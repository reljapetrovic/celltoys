# celltoys

Small toys for a phone. Static site built with Vite, deployed to GitHub Pages.

## Toys

- **Reading Light** (`/reading-light/`): amber or red bedtime reading light that
  holds, then dims to a faint night-light. Install it from Safari with
  Share → Add to Home Screen for a chrome-free full screen.

## Develop

    npm install
    npm run dev        # HTTPS dev server on your LAN; open the printed URL on your phone
    npm test
    npm run build

## Deploy

Push to `main`. The workflow builds and publishes `dist/` to GitHub Pages.
In the repo settings, set Pages → Source to "GitHub Actions" once.
Vite `base` is `/celltoys/`; rename both if the repo is renamed.
