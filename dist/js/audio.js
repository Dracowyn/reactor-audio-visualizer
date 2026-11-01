// Web Audio engine: AudioContext graph, demo / file / mic sources, transport.
// UI copy lives elsewhere; the engine reports through onChange / onNotice(code).
//
// Race guards: `session` is bumped by every start() and stop(). Each async
// step compares its own attempt id to `session` and bails out if the user has
// moved on (switched source, paused, loaded another file) in the meantime.

const FFT_SIZE = 2048;
const ANALYSER_SMOOTHING = 0.75;
const DEFAULT_VOLUME = 0.4;
const VOLUME_RAMP_SECONDS = 0.03;

const DEMO_FREQUENCIES = [55, 82.41, 110, 164.81, 220, 329.63, 440, 659.25];
const DEMO_TRIANGLE_VOICES = 3;
const DEMO_VOICE_GAIN = 0.025;
const DEMO_LFO_DEPTH = 0.023;
const DEMO_LFO_BASE_HZ = 0.22;
const DEMO_LFO_STEP_HZ = 0.087;

/** Eight drifting oscillators, each with its own slow amplitude LFO. */
function startDemoSignal(ctx, destination) {
  const nodes = [];
  DEMO_FREQUENCIES.forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const voice = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    osc.type = i < DEMO_TRIANGLE_VOICES ? 'triangle' : 'sine';
    osc.frequency.value = frequency;
    voice.gain.value = DEMO_VOICE_GAIN;
    lfo.frequency.value = DEMO_LFO_BASE_HZ + i * DEMO_LFO_STEP_HZ;
    lfoDepth.gain.value = DEMO_LFO_DEPTH;
    lfo.connect(lfoDepth);
    lfoDepth.connect(voice.gain);
    osc.connect(voice);
    voice.connect(destination);
    osc.start();
    lfo.start();
    nodes.push(osc, lfo, voice, lfoDepth);
  });
  return nodes;
}

function disposeNode(node) {
  try {
    node.stop?.();
  } catch {
    // Already stopped.
  }
  node.disconnect();
}

export function createAudioEngine({ onChange, onNotice, onContextReady, onEnded }) {
  let ctx = null;
  let analyser = null;
  let master = null;
  let bins = null;
  let wave = null;
  let source = null;
  let stream = null;
  let demoNodes = [];
  let buffer = null;
  let mode = 'demo';
  let playing = false;
  let loading = false;
  let session = 0;
  let offset = 0;
  let startedAt = 0;
  let volume = DEFAULT_VOLUME;
  const frame = { bins: null, energy: 0 };

  function buildGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioContextClass();
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    bins = new Uint8Array(analyser.frequencyBinCount);
    wave = new Float32Array(analyser.fftSize);
    master = ctx.createGain();
    master.gain.value = volume;
    analyser.connect(master);
    master.connect(ctx.destination);
    onContextReady({ sampleRate: ctx.sampleRate, fftSize: analyser.fftSize });
  }

  async function ensureContext() {
    if (!ctx) buildGraph();
    await ctx.resume();
  }

  function teardownSources() {
    if (source) {
      source.onended = null;
      disposeNode(source);
      source = null;
    }
    demoNodes.forEach(disposeNode);
    demoNodes = [];
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function stop() {
    session++;
    loading = false;
    teardownSources();
    playing = false;
    onChange();
  }

  function startFileSource() {
    if (offset >= buffer.duration) offset = 0;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => {
      stop();
      offset = 0;
      onEnded();
    };
    source.start(0, offset);
  }

  /** Returns false if the request went stale while waiting for permission. */
  async function startMicSource(attempt) {
    onNotice('mic-wait');
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (attempt !== session) {
      micStream.getTracks().forEach((track) => track.stop());
      return false;
    }
    stream = micStream;
    source = ctx.createMediaStreamSource(micStream);
    source.connect(analyser);
    master.gain.value = 0; // never feed the mic back to the speakers
    onNotice('mic-live');
    return true;
  }

  async function startSource(attempt) {
    if (mode === 'mic') return startMicSource(attempt);
    master.gain.value = volume;
    if (mode === 'file' && buffer) startFileSource();
    else demoNodes = startDemoSignal(ctx, analyser);
    onNotice('ready');
    return true;
  }

  async function start() {
    if (loading || playing) return;
    loading = true;
    const attempt = ++session;
    try {
      await ensureContext();
      if (attempt !== session) return;
      if (!(await startSource(attempt))) return;
      startedAt = ctx.currentTime;
      playing = true;
      onChange();
    } catch {
      if (attempt !== session) return;
      stop();
      onNotice(mode === 'mic' ? 'mic-error' : 'play-error');
    } finally {
      if (attempt === session) loading = false;
    }
  }

  function getElapsed() {
    return playing ? offset + ctx.currentTime - startedAt : offset;
  }

  function pause() {
    offset = getElapsed();
    stop();
  }

  function toggle() {
    if (playing) pause();
    else start();
  }

  /** Switch to the demo signal or the microphone and start right away. */
  function selectSource(nextMode) {
    stop();
    mode = nextMode;
    offset = 0;
    buffer = null;
    onChange();
    return start();
  }

  /** Decode a user file. Resolves { name, duration }, or null if cancelled / failed. */
  async function loadFile(file) {
    stop();
    const id = session;
    loading = true;
    onNotice('decode-wait');
    try {
      await ensureContext();
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      if (id !== session) return null;
      buffer = decoded;
      mode = 'file';
      offset = 0;
      onChange();
      return { name: file.name, duration: decoded.duration };
    } catch {
      if (id === session) onNotice('decode-error');
      return null;
    } finally {
      if (id === session) loading = false;
    }
  }

  /** Jump to a 0..1 fraction of the loaded file; resumes if it was playing. */
  function seek(fraction) {
    if (mode !== 'file' || !buffer) return null;
    const wasPlaying = playing;
    stop();
    offset = fraction * buffer.duration;
    if (wasPlaying) start();
    return offset;
  }

  function setVolume(value) {
    volume = value;
    if (master && mode !== 'mic') {
      master.gain.setTargetAtTime(value, ctx.currentTime, VOLUME_RAMP_SECONDS);
    }
  }

  /** Refresh the shared spectrum / RMS snapshot (buffers are reused). */
  function analyse() {
    analyser.getByteFrequencyData(bins);
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
    frame.bins = bins;
    frame.energy = Math.sqrt(sum / wave.length);
    return frame;
  }

  /** Strongest bin of the latest spectrum, or null if silent. */
  function findPeak() {
    let peakValue = 0;
    let peakIndex = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > peakValue) {
        peakValue = bins[i];
        peakIndex = i;
      }
    }
    return peakValue > 0 ? { index: peakIndex, sampleRate: ctx.sampleRate, fftSize: analyser.fftSize } : null;
  }

  return {
    start, stop, pause, toggle, selectSource, loadFile, seek, setVolume, analyse, findPeak, getElapsed,
    get playing() { return playing; },
    get loading() { return loading; },
    get mode() { return mode; },
    get duration() { return buffer ? buffer.duration : 0; },
  };
}
