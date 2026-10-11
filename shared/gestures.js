// Tap / double-tap / vertical-swipe recogniser. The core (createRecognizer) is
// a pure state machine so it can be tested without a DOM; attachGestures binds
// it to pointer events.

export function createRecognizer({
  onTap = () => {}, onDoubleTap = () => {}, onSwipe = () => {},
  doubleTapMs = 300, swipeThreshold = 24,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
} = {}) {
  let start = null;        // { x, y, t }
  let lastY = 0;
  let swiping = false;
  let moved = false;
  let pendingTap = null;   // timer id for a delayed single tap
  let lastTapAt = -Infinity;

  function down(x, y, t) {
    start = { x, y, t };
    lastY = y;
    swiping = false;
    moved = false;
  }

  function move(x, y) {
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (!swiping) {
      if (Math.abs(dy) >= swipeThreshold && Math.abs(dy) > Math.abs(dx)) {
        swiping = true;
        onSwipe({ dy: y - lastY });
        lastY = y;
      } else if (Math.abs(dx) >= swipeThreshold) {
        moved = true; // horizontal drag: not a tap
      }
      return;
    }
    if (y !== lastY) {
      onSwipe({ dy: y - lastY });
      lastY = y;
    }
  }

  function up(x, y, t) {
    if (!start) return;
    const wasSwipe = swiping;
    const wasMoved = moved;
    start = null;
    swiping = false;
    if (wasSwipe || wasMoved) return;

    if (t - lastTapAt <= doubleTapMs && pendingTap) {
      cancel(pendingTap);
      pendingTap = null;
      lastTapAt = -Infinity;
      onDoubleTap();
      return;
    }
    lastTapAt = t;
    pendingTap = schedule(() => { pendingTap = null; onTap(); }, doubleTapMs);
  }

  // A system-cancelled pointer (scroll takeover, incoming call) is neither a
  // tap nor a swipe: forget it without scheduling anything.
  function cancelPointer() {
    start = null;
    swiping = false;
    moved = false;
  }

  return { down, move, up, cancel: cancelPointer };
}

export function attachGestures(el, handlers) {
  const r = createRecognizer(handlers);
  const now = () => performance.now();
  const onDown = e => { if (e.isPrimary) r.down(e.clientX, e.clientY, now()); };
  const onMove = e => { if (e.isPrimary) r.move(e.clientX, e.clientY, now()); };
  const onUp = e => { if (e.isPrimary) r.up(e.clientX, e.clientY, now()); };
  const onCancel = e => { if (e.isPrimary) r.cancel(); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
