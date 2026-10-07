// Pure colour + timer model for the reading light. No DOM, no timers.

export const PRESETS = [
  { id: 'candle', name: 'Candle', rgb: [255, 147, 41] },
  { id: 'amber', name: 'Amber', rgb: [255, 64, 0] },
  { id: 'red', name: 'Deep Red', rgb: [255, 0, 0] },
];

export const DEFAULT_SETTINGS = Object.freeze({
  preset: 'amber',
  startBrightness: 1,
  floorBrightness: 0.2,
  holdMinutes: 15,
  fadeMinutes: 10,
  hueShift: true,
  showClock: true,
});

export const LIMITS = Object.freeze({
  startBrightness: [0.2, 1],
  floorBrightness: [0.1, 0.5],
  holdMinutes: [0, 120],
  fadeMinutes: [1, 60],
});

const GAMMA = 2.2;
const MIN_MS = 60_000;

function presetById(id) {
  return PRESETS.find(p => p.id === id) ?? PRESETS.find(p => p.id === DEFAULT_SETTINGS.preset);
}

function clampNumber(value, [lo, hi], fallback) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function clampSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  return {
    preset: presetById(p.preset).id,
    startBrightness: clampNumber(p.startBrightness, LIMITS.startBrightness, DEFAULT_SETTINGS.startBrightness),
    floorBrightness: clampNumber(p.floorBrightness, LIMITS.floorBrightness, DEFAULT_SETTINGS.floorBrightness),
    holdMinutes: clampNumber(p.holdMinutes, LIMITS.holdMinutes, DEFAULT_SETTINGS.holdMinutes),
    fadeMinutes: clampNumber(p.fadeMinutes, LIMITS.fadeMinutes, DEFAULT_SETTINGS.fadeMinutes),
    hueShift: typeof p.hueShift === 'boolean' ? p.hueShift : DEFAULT_SETTINGS.hueShift,
    showClock: typeof p.showClock === 'boolean' ? p.showClock : DEFAULT_SETTINGS.showClock,
  };
}

// brightness is perceptual (0..1); channels scale by brightness^2.2.
export function brightnessToRgb(presetId, brightness) {
  if (!(brightness > 0)) return [0, 0, 0];
  const { rgb } = presetById(presetId);
  const scale = Math.min(1, brightness) ** GAMMA;
  const out = rgb.map(c => Math.round(c * scale));
  const dominant = rgb.indexOf(Math.max(...rgb));
  out[dominant] = Math.max(2, out[dominant]); // never render black unintentionally
  return out;
}

// Exponential in luminance: linear in log-brightness from start to floor.
export function fadeBrightness(start, floor, t) {
  const tt = Math.min(1, Math.max(0, t));
  return start * (floor / start) ** tt;
}

// Inverse: which start brightness puts the fade at `level` when progress is t.
// fade(start, floor, t) = start^(1-t) * floor^t  =>  start = (level / floor^t)^(1/(1-t))
export function startForLevel(level, floor, t) {
  const tt = Math.min(0.999, Math.max(0, t));
  return (level / floor ** tt) ** (1 / (1 - tt));
}

export function hueShiftPreset(presetId, t, enabled) {
  if (!enabled || t < 0.5) return presetById(presetId).id;
  const i = PRESETS.findIndex(p => p.id === presetId);
  return PRESETS[Math.min(PRESETS.length - 1, i + 1)].id;
}

export function timerState(settings, startedAt, now) {
  const holdMs = settings.holdMinutes * MIN_MS;
  const fadeMs = settings.fadeMinutes * MIN_MS;
  const elapsedMs = Math.max(0, now - startedAt);
  const total = holdMs + fadeMs;
  if (elapsedMs < holdMs) {
    return { phase: 'hold', fadeProgress: 0, remainingMs: total - elapsedMs, elapsedMs };
  }
  if (elapsedMs < total) {
    return { phase: 'fade', fadeProgress: (elapsedMs - holdMs) / fadeMs, remainingMs: total - elapsedMs, elapsedMs };
  }
  return { phase: 'floor', fadeProgress: 1, remainingMs: 0, elapsedMs };
}

export function extendSchedule(startedAt, minutes) {
  return startedAt + minutes * MIN_MS;
}

export function currentLight(settings, timer) {
  const { phase, fadeProgress } = timer;
  let brightness;
  if (phase === 'hold') brightness = settings.startBrightness;
  else if (phase === 'fade') brightness = fadeBrightness(settings.startBrightness, settings.floorBrightness, fadeProgress);
  else brightness = settings.floorBrightness;
  const presetId = hueShiftPreset(settings.preset, phase === 'hold' ? 0 : fadeProgress, settings.hueShift);
  return { presetId, brightness, rgb: brightnessToRgb(presetId, brightness) };
}
