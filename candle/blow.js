// Blow detector: intensity 0..1 from mic loudness above an adaptive noise
// floor, gated by the share of power below 800 Hz (blowing is low rumble;
// speech and claps are not). Pure: takes analyser buffers, keeps its own state.
//
// timeData: Float32Array samples from getFloatTimeDomainData.
// freqData: Float32Array of dB per bin from getFloatFrequencyData (-Infinity
// for silent bins). Converted to linear power before summing.

const LOW_HZ = 800, FLOOR_RISE = 0.002, DEAD = 0.01, FULL = 0.2;
const TAU_RISE = 0.05, TAU_FALL = 0.25;
const clamp01 = v => Math.min(1, Math.max(0, v));

export function createBlowDetector({ sampleRate, fftSize, sensitivity = 1 }) {
  const lowBins = Math.max(1, Math.floor(LOW_HZ / (sampleRate / fftSize)));
  let floor = 0, intensity = 0, sens = sensitivity;

  function update(timeData, freqData, dt) {
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
    const rms = timeData.length ? Math.sqrt(sum / timeData.length) : 0;

    floor = rms < floor ? rms : Math.min(rms, floor + FLOOR_RISE * dt);
    const loudness = clamp01((rms - floor - DEAD) / (FULL / sens));

    let low = 0, total = 0;
    for (let i = 0; i < freqData.length; i++) {
      const e = 10 ** (freqData[i] / 10); // dB -> linear power; -Infinity -> 0
      total += e;
      if (i < lowBins) low += e;
    }
    const lowFraction = total > 0 ? low / total : 0;
    const gate = clamp01((lowFraction - 0.35) / 0.3);

    const raw = loudness * gate;
    const tau = raw > intensity ? TAU_RISE : TAU_FALL;
    intensity += (raw - intensity) * (1 - Math.exp(-dt / tau));
    return { intensity, loudness, lowFraction, floor };
  }

  return { update, setSensitivity(s) { sens = s; } };
}
