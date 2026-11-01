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
  canvasHandlers.pointermove({ clientX: 160, clientY: 100, pointerId: 1 });
  assert.ok(nearSideScreenX(getView()) > before);
});

test('dragging left moves the near side of the turntable to the left', () => {
  const { canvasHandlers, getView } = setup();
  const before = nearSideScreenX(getView());
  canvasHandlers.pointerdown({ clientX: 100, clientY: 100, pointerId: 1 });
  canvasHandlers.pointermove({ clientX: 40, clientY: 100, pointerId: 1 });
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
  canvasHandlers.pointermove({ clientX: 100, clientY: 140, pointerId: 1 });
  assert.ok(getView().tilt > before);
});

/** Put two fingers down `gap` pixels apart, then spread them to `spread` pixels. */
function pinch(canvasHandlers, gap, spread) {
  canvasHandlers.pointerdown({ clientX: 200, clientY: 300, pointerId: 1 });
  canvasHandlers.pointerdown({ clientX: 200 + gap, clientY: 300, pointerId: 2 });
  canvasHandlers.pointermove({ clientX: 200 + spread, clientY: 300, pointerId: 2 });
}

test('spreading two fingers zooms in', () => {
  const { canvasHandlers, getView } = setup();
  pinch(canvasHandlers, 100, 130);
  assert.ok(getView().zoom > 1);
});

test('pinching two fingers together zooms out', () => {
  const { canvasHandlers, getView } = setup();
  pinch(canvasHandlers, 100, 80);
  assert.ok(getView().zoom < 1);
});

test('a two-finger pinch does not rotate or tilt the view', () => {
  const { canvasHandlers, getView } = setup();
  const before = getView();
  pinch(canvasHandlers, 100, 160);
  assert.equal(getView().angle, before.angle);
  assert.equal(getView().tilt, before.tilt);
});

test('lifting one finger after a pinch resumes rotation without a jump', () => {
  const { canvasHandlers, getView } = setup();
  pinch(canvasHandlers, 100, 160);
  canvasHandlers.pointerup({ pointerId: 2 });
  const before = getView().angle;
  canvasHandlers.pointermove({ clientX: 200, clientY: 300, pointerId: 1 });
  assert.equal(getView().angle, before); // finger 1 has not moved yet
  canvasHandlers.pointermove({ clientX: 230, clientY: 300, pointerId: 1 });
  assert.ok(getView().angle < before); // dragging right subtracts from the angle
});
