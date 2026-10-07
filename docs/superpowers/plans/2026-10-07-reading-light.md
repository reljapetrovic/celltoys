# Reading Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone web page (first "toy" in the celltoys repo) that fills the screen with amber/red light, dims on a timer to a faint ember, keeps the screen awake, and installs as a PWA from GitHub Pages.

**Architecture:** Vite multi-page site with one folder per toy and a `shared/` folder of tiny helpers. All colour/timer logic is a pure module (`reading-light/light.js`) tested with Vitest; `main.js` only wires DOM, gestures and timestamps. No UI framework.

**Tech Stack:** Vite 5, Vitest, @vitejs/plugin-basic-ssl (HTTPS dev on LAN), vite-plugin-pwa (service worker only), GitHub Actions → GitHub Pages. Plain ES modules, plain CSS.

**Spec:** `docs/superpowers/specs/2026-10-07-reading-light-design.md`

## Global Constraints

- Phone-first (iPhone Safari primary); controls ≥ 44 px; no white UI anywhere; background outside lit area is `#000`.
- Brightness is perceptual; channel = `round(c * brightness ** 2.2)`; dominant channel never below 2 while brightness > 0.
- Fade is exponential: `start * (floor/start) ** t`.
- Timer state is derived from timestamps, never from tick counts.
- Defaults: preset amber, start 100 %, hold 15 min, fade 10 min, floor 20 %, hueShift on, clock on.
- Ranges: start 0.2–1, floor 0.1–0.5, hold 0–120 min, fade 1–60 min.
- Vite `base` is `/celltoys/`; manifest and icons use relative URLs so they work locally and on Pages.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Corrupt or foreign JSON in localStorage (e.g. `"[1,2]"`, `"null"`, wrong version) → page still starts with defaults. Test added in Task 3.
2. `floorBrightness > startBrightness` after user edits → fade must still be monotonic toward floor, never NaN or negative. Test added in Task 2.
3. `holdMinutes = 0` → page is already in `fade` at `elapsed = 0`, `fadeProgress = 0`. Test added in Task 2.
4. Phone locked for longer than hold+fade, then unlocked → first frame shows `floor` phase at floor brightness, no replay of the fade. Covered by timestamp-derived `timerState` test in Task 2 (elapsed far beyond total).
5. Double tap must not also toggle the control sheet (two single taps). Test added in Task 4.

---

### Task 1: Project scaffold, landing page, test runner

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `shared/base.css`, `.gitignore`, `test/smoke.test.js`

**Interfaces:**
- Produces: `npm run dev` (HTTPS on LAN), `npm run build`, `npm test`. Vite `base = '/celltoys/'`. Entry points: `index.html`, `reading-light/index.html` (created in Task 6; config lists it now, Vite tolerates listing it only once it exists, so Task 1 lists just the landing page and Task 6 adds the second entry).

- [ ] **Step 1: Create package.json and .gitignore**

```json
{
  "name": "celltoys",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview --host",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@vitejs/plugin-basic-ssl": "^1.1.0",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.20.0",
    "vitest": "^2.0.0"
  }
}
```

`.gitignore`:
```
node_modules
dist
.DS_Store
```

- [ ] **Step 2: Create vite.config.js**

