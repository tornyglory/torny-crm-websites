/**
 * Recover from stale-client-after-deploy chunk preload failures.
 *
 * Problem: Vite emits a `vite:preloadError` event when a lazy-loaded
 * route or dynamic import can't be fetched. The common cause in prod
 * is a user holding an old tab after we've shipped a new build —
 * their cached `index-<old-hash>.js` tries to pull `TornyImageView-
 * <old-hash>.js`, which no longer exists on the CDN. Router navigation
 * then throws and Sentry logs it (see
 * docs/production-readiness/03-sentry.md "Observed on day one").
 *
 * Fix: a one-shot reload. Once the browser fetches a fresh
 * `index.html`, the new hashes resolve and the user is back on the
 * latest build. Guarded with a sessionStorage flag so we don't loop
 * if the CDN is actually broken (then the second fetch of
 * index.html would also fail and we'd reload again forever).
 *
 * Only runs in the browser — guarded for SSR-safety even though the
 * CRM is a pure SPA today.
 */
const RELOAD_FLAG = 'torny.preloadReloadAt'

export function installPreloadErrorRecovery(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('vite:preloadError', (event) => {
    // If we reloaded in the last minute, we're probably in a real
    // broken state — don't loop. Let the error surface to Sentry and
    // the user sees whatever Vue router renders on failure.
    const last = sessionStorage.getItem(RELOAD_FLAG)
    if (last && Date.now() - Number(last) < 60_000) return

    // Default-behaviour is to throw. We're handling it — stop the
    // propagation so Sentry doesn't log the (now benign) chunk miss.
    event.preventDefault()
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
    window.location.reload()
  })
}
