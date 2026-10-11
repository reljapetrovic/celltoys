# celltoys

Small toys for a phone. A static site built with Vite and deployed to GitHub
Pages at https://reljapetrovic.github.io/celltoys/. Plain JavaScript, no
framework; each toy is a folder with its own page, and `shared/` holds the
helpers they have in common.

## Toys

- **Reading Light** (`reading-light/`): full-screen amber or red bedtime light
  that stays bright while you read, then dims on a timer to a faint
  night-light. Tap for controls, swipe up or down for brightness, double-tap
  to pause.
- **Candle** (`candle/`): a candle flame driven by the microphone. Blow at the
  phone to make it sway; blow hard to put it out; tap to relight. The gear
  opens a sensitivity slider and a live blow meter.

Install either one from the browser: Safari Share → Add to Home Screen, or
Chrome / Brave menu → Install app. The installed app launches fullscreen,
keeps the screen awake and works offline.

## Develop

    npm install
    npm run dev        # HTTPS dev server on your LAN; open the printed URL on your phone
    npm test           # Vitest, pure modules only
    npm run build      # static output in dist/

The dev server uses HTTPS (self-signed) because the microphone, wake lock and
fullscreen APIs need a secure context. Accept the certificate once on the
phone. iOS will not install a home-screen app from a self-signed origin, so
test installs against the deployed site.

Icons are generated, not drawn: `python3 scripts/make-icons.py public/<toy> <style>`.

## Layout

    index.html              landing page listing the toys
    shared/                 base.css, sheet.css, gestures, settings-store, sheet, wake-lock, fullscreen
    reading-light/          index.html, style.css, main.js (DOM wiring), light.js (pure model)
    candle/                 index.html, style.css, main.js, blow.js, flame.js, settings.js (pure), mic.js, render.js
    public/<toy>/           manifest.webmanifest and icons, copied verbatim
    test/                   Vitest specs for the pure modules
    docs/superpowers/       design specs and implementation plans

Pure logic lives in modules with no DOM access and gets tests; DOM wiring is
kept thin and checked on a phone.

## Adding a toy

1. Create `<toy>/index.html` (copy the `<head>` of an existing toy: viewport,
   PWA meta tags, manifest and apple-touch-icon links, `shared/base.css`,
   `shared/sheet.css`), plus `style.css` and `main.js`.
2. Put the logic that can be pure in its own module and give it a spec in `test/`.
3. Add `public/<toy>/manifest.webmanifest` (copy one, change names and
   `start_url`/`scope` stay `./`) and generate icons with `scripts/make-icons.py`.
4. Add the page to `rollupOptions.input` in `vite.config.js`.
5. Add a tile to `index.html`.
6. Reuse `shared/`: `attachSheet`/`createToast` for controls, `attachGestures`
   for taps and swipes, `keepAwake`, `requestFullscreen`, `createStore`.

## Deploy

Push to `main`. The workflow runs the tests, builds, and publishes `dist/` to
GitHub Pages. The service worker precaches every page, so an installed app
launches offline; after a deploy, the first launch may still show the previous
version and the one after that is current (no mid-session reloads).

Vite `base` is `/celltoys/`; change it together with the repo name.
