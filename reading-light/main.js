import {
  DEFAULT_SETTINGS, clampSettings, timerState, currentLight, extendHold,
  uiColor, renderIntervalMs, resumeSession,
} from './light.js';
import { createStore } from '../shared/settings-store.js';
import { attachGestures } from '../shared/gestures.js';
import { attachSheet, createToast } from '../shared/sheet.js';
import { keepAwake } from '../shared/wake-lock.js';
import { requestFullscreen } from '../shared/fullscreen.js';

const MIN_MS = 60_000;
// v2: the night-light default changed from 20 % to 35 %; older saved settings reset.
const store = createStore({
  key: 'celltoys.reading-light',
  version: 2,
  defaults: { ...DEFAULT_SETTINGS, seenHint: false },
});
// The running session survives a reload (iOS may evict a backgrounded PWA).
const sessionStore = createStore({
  key: 'celltoys.reading-light.session',
  version: 2,
  defaults: { startedAt: null, pausedAt: null, off: false, extraHoldMs: 0 },
});
const $ = id => document.getElementById(id);
const els = {
  light: $('light'), clock: $('clock'), paused: $('paused'), hint: $('hint'), intro: $('intro'), sheet: $('sheet'),
  status: $('status'), remaining: $('remaining'),
  brightness: $('brightness'), hold: $('hold'), fade: $('fade'), floor: $('floor'),
  holdOut: $('holdOut'), fadeOut: $('fadeOut'), floorOut: $('floorOut'),
  hueShift: $('hueShift'), showClock: $('showClock'),
  extend: $('extend'), pause: $('pause'), restart: $('restart'), off: $('off'),
};

let settings = clampSettings(store.load());
const saved = sessionStore.load();
const savedExtra = Number.isFinite(saved.extraHoldMs) ? Math.max(0, saved.extraHoldMs) : 0;
const resumed = resumeSession(saved, { ...settings, holdMinutes: settings.holdMinutes + savedExtra / MIN_MS }, Date.now());
let startedAt = resumed?.startedAt ?? Date.now();
let pausedAt = resumed?.pausedAt ?? null;   // timestamp when paused, else null
let extraHoldMs = resumed ? savedExtra : 0;  // "+5 min" presses this session
let off = false;
let offset = 0;           // session-only swipe adjustment during fade/floor
let awake = null;
let awakeGen = 0;          // generation token: only the latest keepAwake() result counts
let awakeTries = 0;
let awakeHintShown = false;
let saveTimer = null;
const MAX_AWAKE_TRIES = 4;
const firstRun = !store.load().seenHint;

const toast = createToast(els.hint);
const sheet = attachSheet(els.sheet, { hideAfterMs: 8000, onShow: () => syncControls() });

// ---------- state helpers ----------
function effectiveNow() { return pausedAt ?? Date.now(); }
function timer() { return timerState(settings, startedAt, effectiveNow(), extraHoldMs); }
function saveSettings(partial) {
  settings = clampSettings({ ...settings, ...partial });
  store.save(settings); // store.save merges onto stored data, so seenHint survives
  syncControls();
}
// For swipes: apply immediately, persist once the finger settles.
function setSettingsSoon(partial) {
  settings = clampSettings({ ...settings, ...partial });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.save(settings); syncControls(); }, 300);
}
function saveSession() { sessionStore.save({ startedAt, pausedAt, off, extraHoldMs }); }

