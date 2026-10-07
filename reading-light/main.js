import {
  DEFAULT_SETTINGS, LIMITS, clampSettings, timerState, currentLight,
  extendSchedule, startForLevel,
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
  store.save(settings); // store.save merges onto stored data, so seenHint survives
  syncControls();
}

// ---------- rendering ----------
const PHASE_LABEL = { hold: 'Reading', fade: 'Dimming', floor: 'Night-light' };

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
  els.status.textContent = pausedAt ? 'Paused' : PHASE_LABEL[t.phase];
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
    if (els.sheet.hidden) showSheet(); else hideSheet();
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

syncControls();
render();
renderClock();
setInterval(renderClock, 1000);
requestAnimationFrame(tick);
