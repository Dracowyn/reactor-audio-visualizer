// Entry point: wires the DOM, audio engine and renderers, and owns the frame loop.

import { binToFrequency, clamp, formatTime, levelToDb } from './math.js';
import { createAudioEngine } from './audio.js';
import { createRenderer } from './renderer.js';
import { createSpectrum } from './spectrum.js';
import { attachInput } from './input.js';
import { registerResponseTool } from './tool.js';
import {
  TRACKS, describeMapping, els, renderControls, resetTimeline, setElapsed, setNotice, setRangeFill, setReadouts, showTrack,
} from './ui.js';

const FRAME_MS = 1000 / 60;
const MAX_FRAME_STEP = 3; // cap dt (in 60 fps frames) after stalls or tab switches
const READOUT_INTERVAL_MS = 100;
const AUDIO_EXTENSION = /\.(mp3|wav|m4a|flac|ogg|oga|opus|aac|weba|webm)$/i;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const renderer = createRenderer(els.core);
const spectrum = createSpectrum(els.spectrum);

let settings = { gain: 1.4, heightFactor: 1, smoothing: 0.75 };
let rafId = 0;
let lastFrame = 0;
let lastReadout = -Infinity;
let wasPlaying = false;
let isSeeking = false;

const engine = createAudioEngine({
  onChange() {
    renderControls({ playing: engine.playing, mode: engine.mode });
    requestRender();
  },
  onNotice: setNotice,
  onContextReady: ({ sampleRate, fftSize }) => renderer.setBinMapping(sampleRate, fftSize),
  onEnded: resetTimeline,
});

/* ---- Frame loop: runs only while something is changing ---------------- */

function requestRender() {
  if (!rafId) rafId = window.requestAnimationFrame(frame);
}

/** Rods breathe in demo preview; reduced motion freezes it to one static frame. */
function idleTimeFor(playing, now) {
  if (playing || engine.mode !== 'demo') return null;
  return reducedMotion.matches ? 0 : now;
}

function updateReadouts(now, analysis) {
  const playing = analysis !== null;
  const stateChanged = playing !== wasPlaying;
  wasPlaying = playing;
  if (!stateChanged && now - lastReadout < READOUT_INTERVAL_MS) return;
  lastReadout = now;
  if (!playing) {
    setReadouts(null, null);
    return;
  }
  const peak = engine.findPeak();
  const hz = peak ? Math.round(binToFrequency(peak.index, peak.sampleRate, peak.fftSize)) : null;
  setReadouts(levelToDb(analysis.energy), hz);
  const seconds = engine.getElapsed();
  const canFollow = engine.mode === 'file' && !isSeeking && engine.duration > 0;
  setElapsed(formatTime(seconds), canFollow ? (seconds / engine.duration) * 100 : null);
}

function frame(now) {
  rafId = 0;
  const dt = lastFrame ? clamp((now - lastFrame) / FRAME_MS, 0, MAX_FRAME_STEP) : 1;
  lastFrame = now;
  const playing = engine.playing;
  const analysis = playing ? engine.analyse() : null;
  const idleTime = idleTimeFor(playing, now);

  const rodsMoving = renderer.render({
    dt,
    spectrum: analysis ? analysis.bins : null,
    energy: analysis ? analysis.energy : 0,
    idleTime,
    gain: settings.gain,
    heightFactor: settings.heightFactor,
    smoothing: settings.smoothing,
  });
  const barsMoving = spectrum.draw(analysis ? analysis.bins : null, dt);
  updateReadouts(now, analysis);

  const isBreathing = idleTime !== null && !reducedMotion.matches;
  if (playing || isBreathing || rodsMoving || barsMoving) requestRender();
  else lastFrame = 0;
}

/** Redraw immediately (a resized canvas is blank until redrawn). */
function renderNow() {
  if (rafId) window.cancelAnimationFrame(rafId);
  rafId = 0;
  frame(performance.now());
}

/* ---- Sliders ---------------------------------------------------------- */

function bindSlider(input, output, format, onValue) {
  const sync = () => {
    output.textContent = format(input.value);
    setRangeFill(input);
    onValue(Number(input.value));
    requestRender();
  };
  input.addEventListener('input', sync);
  sync();
}

