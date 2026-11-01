// View controls: drag to rotate / tilt, wheel, pinch and keyboard zoom, shortcuts.

const DRAG_ROTATE = 0.006;
const DRAG_TILT = 0.002;
const WHEEL_ZOOM = 0.001;
const KEY_ROTATE = 0.08;
const KEY_TILT = 0.04;
const KEY_ZOOM = 0.08;

const TEXT_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const CLICKABLE_TARGETS = new Set(['BUTTON', 'A', 'SUMMARY']);

function isTyping(target) {
  return TEXT_TARGETS.has(target.tagName) || target.isContentEditable;
}

/** Distance between the first two active pointers. */
function spanOf(pointers) {
  const [a, b] = pointers.values();
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// One pointer rotates / tilts; two pointers pinch-zoom (touch-action: none hands us every touch).
function attachPointer(canvas, { renderer, onChange }) {
  const pointers = new Map(); // pointerId -> last { x, y }
  let pinchSpan = 0;

  function rotate(from, e) {
    const view = renderer.getView();
    renderer.setView({
      // Larger angle swings the near side left, so subtract: the near side follows the pointer.
      angle: view.angle - (e.clientX - from.x) * DRAG_ROTATE,
      tilt: view.tilt + (e.clientY - from.y) * DRAG_TILT,
    });
  }

  function pinch() {
    const span = spanOf(pointers);
    if (pinchSpan > 0 && span > 0) renderer.setView({ zoom: renderer.getView().zoom * (span / pinchSpan) });
    pinchSpan = span;
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) pinchSpan = spanOf(pointers);
  });
  canvas.addEventListener('pointermove', (e) => {
    const from = pointers.get(e.pointerId);
    if (!from) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) rotate(from, e);
    else pinch();
    onChange();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    pinchSpan = pointers.size >= 2 ? spanOf(pointers) : 0;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
}

function attachWheel(canvas, { renderer, onChange }) {
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      renderer.setView({ zoom: renderer.getView().zoom - e.deltaY * WHEEL_ZOOM });
      onChange();
    },
    { passive: false },
  );
}

// Arrow keys only act while the canvas has focus (sliders need them elsewhere).
const CANVAS_KEYS = {
  ArrowLeft: (v) => ({ angle: v.angle + KEY_ROTATE }),
  ArrowRight: (v) => ({ angle: v.angle - KEY_ROTATE }),
  ArrowUp: (v) => ({ tilt: v.tilt - KEY_TILT }),
  ArrowDown: (v) => ({ tilt: v.tilt + KEY_TILT }),
};
const GLOBAL_KEYS = {
  '+': (v) => ({ zoom: v.zoom + KEY_ZOOM }),
  '=': (v) => ({ zoom: v.zoom + KEY_ZOOM }),
  '-': (v) => ({ zoom: v.zoom - KEY_ZOOM }),
  _: (v) => ({ zoom: v.zoom - KEY_ZOOM }),
};

/** Returns true when the key was a view shortcut and has been applied. */
function applyViewKey(key, renderer, fromCanvas) {
  if (key === 'r' || key === 'R') {
    renderer.resetView();
    return true;
  }
  const handler = (fromCanvas && CANVAS_KEYS[key]) || GLOBAL_KEYS[key];
  if (!handler) return false;
  renderer.setView(handler(renderer.getView()));
  return true;
}

function attachKeyboard(canvas, { renderer, onChange, onTogglePlay }) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (CLICKABLE_TARGETS.has(e.target.tagName)) return; // already activates itself
      e.preventDefault();
      onTogglePlay();
      return;
    }
    if (applyViewKey(e.key, renderer, e.target === canvas)) {
      e.preventDefault();
      onChange();
    }
  });
}

/** options: { renderer, onChange, onTogglePlay } */
export function attachInput(canvas, options) {
  attachPointer(canvas, options);
  attachWheel(canvas, options);
  attachKeyboard(canvas, options);
}