// ---------- rendering ----------
const PHASE_LABEL = { hold: 'Reading', fade: 'Dimming', floor: 'Night-light' };
const rgbCss = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`);

function render() {
  const t = timer();
  const { presetId, rgb } = currentLight(settings, t, offset);
  const ui = uiColor(presetId);
  document.documentElement.style.setProperty('--fg', rgbCss(ui));
  document.documentElement.style.setProperty('--fg-dim', rgbCss(ui, 0.7));
  els.paused.hidden = !pausedAt || off;
  if (off) {
    els.light.style.background = '#000';
    els.clock.textContent = '';
    return;
  }
  els.light.style.background = rgbCss(rgb);
  els.status.textContent = pausedAt ? 'Paused' : PHASE_LABEL[t.phase];
  els.remaining.textContent = t.phase === 'floor' ? '' : `${Math.ceil(t.remainingMs / MIN_MS)} min left`;
  renderClock();
}

function tick() {
  if (document.visibilityState === 'visible') render();
  setTimeout(tick, renderIntervalMs(timer().phase, off));
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

// ---------- wake lock ----------
// Chrome grants the Screen Wake Lock without a gesture; Safari gates it on
// user activation. Try at load and again on taps until the real API has
// succeeded (the video fallback may or may not keep iOS awake). Each call
// issues a fresh request synchronously, so a call from pointerup runs inside
// the activation; a generation token keeps a slow earlier attempt from
// overriding a later, better one.
function ensureAwake() {
  if (awake?.via === 'api') return Promise.resolve(true);
  if (awakeTries >= MAX_AWAKE_TRIES) return Promise.resolve(false);
  awakeTries++;
  const gen = ++awakeGen;
  return keepAwake().then(next => {
    if (gen !== awakeGen) { next.release(); return awake?.via === 'api'; }
    awake?.release();
    awake = next;
    return next.via === 'api';
  });
}
function awakeHint(text) {
  if (awakeHintShown) return;
  awakeHintShown = true;
  toast.show(text);
}
function releaseAwake() {
  awake?.release();
  awake = null;
  awakeTries = 0;
}

// ---------- actions ----------
function togglePause() {
  if (off) return;
  if (pausedAt) { startedAt += Date.now() - pausedAt; pausedAt = null; }
  else pausedAt = Date.now();
  saveSession();
  syncControls();
  render();
  toast.show(pausedAt ? 'Paused' : 'Resumed', 2500);
}
function restart() {
  off = false; pausedAt = null; startedAt = Date.now(); offset = 0; extraHoldMs = 0;
  saveSession();
  ensureAwake().then(ok => { if (!ok) awakeHint('Keep the screen awake in phone settings'); });
  syncControls();
  render();
}
function turnOff() {
  off = true;
  saveSession();
  releaseAwake();
  sheet.hide();
  render();
}
function extend() {
  extraHoldMs = extendHold(settings, timer(), extraHoldMs, 5);
  saveSession();
  sheet.activity();
  render();
}

function adjustBrightness(delta) {
  if (off) return;
  if (timer().phase === 'hold') {
    setSettingsSoon({ startBrightness: settings.startBrightness + delta });
  } else {
    offset = Math.min(1, Math.max(-1, offset + delta));
  }
  render();
}

// ---------- wiring ----------
attachGestures(els.light, {
  onTap() {
    if (off) { restart(); return; }
    sheet.toggle();
  },
  onDoubleTap: togglePause,
  onSwipe({ dy }) { adjustBrightness(-dy / 300); },
});
// pointerup (not pointerdown) counts as a user activation for fullscreen and,
// on Safari, for the wake lock. Every tap retries until the API has succeeded.
els.light.addEventListener('pointerup', () => {
  if (awake?.via !== 'api') {
    ensureAwake().then(ok => { if (!ok) awakeHint('Keep the screen awake in phone settings'); });
  }
  requestFullscreen();
});
els.light.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (off) restart(); else sheet.toggle();
});

for (const b of els.sheet.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => { saveSettings({ preset: b.dataset.preset }); render(); });
}
els.brightness.addEventListener('input', () => saveSettings({ startBrightness: Number(els.brightness.value) }));
els.hold.addEventListener('input', () => saveSettings({ holdMinutes: Number(els.hold.value) }));
els.fade.addEventListener('input', () => saveSettings({ fadeMinutes: Number(els.fade.value) }));
els.floor.addEventListener('input', () => saveSettings({ floorBrightness: Number(els.floor.value) }));
els.hueShift.addEventListener('click', () => { saveSettings({ hueShift: !settings.hueShift }); render(); });
els.showClock.addEventListener('click', () => saveSettings({ showClock: !settings.showClock }));
els.extend.addEventListener('click', extend);
els.pause.addEventListener('click', togglePause);
els.restart.addEventListener('click', restart);
els.off.addEventListener('click', turnOff);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

// ---------- intro card ----------
// Shown at every launch; fades after a few seconds or on the first touch.
let introTimer = setTimeout(dismissIntro, 6000);
function dismissIntro() {
  clearTimeout(introTimer);
  if (els.intro.hidden) return;
  els.intro.classList.add('fade');
  setTimeout(() => { els.intro.hidden = true; }, 900);
}
els.light.addEventListener('pointerdown', dismissIntro, { once: true });

// ---------- start ----------
saveSession();
syncControls();
render();
tick();
// On first launch the discoverability toast already asks for a tap, which also
// satisfies Safari's wake-lock activation, so the wake hint is skipped then.
ensureAwake().then(ok => { if (!ok && !firstRun) awakeHint('Tap the screen once to keep it awake'); });

// First launch: open the controls so they are discoverable, with the one tip
// the page cannot act on itself.
if (firstRun) {
  sheet.show();
  toast.show('Tap the screen any time for these controls. Set phone brightness to about 15 %.', 12000);
  store.save({ seenHint: true });
}
