// View controls: drag to rotate / tilt, wheel and keyboard zoom, shortcuts.

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

function attachPointer(canvas, { renderer, onChange }) {
  let last = null;

  canvas.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    const view = renderer.getView();
    renderer.setView({
      // Larger angle swings the near side left, so subtract: the near side follows the pointer.
      angle: view.angle - (e.clientX - last.x) * DRAG_ROTATE,
      tilt: view.tilt + (e.clientY - last.y) * DRAG_TILT,
    });
    last = { x: e.clientX, y: e.clientY };
    onChange();
  });
  const endDrag = () => {
    last = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
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
