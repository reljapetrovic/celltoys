# Reading Light — design spec

Date: 2026-10-07
Status: draft for review
Project: celltoys (collection of small phone "toys"; Reading Light is the first)

## 1. Purpose

A phone web page that turns the screen into a bedtime reading light. The parent
reads picture books to young children; the light must be bright enough to read
by, emit as little sleep-disrupting (melanopic) light as possible, and dim
gradually on a timer so the room darkens as the children fall asleep.

Success looks like: open the home-screen icon, the screen fills with amber at a
readable level, nothing else to touch; roughly 25 minutes later it is a faint
red ember, the kids are asleep, one tap turns it off. Settings survive between
nights.

## 2. Research basis (summary)

- Melanopsin peaks near 480 nm. Per unit of visible brightness, pure red carries
  ~500x less melanopic power than warm white and ~20x less than amber.
- Preschoolers are far more light-sensitive than adults: 5–10 lux of white for
  an hour still suppressed melatonin ~80%. "Dim warm white" is not acceptable;
  dim red/amber is the only option that keeps the child under ~1 melanopic lux
  while the parent can read.
- Pure red hurts legibility of blue/green/tan inks and illustrations; amber
  (red plus a little green) is the practical default for picture books; deep
  red once the child is in bed.
- Dusk-simulation evidence: hold, then fade ~20–30 min ending at target sleep
  time, hue shifting warmer while dimming.
- A web page cannot set OS brightness. Users set OS brightness to ~10–25% and
  the page does fine control. 8-bit channel values below ~20 band visibly, so
  the floor must not go lower than ~8% of channel scale.
- iPhone Safari has no Fullscreen API for ordinary pages; "fullscreen" comes
  from Add-to-Home-Screen with `display: standalone`. Screen Wake Lock API
  exists on iOS 16.4+ and Chrome and needs HTTPS plus a user gesture.

Full report with citations lives in the conversation that produced this spec;
key sources: Hartstein 2022 (J Pineal Res), Akacem 2018, Brown 2022 (PLOS
Biol), Schöllhorn 2023, Souman 2018, CET dusk-simulation note.

## 3. Scope

### In scope (v1)

1. Full-viewport colour fill, no visible chrome by default.
2. Three colour presets: Deep Red, Amber (default), Candle.
3. Perceptual brightness control (slider and vertical swipe).
4. Timer: hold → exponential fade → floor; "+5 min" extension; pause/resume.
5. Automatic hue shift one preset warmer during the fade (toggle).
6. Faint clock in the corner (toggle).
7. Keep-screen-awake via Wake Lock API with video fallback.
8. Settings persisted in localStorage.
9. Installable PWA (manifest, icon, standalone display) deployed to GitHub Pages.
10. Repo structured for additional toys: landing page listing toys, shared
    helper modules, one folder per toy.

### Out of scope (parked ideas, each a possible follow-up)

- Pink/brown noise that fades with the light (Web Audio).
- "Glow area": lighting only part of the screen (useful on OLED).
- Schedule mode: "end at 20:30" instead of durations.
- Sunset colour animations.
- Digital fire toy that reacts to blowing into the microphone (next toy; the
  repo structure, HTTPS dev server and shared modules exist to make it easy).

## 4. Architecture

### Tooling

- **Vite** multi-page app: `index.html` (landing) and `reading-light/index.html`
  are both entry points. Plain ES modules, no UI framework, no TypeScript.
- **@vitejs/plugin-basic-ssl** for `vite --host` so the phone can open the dev
  server over HTTPS on the LAN (needed for Wake Lock now, microphone later).
- **vite-plugin-pwa** generating the service worker and manifest injection, so
  the toy works offline once installed.
- **Vitest** for pure-logic tests.
- **GitHub Actions** workflow builds and deploys `dist/` to GitHub Pages.
  `base` in Vite config is set to the repo name so asset paths resolve under
  `https://<user>.github.io/celltoys/`.

### Repository layout

```
celltoys/
  package.json
  vite.config.js
  index.html                     landing page: list of toys
  shared/
    wake-lock.js                 acquire/release with video fallback
    fullscreen.js                request fullscreen where supported, no-op elsewhere
    gestures.js                  tap / double-tap / vertical-swipe recogniser
    settings-store.js            load/save JSON to localStorage with defaults + versioning
    base.css                     reset, dark background, shared control styles
  reading-light/
    index.html
    main.js                      wires DOM, gestures, timer loop, persistence
    light.js                     PURE: presets, brightness → RGB, fade curve, timer state
    manifest.webmanifest
    icon.svg
    style.css
  test/
    light.test.js
    settings-store.test.js
    gestures.test.js
  docs/superpowers/specs/...
  .github/workflows/deploy.yml
```

### Module responsibilities

**`reading-light/light.js` (pure, no DOM, fully unit-tested)**

- `PRESETS`: ordered warm-to-warmest list
  - Candle `{ r: 255, g: 147, b: 41 }` (~1900 K look)
  - Amber `{ r: 255, g: 64, b: 0 }` (default)
  - Deep Red `{ r: 255, g: 0, b: 0 }`
