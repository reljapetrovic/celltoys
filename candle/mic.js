// Microphone capture for the blow detector. Disables echo cancellation,
// noise suppression and AGC so blowing is not filtered out.
//
// The AudioContext is created synchronously, inside the user gesture, before
// the permission prompt consumes it (iOS Safari). resume() is never awaited:
// if the context is still suspended later, call resume() from a pointerup.
// `onEnded` fires if the OS ends the track (phone call, Siri, another app).

export async function startMic({ onEnded } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  ctx.resume().catch(() => {});

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    ctx.close().catch(() => {});
    throw err;
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);

  let stopped = false;
  const track = stream.getAudioTracks()[0];
  track?.addEventListener('ended', () => { if (!stopped) onEnded?.(); });

  const resume = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
  const onVisible = () => { if (document.visibilityState === 'visible') resume(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    sampleRate: ctx.sampleRate,
    fftSize: analyser.fftSize,
    readTime: buf => analyser.getFloatTimeDomainData(buf),
    readFreq: buf => analyser.getFloatFrequencyData(buf),
    resume,
    stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      stream.getTracks().forEach(t => t.stop());
      ctx.close().catch(() => {});
    },
  };
}
