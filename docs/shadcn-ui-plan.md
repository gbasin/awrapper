# UI Modernization Plan — shadcn/ui + Tailwind

Status: proposal

## Goals

- Make the existing GUI clean, modern, and accessible while staying fast and low‑friction.
- Keep backend simple (Fastify, server‑rendered endpoints remain) and layer in a modern UI where it adds the most value.
- Prefer shadcn/ui aesthetics and component ergonomics; enable dark mode, consistent typography, and responsive layout.
- Minimize disruption; allow incremental rollout without blocking current flows.

## Current State (Summary)

- Server: Fastify with server‑rendered HTML in `src/server.ts`, layout/styles in `src/ui.ts`.
- UI: Plain HTML + inline CSS, minimal JS embedded per page (directory browser, session poller, etc.).
- No front‑end build pipeline or static asset serving (no React/Vite/Tailwind today).

Paths to prettify range from “low‑touch CSS polish” to a full React + Tailwind app using shadcn/ui. Because shadcn/ui is a set of React components styled via Tailwind + Radix UI, adopting it fully means adding a small front‑end app.

## Options Considered

1) Keep SSR HTML, add Tailwind via CDN, and restyle templates
- Pros: Very low effort; no new build step.
- Cons: shadcn/ui components are React; we’d only mimic look/feel, not reuse components. Tailwind Play CDN is OK for prototyping, not ideal long‑term. Interactive widgets (dialogs, menus) would be bespoke.

2) Hybrid: Keep existing pages, add a small React “island” for rich views
- Pros: Incremental; keep `/` SSR for quick boot, render `/sessions/:id` as React for a polished chat/log experience.
- Cons: Two rendering models in one app; some duplication in styles.

3) SPA for app shell (React + Vite + Tailwind + shadcn/ui), use existing REST endpoints
- Pros: First‑class shadcn/ui, cohesive design system, strong component ergonomics, easier complex UX (dialogs, tabs, toasts, forms).
- Cons: Introduces front‑end build and static assets; small server changes to serve `/web/dist`.

Recommendation: Option 2 → 3. Start hybrid for minimal disruption, then consolidate into an app shell once stable.

## Recommended Architecture

- Create `web/` (Vite + React + TypeScript + Tailwind + shadcn/ui) alongside the existing Node server.
- Serve built static assets from Fastify at `/app` (or `/` once stable) via `@fastify/static`.
- Use existing REST endpoints (`/sessions`, `/sessions/:id`, `/sessions/:id/messages`, `/browse`, etc.). Optionally add a JSON session list endpoint if/as needed.
- Preserve SSR `/` page initially; link into the React app at `/app` for the “pretty” experience. Later, flip `/` → app.

### Directory Layout

```
awrapper/
  src/                 # existing server
  web/                 # new front-end app (Vite)
    index.html
    src/
      main.tsx
      App.tsx
      routes/
        Home.tsx        # sessions list + create
        Session.tsx     # chat/logs view
      components/       # shadcn components + wrappers
      lib/
        api.ts          # fetch helpers for existing endpoints
        utils.ts        # cn() util, helpers
      styles/
        globals.css     # tailwind base, shadcn tokens
    tailwind.config.ts
    postcss.config.js
    tsconfig.json
    package.json
```

### Front-end Stack

- React + Vite
- Tailwind CSS + `tailwindcss-animate`
- shadcn/ui via CLI (components copied into repo for full control)
- `lucide-react` for icons
- Optional: `@tanstack/react-query` for data fetching, `sonner` for toasts

### Server Integration

- Add `@fastify/static` and serve `web/dist` under `/app`.
- Keep API routes as-is; if needed, add lightweight JSON endpoints mirroring HTML pages.
- During development, run Vite dev server on another port and proxy or open separately.

## UI Design & Component Mapping

Global
- Theme: shadcn/ui default neutral; dark mode first with `dark` class strategy.
- Typography: Inter (UI) + JetBrains Mono (logs). System fonts acceptable fallback.
- Layout: App shell with header bar and content container; responsive up to mobile.

Home (Sessions List + Create)
- Components: `Card`, `Table`, `Badge`, `Button`, `Input`, `Select`, `Textarea`, `Dialog`, `Breadcrumb`.
- Interactions: New session form inline; advanced repo picker in a `Dialog` (replace current server browser with richer UX using breadcrumb + list). Recent repos as `Combobox` or `Datalist`-style `Popover`.

Session Detail (Chat + Logs)
- Components: `Tabs` (Messages, Logs), `ScrollArea`, `Textarea` + `Button` for input, `Separator`, `Badge` for status, `Skeleton` while loading.
- Chat bubbles: Use `Card`/custom container; preserve monospace where needed for code. Add copy buttons for messages.
- Logs: Dark `ScrollArea` with fixed‑height panel; tailing indicator; use monospace + subtle color.
- Actions: “Cancel/Stop” session → `Button` (destructive) with `AlertDialog` confirmation.

