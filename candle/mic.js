// Microphone capture for the blow detector. Disables echo cancellation,
// noise suppression and AGC so blowing is not filtered out.

export async function startMic() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);

  const onVisible = () => { if (document.visibilityState === 'visible' && ctx.state !== 'running') ctx.resume(); };
  document.addEventListener('visibilitychange', onVisible);

  return {
    sampleRate: ctx.sampleRate,
    fftSize: analyser.fftSize,
    readTime: buf => analyser.getFloatTimeDomainData(buf),
    readFreq: buf => analyser.getByteFrequencyData(buf),
    stop() {
      document.removeEventListener('visibilitychange', onVisible);
      stream.getTracks().forEach(t => t.stop());
      ctx.close();
    },
  };
}
