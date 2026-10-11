import {
  DEFAULT_SETTINGS, clampSettings, timerState, currentLight,
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
  light: $('light'), clock: $('clock'), paused: $('paused'), hint: $('hint'), sheet: $('sheet'),
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
let awakePromise = null;
let saveTimer = null;

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
  const { presetId, brightness, rgb } = currentLight(settings, t, offset);
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
  // The clock must contrast with the light itself: dark on a bright surface,
  // dim preset colour on an ember.
  els.clock.style.color = brightness > 0.5 ? 'rgba(0, 0, 0, 0.45)' : rgbCss(ui, 0.45);
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
// user activation. Try at load, retry on the first tap, and only count the
// real API as settled (the video fallback may or may not keep iOS awake).
function ensureAwake() {
  if (awake?.via === 'api') return Promise.resolve(true);
  if (!awakePromise) {
    awakePromise = (async () => {
      awake?.release();
      awake = await keepAwake();
      awakePromise = null;
      return awake.via === 'api';
    })();
  }
  return awakePromise;
}
function releaseAwake() {
  awake?.release();
  awake = null;
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
  ensureAwake();
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
  extraHoldMs += 5 * MIN_MS;
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
// on Safari, for the wake lock.
els.light.addEventListener('pointerup', () => {
  ensureAwake().then(ok => { if (!ok) toast.show('Keep the screen awake in phone settings'); });
  requestFullscreen();
}, { once: true });

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

// ---------- start ----------
saveSession();
syncControls();
render();
tick();
ensureAwake().then(ok => { if (!ok) toast.show('Tap the screen once to keep it awake'); });

// First launch: open the controls so they are discoverable, with the one tip
// the page cannot act on itself.
if (!store.load().seenHint) {
  sheet.show();
  toast.show('Tap the screen any time for these controls. Set phone brightness to about 15 %.', 12000);
  store.save({ seenHint: true });
}
