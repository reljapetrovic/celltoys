# Candle — design spec

Date: 2026-10-07
Status: approved in conversation; implementation on branch `candle`
Project: celltoys (second toy)

## 1. Purpose

A phone page showing a candle flame that flickers on its own, listens to the
microphone, bends and shrinks the harder you blow, and goes out like a
birthday candle when you blow hard enough. Tap to relight. For the kids.

Success: open it, tap once (mic permission appears), the flame is lit; a soft
blow makes it sway, a hard blow puts it out with a puff of smoke; a tap lights
it again. Talking or clapping near it does not blow it out.

## 2. Scope

### In scope

1. Start screen: unlit candle, "Tap to light". The tap creates the
   AudioContext and requests the mic (both need a user gesture).
2. Blow detector: intensity 0..1 from mic loudness above an adaptive noise
   floor, gated by the share of power below 800 Hz so speech and claps are mostly ignored,
   with attack/release smoothing and a persisted sensitivity setting.
3. Flame model: lean, size, health, lit/unlit, smoke, relight flare.
4. Canvas 2D renderer: candle body, wick, layered flame, glow, sparks, smoke.
5. Mic denied or unavailable: candle still lights and flickers; one-line note.
6. Settings sheet (gear button): sensitivity slider, live intensity meter
   toggle. Persisted via `shared/settings-store`.
7. Wake lock and fullscreen on first tap (reuse `shared/`).
8. PWA manifest and icon; tile on the landing page.

### Out of scope

Tilt input, finger interaction, campfire mode, sound effects, multiple candles.

## 3. Architecture

```
candle/
  index.html
  style.css
  main.js        wiring: start screen, mic, frame loop, settings sheet
  blow.js        PURE: createBlowDetector(...).update(timeData, freqData, dt)
  flame.js       PURE: stepFlame(state, intensity, dt, rand), relight(state)
  mic.js         getUserMedia + AnalyserNode; returns data getters
  render.js      Canvas 2D drawing from flame state
public/candle/   manifest.webmanifest, icon-180.png, icon-512.png
test/blow.test.js, test/flame.test.js
```

### Blow detector (`candle/blow.js`)

`createBlowDetector({ sampleRate, fftSize, sensitivity = 1 })` returns
`{ update(timeData, freqData, dt), setSensitivity(s) }`.

- `timeData`: Float32Array of samples (-1..1), from `getFloatTimeDomainData`.
- `freqData`: Float32Array of dB per bin, from `getFloatFrequencyData`
  (`-Infinity` for silent bins). Byte data must not be used: it is a dB
  mapping, and squaring it collapses the dynamic range so the gate never opens.
- `update` returns `{ intensity, loudness, lowFraction, floor }`, all 0..1.

Per call:
1. `rms` = root mean square of `timeData`.
2. Noise floor: drops immediately to `rms` when `rms` is lower; otherwise
   rises at 0.002 per second. Starts at 0.
3. `loudness` = clamp((rms − floor − 0.01) / (0.2 / sensitivity), 0, 1).
4. `lowFraction` = Σ 10^(dB/10) for bins below 800 Hz / Σ 10^(dB/10) over all
   bins (bin width = sampleRate / fftSize). 0 when total power is 0.
5. `gate` = clamp((lowFraction − 0.35) / 0.3, 0, 1).
6. `raw` = loudness × gate.
7. `intensity` eases toward `raw` with time constant 0.05 s when rising and
   0.25 s when falling: `intensity += (raw − intensity) × (1 − e^(−dt/τ))`.

### Flame model (`candle/flame.js`)

State: `{ lit, lean, size, health, smoke, flare, wind }`.
`INITIAL_FLAME = { lit: true, lean: 0, size: 1, health: 1, smoke: 0, flare: 0, wind: 1 }`.

`stepFlame(state, intensity, dt, rand = Math.random)` returns a new state:
- `wind` (±1 direction of lean) flips with probability 0.3 × dt per second
  while intensity < 0.1, so successive blows do not always lean the same way.
- `lean` target = `wind × intensity` plus wobble `(rand() − 0.5) × 0.2 × (0.3 + intensity)`;
  eases with τ = 0.08 s. When unlit, target is 0.
- `size` target = `1 − 0.6 × intensity` (0 when unlit); eases with τ = 0.1 s.
  Relight flare adds `0.5 × flare` to the target.
