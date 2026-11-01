// Pure helpers: rod grid, frequency mapping, projection, colour and formatting.
// Nothing in this file touches the DOM, canvas or Web Audio.

export const GRID_RADIUS = 15;
export const ROD_HALF_SIZE = 0.44;
export const REST_HEIGHT = 0.07;
export const HEIGHT_SCALE = 4.8;

export const MIN_FREQ_HZ = 45;
export const FREQ_RATIO = 320; // 45 Hz at the centre up to 14.4 kHz at the rim

const GRID_FIT_WIDTH = 45;
const GRID_FIT_HEIGHT = 37;
const HORIZON_RATIO = 0.55;
const AMP_BIN_DIVISOR = 765; // 3 bins * 255
const AMP_EXPONENT = 1.7;
export const HEIGHT_KNEE_RATIO = 0.4; // heights up to this share of the ceiling are not compressed
export const HEIGHT_TOP_MARGIN = 0.25; // the tallest rod at the centre stops this far down from the stage top (share of stage height)
const SMOOTH_BASE = 0.45;
const SMOOTH_RANGE = 0.53;
const FACE_EPSILON = 1e-9;
const MIN_RMS = 0.001;

export const BAND_COLORS = Object.freeze({
  low: Object.freeze([230, 186, 118]), // #e6ba76
  mid: Object.freeze([197, 209, 133]), // #c5d185
  high: Object.freeze([153, 180, 169]), // #99b4a9
});

// Outward normals (x, z) of the four box sides. Face k joins corner k to k+1,
// corners ordered (-,-) (+,-) (+,+) (-,+).
export const FACE_NORMALS = Object.freeze([
  Object.freeze([0, -1]),
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([-1, 0]),
]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Circular grid of rods with r <= GRID_RADIUS. Each rod: { x, z, r, seed }. */
export function generateRods() {
  const rods = [];
  for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x++) {
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z++) {
      const r = Math.hypot(x, z);
      if (r <= GRID_RADIUS) {
        rods.push({ x, z, r, seed: Math.abs(Math.sin(x * 127.1 + z * 311.7)) });
      }
    }
  }
  return rods;
}

/** Rod radius (0..15) to a log-spaced frequency in Hz. */
export function radiusToFrequency(radius) {
  return MIN_FREQ_HZ * Math.pow(FREQ_RATIO, radius / GRID_RADIUS);
}

/** Frequency to an FFT bin index, clamped so neighbours (bin-1, bin+1) exist. */
export function frequencyToBin(hz, sampleRate, fftSize) {
  const binCount = fftSize / 2;
  const bin = Math.round((hz * fftSize) / sampleRate);
  return clamp(bin, 1, binCount - 2);
}

export function radiusToBin(radius, sampleRate, fftSize) {
  return frequencyToBin(radiusToFrequency(radius), sampleRate, fftSize);
}

export function binToFrequency(bin, sampleRate, fftSize) {
  return (bin * sampleRate) / fftSize;
}

/** Seconds to "mm:ss" (minutes keep counting past 59). Invalid input gives 00:00. */
export function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

/** Rotate a ground point around the vertical axis. */
export function rotatePoint(x, z, angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return { rx: x * cos - z * sin, rz: x * sin + z * cos };
}

/** Indices of box sides facing the viewer (1 or 2 of them). */
export function visibleFaces(angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const faces = [];
  FACE_NORMALS.forEach(([nx, nz], index) => {
    if (nx * sin + nz * cos > FACE_EPSILON) faces.push(index);
  });
  return faces;
}

/** Rod indices in painter order: far (small rz) first. */
export function depthOrder(rods, angle) {
  const depths = rods.map((rod) => rotatePoint(rod.x, rod.z, angle).rz);
  return rods.map((_, index) => index).sort((a, b) => depths[a] - depths[b]);
}

/** Per-frame camera: computed once, reused for every projected point. */
export function makeProjection(width, height, view) {
  return {
    cx: width / 2,
    cy: height * HORIZON_RATIO,
    scale: Math.min(width / GRID_FIT_WIDTH, height / GRID_FIT_HEIGHT) * view.zoom,
    sin: Math.sin(view.angle),
    cos: Math.cos(view.angle),
    tilt: view.tilt,
  };
}

