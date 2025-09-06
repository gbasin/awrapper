# UI Modernization Plan — shadcn/ui + Tailwind (Full PWA)

Status: finalized (full SPA/PWA now; dark mode deferred)

## Goals

- Deliver a clean, modern, accessible UI using shadcn/ui and Tailwind.
- Move directly to a single‑page app (SPA) with PWA capabilities; retire server‑rendered pages.
- Keep backend simple; reuse current REST endpoints without large API changes.
- Optimize for developer velocity; minimize bespoke UI logic.

## Current State (Summary)

- Server: Fastify with server‑rendered HTML in `src/server.ts`, layout/styles in `src/ui.ts`.
- UI: Plain HTML + inline CSS, minimal embedded JS (directory browser, polling).
- No front‑end build pipeline today.

This plan replaces the server‑rendered UI with a Vite React app using shadcn/ui and serves it from the same Fastify server. PWA features (installability, offline shell) are included.

## Decision

- Serve SPA at `/` immediately; retire SSR pages once SPA reaches parity (ASAP).
- Keep current REST endpoints as‑is and exclude them from SPA fallback; can move under `/api/*` later if desired.
- Repo browser: keep `/browse` as is (KISS), no search/favorites initially.
- Visuals: use shadcn/ui defaults (colors, spacing, radii, typography).
- PWA offline scope: app shell only (no offline logs/messages yet).

## Architecture

- New `web/` app: Vite + React + TypeScript + Tailwind + shadcn/ui + `vite-plugin-pwa`.
- Serve `web/dist` from Fastify at `/` via `@fastify/static`. All unknown routes fall back to `index.html`.
- Keep existing REST endpoints as‑is (`/sessions`, `/sessions/:id`, `/sessions/:id/messages`, `/browse`, etc.).
- During dev, run Vite dev server; for prod, embed built assets.

### Directory Layout

```
awrapper/
  src/                 # existing server (Fastify + REST)
  web/                 # new front-end app (Vite SPA + PWA)
    index.html
    src/
      main.tsx
      App.tsx
      routes/
        Home.tsx        # sessions list + create
        Session.tsx     # chat/logs view
        BrowseDialog.tsx
      components/       # shadcn components + wrappers
      lib/
        api.ts          # fetch helpers for existing endpoints
        query.ts        # react-query client
        utils.ts        # cn() util, helpers
      styles/
        globals.css     # tailwind base
    public/
      manifest.webmanifest
      icons/            # PWA icons
    tailwind.config.ts
    postcss.config.js
    tsconfig.json
    vite.config.ts
    package.json
```

### Front-end Stack

- React + React Router
- Tailwind CSS + `tailwindcss-animate`
- shadcn/ui (components copied for control)
- `lucide-react` for icons
- `@tanstack/react-query` for data fetching + caching
- `vite-plugin-pwa` for manifest + service worker
- `sonner` for toasts (lightweight)

### Server Integration

- Add `@fastify/static` to serve `web/dist` at root.
- SPA fallback: route all non‑API GETs to `index.html`.
- Keep current endpoints and exclude them from SPA fallback.

Server snippet

```ts
// src/server.ts
import fastifyStatic from '@fastify/static'
import path from 'node:path'

await app.register(fastifyStatic, {
  root: path.resolve(__dirname, '../web/dist'),
  prefix: '/',
  index: ['index.html'],
})

// SPA fallback for client routes (exclude known API prefixes)
app.get('/*', (req, reply) => {
  const url = String((req as any).raw.url || '')
  if (
    url.startsWith('/sessions') ||
    url.startsWith('/browse') ||
    url.startsWith('/client-log')
  ) {
    return reply.callNotFound()
  }
  // @ts-ignore sendFile from fastify-static
  return (reply as any).sendFile('index.html')
})
```

## UI Design & Component Mapping

Global
- Theme: light only for v1 (no dark mode yet).
- Typography: Inter (UI) + JetBrains Mono (logs) or system fallbacks.
- Layout: App shell header with content container; responsive to mobile.

Home (Sessions List + Create)
- Components: `Card`, `Table`, `Badge`, `Button`, `Input`, `Select`, `Textarea`, `Dialog`, `Breadcrumb`.
- Interactions: Create session inline; repo picker in `Dialog` with breadcrumb + list; recent repos via `Popover`.

