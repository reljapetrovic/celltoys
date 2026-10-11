import { describe, test, expect } from 'vitest';
import { DEFAULT_SETTINGS, clampSettings } from '../candle/settings.js';

describe('candle settings', () => {
  test('defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({ sensitivity: 1, showMeter: false });
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  test('clamps sensitivity and coerces the meter flag', () => {
    expect(clampSettings({ sensitivity: 9 }).sensitivity).toBe(3);
    expect(clampSettings({ sensitivity: 0 }).sensitivity).toBe(0.5);
    expect(clampSettings({ sensitivity: 'x' }).sensitivity).toBe(1);
    expect(clampSettings({ sensitivity: NaN }).sensitivity).toBe(1);
    expect(clampSettings({ showMeter: 'yes' }).showMeter).toBe(false);
    expect(clampSettings({ showMeter: true }).showMeter).toBe(true);
  });
});