/** World (x, z, height) to screen [x, y]. */
export function project(projection, x, z, h = 0) {
  const { cx, cy, scale, sin, cos, tilt } = projection;
  const rx = x * cos - z * sin;
  const rz = x * sin + z * cos;
  return [cx + rx * scale, cy + rz * scale * tilt - h * scale];
}

export function mixColor(a, b, t) {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function rgbString(color) {
  return `rgb(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])})`;
}

/** Legend colour at normalised radius / position t in 0..1 (low -> mid -> high). */
export function bandColorAt(t) {
  const k = clamp(t, 0, 1);
  return k < 0.5
    ? mixColor(BAND_COLORS.low, BAND_COLORS.mid, k * 2)
    : mixColor(BAND_COLORS.mid, BAND_COLORS.high, (k - 0.5) * 2);
}

/** 0 = low, 1 = mid, 2 = high band for a normalised radius. */
export function bandIndexAt(t) {
  return t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2;
}

/** Frequency in Hz to a rod radius (inverse of radiusToFrequency), unclamped. */
export function frequencyToRadius(hz) {
  return (GRID_RADIUS * Math.log(hz / MIN_FREQ_HZ)) / Math.log(FREQ_RATIO);
}

/** Band (0 low, 1 mid, 2 high) a frequency falls in, using the renderer's thresholds. */
export function bandIndexOfFrequency(hz) {
  const radius = hz > 0 ? clamp(frequencyToRadius(hz), 0, GRID_RADIUS) : 0;
  return bandIndexAt(radius / GRID_RADIUS);
}

/** Hz to a short label: "45 Hz" below 1 kHz, "14.4 kHz" at or above it. */
export function formatFrequency(hz) {
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  return `${Number((hz / 1000).toFixed(1))} kHz`;
}

/** Resting top colour of a rod; a few seeds get the odd rust / sage rods. */
export function restColor(seed) {
  if (seed > 0.92) return [143, 109, 81];
  if (seed > 0.85) return [97, 118, 104];
  return [139 + seed * 29, 148 + seed * 22, 119 + seed * 21];
}

/**
 * Soft-knee limiter: identity (slope 1) up to the knee, then an exponential
 * approach to the ceiling. Value and slope are continuous at the knee.
 */
export function softLimit(x, knee, ceiling) {
  if (x <= knee) return x;
  const room = ceiling - knee;
  return knee + room * (1 - Math.exp(-(x - knee) / room));
}

/** Rod height (world units above rest) the stage can hold: the centre rod's top stays below the top margin. */
export function heightCeiling(width, height, zoom) {
  if (!(width > 0) || !(height > 0)) return Infinity;
  const { scale } = makeProjection(width, height, { angle: 0, tilt: 1, zoom });
  return (height * (HORIZON_RATIO - HEIGHT_TOP_MARGIN)) / scale;
}

/** Compress a rod height smoothly toward the ceiling; untouched below HEIGHT_KNEE_RATIO of it. */
export function limitHeight(height, ceiling) {
  return softLimit(height, ceiling * HEIGHT_KNEE_RATIO, ceiling);
}

/** Smoothed 3-bin average of a byte spectrum, shaped and scaled by sensitivity (unbounded: it drives heat, not height). */
export function shapeAmplitude(bins, index, gain) {
  const average = (bins[index] + bins[index - 1] + bins[index + 1]) / AMP_BIN_DIVISOR;
  return Math.pow(average, AMP_EXPONENT) * gain;
}

/** Slow travelling "breathing" wave shown while idle. timeMs in milliseconds. */
export function idleAmplitude(radius, x, timeMs) {
  return 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(radius * 0.6 - timeMs * 0.0007 + x * 0.1));
}

/** Rod height from amplitude: scaled by the height factor, then limited to the stage ceiling. */
export function targetHeight(amplitude, heightFactor = 1, ceiling = Infinity) {
  return REST_HEIGHT + limitHeight(amplitude * HEIGHT_SCALE * heightFactor, ceiling);
}

/** Fraction of the gap to the target closed in one frame; dt is in 60 fps frames. */
export function smoothingBlend(smoothing, dt) {
  return 1 - Math.pow(SMOOTH_BASE + smoothing * SMOOTH_RANGE, dt);
}

/** RMS level to whole dB, floored at -60 dB. */
export function levelToDb(rms) {
  return Math.round(20 * Math.log10(Math.max(rms, MIN_RMS)));
}
