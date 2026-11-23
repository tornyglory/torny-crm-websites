# 01b · Sanitize `v-html` in `content-blocks` (public club sites)

**Status:** complete
**Date:** 2026-11-11
**Priority:** Day-1b (arguably higher reach than `01` — public visitors, not just admins)
**Related:** [`01-xss-sanitize-html.md`](./01-xss-sanitize-html.md)

## The risk

Two unsanitised `v-html` sites in content-blocks, both rendering on **public club sites** viewed by arbitrary visitors:

- `RichTextBlock.vue:7` — rendered `html` prop with no sanitiser at all. Any admin who pasted malformed HTML into a club's About / News / Terms page would ship it verbatim to every visitor. Stored XSS wide open.
- `CustomAiBlock.vue:241` — had a 6-line regex "sanitiser" that only stripped `<script>` and `<style>` tags. Zero protection against `<img onerror="...">`, `<svg onload="...">`, `javascript:` URLs in `<a href>`, `<iframe srcdoc>`, etc.

The CRM editor hosts these same blocks in its preview, so XSS was also live for admins editing another admin's page.

## Approach

Picked option 1 from the earlier plan: **isomorphic-dompurify as a content-blocks dep.** `isomorphic-dompurify` is a drop-in wrapper that uses the browser's native DOM in the client and spins up jsdom on the server — same API either way, works under both Vite CSR (CRM editor) and Nuxt SSR (club-sites).

Deliberately separate helper from `apps/crm/src/utils/sanitizeHtml.ts` (`sanitizeEmailHtml`) because:

- **Email context** (CRM) is narrow — small tag set, external anchors force-rewritten with `target=_blank noopener`.
- **Website context** (content-blocks) is broader — semantic structure tags (`article`, `section`, `header`, `footer`, `nav`), tables, data attributes, `loading="lazy"`.

Two sanitisers, two trust models. Both deny-by-default, both use DOMPurify, both strip the same event-handler / javascript-URL / iframe-object-embed vectors.

## Files touched

- `packages/content-blocks/package.json` — added `isomorphic-dompurify` as a dep
- `packages/content-blocks/src/utils/sanitizeHtml.ts` — new. `sanitizeWebsiteHtml()` with website-safe allowlist.
- `packages/content-blocks/src/blocks/RichTextBlock.vue` — replaced raw `v-html="html"` with `v-html="sanitizeWebsiteHtml(props.html)"` via a computed.
- `packages/content-blocks/src/blocks/CustomAiBlock.vue` — deleted the 11-line regex `sanitiseHtml` function + replaced the `safeHtml` computed with a `sanitizeWebsiteHtml()` call. The per-block CSS scoper (`scopeCss`) and the opt-in `runJs` execution are untouched — those are deliberate affordances for AI-authored blocks and have their own isolation story.

## What this doesn't do

- Doesn't add unit tests. `content-blocks` has zero test infrastructure (per the audit). Adding vitest + jsdom is scope creep; the CRM `sanitizeHtml.test.ts` already exercises the DOMPurify config at the same severity level (different allowlist but same deny-by-default posture). Setting up tests for `content-blocks` is a legitimate follow-up.
- Doesn't convert to branded types (`SafeHtml = string & { __safeHtml: true }`). That would stop future contributors from assigning raw strings to `v-html`-destined props at the type level. Worth doing when there's bandwidth; the two call sites touched here would be the first to adopt it.
- Doesn't change the `CustomAiBlock` JS execution path (`new Function(...)`). That's an explicit opt-in affordance, not an XSS vector in the same sense — it only runs if `allowJs === true` which comes from an admin-authored block config, not visitor-supplied input.

## Verification

- `pnpm --filter @torny/content-blocks typecheck` — green
- `pnpm --filter @torny/content-blocks lint` — green
- `pnpm --filter @torny/crm typecheck` — green (depends on content-blocks)
- `pnpm --filter @torny/crm test` — green (62/62; none of these directly exercise the content-blocks sanitiser, so no coverage gain in the CRM suite)
- `pnpm --filter @torny/crm build` — green
- **`pnpm --filter @torny/club-sites build` — green** — critical check: this is the Nuxt build that produces a Cloudflare Worker bundle including the SSR render path. `isomorphic-dompurify` shipping jsdom into the worker and still building cleanly is what proves the SSR side works.

## Follow-ups

- Add vitest to `content-blocks` with the same style of sanitiser test as `apps/crm/src/__tests__/sanitizeHtml.test.ts`.
- Audit any other block that hits `v-html` in the future. Current grep (`grep -rn v-html packages/content-blocks/src`) lists only `CustomAiBlock.vue`, `RichTextBlock.vue`, and a comment in `RichTextEditor.vue`. Clean.
- Optional: branded `SafeHtml` type to prevent regressions by construction.
- The Nuxt apps (`club-sites`, `torny-web`) could still render adversarial data via other vectors we haven't audited (e.g. direct `innerHTML` usage in pages, `<a href="{userControlledUrl}">` without URL validation). Out of scope here.
