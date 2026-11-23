/**
 * Sentry initialisation for the CRM. Opt-in via `VITE_SENTRY_DSN` — the
 * DSN is a public identifier, safe to ship in the client bundle. When
 * unset (local dev, preview builds without secrets) this is a no-op so
 * local errors stay in the browser console.
 *
 * What we do capture:
 *   - Uncaught errors (Vue render, global unhandledrejection)
 *   - Explicit `Sentry.captureException(err)` calls from places that
 *     catch-and-continue (see ClaimClubView for the pattern).
 *   - Router-change breadcrumbs so the trail leading up to an error is
 *     visible on the event page.
 *
 * What we do NOT capture (deliberate):
 *   - Performance tracing (`tracesSampleRate: 0`) — adds bundle weight
 *     + storage cost; worth enabling once we have a question to answer.
 *   - Session replay — PII and cookie-banner implications. Revisit when
 *     consent gating lands (audit → Compliance).
 *
 * See docs/production-readiness/03-sentry.md for the full rationale and
 * the setup checklist (Sentry project + Azure SWA env vars + GitHub
 * Actions secrets).
 */
import * as Sentry from '@sentry/vue'
import type { App } from 'vue'
import type { Router } from 'vue-router'

export function initSentry(app: App, router: Router): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    // No DSN configured — stay silent. Dev, preview, and self-hosted
    // builds without a Sentry account all land here.
    return
  }

  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.browserTracingIntegration({ router }),
    ],
    // No perf sampling until there's a specific question worth answering.
    tracesSampleRate: 0,
    // No session replay (PII + consent concerns).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Vue-level: attach component props to events for render errors.
    attachProps: true,
    beforeSend(event) {
      // Strip query strings from URLs — they can carry single-use
      // tokens (invite accept, password reset) that shouldn't land in
      // Sentry. Keep path + fragment.
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url)
          event.request.url = `${u.origin}${u.pathname}${u.hash}`
        } catch {
          // Malformed URL — leave as-is; Sentry will truncate if needed.
        }
      }
      return event
    },
  })
}

// Re-export so call sites import from one place rather than scattering
// `@sentry/vue` imports across the CRM. If we ever swap vendors this is
// the only file that needs to change.
export { captureException, captureMessage, setUser, setTag } from '@sentry/vue'
