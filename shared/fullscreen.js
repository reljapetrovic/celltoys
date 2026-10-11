// An installed PWA already fills the screen (standalone or fullscreen display
// mode), so asking for element fullscreen there is pointless.
export function isStandalone() {
  const mq = window.matchMedia;
  return mq?.('(display-mode: standalone)').matches
    || mq?.('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
}

// iPhone Safari has no element fullscreen; Android and desktop do.
export function requestFullscreen(el = document.documentElement) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn || isStandalone() || document.fullscreenElement) return Promise.resolve(false);
  try {
    return Promise.resolve(fn.call(el)).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
