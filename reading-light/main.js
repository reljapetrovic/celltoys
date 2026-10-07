import {
  DEFAULT_SETTINGS, clampSettings, timerState, currentLight, extendSchedule,
  uiColor, renderIntervalMs, resumeSession,
} from './light.js';
import { createStore } from '../shared/settings-store.js';
import { attachGestures } from '../shared/gestures.js';
import { keepAwake } from '../shared/wake-lock.js';
import { requestFullscreen } from '../shared/fullscreen.js';

const store = createStore({
  key: 'celltoys.reading-light',
  version: 1,
  defaults: { ...DEFAULT_SETTINGS, seenHint: false },
});
// The running session survives a reload (iOS may evict a backgrounded PWA).
const sessionStore = createStore({
  key: 'celltoys.reading-light.session',
  version: 1,
  defaults: { startedAt: null, pausedAt: null, off: false },
});
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
const resumed = resumeSession(sessionStore.load(), settings, Date.now());
let startedAt = resumed?.startedAt ?? Date.now();
let pausedAt = resumed?.pausedAt ?? null;   // timestamp when paused, else null
let off = false;
let offset = 0;           // session-only swipe adjustment during fade/floor
let sheetTimer = null;
let awake = null;

// ---------- state helpers ----------
function effectiveNow() { return pausedAt ?? Date.now(); }
function timer() { return timerState(settings, startedAt, effectiveNow()); }
function saveSettings(partial) {
  settings = clampSettings({ ...settings, ...partial });
  store.save(settings); // store.save merges onto stored data, so seenHint survives
  syncControls();
}
function saveSession() { sessionStore.save({ startedAt, pausedAt, off }); }

// ---------- rendering ----------
const PHASE_LABEL = { hold: 'Reading', fade: 'Dimming', floor: 'Night-light' };
const rgbCss = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`);

function render() {
  const t = timer();
  const { presetId, rgb } = currentLight(settings, t, offset);
  const ui = uiColor(presetId);
  document.documentElement.style.setProperty('--fg', rgbCss(ui));
  document.documentElement.style.setProperty('--fg-dim', rgbCss(ui, 0.55));
  if (off) {
    els.light.style.background = '#000';
    els.clock.textContent = '';
    return;
  }
  const css = rgbCss(rgb);
  els.light.style.background = css;
  els.clock.style.color = css;
  els.status.textContent = pausedAt ? 'Paused' : PHASE_LABEL[t.phase];
  els.remaining.textContent = t.phase === 'floor' ? '' : `${Math.ceil(t.remainingMs / 60000)} min left`;
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

function showHint(text, ms = 8000) {
  els.hint.textContent = text;
  els.hint.hidden = false;
  setTimeout(() => { els.hint.hidden = true; }, ms);
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

// ---------- wake lock ----------
async function ensureAwake() {
  if (awake) return;
  awake = await keepAwake();
  if (!awake.ok) showHint('Keep the screen awake in phone settings');
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
}
function restart() {
  off = false; pausedAt = null; startedAt = Date.now(); offset = 0;
  saveSession();
  ensureAwake();
  syncControls();
  render();
}
function turnOff() {
  off = true;
  saveSession();
  releaseAwake();
  hideSheet();
  render();
}

function adjustBrightness(delta) {
  if (off) return;
  if (timer().phase === 'hold') {
    saveSettings({ startBrightness: settings.startBrightness + delta });
  } else {
    offset = Math.min(1, Math.max(-1, offset + delta));
  }
  render();
}

// ---------- wiring ----------
attachGestures(els.light, {
  onTap() {
    if (off) { restart(); return; }
    if (els.sheet.hidden) showSheet(); else hideSheet();
  },
  onDoubleTap: togglePause,
  onSwipe({ dy }) { adjustBrightness(-dy / 300); },
});
// pointerup (not pointerdown) counts as a user activation for fullscreen in Chromium.
els.light.addEventListener('pointerup', () => { ensureAwake(); requestFullscreen(); }, { once: true });

for (const b of els.sheet.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => { saveSettings({ preset: b.dataset.preset }); render(); });
}
els.brightness.addEventListener('input', () => saveSettings({ startBrightness: Number(els.brightness.value) }));
els.hold.addEventListener('input', () => saveSettings({ holdMinutes: Number(els.hold.value) }));
els.fade.addEventListener('input', () => saveSettings({ fadeMinutes: Number(els.fade.value) }));
els.floor.addEventListener('input', () => saveSettings({ floorBrightness: Number(els.floor.value) }));
els.hueShift.addEventListener('click', () => saveSettings({ hueShift: !settings.hueShift }));
els.showClock.addEventListener('click', () => saveSettings({ showClock: !settings.showClock }));
els.extend.addEventListener('click', () => { startedAt = extendSchedule(startedAt, 5); saveSession(); armSheetHide(); });
els.pause.addEventListener('click', togglePause);
els.restart.addEventListener('click', restart);
els.off.addEventListener('click', turnOff);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

// first-run hint
if (!store.load().seenHint) {
  showHint('Set your phone brightness to about 15 %, then adjust here.');
  store.save({ seenHint: true });
}

saveSession();
syncControls();
render();
tick();
