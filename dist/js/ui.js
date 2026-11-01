// DOM references, Simplified Chinese copy and small view-update helpers.

import { FREQ_RATIO, MIN_FREQ_HZ, bandIndexOfFrequency, formatFrequency } from './math.js';

const byId = (id) => document.getElementById(id);

export const els = {
  stage: byId('stage'),
  live: byId('live'),
  status: byId('status'),
  core: byId('core'),
  spectrum: byId('spectrum'),
  mapping: byId('mapping'),
  reset: byId('reset'),
  fullscreen: byId('fullscreen'),
  demo: byId('demo'),
  mic: byId('mic'),
  upload: byId('upload'),
  file: byId('file'),
  trackName: byId('trackname'),
  trackSub: byId('tracksub'),
  play: byId('play'),
  seek: byId('seek'),
  elapsed: byId('elapsed'),
  duration: byId('duration'),
  gain: byId('gain'),
  gainValue: byId('gainval'),
  relief: byId('relief'),
  reliefValue: byId('reliefval'),
  smooth: byId('smooth'),
  smoothValue: byId('smoothval'),
  volume: byId('volume'),
  volumeValue: byId('volumeval'),
  level: byId('level'),
  freq: byId('freq'),
  peakBand: byId('peakband'),
  peakDot: byId('peakdot'),
  peakLabel: byId('peaklabel'),
  message: byId('message'),
};

export const NOTICES = {
  ready: '音频仅在本机处理，不会上传。',
  'mic-wait': '等待麦克风授权…',
  'mic-live': '正在监听麦克风；停止或切换输入即可关闭。',
  'mic-error': '无法访问麦克风，请检查浏览器权限，或导入音频。',
  'play-error': '无法播放此音频，请尝试其他文件。',
  'decode-wait': '正在读取音频…',
  'decode-error': '无法读取该文件，请尝试 MP3 或 WAV 音频。',
  'not-audio': '请拖入或选择音频文件（MP3 / WAV / M4A / FLAC）。',
  'no-fullscreen': '当前浏览器不支持全屏。',
};

export const TRACKS = {
  demo: { name: '内置演示信号', durationLabel: '循环演示' },
  mic: { name: '麦克风输入', durationLabel: '实时' },
};

// Index matches bandIndexAt in math.js: 0 low, 1 mid, 2 high.
const BANDS = [
  { key: 'low', label: '低频' },
  { key: 'mid', label: '中频' },
  { key: 'high', label: '高频' },
];

/** One-line description of the rod-to-frequency mapping, built from the real constants. */
export function describeMapping(rodCount) {
  const low = formatFrequency(MIN_FREQ_HZ);
  const high = formatFrequency(MIN_FREQ_HZ * FREQ_RATIO);
  return `${rodCount} 根控制棒 · 中心 ${low} 低频 → 边缘 ${high} 高频`;
}

const MODE_LABELS = {
  demo: { running: '演示信号', idle: '演示预览' },
  mic: { running: '实时输入', idle: '已暂停' },
  file: { running: '音频分析', idle: '已暂停' },
};

const EMPTY_READING = '—';
const ZERO_TIME = '00:00';

export function setNotice(code) {
  els.message.textContent = NOTICES[code] ?? '';
}

/** Position of the value within the range as 0..1, written to the wrapper as --p (used by CSS). */
export function setRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const fraction = (Number(input.value) - min) / (max - min);
  input.parentElement.style.setProperty('--p', String(fraction));
}

/** Sync play button, source tabs, status text and seek availability. */
export function renderControls({ playing, mode }) {
  els.play.textContent = playing ? 'Ⅱ' : '▶';
  els.play.setAttribute('aria-label', playing ? '暂停' : '播放');
  els.play.classList.toggle('is-playing', playing);
  for (const [button, name] of [[els.demo, 'demo'], [els.mic, 'mic']]) {
    button.classList.toggle('selected', mode === name);
    button.setAttribute('aria-pressed', String(mode === name));
  }
  const labels = MODE_LABELS[mode];
  els.status.textContent = `${playing ? '运行中' : '待机'} · ${playing ? labels.running : labels.idle}`;
  els.trackSub.textContent = playing ? '控制棒随频谱实时响应' : '点击播放，启动声场';
  els.seek.disabled = mode !== 'file';
  els.live.classList.toggle('is-live', playing);
}

export function showTrack({ name, durationLabel }) {
  els.trackName.textContent = name;
  els.duration.textContent = durationLabel;
}

export function resetTimeline() {
  els.elapsed.textContent = ZERO_TIME;
  els.seek.value = 0;
  setRangeFill(els.seek);
}

export function setElapsed(label, percent) {
  els.elapsed.textContent = label;
  if (percent !== null) {
    els.seek.value = percent;
    setRangeFill(els.seek);
  }
}

export function setReadouts(levelDb, freqHz) {
  els.level.textContent = levelDb === null ? EMPTY_READING : String(levelDb);
  els.freq.textContent = freqHz === null ? EMPTY_READING : String(freqHz);
  setPeakBand(freqHz);
}

/** Show which band the peak frequency falls in, with a dot in that band's colour. */
function setPeakBand(freqHz) {
  els.peakBand.hidden = freqHz === null;
  if (freqHz === null) return;
  const band = BANDS[bandIndexOfFrequency(freqHz)];
  els.peakDot.dataset.band = band.key;
  els.peakLabel.textContent = band.label;
}
