// Core canvas: 709 isometric control rods, bezel, glow and per-frame animation.
// Rod heights live in typed arrays that are mutated in place every frame
// (deliberate: ~700 writes per frame, no allocation). Everything else that is
// shared (view, size) is replaced rather than mutated.

import {
  GRID_RADIUS, REST_HEIGHT, ROD_HALF_SIZE,
  bandIndexAt, clamp, depthOrder, generateRods, heightCeiling, idleAmplitude, makeProjection,
  radiusToBin, rotatePoint, shapeAmplitude, smoothingBlend, targetHeight, visibleFaces,
} from './math.js';
import { fitCanvas } from './canvas.js';
import { createRodStyles, levelOf } from './rod-style.js';
import { createBezelCache, createCoreGlowSprite, createGlowSprites } from './sprites.js';

export const DEFAULT_VIEW = Object.freeze({ angle: -0.32, tilt: 0.58, zoom: 1 });
const TILT_RANGE = [0.25, 0.85];
const ZOOM_RANGE = [0.65, 1.5];

const MOTION_EPSILON = 0.002;
const AMP_GAP_WEIGHT = 1; // amplitude gaps count like height gaps when deciding to keep animating
const OUTLINE_COLOR = '#141b12';
const OUTLINE_WIDTH = 0.55;
const CAP_COLOR = '#404735';
const SPARKLE_COLOR = '#c3c7a3';
const DETAIL_MIN_SCALE = 9; // skip tiny cap details when zoomed far out
const SPARKLE_MIN_SCALE = 13;
const SPARKLE_MIN_SEED = 0.6;

const GLOW_THRESHOLD = 0.38;
const GLOW_MAX_ALPHA = 0.24;
const GLOW_BASE_SIZE = 2.2;
const GLOW_SIZE_GAIN = 1.4;
const GLOW_BUDGET_RODS = 36; // hot-rod count up to which glow alpha is not reduced
const GLOW_BLEND = 'screen';

const CORE_REST = 0.12;
const CORE_ENERGY_GAIN = 5;
const CORE_FOLLOW = 0.12;
const CORE_ALPHA = 0.3;
const CORE_RADIUS = 14;

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function clampView(view) {
  return {
    angle: view.angle,
    tilt: clamp(view.tilt, TILT_RANGE[0], TILT_RANGE[1]),
    zoom: clamp(view.zoom, ZOOM_RANGE[0], ZOOM_RANGE[1]),
  };
}

