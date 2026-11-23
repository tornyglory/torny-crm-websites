# 04 · Remove dead axios code (CVE surface reduction)

**Status:** complete
**Date:** 2026-11-11
**Priority:** Day-4 quick win — triggered by the Dependabot alerts post-activation.
**Related:** [`audit-2026-11-11.md`](./audit-2026-11-11.md) → Security §4, [`02-dependabot.md`](./02-dependabot.md)

## Context

After enabling Dependabot alerts we were staring at **130 vulnerabilities** (8 critical, 42 high, 62 moderate, 18 low). Triage showed:

- **All 8 criticals are dev-tooling only** (vitest UI ×3, tinypool ×2, shell-quote ×1, simple-git ×2) — none reach the production bundle.
- **~6 high-severity alerts attributed to `axios` and `follow-redirects`.** These were suspicious because axios is listed as a dep of `@torny/api-client`.

Investigating: `axios` is only used in `packages/api-client/src/client.ts` to build `createTornyClient`. That function is wrapped in `apps/crm/src/composables/useApi.ts` — **which is never imported or called anywhere.** The actual API layer everywhere else uses `authedFetch`/`publicFetch` from `packages/api-client/src/http.ts`.

Verified via `grep -l axios apps/crm/dist/assets/*.js` — the built production bundle contains no axios code. Vite was already tree-shaking it out. So the alerts are "technically present in `node_modules`" rather than "actually exploitable in deployed code."

Still worth deleting because:
- Reduces Dependabot noise (fewer alerts to triage)
- Removes an unused dep from the install graph (smaller `node_modules`, faster installs)
- Prevents a future contributor from importing `useApi` and accidentally shipping axios to production

## What got deleted

| File | Why |
|---|---|
| `apps/crm/src/composables/useApi.ts` | Never imported. The `useApi()` composable it exports has zero call sites. |
| `packages/api-client/src/client.ts` | Defined `createTornyClient`, `TornyClient`, `TornyClientOptions`. Only consumer was `useApi.ts`. |
| `packages/api-client/src/resources/devices.ts` | All 2 exports (`register`, `unregister`) took a `TornyClient` param. Zero call sites. |
| `packages/api-client/src/resources/teams.ts` | All 4 exports (`listForEvent`, `get`, `save`, `publish`) took a `TornyClient` param. Zero call sites. `tests/teamSelections.test.ts` imports from `@torny/api-client` but from other resources, not this one. |

## What got pruned

- `packages/api-client/src/resources/clubs.ts` — removed the 4 axios-based functions at the top (`listMine`, `get`, `update`, `resolveByHost`). Kept everything else — `updateBrandAssets`, `changeSubdomain`, `checkEmailHandle`, `changeEmailHandle` and related types are actively used by `WebsiteSettingsPanel.vue`, `SettingsView.vue`, etc.
- `packages/api-client/src/index.ts` — removed the three re-exports: `createTornyClient`, `teams`, `devices`.
- `packages/api-client/package.json` — removed `axios` from `dependencies`.
- `pnpm-lock.yaml` — deduped after reinstall.

## What stayed

Everything else. The audit was deliberately minimal — only touched what was proven dead.

## Alerts closed by this cleanup

Once `pnpm-lock.yaml` propagates, Dependabot should close the alerts tied to `axios` and `follow-redirects`. From the earlier screenshots those were roughly:
- Axios: Prototype Pollution Gadget in `toFormData`
- Axios: DoS via Unhandled 'error' Event in HTTP/2 ClientHttp2Session
- Axios: ReDoS in `shouldBypassProxy` host normalization
- Axios: ReDoS in `fromDataURI`
- follow-redirects: array-form headers bypass
- follow-redirects: sensitiveHeaders regex escaping
- follow-redirects: Cross-realm sensitiveHeaders arrays

~7 high-severity alerts expected to drop off the list within a day.

## What this doesn't solve

- The remaining ~35 high-severity alerts (devalue, sharp, node-forge, etc.) are still there. Mostly build-tooling or Nuxt-SSR-only. Best addressed by a planned Nuxt + Vite upgrade when there's bandwidth.
- The 8 critical alerts remain. All dev-tooling, no production exposure.
- Fixing the "stale-client-after-deploy" errors Sentry is already catching (follow-up from [`03-sentry.md`](./03-sentry.md)) is unrelated.

## Verification

- `pnpm --filter @torny/crm typecheck` — green
- `pnpm --filter @torny/api-client typecheck` — green
- `pnpm --filter @torny/crm test` — green (62/62)
- `pnpm lint` — green (all 6 packages)
- `pnpm --filter @torny/crm build` — green
