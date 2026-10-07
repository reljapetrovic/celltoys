import { describe, test, expect } from 'vitest';
import {
  PRESETS, DEFAULT_SETTINGS, LIMITS, clampSettings,
  brightnessToRgb, fadeBrightness, startForLevel, hueShiftPreset,
  timerState, currentLight, extendSchedule,
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
  test('floor default is a visible ember', () => {
    expect(brightnessToRgb('red', DEFAULT_SETTINGS.floorBrightness)[0]).toBeGreaterThanOrEqual(5);
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

describe('startForLevel', () => {
  test('inverts fadeBrightness at progress t', () => {
    const start = startForLevel(0.4, 0.2, 0.3);
    expect(fadeBrightness(start, 0.2, 0.3)).toBeCloseTo(0.4);
  });
  test('at t=0 returns level itself', () => {
    expect(startForLevel(0.7, 0.2, 0)).toBeCloseTo(0.7);
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

describe('extendSchedule', () => {
  test('shifts start later', () => {
    expect(extendSchedule(1000, 5)).toBe(1000 + 5 * MIN);
  });
});

describe('currentLight', () => {
  const s = clampSettings({ preset: 'amber', startBrightness: 1, floorBrightness: 0.2, hueShift: true });
  test('hold uses start brightness and preset', () => {
    const l = currentLight(s, { phase: 'hold', fadeProgress: 0 });
    expect(l).toMatchObject({ presetId: 'amber', brightness: 1, rgb: [255, 64, 0] });
  });
  test('fade interpolates and shifts hue after half', () => {
    const l = currentLight(s, { phase: 'fade', fadeProgress: 0.75 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBeCloseTo(fadeBrightness(1, 0.2, 0.75));
  });
  test('floor uses floor brightness and shifted preset', () => {
    const l = currentLight(s, { phase: 'floor', fadeProgress: 1 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBe(0.2);
  });
});