export function createRenderer(canvas) {
  const g = canvas.getContext('2d');
  const rods = generateRods();
  const count = rods.length;
  const styles = createRodStyles(rods);
  const glowSprites = createGlowSprites();
  const coreSprite = createCoreGlowSprite();
  const bezel = createBezelCache();
  const glowBand = rods.map((rod) => bandIndexAt(rod.r / GRID_RADIUS));

  const heights = new Float32Array(count).fill(REST_HEIGHT);
  const amps = new Float32Array(count); // eased amplitude: drives colour and glow, not height
  const binOf = new Int16Array(count).fill(1);
  const rotX = new Float32Array(count);
  const rotZ = new Float32Array(count);
  const cornerX = new Float64Array(4);
  const cornerY = new Float64Array(4);
  let order = new Int32Array(count);
  let orderAngle = Number.NaN;
  let faces = [];
  let view = DEFAULT_VIEW;
  let size = { width: 0, height: 0, dpr: 1 };
  let coreLevel = CORE_REST;
  let hotCount = 0;

  /** Re-sort for painter order only when the view angle actually changed. */
  function refreshOrder() {
    if (view.angle === orderAngle) return;
    order = Int32Array.from(depthOrder(rods, view.angle));
    rods.forEach((rod, i) => {
      const { rx, rz } = rotatePoint(rod.x, rod.z, view.angle);
      rotX[i] = rx;
      rotZ[i] = rz;
    });
    faces = visibleFaces(view.angle);
    orderAngle = view.angle;
  }

  function targetAmplitude(i, params) {
    if (params.spectrum) return shapeAmplitude(params.spectrum, binOf[i], params.gain);
    if (params.idleTime !== null) return idleAmplitude(rods[i].r, rods[i].x, params.idleTime);
    return 0;
  }

  /**
   * Ease every rod toward its target; returns the largest remaining gap.
   * Height and amplitude ease separately: height is scaled and limited to the
   * stage, amplitude stays raw so colour and glow heat follow sensitivity only.
   */
  function updateHeights(params) {
    const blend = smoothingBlend(params.smoothing, params.dt);
    const ceiling = heightCeiling(size.width, size.height, view.zoom);
    let largestGap = 0;
    let hot = 0;
    for (let i = 0; i < count; i++) {
      const target = targetAmplitude(i, params);
      const heightGap = targetHeight(target, params.heightFactor, ceiling) - heights[i];
      const ampGap = target - amps[i];
      heights[i] += heightGap * blend;
      amps[i] += ampGap * blend;
      if (amps[i] > GLOW_THRESHOLD) hot++;
      largestGap = Math.max(largestGap, Math.abs(heightGap), Math.abs(ampGap) * AMP_GAP_WEIGHT);
    }
    hotCount = hot;
    return largestGap;
  }

  function updateCore(params) {
    const target = params.spectrum ? clamp(params.energy * CORE_ENERGY_GAIN, 0, 1) : CORE_REST;
    const gap = target - coreLevel;
    coreLevel += gap * Math.min(1, CORE_FOLLOW * params.dt);
    return Math.abs(gap);
  }

  /** Screen offsets of a rod's four corners from its centre, once per frame. */
  function prepareCorners({ scale, tilt, sin, cos }) {
    CORNERS.forEach(([dx, dz], k) => {
      const ox = dx * ROD_HALF_SIZE;
      const oz = dz * ROD_HALF_SIZE;
      cornerX[k] = (ox * cos - oz * sin) * scale;
      cornerY[k] = (ox * sin + oz * cos) * scale * tilt;
    });
  }

  function fillSide(face, level, px, baseY, topY) {
    const next = (face + 1) & 3;
    g.beginPath();
    g.moveTo(px + cornerX[face], topY + cornerY[face]);
    g.lineTo(px + cornerX[face], baseY + cornerY[face]);
    g.lineTo(px + cornerX[next], baseY + cornerY[next]);
    g.lineTo(px + cornerX[next], topY + cornerY[next]);
    g.closePath();
    g.fillStyle = styles.sideStyle(face, level);
    g.fill();
    g.stroke();
  }

  function fillTop(i, level, px, topY) {
    g.beginPath();
    g.moveTo(px + cornerX[0], topY + cornerY[0]);
    for (let k = 1; k < 4; k++) g.lineTo(px + cornerX[k], topY + cornerY[k]);
    g.closePath();
    g.fillStyle = styles.topStyle(i, level);
    g.fill();
    g.stroke();
  }

  function fillCap(i, px, topY, scale, tilt) {
    g.beginPath();
    g.ellipse(px, topY, scale * 0.12, scale * 0.12 * tilt, 0, 0, Math.PI * 2);
    g.fillStyle = CAP_COLOR;
    g.fill();
    if (scale > SPARKLE_MIN_SCALE && rods[i].seed > SPARKLE_MIN_SEED) {
      g.fillStyle = SPARKLE_COLOR;
      g.fillRect(px - scale * 0.3, topY - scale * 0.19, 1, 1);
    }
  }

  /** Only the 1-2 side faces that face the viewer are drawn, far rods first. */
  function drawRods({ scale, tilt, cx, cy }) {
    g.lineWidth = OUTLINE_WIDTH;
    g.strokeStyle = OUTLINE_COLOR;
    for (let n = 0; n < count; n++) {
      const i = order[n];
      const px = cx + rotX[i] * scale;
      const baseY = cy + rotZ[i] * scale * tilt;
      const topY = baseY - heights[i] * scale;
      const level = levelOf(amps[i]);
      for (const face of faces) fillSide(face, level, px, baseY, topY);
      fillTop(i, level, px, topY);
      if (scale >= DETAIL_MIN_SCALE) fillCap(i, px, topY, scale, tilt);
    }
  }

  /**
   * Band-coloured halo over hot rods; one composite-mode switch for the whole
   * pass. 'screen' cannot overshoot white, and the per-rod alpha shrinks with
   * the number of hot rods so a dense peak stays a tinted heat, not a blob.
   */
  function drawHotGlow({ scale, tilt, cx, cy }) {
    if (hotCount === 0) return;
    const budget = Math.min(1, Math.sqrt(GLOW_BUDGET_RODS / hotCount));
    g.globalCompositeOperation = GLOW_BLEND;
    for (let n = 0; n < count; n++) {
      const i = order[n];
      const amp = amps[i];
      if (amp <= GLOW_THRESHOLD) continue;
      const heat = Math.min(1, (amp - GLOW_THRESHOLD) / (1 - GLOW_THRESHOLD));
      const glowSize = scale * (GLOW_BASE_SIZE + heat * GLOW_SIZE_GAIN);
      const x = cx + rotX[i] * scale;
      const y = cy + rotZ[i] * scale * tilt - heights[i] * scale;
      g.globalAlpha = heat * GLOW_MAX_ALPHA * budget;
      g.drawImage(glowSprites[glowBand[i]], x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawCoreGlow({ scale, tilt, cx, cy }) {
    const width = CORE_RADIUS * 2 * scale;
    g.globalCompositeOperation = GLOW_BLEND;
    g.globalAlpha = clamp(coreLevel, 0, 1) * CORE_ALPHA;
    g.drawImage(coreSprite, cx - width / 2, cy - (width * tilt) / 2, width, width * tilt);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function draw() {
    const { width, height } = size;
    if (!width || !height) return;
    refreshOrder();
    const projection = makeProjection(width, height, view);
    g.clearRect(0, 0, width, height);
    g.drawImage(bezel.get(size, view), 0, 0, width, height);
    drawCoreGlow(projection);
    prepareCorners(projection);
    drawRods(projection);
    drawHotGlow(projection);
  }

  /**
   * Advance the animation and draw one frame.
   * params: { dt, spectrum: Uint8Array|null, energy, idleTime: ms|null, gain, heightFactor, smoothing }
   * Returns true while rods or glow are still moving (another frame is needed).
   */
  function render(params) {
    const heightGap = updateHeights(params);
    const coreGap = updateCore(params);
    draw();
    return heightGap > MOTION_EPSILON || coreGap > MOTION_EPSILON;
  }

  /** Precompute each rod's FFT bin for the live AudioContext (once per context). */
  function setBinMapping(sampleRate, fftSize) {
    rods.forEach((rod, i) => {
      binOf[i] = radiusToBin(rod.r, sampleRate, fftSize);
    });
  }

  return {
    rodCount: count,
    render,
    setBinMapping,
    resize() {
      size = fitCanvas(canvas);
    },
    getView: () => view,
    setView(patch) {
      view = clampView({ ...view, ...patch });
    },
    resetView() {
      view = DEFAULT_VIEW;
    },
  };
}
