# 11 · club-sites gets vitest

**Status:** complete.
**Date:** 2026-11-25
**Related:** [`07-club-sites-typecheck-debt.md`](./07-club-sites-typecheck-debt.md) (same app, different tail)

Closes the last "shared workspace has zero tests" gap from the original audit. `@torny/club-sites` now runs under `pnpm test` with the rest of the monorepo.

## What's shipped

- `apps/club-sites/vitest.config.ts` — jsdom env, globs `server/**/__tests__/` and `utils/**/__tests__/`.
- `apps/club-sites/package.json` — `test` + `test:watch` scripts (via vitest), plus a `prepare` script (`nuxt prepare`) now that the turbo `test` task depends on `^build` + `prepare`.
- `apps/club-sites/server/utils/tornyApiHelpers.ts` — new. Pure helpers extracted from `tornyApi.ts`: `normaliseHost` + `unwrapFacets`.
- `apps/club-sites/server/utils/tornyApiTypes.ts` — new. Types referenced by the pure helpers (moved out of `tornyApi.ts` so the helpers can be imported by test code without pulling the Nuxt `#imports` graph).
- `apps/club-sites/server/utils/tornyApi.ts` — refactored. Re-exports both helpers + types for backward compatibility; the pure files are now source of truth.
- `apps/club-sites/server/utils/__tests__/tornyApi.test.ts` — 15 tests covering both helpers.

## Why extract to separate files

Vitest loads the whole module graph of anything it imports. `tornyApi.ts` top-imports `useRuntimeConfig from '#imports'` — Nuxt's virtual module alias. Bare vitest can't resolve that without pulling `@nuxt/test-utils` (bigger dep + slower runtime) or stubbing `#imports` (brittle).

Extracting the pure helpers to a side file gives us tests with zero Nuxt runtime cost. The Nuxt-bound functions (`resolveClubForHost`, `fetchSite`, `tornyFetch`, etc.) are deferred to a future PR that brings in `@nuxt/test-utils`.

## What's tested

**`normaliseHost`** — the cache key for tenant lookup. Covers: lowercasing, leading-`www.` strip, trailing-port strip, combined nasty-case, clean-host noop, no-strip-of-`www`-inside-hostname. A silent change here fragments the tenant cache so two different cache rows represent the same club.

**`unwrapFacets`** — the three backend envelope shapes the facets endpoint has used (bare array, `{facets}`, `{rows}`, `{items}`) plus the "don't silently drop rows when shape shifts" guard. Non-array under a known key returns `[]` rather than crashing.

## What's NOT tested (yet)

The Nitro-bound layer: `resolveClubForHost`, `fetchSite`, `fetchCustomFacets`, `tornyFetch`, `invalidateHost`. These all need either `@nuxt/test-utils` or a hand-rolled `useRuntimeConfig` + `$fetch` mock. Worth doing but not today.

Vue composables (`useClub`, `useMember`, `useSite`, `useTheme`, etc.) are deferred for the same reason — they use auto-imported Nuxt primitives.

## Known pre-existing issue: torny-web typecheck

While verifying the monorepo-wide feedback loop, I hit a `vue-tsc` template-type error in `apps/torny-web/pages/signup/index.vue` — `defaultPlanFor` isn't resolving from its auto-import in the template context. Confirmed pre-existing (bare main reproduces it) and completely unrelated to the club-sites work. Not blocking the club-sites commit — filed here so it doesn't vanish.

The CI workflow has been passing green on main, suggesting either:
1. CI typechecks don't exercise this file for some reason (unlikely)
2. The template-type error is non-fatal in the CI environment (possible)
3. The error only reproduces on a specific local setup

Either way: a known vue-tsc + Nuxt 3 auto-import limitation in template contexts. Short-term fix is an explicit `import` in `<script setup>`; a cleaner fix is `vue-tsc` picking up Nuxt's `.nuxt/components.d.ts` correctly.

## Follow-ups

- Add `@nuxt/test-utils` + tests for the Nitro-bound surface of `tornyApi.ts`.
- Investigate / fix the `torny-web` template type error (explicit script-setup import is the 10-second workaround).
- Consider moving `apps/club-sites/components/*` under test — many are stateless presentation components that'd pin shape regressions nicely.