Session Detail (Chat + Logs)
- Components: `Tabs` (Messages, Logs), `ScrollArea`, `Textarea` + `Button` for input, `Separator`, `Badge` for status, `Skeleton` while loading.
- Chat bubbles with code formatting and copy button.
- Logs panel: fixed height, monospace, auto‑tail with network‑aware polling.
- Actions: Cancel session with `AlertDialog` confirmation.

Repo Browser (Dialog)
- Components: `Dialog`, `Breadcrumb`, `Input` (path), `Switch` for “Only Git repos”.
- Shows directories with metadata (• git), actions: Select / Use here.

Feedback
- `sonner` toasts for transient messages; inline form validation.

Accessibility
- Rely on Radix primitives via shadcn/ui; label all inputs and buttons.

## Data & Polling

- Read: fetch JSON from existing endpoints; cache with React Query.
- Write: POST to existing endpoints; optimistic updates for user messages.
- Polling: `refetchInterval` for messages/logs with adaptive backoff when idle.

## PWA

- `vite-plugin-pwa` to generate `manifest.webmanifest` and service worker.
- Caching strategy:
  - App shell: pre‑cache (workbox `navigateFallback` to `index.html`).
  - API calls: network‑first with short cache (or no cache) for freshness.
  - Static assets: cache‑first with revision hashing.
- Metadata: name `awrapper`, theme color (light), icons (512/192/96 variants).

## Theming & Tokens

- Use shadcn/ui default tokens. Defer dark mode variables.
- Consistent monospace sizes for logs/code.

## Implementation Plan

Phase 1 — Bootstrap SPA/PWA (0.5–1 day)
- Scaffold Vite React app under `web/`.
- Install Tailwind, `tailwindcss-animate`, shadcn CLI; run `shadcn init` and add base components: `button`, `input`, `select`, `textarea`, `card`, `table`, `tabs`, `dialog`, `separator`, `badge`, `scroll-area`, `alert-dialog`, `popover`.
- Add router, query client, toasts, icons, and PWA plugin.
- Build Home + Session routes; wire to `/sessions*`, `/browse`, `/sessions/:id/messages`.

Phase 2 — Serve Static From Server (0.5 day)
- Add `@fastify/static` and SPA fallback at `/`.
- Remove/disable SSR pages in `src/server.ts` once SPA is reachable.

Phase 3 — Polish & QA (0.5 day)
- Validate create flow, repo browser dialog, message send, cancel session, logs tailing.
- Handle error/empty states; keyboard shortcut to send (Cmd/Ctrl+Enter).
- Mobile checks for forms, tables, logs.

## Setup Details

Bootstrapping commands (inside `web/`)

```bash
mkdir -p web && cd web
pnpm init -y
pnpm add react react-dom react-router-dom @tanstack/react-query lucide-react sonner
pnpm add -D vite typescript @types/react @types/react-dom tailwindcss postcss autoprefixer tailwindcss-animate vite-plugin-pwa
pnpm dlx tailwindcss init -p

# shadcn/ui
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input select textarea card table tabs dialog separator badge scroll-area alert-dialog popover
```

Tailwind config (key points)

```ts
// web/tailwind.config.ts
import type { Config } from 'tailwindcss'
export default {
  darkMode: false, // defer dark mode
  content: ['index.html', 'src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
```

PWA config (key points)

```ts
// web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'awrapper',
        short_name: 'awrapper',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ],
      },
    }),
  ],
})
```

Build orchestration

- Add a `web/build` script and call it from root `build` via Turbo. Example Turbo task addition:

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**", "web/dist/**"]
    }
  }
}
```

## Rollout Checklist

- SPA served from `/` with fallback routing.
- Home: sessions list styled; create form; repo picker dialog.
- Session: tabs for Messages/Logs; message send; cancel session; logs tailing.
- Error/empty states; toasts; keyboard shortcuts.
- PWA manifest valid; install prompt works; basic offline shell.

## Risks & Mitigations

- Added build complexity: keep `web/` small; rely on shadcn/ui and React Query.
- Offline expectations: limit to app shell; don’t cache dynamic logs aggressively.
- API 404s during SPA fallback: ensure server excludes API paths from `index.html` fallback.

## Next Steps

1) Approve full SPA/PWA approach served at `/` (no dark mode initially).
2) Approve adding `web/` scaffold with Vite + shadcn/ui + PWA plugin.
3) Implement Home and Session screens; wire to existing endpoints.
4) Remove SSR pages once SPA is usable.
