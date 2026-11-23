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

## Priority queue (from the audit)

1. **XSS via `v-html` on received email HTML.** `CommunicationThreadView.vue:401,417` renders adversarial HTML. Combined with localStorage JWT, this is an account-takeover vector. → [`01-xss-sanitize-html.md`](./01-xss-sanitize-html.md)
2. ~~**No error tracking.** No Sentry. Every prod error is silent.~~ → [`03-sentry.md`](./03-sentry.md) **✅ live**
3. **Auto-deploy to prod with no staging.** One config typo = outage. Next.
4. **No GDPR / DSR flow.** Enterprise + UK blocked. Next.
5. **Accessibility fails on auth forms.** Screen-reader users can't hear sign-in errors. Next.
6. ~~**No Dependabot / Renovate.** CVE backlog growing silently.~~ → [`02-dependabot.md`](./02-dependabot.md)
7. **en-NZ hardcoded in 25+ files.** AU/UK expansion blocked. Deferred pending market decision.
8. **No feature flags.** All-or-nothing releases. Deferred.
