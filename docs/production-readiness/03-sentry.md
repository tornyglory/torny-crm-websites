# 03 · Sentry for error tracking

**Status:** code complete; needs Sentry project + env vars to go live
**Date:** 2026-11-11
**Priority:** Day-3 (observability was 2/10 on the audit — this is the biggest single lift)
**Related:** [`audit-2026-11-11.md`](./audit-2026-11-11.md) → Observability

## The risk

Audit found no Sentry, Bugsnag, Rollbar, Datadog — nothing. Every production error is silent. The only prior signal was 4 scattered `console.*` calls that nobody reads. You cannot answer "is prod broken right now?" or "which error is hitting users?"

## Approach

`@sentry/vue` for the CRM. One `initSentry(app, router)` call wired into `main.ts` before the app mounts. DSN comes from `VITE_SENTRY_DSN`; when unset the init is a no-op — safe for local dev and preview builds without secrets.

`@sentry/vite-plugin` uploads sourcemaps during `pnpm --filter @torny/crm build`, so stack traces in Sentry point to the real source. The plugin runs only when all three of `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are present — unset in any env = plugin skipped, no sourcemaps uploaded, no build-time warnings.

## What's captured (and what isn't)

Captured:
- Vue render errors (via `@sentry/vue`'s global error handler)
- Global `unhandledrejection` / uncaught exceptions
- Explicit `captureException(err, { tags: {...} })` calls from catch-and-continue sites
- Router navigation breadcrumbs (for the trail leading up to an error)
- Component props on render errors (`attachProps: true`)

Not captured (deliberate):
- Performance tracing (`tracesSampleRate: 0`) — adds bundle weight + storage cost
- Session replay — PII and cookie-consent implications. Revisit once consent gating lands
- PII scrubbing: `beforeSend` strips query strings from `request.url` to avoid single-use tokens leaking (invite accept, password reset flow carry tokens in URLs)

## Files touched

- `apps/crm/package.json` — `@sentry/vue` as dep, `@sentry/vite-plugin` as devDep
- `apps/crm/src/utils/sentry.ts` — `initSentry` + re-exports of `captureException`, `captureMessage`, `setUser`, `setTag`. Call sites import from `@/utils/sentry` so a future vendor swap touches only this file.
- `apps/crm/src/main.ts` — calls `initSentry(app, router)` before `app.use(router)`
- `apps/crm/env.d.ts` — declares `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_RELEASE`
- `apps/crm/.env.example` — documents the vars (commented out so they stay off by default locally)
- `apps/crm/vite.config.ts` — wires `@sentry/vite-plugin` conditionally on secrets presence; sets `build.sourcemap` the same way
- `.github/workflows/crm-azure-swa.yml` — passes the Sentry env vars during build
- `apps/crm/src/views/auth/ClaimClubView.vue` — replaces the stray `console.error` flagged by the audit with `captureException` + tags

## Setup checklist (you)

1. **Create the Sentry project.**
   - Go to <https://sentry.io/> → create / use your org
   - **Projects → Create Project → Platform: Vue**
   - Name: `torny-crm` (or similar)
   - Copy the DSN that lands on the final screen. Looks like `https://abc123@o456.ingest.sentry.io/789`.

2. **Create an auth token for sourcemap upload.**
   - <https://sentry.io/settings/account/api/auth-tokens/> (user token) or <https://sentry.io/settings/[your-org]/auth-tokens/> (org token — recommended for CI)
   - Scopes: `project:releases`, `project:read`, `org:read`
   - Copy the token. You'll only see it once.

3. **Add Azure SWA env var** (this ships the DSN into the bundle so the running app sends events):
   - Azure portal → your SWA → **Configuration → Application settings → Add**
   - `VITE_SENTRY_DSN` = the DSN from step 1
   - Save. The next deploy picks it up.

4. **Add GitHub Actions secrets** (these let CI upload sourcemaps + tag releases):
   - Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - `VITE_SENTRY_DSN` = same DSN as above (needed at build time too)
   - `SENTRY_AUTH_TOKEN` = the token from step 2
   - `SENTRY_ORG` = your Sentry org slug (the thing in URLs, e.g. `torny`)
   - `SENTRY_PROJECT` = your project slug (e.g. `torny-crm`)

5. **Trigger a build.** Either push an empty commit or `gh workflow run crm-azure-swa.yml`. Check the build log for `Sentry Vite plugin` output — it'll confirm sourcemap upload.

6. **Verify it's live.**
   - Open the deployed CRM
   - Open DevTools console
   - Run: `throw new Error('sentry smoke test')`
   - Within ~30 seconds the error should appear in Sentry → Issues
   - If the stack trace points to minified code (not source), the sourcemap upload didn't work — check CI log

## What this doesn't cover

- **Nuxt apps** (`club-sites`, `torny-web`). Separate Sentry projects + `@sentry/nuxt` module. Not done here — queue for Day-4 if you want public-site error tracking too.
- **Backend request correlation.** The api-client doesn't send an `X-Request-ID` yet. Audit flagged this. Follow-up: generate a request ID client-side, include in headers, log on the backend, attach as a Sentry tag. Makes debug "find this prod error in the backend logs" trivial.
- **Alerts.** Sentry defaults to emailing the issue owner on new issues. If you want Slack / PagerDuty / anything else, configure under **Alerts** in Sentry. Low priority for a small team.

## Follow-ups

- Replace the two `console.warn` calls in `WebsiteEditorView.vue` and `CompleteView.vue` with `captureMessage({ level: 'warning' })` once you confirm Sentry is working.
- Add `setUser({ id, email })` in the auth store on sign-in so Sentry events carry the user context.
- Decide on an environments model: `production` (Azure SWA main), `staging` (once staging exists — see Day-4), `development` (local, usually off).
- Set up release health tracking by shipping a `VITE_SENTRY_RELEASE` matching your GitHub Actions `${{ github.sha }}` — already wired in the workflow.

## Changelog

### 2026-11-11

- `@sentry/vue@^8` + `@sentry/vite-plugin@^2` installed.
- `apps/crm/src/utils/sentry.ts` created with a one-call init and typed re-exports.
- `main.ts`, `vite.config.ts`, `env.d.ts`, `.env.example`, CI workflow all wired for env-var-driven activation.
- `ClaimClubView.vue` `console.error` replaced with `captureException`.
- `pnpm --filter @torny/crm typecheck` — green
- `pnpm --filter @torny/crm test` — green (62/62)
- `pnpm --filter @torny/crm build` — green; Vite plugin correctly skipped without secrets (no sourcemaps emitted)
