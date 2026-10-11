import { describe, test, expect } from 'vitest';
import {
  PRESETS, DEFAULT_SETTINGS, LIMITS, clampSettings,
  brightnessToRgb, fadeBrightness, hueShiftPreset,
  timerState, currentLight, extendHold,
  uiColor, renderIntervalMs, resumeSession,
} from '../reading-light/light.js';

const MIN = 60_000;

describe('presets', () => {
  test('three presets ordered candle, amber, red', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['candle', 'amber', 'red']);
    expect(PRESETS[1].rgb).toEqual([255, 64, 0]);
    expect(PRESETS[2].rgb).toEqual([255, 0, 0]);
  });
});

describe('clampSettings', () => {
  test('fills defaults and clamps ranges', () => {
    const s = clampSettings({ holdMinutes: 999, floorBrightness: 0, preset: 'nope', fadeMinutes: 'x' });
    expect(s.holdMinutes).toBe(LIMITS.holdMinutes[1]);
    expect(s.floorBrightness).toBe(LIMITS.floorBrightness[0]);
    expect(s.preset).toBe('amber');
    expect(s.fadeMinutes).toBe(DEFAULT_SETTINGS.fadeMinutes);
    expect(s.hueShift).toBe(true);
  });
  test('accepts undefined', () => {
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('brightnessToRgb', () => {
  test('full brightness returns preset colour', () => {
    expect(brightnessToRgb('amber', 1)).toEqual([255, 64, 0]);
  });
  test('zero is black', () => {
    expect(brightnessToRgb('red', 0)).toEqual([0, 0, 0]);
  });
  test('applies gamma 2.2', () => {
    const [r] = brightnessToRgb('red', 0.5);
    expect(r).toBe(Math.round(255 * 0.5 ** 2.2)); // 56
  });
  test('dominant channel never below 2 while lit', () => {
    expect(brightnessToRgb('red', 0.01)[0]).toBe(2);
    expect(brightnessToRgb('candle', 0.01)[0]).toBe(2);
  });
  test('floor default is a visible night-light, not a near-black ember', () => {
    expect(brightnessToRgb('red', DEFAULT_SETTINGS.floorBrightness)[0]).toBeGreaterThanOrEqual(20);
    expect(LIMITS.floorBrightness[1]).toBeGreaterThanOrEqual(0.6);
  });
});

describe('fadeBrightness', () => {
  test('endpoints', () => {
    expect(fadeBrightness(1, 0.2, 0)).toBeCloseTo(1);
    expect(fadeBrightness(1, 0.2, 1)).toBeCloseTo(0.2);
    expect(fadeBrightness(1, 0.2, -1)).toBeCloseTo(1);
    expect(fadeBrightness(1, 0.2, 2)).toBeCloseTo(0.2);
  });
  test('is exponential (halfway is geometric mean)', () => {
    expect(fadeBrightness(1, 0.25, 0.5)).toBeCloseTo(0.5);
  });
  test('monotonic and finite when floor > start', () => {
    const a = fadeBrightness(0.2, 0.5, 0.3);
    const b = fadeBrightness(0.2, 0.5, 0.6);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(a).toBeLessThan(b);
    expect(fadeBrightness(0.2, 0.5, 1)).toBeCloseTo(0.5);
  });
});

describe('hueShiftPreset', () => {
  test('shifts one step warmer after half the fade', () => {
    expect(hueShiftPreset('candle', 0.49, true)).toBe('candle');
    expect(hueShiftPreset('candle', 0.5, true)).toBe('amber');
    expect(hueShiftPreset('amber', 1, true)).toBe('red');
  });
  test('clamps at red and respects disabled', () => {
    expect(hueShiftPreset('red', 1, true)).toBe('red');
    expect(hueShiftPreset('amber', 1, false)).toBe('amber');
  });
});

describe('timerState', () => {
  const s = clampSettings({ holdMinutes: 15, fadeMinutes: 10 });
  const t0 = 1_000_000;
  test('hold phase', () => {
    const st = timerState(s, t0, t0 + 5 * MIN);
    expect(st.phase).toBe('hold');
    expect(st.fadeProgress).toBe(0);
    expect(st.remainingMs).toBe(20 * MIN);
  });
  test('fade phase progress', () => {
    const st = timerState(s, t0, t0 + 20 * MIN);
    expect(st.phase).toBe('fade');
    expect(st.fadeProgress).toBeCloseTo(0.5);
    expect(st.remainingMs).toBe(5 * MIN);
  });
  test('floor phase long after end', () => {
    const st = timerState(s, t0, t0 + 10 * 60 * MIN);
    expect(st.phase).toBe('floor');
    expect(st.fadeProgress).toBe(1);
    expect(st.remainingMs).toBe(0);
  });
  test('zero hold starts in fade immediately', () => {
    const st = timerState(clampSettings({ holdMinutes: 0, fadeMinutes: 10 }), t0, t0);
    expect(st.phase).toBe('fade');
    expect(st.fadeProgress).toBe(0);
  });
  test('now before start is treated as elapsed 0', () => {
    expect(timerState(s, t0, t0 - 5000).elapsedMs).toBe(0);
  });
});

describe('extendHold', () => {
  const s = clampSettings({ holdMinutes: 15, fadeMinutes: 10 });
  const t0 = 1_000_000;
  test('during hold it adds five minutes', () => {
    const extra = extendHold(s, timerState(s, t0, t0 + 2 * MIN), 0, 5);
    expect(extra).toBe(5 * MIN);
    expect(timerState(s, t0, t0 + 2 * MIN, extra).remainingMs).toBe(28 * MIN);
  });
  test('during the fade it gives five more bright minutes, then the fade again', () => {
    const extra = extendHold(s, timerState(s, t0, t0 + 20 * MIN), 0, 5);
    const st = timerState(s, t0, t0 + 20 * MIN, extra);
    expect(st.phase).toBe('hold');
    expect(st.remainingMs).toBe(15 * MIN);
  });
  test('in the night-light phase it also gives five bright minutes', () => {
    const extra = extendHold(s, timerState(s, t0, t0 + 60 * MIN), 0, 5);
    const st = timerState(s, t0, t0 + 60 * MIN, extra);
    expect(st.phase).toBe('hold');
    expect(st.remainingMs).toBe(15 * MIN);
  });
  test('pressing twice accumulates', () => {
    const t = timerState(s, t0, t0 + 2 * MIN);
    const extra = extendHold(s, t, extendHold(s, t, 0, 5), 5);
    expect(extra).toBe(10 * MIN);
  });
});

describe('timerState with extra hold', () => {
  const s = clampSettings({ holdMinutes: 15, fadeMinutes: 10 });
  const t0 = 1_000_000;
  test('extra hold adds exactly that much remaining time, even early in the session', () => {
    const before = timerState(s, t0, t0 + 2 * MIN);
    const after = timerState(s, t0, t0 + 2 * MIN, 5 * MIN);
    expect(after.remainingMs - before.remainingMs).toBe(5 * MIN);
    expect(after.phase).toBe('hold');
  });
  test('extra hold during the fade moves the fade later', () => {
    expect(timerState(s, t0, t0 + 19 * MIN).phase).toBe('fade');
    const st = timerState(s, t0, t0 + 19 * MIN, 5 * MIN);
    expect(st.phase).toBe('hold');
    expect(st.remainingMs).toBe(11 * MIN);
  });
});

describe('currentLight', () => {
  const s = clampSettings({ preset: 'amber', startBrightness: 1, floorBrightness: 0.2, hueShift: true });
  test('hold uses start brightness and preset', () => {
    const l = currentLight(s, { phase: 'hold', fadeProgress: 0 });
    expect(l).toMatchObject({ presetId: 'amber', brightness: 1, rgb: [255, 64, 0] });
  });
  test('fade interpolates brightness and names the warmer preset after half', () => {
    const l = currentLight(s, { phase: 'fade', fadeProgress: 0.75 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBeCloseTo(fadeBrightness(1, 0.2, 0.75));
  });
  test('hue shifts smoothly: green channel falls monotonically across the fade, no step', () => {
    const greens = [0, 0.25, 0.49, 0.5, 0.51, 0.75, 1].map(t => currentLight(s, { phase: 'fade', fadeProgress: t }).rgb[1]);
    for (let i = 1; i < greens.length; i++) expect(greens[i]).toBeLessThanOrEqual(greens[i - 1]);
    const step = Math.abs(greens[3] - greens[2]);
    expect(step).toBeLessThanOrEqual(1);
    expect(greens[6]).toBe(0);
  });
  test('floor uses floor brightness and the fully shifted preset', () => {
    const l = currentLight(s, { phase: 'floor', fadeProgress: 1 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBe(0.2);
    expect(l.rgb[1]).toBe(0);
  });
  test('with hue shift off the colour stays on the chosen preset', () => {
    const off = clampSettings({ ...s, hueShift: false });
    const l = currentLight(off, { phase: 'fade', fadeProgress: 0.9 });
    expect(l.presetId).toBe('amber');
    expect(l.rgb).toEqual(brightnessToRgb('amber', l.brightness));
  });
});

describe('currentLight with session offset', () => {
  const s = clampSettings({ preset: 'amber', startBrightness: 1, floorBrightness: 0.2, hueShift: false });
  test('hold ignores the offset (swipe there edits startBrightness instead)', () => {
    expect(currentLight(s, { phase: 'hold', fadeProgress: 0 }, -0.5).brightness).toBe(1);
  });
  test('fade adds the offset to the curve value', () => {
    const base = fadeBrightness(1, 0.2, 0.5);
    expect(currentLight(s, { phase: 'fade', fadeProgress: 0.5 }, 0.1).brightness).toBeCloseTo(base + 0.1);
  });
  test('floor adds the offset and clamps to [0.02, 1]', () => {
    expect(currentLight(s, { phase: 'floor', fadeProgress: 1 }, 0.3).brightness).toBeCloseTo(0.5);
    expect(currentLight(s, { phase: 'floor', fadeProgress: 1 }, -5).brightness).toBe(0.02);
    expect(currentLight(s, { phase: 'floor', fadeProgress: 1 }, 5).brightness).toBe(1);
  });
  test('offset defaults to 0', () => {
    expect(currentLight(s, { phase: 'floor', fadeProgress: 1 }).brightness).toBe(0.2);
  });
});

describe('uiColor', () => {
  test('is the full preset colour so sheet text stays legible at night', () => {
    expect(uiColor('red')).toEqual([255, 0, 0]);
    expect(uiColor('amber')).toEqual([255, 64, 0]);
  });
});

describe('renderIntervalMs', () => {
  test('renders often during the fade and slowly otherwise', () => {
    expect(renderIntervalMs('fade', false)).toBeLessThanOrEqual(100);
    expect(renderIntervalMs('hold', false)).toBeGreaterThanOrEqual(500);
    expect(renderIntervalMs('floor', false)).toBeGreaterThanOrEqual(500);
    expect(renderIntervalMs('fade', true)).toBeGreaterThanOrEqual(500);
  });
});

describe('resumeSession', () => {
  const s = clampSettings({ holdMinutes: 15, fadeMinutes: 10 });
  const t0 = 5_000_000;
  test('resumes a recent, running session', () => {
    expect(resumeSession({ startedAt: t0, pausedAt: null, off: false }, s, t0 + 20 * MIN)).toEqual({ startedAt: t0, pausedAt: null });
  });
  test('resumes a paused session, keeping its paused timestamp', () => {
    expect(resumeSession({ startedAt: t0, pausedAt: t0 + 3 * MIN, off: false }, s, t0 + 20 * MIN)).toEqual({ startedAt: t0, pausedAt: t0 + 3 * MIN });
  });
  test('starts fresh when the session is older than hold + fade + 2 h', () => {
    expect(resumeSession({ startedAt: t0, pausedAt: null, off: false }, s, t0 + (25 + 121) * MIN)).toBeNull();
  });
  test('starts fresh when the saved session was off, missing, or malformed', () => {
    expect(resumeSession({ startedAt: t0, pausedAt: null, off: true }, s, t0 + MIN)).toBeNull();
    expect(resumeSession(null, s, t0)).toBeNull();
    expect(resumeSession({ startedAt: 'x' }, s, t0)).toBeNull();
    expect(resumeSession({ startedAt: t0 + 10 * MIN }, s, t0)).toBeNull(); // from the future
  });
});
