// Pure colour + timer model for the reading light. No DOM, no timers.

export const PRESETS = [
  { id: 'candle', name: 'Candle', rgb: [255, 147, 41] },
  { id: 'amber', name: 'Amber', rgb: [255, 64, 0] },
  { id: 'red', name: 'Deep Red', rgb: [255, 0, 0] },
];

export const DEFAULT_SETTINGS = Object.freeze({
  preset: 'amber',
  startBrightness: 1,
  floorBrightness: 0.35,
  holdMinutes: 15,
  fadeMinutes: 10,
  hueShift: true,
  showClock: true,
});

export const LIMITS = Object.freeze({
  startBrightness: [0.2, 1],
  floorBrightness: [0.1, 0.6],
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
function rgbAtBrightness(rgb, brightness) {
  if (!(brightness > 0)) return [0, 0, 0];
  const scale = Math.min(1, brightness) ** GAMMA;
  const out = rgb.map(c => Math.round(c * scale));
  const dominant = rgb.indexOf(Math.max(...rgb));
  out[dominant] = Math.max(2, out[dominant]); // never render black unintentionally
  return out;
}

export function brightnessToRgb(presetId, brightness) {
  return rgbAtBrightness(presetById(presetId).rgb, brightness);
}

// Linear mix of two base colours; k = 0 gives `from`, k = 1 gives `to`.
function mixRgb(from, to, k) {
  return from.map((c, i) => c + (to[i] - c) * k);
}

// Exponential in luminance: linear in log-brightness from start to floor.
export function fadeBrightness(start, floor, t) {
  const tt = Math.min(1, Math.max(0, t));
  return start * (floor / start) ** tt;
}

export function hueShiftPreset(presetId, t, enabled) {
  if (!enabled || t < 0.5) return presetById(presetId).id;
  const i = PRESETS.findIndex(p => p.id === presetId);
  return PRESETS[Math.min(PRESETS.length - 1, i + 1)].id;
}

// `extraHoldMs` is session time added with "+5 min"; it lengthens the hold
// phase directly so the extension is never lost early in a session.
export function timerState(settings, startedAt, now, extraHoldMs = 0) {
  const holdMs = settings.holdMinutes * MIN_MS + extraHoldMs;
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

// Session-only brightness floor/ceiling for swipe offsets outside the hold phase.
const OFFSET_MIN = 0.02;

// `offset` is a session-only perceptual adjustment (from swiping) applied during
// fade and floor; during hold the swipe edits startBrightness itself instead.
export function currentLight(settings, timer, offset = 0) {
  const { phase, fadeProgress } = timer;
  let brightness;
  if (phase === 'hold') brightness = settings.startBrightness;
  else if (phase === 'fade') brightness = fadeBrightness(settings.startBrightness, settings.floorBrightness, fadeProgress);
  else brightness = settings.floorBrightness;
  if (phase !== 'hold') brightness = Math.min(1, Math.max(OFFSET_MIN, brightness + offset));
  const t = phase === 'hold' ? 0 : fadeProgress;
  // The named preset switches at half-fade (used for UI colour); the light
  // itself blends continuously so there is no visible colour step.
  const presetId = hueShiftPreset(settings.preset, t, settings.hueShift);
  const from = presetById(settings.preset).rgb;
  const to = presetById(hueShiftPreset(settings.preset, 1, settings.hueShift)).rgb;
  const base = settings.hueShift ? mixRgb(from, to, t) : from;
  return { presetId, brightness, rgb: rgbAtBrightness(base, brightness) };
}

// Colour for the control sheet: the full preset colour, independent of the
// fade level, so the controls stay legible even when the light is a faint
// ember. A few seconds of amber text costs nothing melanopically.
export function uiColor(presetId) {
  return brightnessToRgb(presetId, 1);
}

// How often the page needs to re-render. Only the fade changes visibly.
export function renderIntervalMs(phase, off) {
  return !off && phase === 'fade' ? 100 : 1000;
}

const RESUME_GRACE_MS = 2 * 60 * MIN_MS;

// Decide whether a saved session should continue after a reload (e.g. iOS
// evicting the PWA). Returns { startedAt, pausedAt } or null for a fresh start.
export function resumeSession(saved, settings, now) {
  if (!saved || typeof saved !== 'object' || saved.off) return null;
  const { startedAt } = saved;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt > now) return null;
  const windowMs = (settings.holdMinutes + settings.fadeMinutes) * MIN_MS + RESUME_GRACE_MS;
  if (now - startedAt > windowMs) return null;
  const pausedAt = typeof saved.pausedAt === 'number' && Number.isFinite(saved.pausedAt) ? saved.pausedAt : null;
  return { startedAt, pausedAt };
}
