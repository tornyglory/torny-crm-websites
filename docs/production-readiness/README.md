# Production Readiness

This folder captures the production-readiness audit and the remediation work that falls out of it. Separate from `docs/backend-briefs/` because most of this is pure FE / ops / process, not backend contract.

## Index

- [`audit-2026-11-11.md`](./audit-2026-11-11.md) — Full area-by-area audit with scores and evidence.
- [`01-xss-sanitize-html.md`](./01-xss-sanitize-html.md) — Day 1 fix. DOMPurify on every `v-html` in the CRM. **Complete.**
- [`01b-xss-sanitize-content-blocks.md`](./01b-xss-sanitize-content-blocks.md) — Follow-up. Same treatment for `content-blocks` package (public club sites, wider blast radius). **Complete.** Isomorphic sanitiser (jsdom on server, native DOM in browser) wraps `RichTextBlock` + `CustomAiBlock`.
- [`02-dependabot.md`](./02-dependabot.md) — Day 2 fix. Dependabot config for weekly dep bumps + GitHub Actions pins. **Complete.**
- [`03-sentry.md`](./03-sentry.md) — Day 3 fix. `@sentry/vue` + sourcemap upload wired into CRM build. **Live. Smoke test passed 2026-11-11. First real production error already captured (stale-client-after-deploy on dynamic imports — flagged as follow-up).**
- [`04-dead-axios-code.md`](./04-dead-axios-code.md) — Day 4 quick win. Deleted unused axios wrapper + dead resource files, closing ~7 high-severity Dependabot alerts. **Complete.**
- [`05-preload-error-recovery.md`](./05-preload-error-recovery.md) — Day 5 quick win. One-shot reload on `vite:preloadError` so stale tabs recover from deploys instead of throwing. **Complete.**
- [`06-build-quality-next-steps.md`](./06-build-quality-next-steps.md) — Scoping doc for the "editor experience → 9" push. Three candidate pushes (inline uploads, consistency + a11y sweep, live preview) ranked by leverage. **Scoping only — not started.**
- [`06-csp-headers.md`](./06-csp-headers.md) — CRM Content-Security-Policy, started in Report-Only then flipped to enforcing. **Complete.**
- [`07-club-sites-typecheck-debt.md`](./07-club-sites-typecheck-debt.md) — Nuxt-app typecheck + test setup gaps that CRM-only CI had been masking. Fixed `club-sites` typecheck, wired `torny-web` prepare → test via turbo, flipped CI back to monorepo-wide `pnpm typecheck` + `pnpm test`. **Complete.**
- [`08-compliance-floor.md`](./08-compliance-floor.md) — `/privacy` + `/terms` scaffolds on the marketing site so the `/signup` wizard's links no longer 404. Structured for NZ Privacy Act 2020 + standard SaaS terms. **Scaffold shipped — legal review required before production.**
- [`09-sign-in-rate-limit.md`](./09-sign-in-rate-limit.md) — Client-side lockout on failed sign-in attempts with exponential backoff; ready to honour a backend 429 + `retry_after_seconds` when the server rate limit ships. **FE shipped on all four auth forms; backend specced in brief 120.**
- [`10-httponly-cookies-phase-b.md`](./10-httponly-cookies-phase-b.md) — CRM migration to HttpOnly session cookies per brief 119 Phase B. Closes the XSS → account-takeover path. **Branch ready (PR #17); blocked on one-line backend CORS fix before merge.**
- [`11-club-sites-vitest.md`](./11-club-sites-vitest.md) — vitest + 15 tests in `apps/club-sites` for the pure helpers in `server/utils/tornyApi.ts`. Closes the "shared workspace has zero tests" gap. **Complete.**
- [`12-seo.md`](./12-seo.md) — robots.txt + sitemap.xml + canonical URLs + Organization/SportsClub JSON-LD across torny-web + club-sites; `noindex` on the CRM. **Complete.**
- [`12b-seo-ai-ready.md`](./12b-seo-ai-ready.md) — AI crawler readiness: `llms.txt` on both sites, explicit AI bot directives in `robots.txt`, per-page `useSeoMeta` on all club-sites pages, `BreadcrumbList` + enriched `SportsClub` + `WebSite` JSON-LD. **Complete.**

## Priority queue (from the audit)

1. **XSS via `v-html` on received email HTML.** `CommunicationThreadView.vue:401,417` renders adversarial HTML. Combined with localStorage JWT, this is an account-takeover vector. → [`01-xss-sanitize-html.md`](./01-xss-sanitize-html.md)
2. ~~**No error tracking.** No Sentry. Every prod error is silent.~~ → [`03-sentry.md`](./03-sentry.md) **✅ live**
3. **Auto-deploy to prod with no staging.** One config typo = outage. Next.
4. **No GDPR / DSR flow.** Enterprise + UK blocked. Next.
5. **Accessibility fails on auth forms.** Screen-reader users can't hear sign-in errors. Next.
6. ~~**No Dependabot / Renovate.** CVE backlog growing silently.~~ → [`02-dependabot.md`](./02-dependabot.md)
7. **en-NZ hardcoded in 25+ files.** AU/UK expansion blocked. Deferred pending market decision.
8. **No feature flags.** All-or-nothing releases. Deferred.
