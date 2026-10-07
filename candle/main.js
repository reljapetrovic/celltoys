import { createBlowDetector } from './blow.js';
import { INITIAL_FLAME, stepFlame, relight } from './flame.js';
import { startMic } from './mic.js';
import { createRenderer } from './render.js';
import { createStore } from '../shared/settings-store.js';
import { attachGestures } from '../shared/gestures.js';
import { keepAwake } from '../shared/wake-lock.js';
import { requestFullscreen } from '../shared/fullscreen.js';

const store = createStore({ key: 'celltoys.candle', version: 1, defaults: { sensitivity: 1, showMeter: false } });
const clampSettings = s => ({
  sensitivity: Math.min(3, Math.max(0.5, Number(s.sensitivity) || 1)),
  showMeter: s.showMeter === true,
});
let settings = clampSettings(store.load());

const $ = id => document.getElementById(id);
const els = {
  scene: $('scene'), start: $('start'), note: $('note'), gear: $('gear'), sheet: $('sheet'),
  sensitivity: $('sensitivity'), sensOut: $('sensOut'), meter: $('meter'),
};

const renderer = createRenderer(els.scene);
let flame = { ...INITIAL_FLAME, lit: false, size: 0 };
let detector = null;
let mic = null;
let timeBuf = null, freqBuf = null;
let intensity = 0;
let last = performance.now();
let started = false;
let sheetTimer = null;

function showNote(text, ms = 6000) {
  els.note.textContent = text; els.note.hidden = false;
  setTimeout(() => { els.note.hidden = true; }, ms);
}

function saveSettings(partial) {
  settings = clampSettings({ ...settings, ...partial });
  store.save(settings);
  detector?.setSensitivity(settings.sensitivity);
  syncControls();
}
function syncControls() {
  els.sensitivity.value = settings.sensitivity;
  els.sensOut.textContent = settings.sensitivity.toFixed(1);
  els.meter.setAttribute('aria-pressed', String(settings.showMeter));
}

async function start() {
  if (started) return;
  started = true;
  els.start.hidden = true;
  keepAwake();
  requestFullscreen();
  flame = relight(flame);
  try {
    mic = await startMic();
    detector = createBlowDetector({ sampleRate: mic.sampleRate, fftSize: mic.fftSize, sensitivity: settings.sensitivity });
    timeBuf = new Float32Array(mic.fftSize);
    freqBuf = new Uint8Array(mic.fftSize / 2);
  } catch {
    showNote('Blowing needs the microphone. The candle still flickers.');
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (document.visibilityState === 'visible') {
    if (detector) {
      mic.readTime(timeBuf); mic.readFreq(freqBuf);
      intensity = detector.update(timeBuf, freqBuf, dt).intensity;
    }
    flame = stepFlame(flame, intensity, dt);
    renderer.draw(flame, intensity, now / 1000, dt, { meter: settings.showMeter });
  }
  requestAnimationFrame(frame);
}

// ---------- sheet ----------
function armSheetHide() { clearTimeout(sheetTimer); sheetTimer = setTimeout(() => { els.sheet.hidden = true; }, 5000); }
els.gear.addEventListener('click', () => { els.sheet.hidden = !els.sheet.hidden; if (!els.sheet.hidden) armSheetHide(); });
els.sheet.addEventListener('input', armSheetHide);
els.sheet.addEventListener('pointerdown', armSheetHide);
els.sensitivity.addEventListener('input', () => saveSettings({ sensitivity: Number(els.sensitivity.value) }));
els.meter.addEventListener('click', () => saveSettings({ showMeter: !settings.showMeter }));

// ---------- gestures ----------
els.start.addEventListener('pointerup', start, { once: true });
attachGestures(els.scene, {
  onTap() {
    if (!started) { start(); return; }
    if (!flame.lit) flame = relight(flame);
  },
});

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
syncControls();
requestAnimationFrame(frame);
