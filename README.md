# VYOM Telemetry Dashboard

A browser-based telemetry dashboard with camera access, local demo telemetry, charts, and tracking controls.

## Run locally

**Requirements:** Node.js 22 and npm.

```bash
npm ci
npm run dev
```

The local Express development server is available at `http://localhost:3000`. Camera access requires a secure context; use `localhost` locally or HTTPS when deployed.

## Build and validate

```bash
npm run lint
npm run build
```

The build writes the static application to `dist/` and bundles the optional local Express server as `dist/server.cjs`.

## Deploy to Vercel

Import the repository in Vercel. The included `vercel.json` installs with `npm ci`, runs `npm run build`, serves `dist/`, and routes client-side paths to the SPA entry point. No environment variables are required for the dashboard's browser-based demo.

Vercel hosts the static dashboard; it does not run the long-lived Express/Socket.IO process from `server.ts`. The dashboard's demo telemetry and camera processing run in the browser. The optional `/api/analyze-frame` and `/api/health` routes in the local Express server are not available from this static deployment.

## GitHub

The GitHub Actions workflow installs from the lockfile, type-checks, and builds on every push and pull request. Do not commit `.env.local` or other secret-bearing environment files; they are excluded by `.gitignore`.