- `DEFAULT_SETTINGS`: `{ preset: 'amber', startBrightness: 1.0, floorBrightness: 0.05, holdMinutes: 15, fadeMinutes: 10, hueShift: true, showClock: true }`.
- `brightnessToRgb(preset, brightness)`: `brightness` ∈ [0,1] is perceptual.
  Channel = `round(c * brightness ** 2.2)`. Values are clamped so no lit channel
  falls below 20 while brightness > 0 (banding guard); brightness 0 → black.
- `fadeBrightness(start, floor, t)`: `t` ∈ [0,1] progress through the fade;
  returns `start * (floor/start) ** t` (exponential in luminance, i.e. linear in
  log-luminance). `t≤0 → start`, `t≥1 → floor`.
- `hueShiftPreset(preset, t)`: returns the preset one step warmer once
  `t ≥ 0.5`, clamped at Deep Red; identity when hueShift is off.
- `timerState(settings, startedAt, now, pausedTotalMs)`: returns
  `{ phase: 'hold' | 'fade' | 'floor', fadeProgress, remainingMs }` computed purely
  from timestamps, so lock-screen or app switching never desyncs it.
- `extendHold(timer, minutes)`: shifts the schedule later by `minutes`.

**`reading-light/main.js`**

- On load: read settings via `settings-store`, render colour, start timer
  immediately (opening the toy *is* starting the session).
- Timer loop: `requestAnimationFrame` while visible; recomputes colour from
  `timerState` each frame; on `visibilitychange` back to visible, recompute at
  once (no drift).
- Gestures (via `shared/gestures.js`):
  - single tap → toggle control sheet (auto-hides after 4 s of no interaction)
  - double tap → pause/resume fade
  - vertical swipe → adjust current brightness ±; while in `hold` this sets
    `startBrightness`; during `fade` it rescales the remaining curve from the
    new level.
- Control sheet contents: preset buttons (3), brightness slider, hold minutes,
  fade minutes, floor %, hue-shift toggle, clock toggle, "+5 min", "Restart",
  "Off" (black screen, timer stopped; tap to resume last settings).
- Status line in the sheet: phase and remaining minutes.
- Clock: `HH:MM` in the current colour at ~35% opacity, bottom-right, `font-variant-numeric: tabular-nums`.
- Wake lock acquired on first user gesture and re-acquired on `visibilitychange`.
- Fullscreen requested on first gesture where supported (Android/laptop).
- All setting changes save immediately.

**`shared/settings-store.js`**

- `createStore(key, defaults, version)`: returns `{ load(), save(partial) }`.
  Unknown or older versions are discarded in favour of defaults. Pure JSON.

**`shared/gestures.js`**

- Pointer-event based; exports `attachGestures(el, { onTap, onDoubleTap, onSwipe })`.
  Thresholds: double-tap 300 ms; swipe = vertical movement ≥ 24 px and
  horizontal < vertical. Recogniser core is a pure state machine so it can be
  tested without a DOM.

**`shared/wake-lock.js`**

- `keepAwake()`: tries `navigator.wakeLock.request('screen')`; on failure or
  absence, plays a muted, looping, tiny inline WebM/MP4 video. Returns a
  `release()`.

## 5. Visual design

- Background outside the lit area is `#000` always (OLED friendly).
- The control sheet is translucent black over the colour, text in the current
  preset colour at reduced saturation; no white UI anywhere, ever (white at
  night is the thing we are avoiding).
- Controls are large (≥ 44 px targets) for one-thumb use in the dark.
- Landing page (`index.html`): dark, lists toys as big tiles; just Reading Light
  for now.

## 6. Error handling

- Wake lock unavailable → silent fallback to video; if that also fails, show
  a one-line hint in the sheet: "Keep the screen awake in phone settings".
- Fullscreen unsupported → no-op.
- localStorage unavailable (private mode) → run with defaults, don't throw.
- Settings validated on load: numbers clamped to sane ranges (hold 0–120 min,
  fade 1–60 min, floor 0–50%, brightness 0.05–1).

## 7. Testing

- **Vitest unit tests** for `light.js` (presets, gamma mapping, banding guard,
  fade endpoints and monotonicity, hue shift timing, timer phases across
  pause/extend), `settings-store.js` (defaults, versioning, bad JSON), and the
  gesture state machine.
- **Manual device checklist** (iPhone, Safari and installed PWA): standalone
  launch has no browser chrome; screen stays awake 5+ min; lock and unlock does
  not jump the timer; swipe and taps work; settings persist after force-quit;
  offline launch works after install.

## 8. Defaults recap

| Setting            | Default  | Range       |
|--------------------|----------|-------------|
| Preset             | Amber    | 3 presets   |
| Start brightness   | 100 %    | 5–100 %     |
| Hold               | 15 min   | 0–120 min   |
| Fade               | 10 min   | 1–60 min    |
| Floor brightness   | 5 %      | 0–50 %      |
| Hue shift in fade  | on       |             |
| Clock              | on       |             |

Tip shown once on first launch: "Set your phone brightness to about 15 %, then
adjust here."
