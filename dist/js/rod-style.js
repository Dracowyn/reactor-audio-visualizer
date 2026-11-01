// Quantised, lazily cached fill styles for rod tops and sides. Looking up a
// string beats building one per rod per frame.

import { GRID_RADIUS, bandColorAt, clamp, mixColor, restColor, rgbString } from './math.js';

export const LEVELS = 32;
const TOP_BAND_MIX = 1; // the hottest rods reach their band colour in full
const TOP_HIGHLIGHT = [244, 247, 214];
const TOP_HIGHLIGHT_MIX = 0.08; // a small lift only: cream must never replace the band hue
const SIDE_LIFT = [30, 30, 20];

// Resting colours of the four box sides (see FACE_NORMALS in math.js).
const FACE_COLORS = [
  [66, 72, 56],
  [55, 62, 44],
  [51, 60, 43],
  [57, 67, 47],
];

/** Map an amplitude (0..1+) to a palette level. */
export function levelOf(amplitude) {
  return Math.round(clamp(amplitude, 0, 1) * (LEVELS - 1));
}

function buildSideStyles() {
  return FACE_COLORS.map((color) =>
    Array.from({ length: LEVELS }, (_, level) => {
      const t = level / (LEVELS - 1);
      return rgbString(color.map((channel, k) => channel + t * SIDE_LIFT[k]));
    }),
  );
}

export function createRodStyles(rods) {
  const bases = rods.map((rod) => restColor(rod.seed));
  const bands = rods.map((rod) => bandColorAt(rod.r / GRID_RADIUS));
  const tops = new Array(rods.length * LEVELS);
  const sides = buildSideStyles();

  /** Top colour: rest colour tinted toward the rod's band colour by amplitude. */
  function topStyle(rodIndex, level) {
    const key = rodIndex * LEVELS + level;
    let style = tops[key];
    if (style === undefined) {
      const t = level / (LEVELS - 1);
      const tinted = mixColor(bases[rodIndex], bands[rodIndex], t * TOP_BAND_MIX);
      style = rgbString(mixColor(tinted, TOP_HIGHLIGHT, t * t * TOP_HIGHLIGHT_MIX));
      tops[key] = style;
    }
    return style;
  }

  function sideStyle(face, level) {
    return sides[face][level];
  }

  return { topStyle, sideStyle };
}