Repo Browser (Dialog)
- Components: `Dialog`, `Breadcrumb`, `Input` (path), `Toggle` or `Switch` for “Only Git repos”.
- List directories with secondary metadata (• git); show “Use here” and “Select” actions.

Feedback
- Use `sonner` toasts for transient success/error; inline `Form` validation states for inputs.

Accessibility
- Keep shadcn defaults (Radix primitives are a11y‑friendly). Ensure semantic markup for tables, buttons, labels.

## Data Flow

- Read: fetch JSON from existing endpoints; cache with React Query (optional) and background refresh.
- Write: POST to existing endpoints; optimistic UI for message send; error states surfaced via toast + inline.
- Polling: replace ad‑hoc polling with React Query `refetchInterval` for messages/logs; adjust to avoid server overload.

## Theming & Tokens

- Use shadcn/ui CSS variables in `:root` to define color system.
- Enable `darkMode: ['class']` in Tailwind; wrap `ThemeProvider` to toggle if desired.
- Keep code/log monospace at consistent sizes; avoid full‑page zoom on mobile.

## Implementation Plan (Incremental)

Phase 0 — Quick Polish (1–2h)
- Keep SSR; add minimal CSS tuning in `src/ui.ts` (spacing, color, buttons) to reduce rough edges while the real UI lands.

Phase 1 — Bootstrap `web/` (0.5–1 day)
- Scaffold Vite React app under `web/`.
- Install Tailwind, `tailwindcss-animate`, shadcn CLI; run `shadcn init` and add base components: `button`, `input`, `select`, `textarea`, `card`, `table`, `tabs`, `dialog`, `separator`, `badge`, `scroll-area`, `alert-dialog`, `popover`.
- Add `lucide-react`, optional `@tanstack/react-query`, `sonner`.
- Implement `/app` routes: Home (sessions) + Session (messages/logs).
- Wire to existing endpoints with a small `api.ts` wrapper.

Phase 2 — Serve Static Assets (0.5 day)
- Add `@fastify/static` in server to serve `web/dist` at `/app`.
- Add Turbo task to build `web` during root `build`; ensure `pnpm ci` builds both.

Phase 3 — Replace SSR Pages (optional, 0.5–1 day)
- Redirect `/` to `/app` and/or embed React app as default shell.
- Remove redundant SSR forms as the React app reaches feature parity.

## Setup Details

Front-end bootstrap (inside `web/`)

```bash
# from repo root
pnpm --filter awrapper exec echo "using root only for now"

# create web/
mkdir -p web && cd web
pnpm init -y
pnpm add react react-dom
pnpm add -D vite typescript @types/react @types/react-dom tailwindcss postcss autoprefixer tailwindcss-animate
pnpm dlx tailwindcss init -p

# shadcn/ui
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input select textarea card table tabs dialog separator badge scroll-area alert-dialog popover

pnpm add lucide-react
# optional
pnpm add @tanstack/react-query sonner
```

Tailwind config (key points)

```ts
// web/tailwind.config.ts
import type { Config } from 'tailwindcss'
export default {
  darkMode: ['class'],
  content: ['index.html', 'src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { /* shadcn tokens configured by CLI */ },
      keyframes: { /* tailwindcss-animate */ },
      animation: { /* tailwindcss-animate */ },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
```

Server static hosting (snippet)

```ts
// src/server.ts
import fastifyStatic from '@fastify/static'
import path from 'node:path'

await app.register(fastifyStatic, {
  root: path.resolve(__dirname, '../web/dist'),
  prefix: '/app/',
  index: ['index.html'],
})

app.get('/app/*', (_req, reply) => {
  // SPA fallback
  // @ts-ignore - reply.sendFile from fastify-static
  return (reply as any).sendFile('index.html')
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

- Basic theming + typography set; dark mode works.
- Home: sessions list styled; create form clean; repo picker dialog functional.
- Session: tabs for Messages/Logs; message send flow; cancel session confirmation.
- Error/empty states covered; toasts wired; keyboard shortcuts for send.
- Mobile check for forms, tables, and logs.

## Risks & Mitigations

- Added complexity (front-end build): keep `web/` small; rely on shadcn/ui and React Query to avoid bespoke infra.
- Duplicate rendering (SSR + React): limit SSR to `/` during transition; point users to `/app` early.
- Styling drift: keep all custom UI inside `web/`; avoid mixing Tailwind into server templates beyond Phase 0 polish.

## Alternative (No React)

If React is undesirable, we can:
- Use Tailwind via CDN and restyle current templates; adopt lightweight JS (HTMX/Alpine) for dialogs/menus.
- Copy shadcn visual patterns (spacing, radii, colors) via CSS variables without components.
Tradeoffs: more bespoke JS for interactivity; less reuse of shadcn components.

## Next Steps

1) Confirm Option 2→3 approach and `/app` mount path.
2) Approve adding `web/` with Vite + shadcn/ui scaffold.
3) Implement Home and Session screens; wire APIs; ship behind `/app`.
4) Iterate on polish; decide on making `/` → `/app` default.

