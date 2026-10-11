import { createBlowDetector } from './blow.js';
import { INITIAL_FLAME, stepFlame, relight } from './flame.js';
import { startMic } from './mic.js';
import { createRenderer } from './render.js';
import { DEFAULT_SETTINGS, clampSettings } from './settings.js';
import { createStore } from '../shared/settings-store.js';
import { attachSheet, createToast } from '../shared/sheet.js';
import { keepAwake } from '../shared/wake-lock.js';
import { requestFullscreen } from '../shared/fullscreen.js';

const store = createStore({ key: 'celltoys.candle', version: 1, defaults: DEFAULT_SETTINGS });
let settings = clampSettings(store.load());

const $ = id => document.getElementById(id);
const els = {
  scene: $('scene'), probe: $('safe-probe'), start: $('start'), note: $('note'), relight: $('relight'),
  gear: $('gear'), sheet: $('sheet'), sensitivity: $('sensitivity'), sensOut: $('sensOut'), meter: $('meter'),
};

const renderer = createRenderer(els.scene);
const toast = createToast(els.note);
const sheet = attachSheet(els.sheet, { hideAfterMs: 8000 });

let flame = { ...INITIAL_FLAME, lit: false, size: 0 };
let detector = null;
let mic = null;
let connecting = false;
let micDenied = false;    // the first attempt failed: no permission or no mic; stop asking
let timeBuf = null, freqBuf = null;
let intensity = 0;
let reading = null;       // last detector result, shown on the meter for tuning
let last = performance.now();
let started = false;
let unlitFor = 0;

const MIN_FRAME_MS = 15; // cap at ~60 fps; 120 Hz screens gain nothing here
let safeTopPx = 0;
function measureSafeTop() { safeTopPx = parseFloat(getComputedStyle(els.probe).paddingTop) || 0; }

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

// ---------- microphone lifecycle ----------
// Capture runs only while the page is visible; it is released when hidden
// (no hot mic in the background) and reconnected on return or on the next tap.
async function connectMic(reason) {
  if (mic || connecting || micDenied) return;
  connecting = true;
  try {
    const m = await startMic({
      onEnded() {
        if (mic !== m) return;
        disconnectMic();
        toast.show('Microphone stopped. Tap to reconnect.', 0);
      },
    });
    if (document.visibilityState === 'hidden') { m.stop(); connecting = false; return; } // went to background meanwhile
    mic = m;
    m.resume();
    detector = createBlowDetector({ sampleRate: m.sampleRate, fftSize: m.fftSize, sensitivity: settings.sensitivity });
    timeBuf = new Float32Array(m.fftSize);
    freqBuf = new Float32Array(m.fftSize / 2);
    toast.hide();
  } catch {
    if (reason === 'first') {
      micDenied = true;
      toast.show('Blowing needs the microphone. The candle still flickers.');
    } else {
      toast.show('Tap to reconnect the microphone.', 0);
    }
  }
  connecting = false;
}
function disconnectMic() {
  mic?.stop();
  mic = null;
  detector = null;
  intensity = 0;
  reading = null;
}

async function start() {
  if (started) return;
  started = true;
  els.start.hidden = true;
  keepAwake();
  requestFullscreen();
  flame = relight(flame);
  connectMic('first');
}

function frame(now) {
  if (now - last < MIN_FRAME_MS) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (document.visibilityState === 'visible') {
    if (detector) {
      mic.readTime(timeBuf); mic.readFreq(freqBuf);
      reading = detector.update(timeBuf, freqBuf, dt);
      intensity = reading.intensity;
    }
    flame = stepFlame(flame, intensity, dt);
    unlitFor = started && !flame.lit ? unlitFor + dt : 0;
    els.relight.hidden = unlitFor < 2;
    renderer.draw(flame, intensity, now / 1000, dt, { meter: settings.showMeter || sheet.visible, safeTop: safeTopPx, reading });
  }
  requestAnimationFrame(frame);
}

// ---------- wiring ----------
els.gear.addEventListener('click', () => sheet.toggle());
els.sensitivity.addEventListener('input', () => saveSettings({ sensitivity: Number(els.sensitivity.value) }));
els.meter.addEventListener('click', () => saveSettings({ showMeter: !settings.showMeter }));

els.start.addEventListener('pointerup', start, { once: true });
els.start.addEventListener('click', start); // keyboard activation; start() is idempotent
// Relight on pointerup directly: no double-tap window, so no 300 ms lag.
els.scene.addEventListener('pointerup', () => {
  if (!started) return;
  if (!mic) connectMic('reconnect'); else mic.resume();
  if (!flame.lit) { flame = relight(flame); unlitFor = 0; els.relight.hidden = true; }
});

document.addEventListener('visibilitychange', () => {
  if (!started) return;
  if (document.visibilityState === 'hidden') disconnectMic();
  else connectMic('reconnect');
});

window.addEventListener('resize', () => { renderer.resize(); measureSafeTop(); });
renderer.resize();
measureSafeTop();
syncControls();
requestAnimationFrame(frame);
