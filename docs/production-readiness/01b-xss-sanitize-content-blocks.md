# 01b · Sanitize `v-html` in `content-blocks` (public club sites)

**Status:** not started
**Date raised:** 2026-11-11
**Priority:** Day-1b (arguably higher reach than `01` — public visitors, not just admins)
**Related:** [`01-xss-sanitize-html.md`](./01-xss-sanitize-html.md)

## Why this is split from `01`

While sweeping the CRM for `v-html`, grep surfaced two sites in `packages/content-blocks/src/blocks/`:

- `CustomAiBlock.vue:241` — renders author-supplied HTML with a comment claiming the backend sanitiser is the trust boundary. Defence-in-depth gap: a compromised backend route = XSS.
- `RichTextBlock.vue:7` — renders `html` prop with no sanitiser at all.

Both of these render on **public club sites**, viewed by arbitrary web visitors. That's a wider blast radius than the CRM — a stored XSS in a club's About page would hit every member and prospect.

They weren't included in `01` because:
1. `content-blocks` is a separate workspace and consumed by both `apps/crm` (SSR-ish via Vite) and `apps/club-sites` (Nuxt SSR + hydration).
2. DOMPurify needs a DOM — in Nuxt SSR you need `isomorphic-dompurify` or a server-side alternative (e.g. `sanitize-html`).
3. Changing the type of `html: string | null` to require pre-sanitised input (branded type / factory) is a larger API change than a drop-in call-site wrap.

## Approach options

1. **Isomorphic sanitiser** — `isomorphic-dompurify` as a dep of `content-blocks`. Works SSR + browser. Same ergonomics as `01`.
2. **Branded type at the boundary** — `type SafeHtml = string & { __safeHtml: true }`. Block consumers must call a `sanitize()` factory that returns the brand. Compiler forces you to prove sanitisation at every assignment. Bigger refactor but much harder to regress.
3. **Server-only sanitisation** — trust the backend. Current state. Not defence-in-depth.

**Recommended:** option 1 for speed, option 2 as a follow-up when there's bandwidth.

## Scope

- `packages/content-blocks/src/blocks/CustomAiBlock.vue:241`
- `packages/content-blocks/src/blocks/RichTextBlock.vue:7`
- Anywhere else a block renders author HTML (needs a wider grep over `content-blocks` once started)

## Verification

- Vitest + jsdom setup in `content-blocks` (currently none — package has zero tests, per the audit)
- SSR snapshot test to prove the sanitiser runs in the Nitro build, not just the browser