function bindSliders() {
  bindSlider(els.gain, els.gainValue, (v) => `${Number(v).toFixed(1)}×`, (gain) => {
    settings = { ...settings, gain };
  });
  bindSlider(els.relief, els.reliefValue, (v) => `${v}%`, (percent) => {
    settings = { ...settings, heightFactor: percent / 100 };
  });
  bindSlider(els.smooth, els.smoothValue, (v) => `${v}%`, (percent) => {
    settings = { ...settings, smoothing: percent / 100 };
  });
  bindSlider(els.volume, els.volumeValue, (v) => `${v}%`, (percent) => engine.setVolume(percent / 100));
}

/* ---- Transport and sources -------------------------------------------- */

function selectSource(mode) {
  showTrack(TRACKS[mode]);
  resetTimeline();
  engine.selectSource(mode);
}

async function importFile(file) {
  const meta = await engine.loadFile(file);
  if (!meta) return;
  showTrack({ name: meta.name, durationLabel: formatTime(meta.duration) });
  resetTimeline();
  await engine.start();
}

function isAudioFile(file) {
  return file.type.startsWith('audio/') || AUDIO_EXTENSION.test(file.name);
}

function importIfAudio(file) {
  if (!file) return;
  if (isAudioFile(file)) importFile(file);
  else setNotice('not-audio');
}

function bindSeek() {
  const preview = () => {
    isSeeking = true;
    const fraction = Number(els.seek.value) / 100;
    setElapsed(formatTime(fraction * engine.duration), null);
    setRangeFill(els.seek);
  };
  const commit = () => {
    const offset = engine.seek(Number(els.seek.value) / 100);
    if (offset !== null) setElapsed(formatTime(offset), null);
    isSeeking = false;
  };
  els.seek.addEventListener('input', preview);
  els.seek.addEventListener('change', commit);
  els.seek.addEventListener('pointerdown', () => { isSeeking = true; });
  els.seek.addEventListener('pointerup', () => { isSeeking = false; });
  els.seek.addEventListener('pointercancel', () => { isSeeking = false; });
}

function bindDropZone() {
  let depth = 0; // dragenter/dragleave fire for every child element
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const setDropping = (on) => els.stage.classList.toggle('is-dropping', on);

  els.stage.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    setDropping(true);
  });
  els.stage.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  els.stage.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) setDropping(false);
  });
  els.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    setDropping(false);
    importIfAudio(e.dataTransfer?.files?.[0]);
  });
}

function bindControls() {
  els.play.addEventListener('click', () => engine.toggle());
  els.demo.addEventListener('click', () => selectSource('demo'));
  els.mic.addEventListener('click', () => selectSource('mic'));
  els.upload.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', (e) => {
    importIfAudio(e.target.files[0]);
    e.target.value = '';
  });
  els.reset.addEventListener('click', () => {
    renderer.resetView();
    requestRender();
  });
  els.fullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    els.fullscreen.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
  window.addEventListener('pagehide', () => engine.stop());
  reducedMotion.addEventListener('change', requestRender);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    setNotice('no-fullscreen');
  }
}

/* ---- Boot ------------------------------------------------------------- */

function applyResponse({ sensitivity, smoothing }) {
  els.gain.value = sensitivity;
  els.gain.dispatchEvent(new Event('input'));
  els.smooth.value = smoothing;
  els.smooth.dispatchEvent(new Event('input'));
}

function boot() {
  els.mapping.textContent = describeMapping(renderer.rodCount);
  const observer = new ResizeObserver(() => {
    renderer.resize();
    spectrum.resize();
    renderNow();
  });
  observer.observe(els.core);
  observer.observe(els.spectrum);
  bindSliders();
  bindSeek();
  bindDropZone();
  bindControls();
  attachInput(els.core, { renderer, onChange: requestRender, onTogglePlay: () => engine.toggle() });
  registerResponseTool({
    apply: applyResponse,
    read: () => ({ sensitivity: settings.gain, smoothing: settings.smoothing * 100 }),
  });
  renderControls({ playing: false, mode: engine.mode });
  requestRender();
}

boot();
