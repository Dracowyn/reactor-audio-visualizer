// Canvas sizing shared by the core and spectrum views.

export const MAX_DPR = 2;

/**
 * Match the backing store to the element's CSS size and device pixel ratio
 * (capped at MAX_DPR). Returns CSS-pixel size; drawing code uses CSS pixels.
 */
export function fitCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height, dpr };
}
