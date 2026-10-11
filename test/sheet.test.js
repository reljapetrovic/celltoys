import { describe, test, expect, vi } from 'vitest';
import { createSheetController } from '../shared/sheet.js';

function fakeTimers() {
  const queue = [];
  return {
    schedule: (fn, ms) => { const id = { fn, ms }; queue.push(id); return id; },
    cancel: id => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); },
    // run only the timers pending now; a callback that re-arms is left for the next flush
    flush: () => { const due = queue.splice(0); for (const t of due) t.fn(); },
    pending: () => queue.length,
  };
}

function setup(opts = {}) {
  const timers = fakeTimers();
  const h = { onShow: vi.fn(), onHide: vi.fn() };
  const c = createSheetController({ ...h, hideAfterMs: 8000, schedule: timers.schedule, cancel: timers.cancel, ...opts });
  return { c, h, timers };
}

describe('sheet controller', () => {
  test('show arms an auto-hide of the configured length', () => {
    const { c, h, timers } = setup();
    c.show();
    expect(h.onShow).toHaveBeenCalledTimes(1);
    expect(c.visible).toBe(true);
    expect(timers.pending()).toBe(1);
    timers.flush();
    expect(h.onHide).toHaveBeenCalledTimes(1);
    expect(c.visible).toBe(false);
  });
  test('does not hide while a pointer is down; hides after it lifts', () => {
    const { c, h, timers } = setup();
    c.show();
    c.pointer(true);
    timers.flush();
    expect(h.onHide).not.toHaveBeenCalled();
    expect(c.visible).toBe(true);
    c.pointer(false);
    timers.flush();
    expect(h.onHide).toHaveBeenCalledTimes(1);
  });
  test('activity re-arms the timer', () => {
    const { c, h, timers } = setup();
    c.show();
    const first = timers.pending();
    c.activity();
    expect(timers.pending()).toBe(first); // old cancelled, new scheduled
    timers.flush();
    expect(h.onHide).toHaveBeenCalledTimes(1);
  });
  test('toggle and explicit hide cancel the pending timer', () => {
    const { c, h, timers } = setup();
    c.toggle();
    expect(c.visible).toBe(true);
    c.toggle();
    expect(c.visible).toBe(false);
    expect(timers.pending()).toBe(0);
    c.show(); c.hide();
    expect(timers.pending()).toBe(0);
    expect(h.onHide).toHaveBeenCalledTimes(2);
  });
  test('activity while hidden does nothing', () => {
    const { c, timers } = setup();
    c.activity();
    expect(timers.pending()).toBe(0);
  });
});
