# 07 · club-sites typecheck debt

**Status:** open. Needs a session.
**Date raised:** 2026-11-25
**Priority:** Blocker before we expand CI typecheck to the full monorepo.

## Context

During the api-client + content-blocks test-infra push (commit `fe9335b`) I tried to switch CI's typecheck step from `pnpm --filter @torny/crm typecheck` to `pnpm typecheck` (via turbo, all workspaces) — so that any regression in a shared package or a Nuxt app lands red on the PR, not silently on main.

That change immediately caught a pre-existing typecheck failure in `apps/club-sites/server/utils/tornyApi.ts:464`:

```
Type 'Promise<TypedInternalResponse<NitroFetchRequest, T, "get">>'
  is not assignable to type 'Promise<T>'.
  Type 'TypedInternalResponse<NitroFetchRequest, T, "get">' is not
    assignable to type 'T'.
    'T' could be instantiated with an arbitrary type which could be
    unrelated to 'TypedInternalResponse<NitroFetchRequest, T, "get">'.

Type 'Club' is not comparable to type 'Record<string, unknown>'.
  Index signature for type 'string' is missing in type 'Club'.
```

Two separate issues on the same file. Likely from a Nitro / Nuxt types bump upstream — vue-tsc + @nuxt/kit versions have moved enough since the file was written that the generic inference breaks.

Reverted the ci.yml change in a follow-up so main CI stays green. Test expansion stayed (all three packages now run tests in CI via `pnpm test`).

## Why fix this

- `club-sites` is a deployed app — `app.torny.pro` → public club websites. Typecheck errors there could mask real bugs.
- The only workspace in the repo whose typecheck isn't gated by CI. Every other app / package already runs under `pnpm typecheck` in a pre-commit or deploy context, so they stay clean. club-sites drifts because nothing checks it.

## What to fix

- `apps/club-sites/server/utils/tornyApi.ts:464` — two typecheck errors. Likely the `$fetch<T>()` generic needs an explicit cast or the return type needs to swap from `Promise<T>` to the Nitro `TypedInternalResponse` shape.
- Re-run `pnpm --filter @torny/club-sites typecheck` locally after the fix.
- Then flip ci.yml back to `pnpm typecheck` across the monorepo.

## Not in scope

- Bumping Nitro / Nuxt versions. That's part of the bigger "Nuxt + Vite major upgrade" track (`04`-era alerts). If the typecheck fix needs a version bump, note it; don't bundle the whole upgrade here.
