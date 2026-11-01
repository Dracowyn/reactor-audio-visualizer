// Mini spectrum: band-coloured bars with rounded tops and falling peak caps.

import { bandColorAt, mixColor, rgbString } from './math.js';
import { fitCanvas } from './canvas.js';

const BAR_COUNT = 48;
const BAR_GAP = 3;
const MIN_BAR_PX = 2;
const CAP_PX = 2;
const BIN_FRACTION = 0.68; // upper part of the spectrum is rarely interesting
const RELEASE = 0.86; // per-frame multiplier for falling bars
const PEAK_HOLD_FRAMES = 30;
const PEAK_FALL = 0.012;
const SETTLED_LEVEL = 0.004;
const CAP_LIGHTEN = [244, 247, 214];
const CAP_LIGHTEN_MIX = 0.45;

export function createSpectrum(canvas) {
  const g = canvas.getContext('2d');
  const levels = new Float32Array(BAR_COUNT);
  const peaks = new Float32Array(BAR_COUNT);
  const holds = new Float32Array(BAR_COUNT);
  const barColors = [];
  const capColors = [];
  let size = { width: 0, height: 0 };

  for (let i = 0; i < BAR_COUNT; i++) {
    const color = bandColorAt(i / (BAR_COUNT - 1));
    barColors.push(rgbString(color));
    capColors.push(rgbString(mixColor(color, CAP_LIGHTEN, CAP_LIGHTEN_MIX)));
  }

  function sample(bins, i) {
    if (!bins) return 0;
    const position = Math.pow(i / (BAR_COUNT - 1), 2);
    const index = Math.min(bins.length - 1, Math.floor(position * bins.length * BIN_FRACTION));
    return bins[index] / 255;
  }

  /** Fast attack, slow release; peak caps hold briefly, then fall. */
  function advance(bins, dt) {
    let active = false;
    for (let i = 0; i < BAR_COUNT; i++) {
      const value = sample(bins, i);
      levels[i] = Math.max(value, levels[i] * Math.pow(RELEASE, dt));
      if (levels[i] >= peaks[i]) {
        peaks[i] = levels[i];
        holds[i] = PEAK_HOLD_FRAMES;
      } else if (holds[i] > 0) {
        holds[i] -= dt;
      } else {
        peaks[i] = Math.max(levels[i], peaks[i] - PEAK_FALL * dt);
      }
      if (levels[i] > SETTLED_LEVEL || peaks[i] > SETTLED_LEVEL) active = true;
    }
    return active;
  }

  function drawBar(i, barWidth) {
    const { height } = size;
    const barHeight = Math.max(MIN_BAR_PX, levels[i] * height);
    const x = i * (size.width / BAR_COUNT);
    const y = height - barHeight;
    g.fillStyle = barColors[i];
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, barWidth, barHeight, [barWidth / 2, barWidth / 2, 0, 0]);
    else g.rect(x, y, barWidth, barHeight);
    g.fill();
  }

  function drawCap(i, barWidth) {
    const capY = size.height - Math.max(MIN_BAR_PX, peaks[i] * size.height) - CAP_PX - 1;
    if (peaks[i] < SETTLED_LEVEL || capY < 0) return;
    g.fillStyle = capColors[i];
    g.fillRect(i * (size.width / BAR_COUNT), capY, barWidth, CAP_PX);
  }

  /** Draw one frame. Returns true while bars or caps are still moving. */
  function draw(bins, dt) {
    const active = advance(bins, dt);
    if (!size.width) return active;
    const barWidth = size.width / BAR_COUNT - BAR_GAP;
    g.clearRect(0, 0, size.width, size.height);
    for (let i = 0; i < BAR_COUNT; i++) {
      drawBar(i, barWidth);
      drawCap(i, barWidth);
    }
    return active;
  }

  return {
    draw,
    resize() {
      size = fitCanvas(canvas);
    },
  };
}
