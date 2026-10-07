// Candle flame model. Pure: (state, intensity, dt) -> state.

export const INITIAL_FLAME = Object.freeze({
  lit: true, lean: 0, size: 1, health: 1, smoke: 0, flare: 0, wind: 1,
});

const ease = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
const clamp01 = v => Math.min(1, Math.max(0, v));

export function stepFlame(s, intensity, dt, rand = Math.random) {
  let { lit, lean, size, health, smoke, flare, wind } = s;
  if (dt <= 0) return { ...s };

  if (intensity < 0.1 && rand() < 0.3 * dt) wind = -wind;
  const wobble = (rand() - 0.5) * 0.2 * (0.3 + intensity);
  lean = ease(lean, lit ? wind * intensity + wobble : 0, dt, 0.08);

  flare = Math.max(0, flare - dt / 0.4);
  size = ease(size, lit ? 1 - 0.6 * intensity + 0.5 * flare : 0, dt, 0.1);

  if (lit) health = clamp01(intensity > 0.8 ? health - dt / 0.35 : health + dt / 0.5);
  if (lit && health <= 0) { lit = false; smoke = 1; }
  smoke = Math.max(0, smoke - dt / 3);

  return { lit, lean, size, health, smoke, flare, wind };
}

export function relight(s) {
  return { ...s, lit: true, health: 1, size: 0.2, flare: 1, smoke: 0 };
}
