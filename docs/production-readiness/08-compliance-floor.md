# 08 · Compliance floor

**Status:** scaffold shipped. Legal review required before production.
**Date:** 2026-11-25
**Priority:** blocker for real customers in NZ, AU, UK, EU.

## What's shipped

Two placeholder legal pages on the marketing site so the `/signup` wizard's link to them doesn't 404:

- [`/privacy`](../../apps/torny-web/pages/privacy.vue) — structured around NZ Privacy Act 2020 (IPPs 1–13)
- [`/terms`](../../apps/torny-web/pages/terms.vue) — structured as standard SaaS terms for NZ jurisdiction

Both pages:
- Render under `torny.pro/privacy` and `torny.pro/terms` respectively, matching the existing marketing-site Nuxt page conventions.
- Carry a prominent **"Draft — placeholder scaffold, legal review required"** banner at the top.
- Mark every section that needs human legal input with an inline `DRAFT` / `TODO` marker in orange.
- Use the design-tokens style so they match the rest of the marketing site.
- Cross-link to each other and back to the homepage.
- Set proper `useSeoMeta` so Google indexes them when the real content lands.

## Why "scaffold not final"

Writing real legal text without counsel is dangerous — any phrasing we invent could be enforceable against the business in ways we didn't intend, or could fail to protect customers in ways that invite complaint to the Privacy Commissioner. The scaffolds:

- Fix the immediate UX gap (signup CTA → privacy / terms → 404)
- Capture the structure a lawyer will want to populate (so review is faster)
- Mark unambiguously what is placeholder vs what is final (so a reviewer, a user, or a future contributor doesn't mistake the one for the other)

## Why this matters for production

The audit scored Compliance 3/10 with these gaps:
- No `/privacy` or `/terms` pages — now scaffolded
- No cookie consent gating — still open; blocker for GDPR, deferred because there are no cookies to gate today
- No DSR flow (data export + delete) — still open; a manual "email us" path is acceptable for NZ Privacy Act but not for GDPR
- No sub-processor list — needs the privacy page to list AWS region, Sentry, Stripe, Cloudflare, SES
- No breach notification policy — internal doc, separate track

## What still needs to happen before production

1. **Legal review.** Counsel reviews both pages and populates every `TODO` / `DRAFT` marker. Reasonable effort in NZ: 2–4 hours of a lawyer's time for the pair.
2. **Legal entity details.** Both pages reference the "legal entity name, NZBN, registered address" — populate.
3. **Contact routes.** Both pages promise `privacy@torny.pro` and `hello@torny.pro` inboxes. Set them up + route to a real human.
4. **Sub-processor list.** The privacy page §4 needs the concrete list: AWS Lambda (ap-southeast-2), Azure SWA, Cloudflare Pages, Amazon SES, Sentry, Stripe. Note the region for each, and whether any crosses borders.
5. **Retention periods.** §6 needs concrete numbers per data category (account, communications, payments, audit logs). Confirm with backend.
6. **Billing boundary.** Terms §6 needs the Stripe + Torny split explained — Torny as merchant of record for subscriptions, club as merchant of record for member dues via Stripe Connect.
7. **Liability cap.** Terms §8 — the standard "fees paid in the 12 months preceding the claim" clause with fraud / gross-negligence carve-outs. Counsel sign-off.
8. **Link from CRM sign-in.** `apps/crm/src/views/auth/SignInView.vue` doesn't currently link to privacy / terms. Add a footer link.

## Not in scope for this page

- **Cookie consent banner.** Torny ships zero third-party analytics today. If / when we add GA4, Plausible, or similar, build the consent gate then. Plausible's whole value proposition is "no banner needed" so prefer it unless there's a specific reason to use GA4.
- **DSR (Data Subject Request) flow.** The NZ Privacy Act gives you 20 working days to respond, which a manual intake via the `privacy@` inbox satisfies. GDPR tightens this further + requires automated data export. Build when AU / UK launch is scheduled.
- **Club-site privacy / terms.** Each club will want their own — they're the data controller for their members. Future: each club's admin edits a privacy policy in the site editor; falls back to a Torny-managed default pointing at `torny.pro/privacy` and this page.
- **Cookie policy** as a separate page. We don't need one until analytics lands.

## Verification

- Visit `torny.pro/privacy` and `torny.pro/terms` on the deployed marketing site after this commit lands — both pages render, no 404.
- Click from the `/signup` wizard's "By continuing you agree to our terms and privacy notice." — the links no longer 404.
- Both pages visible to crawlers (no `noindex`) — real content, when it lands, gets indexed.
