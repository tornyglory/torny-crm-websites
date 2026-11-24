# 07 · club-sites typecheck + torny-web test setup

**Status:** resolved.
**Date raised:** 2026-11-25
**Date resolved:** 2026-11-25

## Context

When the api-client + content-blocks test-infra push (commit `fe9335b`) expanded CI to run `pnpm typecheck` and `pnpm test` across every workspace (not just CRM), two pre-existing failures in the Nuxt apps surfaced for the first time. Both had been masked by CRM-only CI.

## Issue 1: club-sites typecheck

Two errors in `apps/club-sites`:

```
layouts/default.vue(85,9): error TS2352:
  Conversion of type 'Club | null' to type 'Record<string, unknown> | undefined'
  may be a mistake because neither type sufficiently overlaps with the other.

server/utils/tornyApi.ts(464,3): error TS2322:
  Type 'Promise<TypedInternalResponse<NitroFetchRequest, T, "get">>'
  is not assignable to type 'Promise<T>'.
```

### Fixes

- `layouts/default.vue:85` — the cast was reading a `plan` field that was added to the Club payload in brief 93 but never pushed onto the shared `Club` interface. Narrow via `as unknown as Record<string, unknown>` at the read site. Replace with a typed field once brief 93's shape is stable upstream.
- `server/utils/tornyApi.ts:464` — Nitro's `$fetch<T>` overloads treat known internal paths as `TypedInternalResponse<..., T, 'get'>`, which isn't what this helper proxies (external Torny API). Collapse the overload with an explicit `as Promise<T>` cast.

Commit: this one (see doc history).

## Issue 2: torny-web test setup

`apps/torny-web/tsconfig.json` extends `./.nuxt/tsconfig.json`, which only exists after `nuxt prepare` (or a dev/build). Cold CI didn't have it.

### Fix (option 1 from the original debt scoping)

- Added `"prepare": "nuxt prepare"` to `apps/torny-web/package.json`.
- Added `test` task deps in `turbo.json` — `dependsOn: ["^build", "prepare"]` — so turbo runs `prepare` in the same workspace before `test`.
- Declared a `prepare` task in `turbo.json` with `cache: false` (it's a code-gen step, doesn't cache).

## Related: CI step flipped back to monorepo-wide

With both issues fixed, `ci.yml` now runs:

- `pnpm typecheck` (all 6 workspaces)
- `pnpm test` (4 workspaces with test scripts)

instead of the CRM-only forms. Future regressions in any workspace will show red on PR before landing on main.

## Not done (follow-up)

- Add `plan` to the shared `Club` interface so `layouts/default.vue:85` can drop the unknown cast. Needs backend brief 93 to finalise the response shape first; small ticket for later.
- club-sites currently has no test suite (per the production-readiness audit). Setting up vitest there is the next shared-package-quality push once we have bandwidth.
