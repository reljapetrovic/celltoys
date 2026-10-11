// Candle settings: defaults and validation. Pure.

export const DEFAULT_SETTINGS = Object.freeze({ sensitivity: 2, showMeter: false });

export function clampSettings(partial) {
  const p = partial && typeof partial === 'object' ? partial : {};
  const n = Number(p.sensitivity);
  return {
    sensitivity: Number.isFinite(n) ? Math.min(10, Math.max(0.5, n)) : DEFAULT_SETTINGS.sensitivity,
    showMeter: p.showMeter === true,
  };
}
