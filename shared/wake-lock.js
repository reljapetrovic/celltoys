// Keep the screen awake. Prefers the Screen Wake Lock API; falls back to a
// muted looping video fed from a canvas stream (older Safari).
//
// Resolves to { ok, via, release }. `via` is 'api', 'video' or null so the
// caller can retry the API later (e.g. after the first tap on Safari, which
// gates the API on user activation) when only the fallback succeeded.

export async function keepAwake() {
  let sentinel = null;
  let video = null;
  let interval = null;
  let released = false;
  let via = null;

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
      interval = setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#000' : '#010101'; ctx.fillRect(0, 0, 2, 2); }, 1000);
      return video.play().then(() => true).catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  async function acquire() {
    if (released) return false;
    if (await viaApi()) { via = 'api'; return true; }
    const ok = video ? await video.play().then(() => true).catch(() => false) : await viaVideo();
    via = ok ? 'video' : null;
    return ok;
  }

  const onVisible = () => { if (document.visibilityState === 'visible' && !sentinel) acquire(); };
  document.addEventListener('visibilitychange', onVisible);

  const ok = await acquire();
  return {
    ok,
    via,
    release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release?.();
      clearInterval(interval);
      if (video) { video.pause(); video.remove(); video = null; }
    },
  };
}
