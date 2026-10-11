// Candle settings: defaults and validation. Pure.

export const DEFAULT_SETTINGS = Object.freeze({ sensitivity: 1, showMeter: false });

export function clampSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const n = Number(p.sensitivity);
  return {
    sensitivity: Number.isFinite(n) ? Math.min(3, Math.max(0.5, n)) : DEFAULT_SETTINGS.sensitivity,
    showMeter: p.showMeter === true,
  };
}
