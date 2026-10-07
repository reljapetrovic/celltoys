import { describe, test, expect, vi } from 'vitest';
import { createRecognizer } from '../shared/gestures.js';

function fakeTimers() {
  const queue = [];
  return {
    schedule: (fn, ms) => { const id = { fn, ms }; queue.push(id); return id; },
    cancel: id => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); },
    flush: () => { while (queue.length) queue.shift().fn(); },
  };
}

function setup() {
  const timers = fakeTimers();
  const h = { onTap: vi.fn(), onDoubleTap: vi.fn(), onSwipe: vi.fn() };
  const r = createRecognizer({ ...h, schedule: timers.schedule, cancel: timers.cancel });
  return { r, h, timers };
}

describe('recognizer', () => {
  test('single tap fires after the double-tap window', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50);
    expect(h.onTap).not.toHaveBeenCalled();
    timers.flush();
    expect(h.onTap).toHaveBeenCalledTimes(1);
  });
  test('double tap fires once and suppresses single tap', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50);
    r.down(12, 11, 200); r.up(12, 11, 240);
    timers.flush();
    expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(h.onTap).not.toHaveBeenCalled();
  });
  test('two taps far apart in time are two single taps', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50); timers.flush();
    r.down(10, 10, 1000); r.up(10, 10, 1050); timers.flush();
    expect(h.onTap).toHaveBeenCalledTimes(2);
    expect(h.onDoubleTap).not.toHaveBeenCalled();
  });
  test('vertical drag beyond threshold emits swipe deltas and no tap', () => {
    const { r, h, timers } = setup();
    r.down(100, 300, 0);
    r.move(100, 290, 10);   // 10px, under threshold
    r.move(102, 270, 20);   // 30px total, crosses threshold
    r.move(103, 250, 30);
    r.up(103, 250, 40);
    timers.flush();
    expect(h.onSwipe).toHaveBeenCalledTimes(2);
    expect(h.onSwipe.mock.calls[0][0].dy).toBe(-30);
    expect(h.onSwipe.mock.calls[1][0].dy).toBe(-20);
    expect(h.onTap).not.toHaveBeenCalled();
  });
  test('horizontal drag is neither swipe nor tap', () => {
    const { r, h, timers } = setup();
    r.down(100, 300, 0); r.move(160, 305, 20); r.up(160, 305, 40); timers.flush();
    expect(h.onSwipe).not.toHaveBeenCalled();
    expect(h.onTap).not.toHaveBeenCalled();
  });
});
