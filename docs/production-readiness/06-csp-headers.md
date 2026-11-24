# 06 · Content-Security-Policy headers (CRM)

**Status:** Report-Only mode live. Enforcement after observation window.
**Date:** 2026-11-25
**Priority:** Defence-in-depth on top of the DOMPurify sanitisers from day 01 / 01b.

> There's an unrelated `06-build-quality-next-steps.md` in this folder — that one was the editor-UX scoping doc. Different numbering track, same date happens by coincidence.

## Why

We already strip XSS vectors at render time with `sanitizeEmailHtml` (CRM) and `sanitizeWebsiteHtml` (content-blocks). CSP is the second line of defence: even if an unsanitised string ever reaches the DOM, the browser refuses to execute anything that isn't on an explicit allowlist. Standard belt-and-braces for anything that renders user-supplied HTML.

The audit scored Security 3/10 pre-work. Sanitisers lifted it to ~7. CSP in enforcing mode is the move to 8.

## Scope — CRM only

Only `apps/crm` is getting a CSP today. The Nuxt apps (`club-sites`, `torny-web`) deserve one too but have a known blocker: `CustomAiBlock` executes admin-authored JS via `new Function(...)`. Enforcing a CSP there needs either `unsafe-eval` globally (defeats the point) or isolating that block in a sandboxed iframe (a bigger refactor). Deferred — the CRM admin surface is the higher-value target first anyway.

## What was audited

Inventory of every external host the CRM talks to at runtime, so the policy allowlist isn't guesswork:

| Host | Used for | Directive |
|---|---|---|
| `*.execute-api.ap-southeast-2.amazonaws.com` | 5 AWS Lambda APIs (SAM, CRM, Media, Venue, BulkEmail) | `connect-src` |
| `*.ingest.us.sentry.io` | Sentry event ingest | `connect-src` |
| `fonts.googleapis.com` | Google Fonts CSS | `style-src` |
| `fonts.gstatic.com` | Google Fonts font files | `font-src` |

Not in the policy because they aren't used:
- No embedded Stripe.js — admins redirect to hosted Stripe Checkout / Portal, come back. No `js.stripe.com` allowlist needed.
- No external analytics (no GA, no PostHog, nothing).
- Both CRM iframes (`EmailDetailModal`, `WrapEditView`) use `srcdoc` — same-origin, no `frame-src` allowlist needed.
- No external CDN for scripts / styles.

## The policy

Deployed as `Content-Security-Policy-Report-Only` first — browser evaluates and logs violations to DevTools console without actually blocking anything.

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
connect-src 'self' https://*.execute-api.ap-southeast-2.amazonaws.com https://*.ingest.us.sentry.io;
frame-src 'self';
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests
```

### Why each directive looks like this

- `default-src 'self'` — deny-by-default. Any directive I didn't explicitly set inherits this.
- `script-src 'self'` — no external scripts, no inline. Strictest. We have no CDN scripts and no inline `<script>` tags; `/src/main.ts` is the only script entry.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` — Vue's scoped styles get injected as inline `<style>` tags at build-time + runtime. `'unsafe-inline'` here is a known weakness, could be tightened with per-build nonces if we ever wanted the CSP to also mitigate CSS injection. Low priority — the sanitiser already blocks `<style>` in user-supplied HTML.
- `font-src 'self' https://fonts.gstatic.com` — Google Fonts CDN serves font files from `fonts.gstatic.com`. CSS imports go through `fonts.googleapis.com` (allowed in `style-src`).
- `img-src 'self' data: blob: https:` — permissive on purpose. Admins can reference external images in email bodies and signatures (club logos hosted on their own domain, images pasted from anywhere). `data:` for inline signature images, `blob:` for FileReader previews, `https:` for everything else.
- `connect-src` — explicit allowlist for API + Sentry. Wildcards scope to the AWS region + Sentry ingest, not blanket `https:`.
- `frame-src 'self'` — our own iframes (both use `srcdoc`).
- `frame-ancestors 'none'` — nobody can embed the CRM in an iframe. Duplicate of `X-Frame-Options: DENY` but CSP-native (newer).
- `form-action 'self'` — forms submit back to us only. CSRF guard against form-posting attacks.
- `base-uri 'self'` — prevent `<base>` tag injection from rewriting all relative URLs.
- `object-src 'none'` — no Flash / `<embed>` / `<object>`.
- `upgrade-insecure-requests` — any accidental `http://` resource gets upgraded to `https://`. Belt and braces.

## Report-Only → Enforcing

### Now (Report-Only)

The browser enforces nothing. It just evaluates the policy and logs violations to DevTools console:

```
[Report Only] Refused to load the script 'https://example.com/foo.js' because it violates the following Content Security Policy directive: "script-src 'self'".
```

### Observation window (next ~1–2 days)

Click through the CRM with DevTools console open. Hit: sign-in, dashboard, members list, member detail, communications (send email, view thread), settings (every tab), stripe connect card, website editor, PDF upload. Any `[Report Only]` violations on real behaviour mean the policy is wrong — add the missing source and re-deploy.

Common things that *will* show up as violations and *shouldn't* be allowed:
- Browser extensions injecting scripts. Ignore — those only affect the dev.
- `chrome-extension://` URLs. Ignore.

If you want violations collected centrally instead of relying on DevTools, Sentry has a CSP endpoint we can point at — add a `report-uri` directive to the policy. Deferred for now because DevTools is sufficient while clicking through manually.

### Enforcing

Once the observation window is quiet, flip `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `apps/crm/public/staticwebapp.config.json`. From that point, the browser blocks policy violations instead of just logging them. Rollback is a one-line revert if anything breaks.

## Risks

- **User-pasted image hosts:** `img-src https:` allows any HTTPS host, so arbitrary tracking pixels could embed. Acceptable trade-off against the alternative (admins can't embed external images at all).
- **Future external deps:** anything new that loads from a non-allowlisted origin will break under enforcing mode. Add to the policy at the same time as you add the dep.
- **Chrome / Firefox / Safari CSP differences:** rare but real. Test in at least Chrome + Safari before enforcing.

## Follow-ups

- **CSP for Nuxt apps** — needs `CustomAiBlock` isolation decision first. Possibly via `<iframe sandbox>`.
- **`strict-dynamic` + nonces** — tighten `script-src` further if we ever add a build step that emits nonces. Not needed today.
- **Sentry CSP endpoint** — if manual DevTools observation gets tedious, wire `report-uri` to Sentry so violations show up in the Issues feed.
- **HSTS header** — `Strict-Transport-Security` would prevent any HTTP downgrade. Azure SWA already redirects HTTP → HTTPS at the edge; HSTS pins it client-side. Low-priority add.
- **CSP on the `app.torny.pro` DNS / Cloudflare layer** — some folks prefer managing CSP at the edge rather than per-app. Current approach keeps it in the repo (`staticwebapp.config.json`) so it's reviewable + versioned with the code.

## Files

- `apps/crm/public/staticwebapp.config.json` — policy lives in `globalHeaders`.

## Verification

- Deploy — SWA picks up `staticwebapp.config.json` changes automatically on next deploy.
- Open `app.torny.pro`, DevTools → Network → any request → Response Headers → `content-security-policy-report-only` should be present with the full policy.
- Click through the CRM, watch console for `[Report Only]` violations.
- When clean: flip the header name to `Content-Security-Policy` in a one-line commit.
