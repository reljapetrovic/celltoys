// Bottom control sheet with auto-hide, plus a one-line toast. The controller
// is a pure state machine (testable with fake timers); attachSheet and
// createToast bind it to DOM elements.

export function createSheetController({
  hideAfterMs = 8000, onShow = () => {}, onHide = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
} = {}) {
  let visible = false;
  let pointerDown = false;
  let timer = null;

  function arm() {
    if (timer) cancel(timer);
    timer = schedule(() => {
      timer = null;
      if (pointerDown) arm();   // a finger resting on a slider keeps the sheet open
      else hide();
    }, hideAfterMs);
  }
  function show() {
    visible = true;
    onShow();
    arm();
  }
  function hide() {
    if (timer) cancel(timer);
    timer = null;
    visible = false;
    onHide();
  }
  function toggle() { if (visible) hide(); else show(); }
  function activity() { if (visible) arm(); }
  function pointer(down) {
    pointerDown = down;
    if (visible) arm();
  }
  return { show, hide, toggle, activity, pointer, get visible() { return visible; } };
}

// Binds a controller to a sheet element: toggles its `hidden` attribute and
// keeps it open while the user interacts with it.
export function attachSheet(el, { hideAfterMs, onShow } = {}) {
  const c = createSheetController({
    hideAfterMs,
    onShow() { el.hidden = false; onShow?.(); },
    onHide() { el.hidden = true; },
  });
  el.addEventListener('pointerdown', () => c.pointer(true));
  // A mouse or pen can lift outside the sheet (touch has implicit capture), so
  // the release is tracked on the window.
  window.addEventListener('pointerup', () => c.pointer(false));
  window.addEventListener('pointercancel', () => c.pointer(false));
  el.addEventListener('input', () => c.activity());
  el.addEventListener('click', () => c.activity());
  return c;
}

// A short status line at the top of the screen. `ms = 0` keeps it until hide().
export function createToast(el) {
  let timer = null;
  return {
    show(text, ms = 6000) {
      clearTimeout(timer);
      el.textContent = text;
      el.hidden = false;
      if (ms > 0) timer = setTimeout(() => { el.hidden = true; }, ms);
    },
    hide() {
      clearTimeout(timer);
      el.hidden = true;
    },
  };
}
