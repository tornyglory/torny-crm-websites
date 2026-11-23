# 05 · Recover from stale-client chunk preload failures

**Status:** complete
**Date:** 2026-11-11
**Priority:** Day-5 quick win — surfaced by Sentry within minutes of going live.
**Related:** [`03-sentry.md`](./03-sentry.md) "Observed on day one"

## The problem

Within minutes of Sentry capturing its first real events, we saw the classic Vite SPA deploy-staleness pattern:

```
TypeError: Failed to fetch dynamically imported module:
  https://app.torny.pro/assets/TornyImageView-<old-hash>.js
Error: Unable to preload CSS for /assets/TornyImageView-<old-hash>.css
```

How it happens:
1. User opens the CRM, loads `index-<hashA>.js`
2. We ship a new build; new index now points at `index-<hashB>.js`
3. User has their tab open. They click a navigation link.
4. Their old `index-<hashA>.js` references the lazy chunk `TornyImageView-<hashA>.js`
5. That file no longer exists on the CDN (only `-<hashB>.js` does)
6. Browser 404s → Vue router throws → Sentry logs it
7. User sees a broken navigation

Mild severity (hitting refresh fixes it), but a bad first impression and wholly avoidable.

## The fix

Listen for Vite's `vite:preloadError` event and reload once. The reload fetches a fresh `index.html` which points at the new hashes — user lands on the latest build transparently.

Guarded with a sessionStorage flag so we don't infinite-loop if the CDN is actually broken (then the reload would also hit the same error and we'd reload again forever). One shot per minute per session.

`event.preventDefault()` on the way through so Sentry doesn't log the (now-benign) chunk miss — cleans up our issue list.

## Files touched

- `apps/crm/src/utils/preloadErrorRecovery.ts` — new. Single `installPreloadErrorRecovery()` function.
- `apps/crm/src/main.ts` — one call, early in bootstrap so the listener is attached before any lazy route resolves.

## Not in scope

- The Nuxt apps (`club-sites`, `torny-web`) have the same risk when you redeploy them and users hold tabs open. Nuxt has its own built-in handling via `vue-router`'s `onError` + reload patterns — worth checking they're wired. Deferred.
- A fancier UX (toast "a new version is available, click to refresh" instead of silent reload) is a product call, not an ops fix. Silent reload is appropriate for now.

## Verification

- `pnpm --filter @torny/crm typecheck` — green
- `pnpm --filter @torny/crm test` — green (62/62)
- `pnpm --filter @torny/crm lint` — green
- `pnpm --filter @torny/crm build` — green
- Smoke test to confirm the fix landed can only be done by deploying + waiting for the next natural occurrence (user with stale tab clicks after a deploy). Sentry will show the reduction over the next week.

## Expected effect

Those two Sentry issues (`Failed to fetch dynamically imported module`, `Unable to preload CSS`) should stop accumulating new events after the next deploy that ships this code. If they keep firing, something else is wrong and we'll re-open.
