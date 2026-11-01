import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjection, project } from '../dist/js/math.js';
import { attachInput } from '../dist/js/input.js';

// Minimal DOM stand-ins: input.js only needs addEventListener on the canvas and document.
function setup() {
  const canvasHandlers = {};
  const documentHandlers = {};
  const canvas = {
    addEventListener: (type, fn) => { canvasHandlers[type] = fn; },
    setPointerCapture() {},
  };
  globalThis.document = { addEventListener: (type, fn) => { documentHandlers[type] = fn; } };
  let view = { angle: -0.32, tilt: 0.58, zoom: 1 };
  const renderer = {
    getView: () => view,
    setView: (patch) => { view = { ...view, ...patch }; },
    resetView() {},
  };
  attachInput(canvas, { renderer, onChange() {}, onTogglePlay() {} });
  return { canvasHandlers, documentHandlers, canvas, getView: () => view };
}

/** Screen x of a rod on the near side (z > 0) of the turntable. */
const nearSideScreenX = (view) => project(makeProjection(900, 740, view), 0, 10)[0];

test('dragging right moves the near side of the turntable to the right', () => {
  const { canvasHandlers, getView } = setup();
  const before = nearSideScreenX(getView());
  canvasHandlers.pointerdown({ clientX: 100, clientY: 100, pointerId: 1 });
  canvasHandlers.pointermove({ clientX: 160, clientY: 100 });
  assert.ok(nearSideScreenX(getView()) > before);
});

test('dragging left moves the near side of the turntable to the left', () => {
  const { canvasHandlers, getView } = setup();
  const before = nearSideScreenX(getView());
  canvasHandlers.pointerdown({ clientX: 100, clientY: 100, pointerId: 1 });
  canvasHandlers.pointermove({ clientX: 40, clientY: 100 });
  assert.ok(nearSideScreenX(getView()) < before);
});

test('ArrowRight on the canvas turns the near side right, like dragging right', () => {
  const { canvas, documentHandlers, getView } = setup();
  const before = nearSideScreenX(getView());
  documentHandlers.keydown({ key: 'ArrowRight', target: canvas, preventDefault() {} });
  assert.ok(nearSideScreenX(getView()) > before);
});

test('ArrowLeft on the canvas turns the near side left', () => {
  const { canvas, documentHandlers, getView } = setup();
  const before = nearSideScreenX(getView());
  documentHandlers.keydown({ key: 'ArrowLeft', target: canvas, preventDefault() {} });
  assert.ok(nearSideScreenX(getView()) < before);
});

test('vertical drag still tilts: dragging down raises the tilt', () => {
  const { canvasHandlers, getView } = setup();
  const before = getView().tilt;
  canvasHandlers.pointerdown({ clientX: 100, clientY: 100, pointerId: 1 });
  canvasHandlers.pointermove({ clientX: 100, clientY: 140 });
  assert.ok(getView().tilt > before);
});