- `health`: while lit and intensity > 0.8, drains at 1 per 0.35 s; otherwise
  refills at 1 per 0.5 s. Clamped 0..1.
- When health reaches 0 while lit: `lit = false`, `smoke = 1`.
- `smoke` decays at 1 per 3 s. `flare` decays at 1 per 0.4 s.

`relight(state)` → `{ ...state, lit: true, health: 1, size: 0.2, flare: 1, smoke: 0 }`.

### Mic (`candle/mic.js`)

`startMic()` → `Promise<{ sampleRate, fftSize, readTime(Float32Array), readFreq(Float32Array), resume(), stop() }>`.
Creates the AudioContext synchronously inside the user gesture (before the
permission prompt consumes it on iOS) and calls `resume()` without awaiting;
then requests `{ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }`
and builds an AnalyserNode with `fftSize = 1024`, `smoothingTimeConstant = 0.5`.
Rejects on denial (closing the context); caller handles. `resume()` is called
again from every pointerup on the canvas and on visibility change.

### Renderer (`candle/render.js`)

`createRenderer(canvas)` → `{ resize(), draw(state, intensity, time) }`.
Draws at devicePixelRatio: black background; candle body (pale wax
rectangle with rounded top, slight gradient); wick; when lit, three layered
teardrops (blue base, orange body, yellow core) whose tip is offset by
`lean × 0.6 × flameHeight` and whose height scales with `size`, with a
sine/noise flicker on the width; a radial glow scaled by `size`; a few
rising spark particles proportional to `size`; when `smoke > 0`, grey wisps
rising from the wick with alpha ∝ smoke. A small meter bar at the top when
enabled.

### Page (`candle/main.js`)

- Settings via `createStore({ key: 'celltoys.candle', version: 1, defaults })` with
  defaults and clamping in the pure `candle/settings.js`.
- Start screen overlay. First tap: `keepAwake()`, `requestFullscreen()` (on
  pointerup), `startMic()`; on failure show the note "Blowing needs the
  microphone" for 6 s and continue without a detector (intensity 0).
- Loop with `requestAnimationFrame`, capped at ~60 fps; `dt` clamped to
  0–0.05 s; skips when the tab is hidden. Per frame: read mic data →
  `detector.update` → `stepFlame` → `draw`.
- Microphone lifecycle: capture is released when the page is hidden (no hot
  mic in the background) and reconnected when it returns or on the next tap;
  a track ended by the OS (call, Siri) shows "Microphone stopped. Tap to
  reconnect."
- After 2 s unlit a "Tap to relight" hint appears in the dark area above the
  candle and disappears on relight.
- Pointerup on the canvas when unlit → `relight` (bound directly, not via the
  shared tap recogniser, so there is no double-tap delay).
- Gear button (top-right, dim, inside the safe area) toggles the sheet:
  sensitivity slider 0.5–3, meter toggle. Sheet auto-hides after 8 s of no
  interaction, never while a finger is on it. The meter is drawn below the
  top safe-area inset.

## 4. Visual

Black background; wax in warm off-white (`#f1e4c8`) with a faint orange
glow; flame colours yellow `#ffd36b`, orange `#ff7a1a`, blue `#4a7cff` base;
smoke grey at low alpha. UI text in the dim amber from `shared/base.css`.

## 5. Error handling

- Mic denied / insecure context / no `getUserMedia`: flame works, note shown.
- AudioContext suspended after backgrounding: resume on `visibilitychange`.
- Settings validated: sensitivity clamped 0.5–3; showMeter boolean.

## 6. Testing

- `test/blow.test.js` (spectra as dB fixtures): silence → 0; blow-shaped
  spectrum (−8 dB rumble to 800 Hz, −9 dB/octave above) at 0.3 RMS → > 0.6;
  speech-shaped spectrum at 0.3 RMS → < 0.2; 1 kHz sine → < 0.1;
  sustained quiet raises the floor; sensitivity 2 doubles response; intensity
  rises within ~0.1 s and decays slower than it rises.
- `test/flame.test.js`: lean follows intensity sign of wind; size shrinks with
  intensity; 0.5 s at intensity 0.9 extinguishes; 0.2 s at 0.9 does not;
  relight restores lit/health and sets flare; smoke decays to 0; wind flips
  only while calm (with deterministic rand).
- Device checklist: permission prompt appears on first tap; soft blow sways,
  hard blow extinguishes; talking does not extinguish; tap relights; meter
  moves; sensitivity persists; installed PWA launches fullscreen.
