import { describe, test, expect } from 'vitest';
import { INITIAL_FLAME, stepFlame, relight } from '../candle/flame.js';

const calm = () => 0.5; // no wobble, no wind flips
function run(state, intensity, seconds, rand = calm, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) state = stepFlame(state, intensity, dt, rand);
  return state;
}

describe('flame model', () => {
  test('lean follows intensity in the wind direction', () => {
    expect(run(INITIAL_FLAME, 0.6, 1).lean).toBeGreaterThan(0.5);
    expect(run({ ...INITIAL_FLAME, wind: -1 }, 0.6, 1).lean).toBeLessThan(-0.5);
  });
  test('size shrinks with intensity', () => {
    const s = run(INITIAL_FLAME, 0.5, 1).size;
    expect(s).toBeGreaterThan(0.65); expect(s).toBeLessThan(0.75);
  });
  test('half a second of hard blowing extinguishes and makes smoke', () => {
    const s = run(INITIAL_FLAME, 0.9, 0.5);
    expect(s.lit).toBe(false); expect(s.smoke).toBeGreaterThan(0.5);
  });
  test('a moderate blow at 0.75 extinguishes within half a second', () => {
    expect(run(INITIAL_FLAME, 0.75, 0.5).lit).toBe(false);
  });
  test('a short gust does not extinguish', () => {
    expect(run(INITIAL_FLAME, 0.9, 0.2).lit).toBe(true);
  });
  test('unlit flame collapses, smoke clears after a few seconds', () => {
    const s = run(run(INITIAL_FLAME, 0.9, 0.5), 0, 4);
    expect(s.size).toBeLessThan(0.01); expect(s.smoke).toBe(0); expect(Math.abs(s.lean)).toBeLessThan(0.01);
  });
  test('relight restores lit and health with a flare that decays', () => {
    const out = run(INITIAL_FLAME, 0.9, 0.5);
    const re = relight(out);
    expect(re).toMatchObject({ lit: true, health: 1, flare: 1, smoke: 0 });
    expect(run(re, 0, 1).flare).toBe(0);
    expect(run(re, 0, 1).size).toBeGreaterThan(0.9);
  });
  test('wind flips only while calm', () => {
    const always = () => 0;
    expect(stepFlame(INITIAL_FLAME, 0, 1 / 60, always).wind).toBe(-1);
    expect(stepFlame(INITIAL_FLAME, 0.5, 1 / 60, always).wind).toBe(1);
  });
  test('zero dt leaves state unchanged and finite', () => {
    const s = stepFlame(INITIAL_FLAME, 0.7, 0);
    expect(s).toEqual(INITIAL_FLAME);
  });
});
