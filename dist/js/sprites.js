// Pre-rendered canvases: soft glow sprites and the cached static bezel.

import { BAND_COLORS, makeProjection, project } from './math.js';

const GLOW_SPRITE_SIZE = 96;
const CORE_COLOR = BAND_COLORS.low; // the core is the low band: amber heat
const RING_SEGMENTS = 100;
const TICK_COUNT = 80;
const TICK_ARC = 0.034;
const TICK_INNER = 15.7;
const TICK_OUTER = 16.15;

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function radialSprite(color, stops) {
  const canvas = makeCanvas(GLOW_SPRITE_SIZE);
  const g = canvas.getContext('2d');
  const half = GLOW_SPRITE_SIZE / 2;
  const gradient = g.createRadialGradient(half, half, 0, half, half, half);
  const [r, gr, b] = color.map(Math.round);
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(${r},${gr},${b},${alpha})`);
  g.fillStyle = gradient;
  g.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  return canvas;
}

/** One soft glow sprite per frequency band (index = low, mid, high). */
export function createGlowSprites() {
  const stops = [[0, 0.85], [0.22, 0.45], [0.55, 0.12], [1, 0]];
  return [BAND_COLORS.low, BAND_COLORS.mid, BAND_COLORS.high].map((c) => radialSprite(c, stops));
}

/** Wide, faint glow that sits under the core and follows overall energy. */
export function createCoreGlowSprite() {
  return radialSprite(CORE_COLOR, [[0, 0.55], [0.35, 0.25], [0.7, 0.07], [1, 0]]);
}

function strokeRing(g, projection, radius, color, width) {
  g.beginPath();
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    const [x, y] = project(projection, Math.cos(a) * radius, Math.sin(a) * radius);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

function fillTick(g, projection, index) {
  const a0 = (index / TICK_COUNT) * Math.PI * 2;
  const a1 = a0 + TICK_ARC;
  const corners = [
    [a0, TICK_INNER], [a1, TICK_INNER], [a1, TICK_OUTER], [a0, TICK_OUTER],
  ];
  g.beginPath();
  corners.forEach(([a, r], k) => {
    const [x, y] = project(projection, Math.cos(a) * r, Math.sin(a) * r);
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.closePath();
  g.fillStyle = index % 2 ? '#484d31' : '#adac64';
  g.fill();
}

function paintBezel(g, projection) {
  strokeRing(g, projection, 16.4, '#060b07', 20);
  strokeRing(g, projection, 16.5, '#505948', 2);
  strokeRing(g, projection, 16, '#878969', 1);
  strokeRing(g, projection, 17.3, '#303a2d', 1);
  for (let i = 0; i < TICK_COUNT; i++) fillTick(g, projection, i);
}

/**
 * The bezel (rings + tick marks) never changes between frames, so it is drawn
 * to an offscreen canvas that is rebuilt only when size or view changes.
 */
export function createBezelCache() {
  const canvas = document.createElement('canvas');
  let cachedKey = '';

  function get(size, view) {
    const key = `${size.width}|${size.height}|${size.dpr}|${view.angle}|${view.tilt}|${view.zoom}`;
    if (key === cachedKey) return canvas;
    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    const g = canvas.getContext('2d');
    g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    paintBezel(g, makeProjection(size.width, size.height, view));
    cachedKey = key;
    return canvas;
  }

  return { get };
}
