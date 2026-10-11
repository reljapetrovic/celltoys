import { describe, test, expect } from 'vitest';
import { createBlowDetector } from '../candle/blow.js';

const SR = 48000, FFT = 1024, BINS = FFT / 2;

function noiseTime(rms, n = FFT, seed = 1) {
  // deterministic pseudo-random ±1 noise scaled to the requested RMS
  const out = new Float32Array(n); let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out[i] = (s / 0x7fffffff) * 2 - 1; }
  let sum = 0; for (const v of out) sum += v * v; const k = rms / Math.sqrt(sum / n);
  for (let i = 0; i < n; i++) out[i] *= k; return out;
}
function sineTime(rms, hz, n = FFT) {
  const out = new Float32Array(n); const amp = rms * Math.SQRT2;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * hz * i / SR); return out;
}
// Spectra are dB values per bin, as getFloatFrequencyData returns them.
const BIN_HZ = SR / FFT;
function blowFreq() {
  // rumble at -8 dB up to 800 Hz, rolling off 9 dB per octave above
  const f = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) { const hz = Math.max(1, i * BIN_HZ); f[i] = hz <= 800 ? -8 : -8 - 9 * Math.log2(hz / 800); }
  return f;
}
function speechFreq() {
  // vowel-like: formant energy 800-3000 Hz, less below, little above
  const f = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) { const hz = i * BIN_HZ; f[i] = hz < 800 ? -20 : hz < 3000 ? -12 : -30; }
  return f;
}
function toneFreq(hz) { const f = new Float32Array(BINS).fill(-100); f[Math.round(hz / BIN_HZ)] = 0; return f; }
const quietFreq = () => new Float32Array(BINS).fill(-Infinity);
const silence = () => new Float32Array(FFT);
function run(det, time, freq, seconds, dt = 1 / 60) { let r; for (let t = 0; t < seconds; t += dt) r = det.update(time, freq, dt); return r; }

describe('blow detector', () => {
  test('silence and all-zero spectrum give zero without NaN', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    const r = run(d, silence(), quietFreq(), 0.5);
    expect(r.intensity).toBe(0); expect(r.lowFraction).toBe(0); expect(Number.isNaN(r.loudness)).toBe(false);
  });
  test('low-frequency noise at 0.3 RMS reads as a strong blow', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    expect(run(d, noiseTime(0.3), blowFreq(), 0.5).intensity).toBeGreaterThan(0.6);
  });
  test('a soft blow at 0.06 RMS already reads as a strong blow', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    expect(run(d, noiseTime(0.06), blowFreq(), 0.5).intensity).toBeGreaterThan(0.5);
  });
  test('a distant blow at 0.02 RMS still sways the flame noticeably', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    expect(run(d, noiseTime(0.02), blowFreq(), 0.5).intensity).toBeGreaterThan(0.4);
  });
  test('loud speech-shaped sound is held well below the extinguish level', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    const i = run(d, noiseTime(0.3), speechFreq(), 0.5).intensity;
    expect(i).toBeLessThan(0.5);
    expect(i).toBeGreaterThan(0); // a shout may flicker the flame, that is fine
  });
  test('a 1 kHz tone at 0.3 RMS is held well below the extinguish level', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    expect(run(d, sineTime(0.3, 1000), toneFreq(1000), 0.5).intensity).toBeLessThan(0.5);
  });
  test('floor rises slowly under sustained sound and lowers loudness', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    const first = d.update(noiseTime(0.05), blowFreq(), 1 / 60);
    const later = run(d, noiseTime(0.05), blowFreq(), 10);
    expect(later.floor).toBeGreaterThan(0.015); expect(later.floor).toBeLessThanOrEqual(0.05);
    expect(later.loudness).toBeLessThan(first.loudness);
  });
  test('sensitivity 2 roughly doubles a weak response', () => {
    const a = createBlowDetector({ sampleRate: SR, fftSize: FFT, sensitivity: 1 });
    const b = createBlowDetector({ sampleRate: SR, fftSize: FFT, sensitivity: 2 });
    const ia = run(a, noiseTime(0.01), blowFreq(), 0.5).intensity;
    const ib = run(b, noiseTime(0.01), blowFreq(), 0.5).intensity;
    expect(ib / ia).toBeGreaterThan(1.8); expect(ib / ia).toBeLessThan(2.2);
  });
  test('setSensitivity changes later readings', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    const before = run(d, noiseTime(0.01), blowFreq(), 0.5).intensity;
    d.setSensitivity(3);
    expect(run(d, noiseTime(0.01), blowFreq(), 0.5).intensity).toBeGreaterThan(before * 2);
  });
  test('intensity rises within 0.1 s and decays slower than it rises', () => {
    const d = createBlowDetector({ sampleRate: SR, fftSize: FFT });
    const up = run(d, noiseTime(0.3), blowFreq(), 0.1, 0.05).intensity;
    expect(up).toBeGreaterThan(0.6);
    const down = run(d, silence(), blowFreq(), 0.1, 0.05).intensity;
    expect(down).toBeGreaterThan(0.5); expect(down).toBeLessThan(up);
  });
});