```js
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: '/celltoys/',
  plugins: [basicSsl()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Create shared/base.css**

```css
:root {
  color-scheme: dark;
  --fg: #ff8a40;
  --fg-dim: rgba(255, 138, 64, 0.55);
  --bg: #000;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg); color: var(--fg); }
body {
  font: 17px/1.4 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}
a { color: inherit; }
button, input, select {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--fg-dim);
  border-radius: 12px;
  min-height: 44px;
  padding: 0 14px;
}
button { cursor: pointer; }
button[aria-pressed="true"] { background: var(--fg-dim); color: #000; }
```

- [ ] **Step 4: Create landing index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#000000">
  <title>celltoys</title>
  <link rel="stylesheet" href="/shared/base.css">
  <style>
    main { max-width: 480px; margin: 0 auto; padding: 32px 16px; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    p { color: var(--fg-dim); margin-bottom: 24px; }
    .tile {
      display: block; padding: 24px 20px; border: 1px solid var(--fg-dim);
      border-radius: 16px; text-decoration: none; margin-bottom: 16px;
    }
    .tile strong { display: block; font-size: 20px; }
    .tile span { color: var(--fg-dim); }
  </style>
</head>
<body>
  <main>
    <h1>celltoys</h1>
    <p>Small toys for a phone.</p>
    <a class="tile" href="/reading-light/">
      <strong>Reading Light</strong>
      <span>Amber bedtime light that dims while you read.</span>
    </a>
  </main>
</body>
</html>
```

- [ ] **Step 5: Create a smoke test**

`test/smoke.test.js`:
```js
import { test, expect } from 'vitest';

test('test runner works', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npm test && npm run build`
Expected: 1 test passes; `dist/index.html` exists and references `/celltoys/assets/...`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Scaffold celltoys with Vite, Vitest and landing page"
```

---

### Task 2: Pure light model (`reading-light/light.js`)

**Files:**
- Create: `reading-light/light.js`
- Test: `test/light.test.js`

**Interfaces:**
- Produces:
  - `PRESETS: Array<{ id: 'candle'|'amber'|'red', name: string, rgb: [number,number,number] }>` ordered warm → warmest.
  - `DEFAULT_SETTINGS`, `LIMITS`, `clampSettings(partial) → Settings`
  - `brightnessToRgb(presetId, brightness) → [r,g,b]`
  - `fadeBrightness(start, floor, t) → number`
  - `startForLevel(level, floor, t) → number` (inverse of fade at progress t)
  - `hueShiftPreset(presetId, t, enabled) → presetId`
  - `timerState(settings, startedAt, now) → { phase, fadeProgress, remainingMs, elapsedMs }`
  - `currentLight(settings, timer) → { presetId, brightness, rgb }`
  - `extendSchedule(startedAt, minutes) → number`

- [ ] **Step 1: Write the failing tests**

`test/light.test.js`:
```js
import { describe, test, expect } from 'vitest';
import {
  PRESETS, DEFAULT_SETTINGS, LIMITS, clampSettings,
  brightnessToRgb, fadeBrightness, startForLevel, hueShiftPreset,
  timerState, currentLight, extendSchedule,
} from '../reading-light/light.js';

const MIN = 60_000;

describe('presets', () => {
  test('three presets ordered candle, amber, red', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['candle', 'amber', 'red']);
    expect(PRESETS[1].rgb).toEqual([255, 64, 0]);
    expect(PRESETS[2].rgb).toEqual([255, 0, 0]);
  });
});

