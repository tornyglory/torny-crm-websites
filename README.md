# Torny

Monorepo for the Torny platform.

## Structure

```
torny/
├── apps/
│   ├── crm/          # Club owner CRM (Vue 3 + Vite SPA)
│   └── club-sites/   # Public club websites (Nuxt 3 → Cloudflare Pages)
└── packages/
    ├── design-tokens/    # Shared CSS custom properties + TS tokens
    ├── content-blocks/   # Vue block components used by CRM editor + public sites
    └── api-client/       # Typed axios wrappers for the Torny API
```

The Capacitor player apps (iOS + Android from Vue) live in the separate `torny-apps` repo; the native-native Swift/Kotlin apps live in `torny_swift` / `torny_kotlin`.

## Prerequisites

- Node.js `>=20.11`
- pnpm `9.15.0` (install with `npm i -g pnpm@9.15.0`)

## Getting started

```bash
pnpm install         # install everything
pnpm dev             # run every app in parallel
pnpm dev:crm         # just the CRM
pnpm dev:sites       # just the public club sites
pnpm build           # build every app + package
pnpm typecheck       # type-check everything
```

## Deployment

- **CRM** (`apps/crm`) — static SPA build, host anywhere (CF Pages recommended).
- **Club sites** (`apps/club-sites`) — Nuxt 3 on Cloudflare Pages with custom hostnames via Cloudflare for SaaS. See `apps/club-sites/README.md` for tenant + revalidation flow.