describe('clampSettings', () => {
  test('fills defaults and clamps ranges', () => {
    const s = clampSettings({ holdMinutes: 999, floorBrightness: 0, preset: 'nope', fadeMinutes: 'x' });
    expect(s.holdMinutes).toBe(LIMITS.holdMinutes[1]);
    expect(s.floorBrightness).toBe(LIMITS.floorBrightness[0]);
    expect(s.preset).toBe('amber');
    expect(s.fadeMinutes).toBe(DEFAULT_SETTINGS.fadeMinutes);
    expect(s.hueShift).toBe(true);
  });
  test('accepts undefined', () => {
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('brightnessToRgb', () => {
  test('full brightness returns preset colour', () => {
    expect(brightnessToRgb('amber', 1)).toEqual([255, 64, 0]);
  });
  test('zero is black', () => {
    expect(brightnessToRgb('red', 0)).toEqual([0, 0, 0]);
  });
  test('applies gamma 2.2', () => {
    const [r] = brightnessToRgb('red', 0.5);
    expect(r).toBe(Math.round(255 * 0.5 ** 2.2)); // 56
  });
  test('dominant channel never below 2 while lit', () => {
    expect(brightnessToRgb('red', 0.01)[0]).toBe(2);
    expect(brightnessToRgb('candle', 0.01)[0]).toBe(2);
  });
  test('floor default is a visible ember', () => {
    expect(brightnessToRgb('red', DEFAULT_SETTINGS.floorBrightness)[0]).toBeGreaterThanOrEqual(5);
  });
});

describe('fadeBrightness', () => {
  test('endpoints', () => {
    expect(fadeBrightness(1, 0.2, 0)).toBeCloseTo(1);
    expect(fadeBrightness(1, 0.2, 1)).toBeCloseTo(0.2);
    expect(fadeBrightness(1, 0.2, -1)).toBeCloseTo(1);
    expect(fadeBrightness(1, 0.2, 2)).toBeCloseTo(0.2);
  });
  test('is exponential (halfway is geometric mean)', () => {
    expect(fadeBrightness(1, 0.25, 0.5)).toBeCloseTo(0.5);
  });
  test('monotonic and finite when floor > start', () => {
    const a = fadeBrightness(0.2, 0.5, 0.3);
    const b = fadeBrightness(0.2, 0.5, 0.6);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
    expect(a).toBeLessThan(b);
    expect(fadeBrightness(0.2, 0.5, 1)).toBeCloseTo(0.5);
  });
});

describe('startForLevel', () => {
  test('inverts fadeBrightness at progress t', () => {
    const start = startForLevel(0.4, 0.2, 0.3);
    expect(fadeBrightness(start, 0.2, 0.3)).toBeCloseTo(0.4);
  });
  test('at t=0 returns level itself', () => {
    expect(startForLevel(0.7, 0.2, 0)).toBeCloseTo(0.7);
  });
});

describe('hueShiftPreset', () => {
  test('shifts one step warmer after half the fade', () => {
    expect(hueShiftPreset('candle', 0.49, true)).toBe('candle');
    expect(hueShiftPreset('candle', 0.5, true)).toBe('amber');
    expect(hueShiftPreset('amber', 1, true)).toBe('red');
  });
  test('clamps at red and respects disabled', () => {
    expect(hueShiftPreset('red', 1, true)).toBe('red');
    expect(hueShiftPreset('amber', 1, false)).toBe('amber');
  });
});

describe('timerState', () => {
  const s = clampSettings({ holdMinutes: 15, fadeMinutes: 10 });
  const t0 = 1_000_000;
  test('hold phase', () => {
    const st = timerState(s, t0, t0 + 5 * MIN);
    expect(st.phase).toBe('hold');
    expect(st.fadeProgress).toBe(0);
    expect(st.remainingMs).toBe(20 * MIN);
  });
  test('fade phase progress', () => {
    const st = timerState(s, t0, t0 + 20 * MIN);
    expect(st.phase).toBe('fade');
    expect(st.fadeProgress).toBeCloseTo(0.5);
    expect(st.remainingMs).toBe(5 * MIN);
  });
  test('floor phase long after end', () => {
    const st = timerState(s, t0, t0 + 10 * 60 * MIN);
    expect(st.phase).toBe('floor');
    expect(st.fadeProgress).toBe(1);
    expect(st.remainingMs).toBe(0);
  });
  test('zero hold starts in fade immediately', () => {
    const st = timerState(clampSettings({ holdMinutes: 0, fadeMinutes: 10 }), t0, t0);
    expect(st.phase).toBe('fade');
    expect(st.fadeProgress).toBe(0);
  });
  test('now before start is treated as elapsed 0', () => {
    expect(timerState(s, t0, t0 - 5000).elapsedMs).toBe(0);
  });
});

describe('extendSchedule', () => {
  test('shifts start later', () => {
    expect(extendSchedule(1000, 5)).toBe(1000 + 5 * MIN);
  });
});

describe('currentLight', () => {
  const s = clampSettings({ preset: 'amber', startBrightness: 1, floorBrightness: 0.2, hueShift: true });
  test('hold uses start brightness and preset', () => {
    const l = currentLight(s, { phase: 'hold', fadeProgress: 0 });
    expect(l).toMatchObject({ presetId: 'amber', brightness: 1, rgb: [255, 64, 0] });
  });
  test('fade interpolates and shifts hue after half', () => {
    const l = currentLight(s, { phase: 'fade', fadeProgress: 0.75 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBeCloseTo(fadeBrightness(1, 0.2, 0.75));
  });
  test('floor uses floor brightness and shifted preset', () => {
    const l = currentLight(s, { phase: 'floor', fadeProgress: 1 });
    expect(l.presetId).toBe('red');
    expect(l.brightness).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/light.test.js`
Expected: FAIL, cannot resolve `../reading-light/light.js`.

- [ ] **Step 3: Implement light.js**

```js
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

export function brightnessToRgb(presetId, brightness) {
  if (!(brightness > 0)) return [0, 0, 0];
  const { rgb } = presetById(presetId);
  const scale = Math.min(1, brightness) ** GAMMA;
  const out = rgb.map(c => Math.round(c * scale));
  const dominant = rgb.indexOf(Math.max(...rgb));
  out[dominant] = Math.max(2, out[dominant]);
  return out;
}

export function fadeBrightness(start, floor, t) {
  const tt = Math.min(1, Math.max(0, t));
  return start * (floor / start) ** tt;
}

export function startForLevel(level, floor, t) {
  const tt = Math.min(0.999, Math.max(0, t));
  // fade(start, floor, t) = start^(1-t) * floor^t  =>  start = (level / floor^t)^(1/(1-t))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/light.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add reading-light/light.js test/light.test.js && git commit -m "Add pure light model with presets, gamma, fade and timer"
```

---

### Task 3: Settings store (`shared/settings-store.js`)

**Files:**
- Create: `shared/settings-store.js`
- Test: `test/settings-store.test.js`

**Interfaces:**
- Produces: `createStore({ key, version, defaults, storage }) → { load(): object, save(partial): object }`. `storage` defaults to `globalThis.localStorage` and may be undefined.

- [ ] **Step 1: Write the failing tests**

`test/settings-store.test.js`:
```js
import { describe, test, expect } from 'vitest';
import { createStore } from '../shared/settings-store.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    dump: () => Object.fromEntries(m),
  };
}

const defaults = { a: 1, b: 'x' };

describe('createStore', () => {
  test('returns defaults when empty', () => {
    const s = createStore({ key: 'k', version: 1, defaults, storage: memoryStorage() });
    expect(s.load()).toEqual(defaults);
  });
  test('save merges and persists with version envelope', () => {
    const st = memoryStorage();
    const s = createStore({ key: 'k', version: 1, defaults, storage: st });
    expect(s.save({ a: 2 })).toEqual({ a: 2, b: 'x' });
    expect(JSON.parse(st.dump().k)).toEqual({ v: 1, data: { a: 2, b: 'x' } });
    expect(s.load()).toEqual({ a: 2, b: 'x' });
  });
  test('discards other versions', () => {
    const st = memoryStorage({ k: JSON.stringify({ v: 0, data: { a: 9 } }) });
    const s = createStore({ key: 'k', version: 1, defaults, storage: st });
    expect(s.load()).toEqual(defaults);
  });
  test('tolerates corrupt, foreign and null JSON', () => {
    for (const raw of ['{not json', '[1,2]', 'null', '"str"', JSON.stringify({ v: 1, data: null })]) {
      const s = createStore({ key: 'k', version: 1, defaults, storage: memoryStorage({ k: raw }) });
      expect(s.load()).toEqual(defaults);
    }
  });
  test('works with no storage at all', () => {
    const s = createStore({ key: 'k', version: 1, defaults, storage: undefined });
    expect(s.load()).toEqual(defaults);
    expect(s.save({ a: 5 })).toEqual({ a: 5, b: 'x' });
  });
  test('survives a throwing storage', () => {
    const bad = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
    const s = createStore({ key: 'k', version: 1, defaults, storage: bad });
    expect(s.load()).toEqual(defaults);
    expect(s.save({ a: 3 })).toEqual({ a: 3, b: 'x' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/settings-store.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// Versioned JSON settings in localStorage (or any getItem/setItem object).
// Never throws: missing, corrupt or foreign data yields defaults.

export function createStore({ key, version, defaults, storage = globalThis.localStorage }) {
  function load() {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults };
      if (parsed.v !== version || !parsed.data || typeof parsed.data !== 'object') return { ...defaults };
      return { ...defaults, ...parsed.data };
    } catch {
      return { ...defaults };
    }
  }
  function save(partial) {
    const next = { ...load(), ...partial };
    try {
      storage?.setItem(key, JSON.stringify({ v: version, data: next }));
    } catch {
      // storage full or unavailable: keep running with in-memory value
    }
    return next;
  }
  return { load, save };
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/settings-store.js test/settings-store.test.js && git commit -m "Add versioned localStorage settings store"
```

---

### Task 4: Gesture recogniser (`shared/gestures.js`)

**Files:**
- Create: `shared/gestures.js`
- Test: `test/gestures.test.js`

**Interfaces:**
- Produces:
  - `createRecognizer({ onTap, onDoubleTap, onSwipe, doubleTapMs = 300, swipeThreshold = 24, schedule = setTimeout, cancel = clearTimeout })` → `{ down(x, y, t), move(x, y, t), up(x, y, t) }`. `onSwipe({ dy })` receives vertical movement since the previous swipe event (negative = finger moved up). A single tap fires only after `doubleTapMs` elapses without a second tap.
  - `attachGestures(el, handlers)` → `detach()`; binds pointer events on `el`.

- [ ] **Step 1: Write the failing tests**

`test/gestures.test.js`:
```js
import { describe, test, expect, vi } from 'vitest';
import { createRecognizer } from '../shared/gestures.js';

function fakeTimers() {
  const queue = [];
  return {
    schedule: (fn, ms) => { const id = { fn, ms }; queue.push(id); return id; },
    cancel: id => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); },
    flush: () => { while (queue.length) queue.shift().fn(); },
  };
}

function setup() {
  const timers = fakeTimers();
  const h = { onTap: vi.fn(), onDoubleTap: vi.fn(), onSwipe: vi.fn() };
  const r = createRecognizer({ ...h, schedule: timers.schedule, cancel: timers.cancel });
  return { r, h, timers };
}

describe('recognizer', () => {
  test('single tap fires after the double-tap window', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50);
    expect(h.onTap).not.toHaveBeenCalled();
    timers.flush();
    expect(h.onTap).toHaveBeenCalledTimes(1);
  });
  test('double tap fires once and suppresses single tap', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50);
    r.down(12, 11, 200); r.up(12, 11, 240);
    timers.flush();
    expect(h.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(h.onTap).not.toHaveBeenCalled();
  });
  test('two taps far apart in time are two single taps', () => {
    const { r, h, timers } = setup();
    r.down(10, 10, 0); r.up(10, 10, 50); timers.flush();
    r.down(10, 10, 1000); r.up(10, 10, 1050); timers.flush();
    expect(h.onTap).toHaveBeenCalledTimes(2);
    expect(h.onDoubleTap).not.toHaveBeenCalled();
  });
  test('vertical drag beyond threshold emits swipe deltas and no tap', () => {
    const { r, h, timers } = setup();
    r.down(100, 300, 0);
    r.move(100, 290, 10);   // 10px, under threshold
    r.move(102, 270, 20);   // 30px total, crosses threshold
    r.move(103, 250, 30);
    r.up(103, 250, 40);
    timers.flush();
    expect(h.onSwipe).toHaveBeenCalledTimes(2);
    expect(h.onSwipe.mock.calls[0][0].dy).toBe(-30);
    expect(h.onSwipe.mock.calls[1][0].dy).toBe(-20);
    expect(h.onTap).not.toHaveBeenCalled();
  });
  test('horizontal drag is neither swipe nor tap', () => {
    const { r, h, timers } = setup();
    r.down(100, 300, 0); r.move(160, 305, 20); r.up(160, 305, 40); timers.flush();
    expect(h.onSwipe).not.toHaveBeenCalled();
    expect(h.onTap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests** → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// Tap / double-tap / vertical-swipe recogniser. Core is a pure state machine
// (createRecognizer) so it can be tested without a DOM; attachGestures binds it
// to pointer events.

export function createRecognizer({
  onTap = () => {}, onDoubleTap = () => {}, onSwipe = () => {},
  doubleTapMs = 300, swipeThreshold = 24,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
} = {}) {
  let start = null;        // { x, y, t }
  let lastY = 0;
  let swiping = false;
  let moved = false;
  let pendingTap = null;   // timer id for a delayed single tap
  let lastTapAt = -Infinity;

  function down(x, y, t) {
    start = { x, y, t };
    lastY = y;
    swiping = false;
    moved = false;
  }

  function move(x, y, t) {
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (!swiping) {
      if (Math.abs(dy) >= swipeThreshold && Math.abs(dy) > Math.abs(dx)) {
        swiping = true;
        onSwipe({ dy: y - lastY });
        lastY = y;
      } else if (Math.abs(dx) >= swipeThreshold) {
        moved = true; // horizontal drag: not a tap
      }
      return;
    }
    if (y !== lastY) {
      onSwipe({ dy: y - lastY });
      lastY = y;
    }
  }

  function up(x, y, t) {
    if (!start) return;
    const wasSwipe = swiping;
    const wasMoved = moved;
    start = null;
    swiping = false;
    if (wasSwipe || wasMoved) return;

    if (t - lastTapAt <= doubleTapMs && pendingTap) {
      cancel(pendingTap);
      pendingTap = null;
      lastTapAt = -Infinity;
      onDoubleTap();
      return;
    }
    lastTapAt = t;
    pendingTap = schedule(() => { pendingTap = null; onTap(); }, doubleTapMs);
  }

  return { down, move, up };
}

export function attachGestures(el, handlers) {
  const r = createRecognizer(handlers);
  const now = () => performance.now();
  const onDown = e => { if (e.isPrimary) r.down(e.clientX, e.clientY, now()); };
  const onMove = e => { if (e.isPrimary) r.move(e.clientX, e.clientY, now()); };
  const onUp = e => { if (e.isPrimary) r.up(e.clientX, e.clientY, now()); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/gestures.js test/gestures.test.js && git commit -m "Add tap, double-tap and vertical swipe recogniser"
```

---

### Task 5: Wake lock and fullscreen helpers

**Files:**
- Create: `shared/wake-lock.js`, `shared/fullscreen.js`

**Interfaces:**
- Produces: `keepAwake() → Promise<{ ok: boolean, release() }>`; re-acquires itself on `visibilitychange`. `requestFullscreen(el)`; `isStandalone() → boolean`.

No unit tests (browser-only APIs); verified in Task 6's device checklist.

- [ ] **Step 1: Create shared/wake-lock.js**

```js
// Keep the screen awake. Prefers the Screen Wake Lock API; falls back to a
// muted looping video fed from a canvas stream (works on older Safari).

export async function keepAwake() {
  let sentinel = null;
  let video = null;
  let released = false;

  async function viaApi() {
    if (!('wakeLock' in navigator)) return false;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => { sentinel = null; });
      return true;
    } catch {
      return false;
    }
  }

  function viaVideo() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2; canvas.height = 2;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const stream = canvas.captureStream(1);
      video = document.createElement('video');
      video.muted = true; video.loop = true; video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none';
      video.srcObject = stream;
      document.body.appendChild(video);
      setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#000' : '#010101'; ctx.fillRect(0, 0, 2, 2); }, 1000);
      return video.play().then(() => true).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  async function acquire() {
    if (released) return false;
    if (await viaApi()) return true;
    if (!video) return viaVideo();
    return video.play().then(() => true).catch(() => false);
  }

  const onVisible = () => { if (document.visibilityState === 'visible' && !sentinel) acquire(); };
  document.addEventListener('visibilitychange', onVisible);

  const ok = await acquire();
  return {
    ok,
    release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release?.();
      if (video) { video.pause(); video.remove(); video = null; }
    },
  };
}
```

- [ ] **Step 2: Create shared/fullscreen.js**

```js
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

// iPhone Safari has no element fullscreen; Android and desktop do.
export function requestFullscreen(el = document.documentElement) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn || isStandalone() || document.fullscreenElement) return Promise.resolve(false);
  try {
    return Promise.resolve(fn.call(el)).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/wake-lock.js shared/fullscreen.js && git commit -m "Add wake lock and fullscreen helpers"
```

---

### Task 6: Reading light page (HTML, CSS, main.js)

**Files:**
- Create: `reading-light/index.html`, `reading-light/style.css`, `reading-light/main.js`
- Modify: `vite.config.js` (add entry)

**Interfaces:**
- Consumes: everything from Tasks 2–5 with the exact names listed there.

- [ ] **Step 1: Add the entry to vite.config.js**

Replace the `input` object with:
```js
      input: {
        main: resolve(__dirname, 'index.html'),
        readingLight: resolve(__dirname, 'reading-light/index.html'),
      },
```

- [ ] **Step 2: Create reading-light/index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#000000">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Reading Light">
  <link rel="manifest" href="/reading-light/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/reading-light/icon-180.png">
  <title>Reading Light</title>
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="light" aria-label="Reading light surface"></div>
  <div id="clock" aria-hidden="true"></div>
  <div id="hint" hidden>Set your phone brightness to about 15 %, then adjust here.</div>

  <section id="sheet" hidden aria-label="Controls">
    <div class="row status">
      <span id="status">Reading</span>
      <span id="remaining"></span>
    </div>
    <div class="row presets" role="group" aria-label="Colour">
      <button data-preset="candle">Candle</button>
      <button data-preset="amber">Amber</button>
      <button data-preset="red">Deep Red</button>
    </div>
    <label class="row"><span>Brightness</span>
      <input id="brightness" type="range" min="0.2" max="1" step="0.01"></label>
    <label class="row"><span>Hold <output id="holdOut"></output> min</span>
      <input id="hold" type="range" min="0" max="120" step="1"></label>
    <label class="row"><span>Fade <output id="fadeOut"></output> min</span>
      <input id="fade" type="range" min="1" max="60" step="1"></label>
    <label class="row"><span>Night-light <output id="floorOut"></output> %</span>
      <input id="floor" type="range" min="0.1" max="0.5" step="0.01"></label>
    <div class="row toggles">
      <button id="hueShift" aria-pressed="true">Warm as it fades</button>
      <button id="showClock" aria-pressed="true">Clock</button>
    </div>
    <div class="row actions">
      <button id="extend">+5 min</button>
      <button id="pause">Pause</button>
      <button id="restart">Restart</button>
      <button id="off">Off</button>
    </div>
    <p class="help">Tap: controls · Double-tap: pause · Swipe up/down: brightness</p>
  </section>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create reading-light/style.css**

```css
html, body { overflow: hidden; height: 100%; }
#light {
  position: fixed; inset: 0; background: #000;
  touch-action: none; user-select: none; -webkit-user-select: none;
}
#clock {
  position: fixed; right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  font-size: 22px; font-variant-numeric: tabular-nums; opacity: 0.35;
  pointer-events: none; letter-spacing: 0.04em;
}
#hint {
  position: fixed; top: max(24px, env(safe-area-inset-top)); left: 16px; right: 16px;
  text-align: center; color: var(--fg-dim); font-size: 15px; pointer-events: none;
}
#sheet {
  position: fixed; left: 0; right: 0; bottom: 0;
  padding: 16px 16px max(16px, env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(6px);
  border-top: 1px solid var(--fg-dim); border-radius: 20px 20px 0 0;
  max-height: 85vh; overflow-y: auto;
}
#sheet[hidden] { display: none; }
.row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.row > span { flex: 0 0 150px; }
.row input[type="range"] { flex: 1; min-height: 44px; accent-color: var(--fg); border: 0; padding: 0; }
.status { justify-content: space-between; color: var(--fg-dim); font-size: 15px; }
.presets button, .toggles button, .actions button { flex: 1; }
.help { color: var(--fg-dim); font-size: 13px; text-align: center; margin-top: 4px; }
```

- [ ] **Step 4: Create reading-light/main.js**

```js
import {
  PRESETS, DEFAULT_SETTINGS, clampSettings, timerState, currentLight,
  extendSchedule, startForLevel, LIMITS,
} from './light.js';
import { createStore } from '../shared/settings-store.js';
import { attachGestures } from '../shared/gestures.js';
import { keepAwake } from '../shared/wake-lock.js';
import { requestFullscreen } from '../shared/fullscreen.js';

const store = createStore({ key: 'celltoys.reading-light', version: 1, defaults: { ...DEFAULT_SETTINGS, seenHint: false } });
const $ = id => document.getElementById(id);
const els = {
  light: $('light'), clock: $('clock'), hint: $('hint'), sheet: $('sheet'),
  status: $('status'), remaining: $('remaining'),
  brightness: $('brightness'), hold: $('hold'), fade: $('fade'), floor: $('floor'),
  holdOut: $('holdOut'), fadeOut: $('fadeOut'), floorOut: $('floorOut'),
  hueShift: $('hueShift'), showClock: $('showClock'),
  extend: $('extend'), pause: $('pause'), restart: $('restart'), off: $('off'),
};

let settings = clampSettings(store.load());
let startedAt = Date.now();
let pausedAt = null;      // timestamp when paused, else null
let off = false;
let sheetTimer = null;
let awake = null;

// ---------- state helpers ----------
function effectiveNow() { return pausedAt ?? Date.now(); }
function timer() { return timerState(settings, startedAt, effectiveNow()); }
function saveSettings(partial) {
  settings = clampSettings({ ...settings, ...partial });
  store.save(settings);
  syncControls();
}

// ---------- rendering ----------
function render() {
  if (off) {
    els.light.style.background = '#000';
    els.clock.style.color = '#200';
    return;
  }
  const t = timer();
  const { rgb } = currentLight(settings, t);
  const css = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  els.light.style.background = css;
  els.clock.style.color = css;
  document.documentElement.style.setProperty('--fg', css);
  els.status.textContent = pausedAt ? 'Paused' : ({ hold: 'Reading', fade: 'Dimming', floor: 'Night-light' })[t.phase];
  els.remaining.textContent = t.phase === 'floor' ? '' : `${Math.ceil(t.remainingMs / 60000)} min left`;
}

function tick() {
  if (document.visibilityState === 'visible') render();
  requestAnimationFrame(tick);
}

function renderClock() {
  if (!settings.showClock || off) { els.clock.textContent = ''; return; }
  const d = new Date();
  els.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function syncControls() {
  for (const b of els.sheet.querySelectorAll('[data-preset]')) {
    b.setAttribute('aria-pressed', String(b.dataset.preset === settings.preset));
  }
  els.brightness.value = settings.startBrightness;
  els.hold.value = settings.holdMinutes; els.holdOut.textContent = settings.holdMinutes;
  els.fade.value = settings.fadeMinutes; els.fadeOut.textContent = settings.fadeMinutes;
  els.floor.value = settings.floorBrightness; els.floorOut.textContent = Math.round(settings.floorBrightness * 100);
  els.hueShift.setAttribute('aria-pressed', String(settings.hueShift));
  els.showClock.setAttribute('aria-pressed', String(settings.showClock));
  els.pause.textContent = pausedAt ? 'Resume' : 'Pause';
  renderClock();
}

// ---------- sheet visibility ----------
function showSheet() {
  els.sheet.hidden = false;
  syncControls();
  armSheetHide();
}
function hideSheet() { els.sheet.hidden = true; clearTimeout(sheetTimer); }
function armSheetHide() {
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(hideSheet, 4000);
}
els.sheet.addEventListener('pointerdown', armSheetHide);
els.sheet.addEventListener('input', armSheetHide);

// ---------- actions ----------
function togglePause() {
  if (off) return;
  if (pausedAt) { startedAt += Date.now() - pausedAt; pausedAt = null; }
  else pausedAt = Date.now();
  syncControls();
}
function restart() { off = false; pausedAt = null; startedAt = Date.now(); syncControls(); }
function turnOff() { off = true; hideSheet(); render(); renderClock(); }

function adjustBrightness(delta) {
  if (off) return;
  const t = timer();
  if (t.phase === 'hold') {
    saveSettings({ startBrightness: settings.startBrightness + delta });
  } else if (t.phase === 'fade') {
    const { brightness } = currentLight(settings, t);
    const level = Math.min(1, Math.max(LIMITS.floorBrightness[0], brightness + delta));
    saveSettings({ startBrightness: startForLevel(level, settings.floorBrightness, t.fadeProgress) });
  } else {
    saveSettings({ floorBrightness: settings.floorBrightness + delta });
  }
}

async function firstGesture() {
  if (!awake) awake = await keepAwake();
  requestFullscreen();
}

// ---------- wiring ----------
attachGestures(els.light, {
  onTap() {
    if (off) { restart(); return; }
    els.sheet.hidden ? showSheet() : hideSheet();
  },
  onDoubleTap: togglePause,
  onSwipe({ dy }) { adjustBrightness(-dy / 300); },
});
els.light.addEventListener('pointerdown', firstGesture, { once: true });

for (const b of els.sheet.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => saveSettings({ preset: b.dataset.preset }));
}
els.brightness.addEventListener('input', () => saveSettings({ startBrightness: Number(els.brightness.value) }));
els.hold.addEventListener('input', () => saveSettings({ holdMinutes: Number(els.hold.value) }));
els.fade.addEventListener('input', () => saveSettings({ fadeMinutes: Number(els.fade.value) }));
els.floor.addEventListener('input', () => saveSettings({ floorBrightness: Number(els.floor.value) }));
els.hueShift.addEventListener('click', () => saveSettings({ hueShift: !settings.hueShift }));
els.showClock.addEventListener('click', () => saveSettings({ showClock: !settings.showClock }));
els.extend.addEventListener('click', () => { startedAt = extendSchedule(startedAt, 5); armSheetHide(); });
els.pause.addEventListener('click', togglePause);
els.restart.addEventListener('click', restart);
els.off.addEventListener('click', turnOff);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

// first-run hint
if (!store.load().seenHint) {
  els.hint.hidden = false;
  setTimeout(() => { els.hint.hidden = true; }, 8000);
  store.save({ seenHint: true });
}

for (const p of PRESETS) void p; // presets are rendered statically in HTML; keep import for clarity
syncControls();
render();
renderClock();
setInterval(renderClock, 1000);
requestAnimationFrame(tick);
```

Note: `settings` stores only the keys clampSettings knows about; `seenHint` lives in the store but is dropped by clampSettings, so `store.save(settings)` keeps it because `save` merges onto the previously loaded value.

- [ ] **Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: all tests pass; `dist/reading-light/index.html` exists.

- [ ] **Step 6: Manual check in a desktop browser**

Run: `npm run dev` and open the printed `https://localhost:5173/celltoys/reading-light/` (accept the self-signed cert). Verify: amber fill; click shows sheet; sheet hides after 4 s; sliders update; set hold to 0 and fade to 1 to watch the fade; "Off" → black, click → back.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Add reading light page with controls, timer and gestures"
```

---

### Task 7: PWA manifest, icons and service worker

**Files:**
- Create: `public/reading-light/manifest.webmanifest`, `public/reading-light/icon-180.png`, `public/reading-light/icon-512.png`, `scripts/make-icons.py`
- Modify: `vite.config.js`

- [ ] **Step 1: Create scripts/make-icons.py** (pure Python, no dependencies; amber rounded square with a soft glow)

```python
#!/usr/bin/env python3
"""Generate reading-light PNG icons without external libraries."""
import struct, zlib, sys, os, math

def png(width, height, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y]) for y in range(height))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def icon(size):
    rows = []
    cx = cy = size / 2
    r = size * 0.42
    for y in range(size):
        row = []
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / r
            # glow: amber centre fading to deep red edge, black outside the disc
            if d > 1.08:
                row += [0, 0, 0]
            else:
                k = max(0.0, 1 - d) ** 0.6
                row += [int(255 * min(1, 0.35 + 0.65 * k)), int(64 * k), 0]
        rows.append(row)
    return png(size, size, rows)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for s in (180, 512):
    with open(os.path.join(out, f'icon-{s}.png'), 'wb') as f:
        f.write(icon(s))
print('ok')
```

Run: `python3 scripts/make-icons.py public/reading-light` → prints `ok`; two PNGs exist.

- [ ] **Step 2: Create public/reading-light/manifest.webmanifest**

```json
{
  "name": "Reading Light",
  "short_name": "Reading Light",
  "description": "Amber bedtime reading light that dims while you read.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: Add vite-plugin-pwa for offline caching (manifest handled manually)**

In `vite.config.js`:
```js
import { VitePWA } from 'vite-plugin-pwa';
// ...
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: null,
      },
    }),
  ],
```

- [ ] **Step 4: Build and inspect**

Run: `npm run build && ls dist dist/reading-light && grep -c registerSW dist/reading-light/index.html`
Expected: `dist/sw.js` and `dist/reading-light/{index.html,manifest.webmanifest,icon-180.png,icon-512.png}` exist; grep prints `1`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add PWA manifest, icons and offline service worker"
```

---

### Task 8: GitHub Pages deployment and README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create README.md**

```markdown
# celltoys

Small toys for a phone. Static site built with Vite, deployed to GitHub Pages.

## Toys

- **Reading Light** (`/reading-light/`): amber or red bedtime reading light that
  holds, then dims to a faint night-light. Install it from Safari with
  Share → Add to Home Screen for a chrome-free full screen.

## Develop

    npm install
    npm run dev        # HTTPS dev server on your LAN; open the printed URL on your phone
    npm test
    npm run build

## Deploy

Push to `main`. The workflow builds and publishes `dist/` to GitHub Pages.
In the repo settings, set Pages → Source to "GitHub Actions" once.
Vite `base` is `/celltoys/`; rename both if the repo is renamed.
```

- [ ] **Step 3: Rename branch to main and commit**

```bash
git branch -M main && git add -A && git commit -m "Add GitHub Pages workflow and README"
```

- [ ] **Step 4: Final verification**

Run: `npm test && npm run build`. Expected: all green. Then report the device checklist from the spec (section 7) for the user to run on their phone; creating the GitHub repo and pushing is the user's step.
