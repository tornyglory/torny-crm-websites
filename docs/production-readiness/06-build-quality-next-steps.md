# 06 — Build quality: get the editor experience closer to 9

**Status:** not started. Scoping only — pick before committing to time.

The audit baseline (`audit-2026-11-11.md`) scored the overall build **5.5 / 10**, with the operational floor since lifted by docs 01–05 (XSS, Sentry, Dependabot, axios cleanup, preload recovery). Code health already sits at 9. Everything from here is about the **editor + public-site product polish** — the stuff a club admin feels on their first visit to the CRM.

Three candidate pushes, ranked by leverage.

---

## Candidate 1 — Inline asset uploads (small, tangible)

**Target:** admins never paste a URL into the editor. Logos, PDFs, and anything else follows the same drag-and-drop pattern as the existing `ImagePicker`.

**Scope:**
- Extend the `block-images` pipeline to accept `application/pdf` (new MIME in the allowed set; size cap ~10 MB).
- Add a `PdfPicker` component in CRM that mirrors `ImagePicker` ergonomics (drag target, remove, preview thumbnail).
- Swap the `pdfUrl` text input in `BistroMenuBlock`'s inspector for `PdfPicker`.
- Audit all other text-URL inputs across the inspector (`VideoPicker` already exists for `blockVideos` — gap-check nothing else is text-only when it shouldn't be).
- Backend brief for the MIME extension (small; mirror the existing `block-images` endpoint shape).

**Why it's a 9 move:** inline uploads are table-stakes for modern CMS editors. Right now BistroMenu says "paste a URL" — admins without a CDN of their own feel the friction immediately.

**Risk:** low. Narrow backend change, clean FE pattern already established.

**Effort:** ~1 day FE + ~half-day backend.

---

## Candidate 2 — Visual + accessibility consistency sweep

**Target:** lift the **a11y score from 4 → 7** and knock out the "quietly broken" moments like the "Nothing here yet" page's left-edge alignment regression we caught this week.

**Scope:**
- Audit every block in `packages/content-blocks/src/blocks/` for:
  - Focus states (keyboard nav must be visible)
  - Colour contrast (muted text + token-scheme combinations, particularly dark themes)
  - Interactive affordances (e.g. tile cards without `role="button"` + `tabindex="0"`)
  - Gutter / padding stacking (PageRenderer + block-level + mobile overrides interacting)
- Audit CRM forms for:
  - Error messages read by screen readers (`aria-describedby` wiring on the inputs that already surface inline errors, like the `FooterConfigEditor` field errors)
  - Label associations (labels present but programmatically unlinked)
  - Field-level keyboard focus order
- Add a baseline axe-core run to the CRM Playwright smoke suite so regressions are caught, not relitigated.

**Why it's a 9 move:** the audit specifically flags accessibility as a scores laggard (`4 / 10`). A focused day across the surface lifts the floor and prevents the "we'll fix it next sprint" accumulation.

**Risk:** low. All in-tree, no backend surface.

**Effort:** 1–2 days. Mostly mechanical once the audit list is compiled.

---

## Candidate 3 — Live preview in the Website editor

**Target:** admins see their block edits land in a preview pane as they type, instead of save → open club site in a new tab → refresh.

**Scope:**
- Side pane in `WebsiteEditorView` that mounts the real `BlockRenderer` with the current draft props.
- Debounced reactive binding — ~150 ms after a field change, preview re-renders.
- Scoped CSS reset in the preview container so the public site's tokens don't bleed into the CRM shell.
- Device-frame toggle (desktop / tablet / mobile) via a resizable preview width.
- Feature flag for rollout; keep the current "save + view live" affordance as a fallback until the preview is proven.

**Why it's a 9 move:** this is the transformative one. Every published CMS in the last decade has it; without it, the Torny editor still feels like the 2015-era generation. But it's also the hardest to land cleanly — the public site renders inside Nuxt + token injection + per-club theming, and faithfully reproducing that inside the CRM shell is where subtle visual drift creeps in.

**Risk:** medium. Token leaks, SSR assumptions, and font loading are the three places this tends to break. The Nuxt → Vue bridge is worth a prototype before committing.

**Effort:** 2–3 days for the first pass. Expect follow-up polish.

---

## Recommendation

Order **1 → 2 → 3** (ship, lift the floor, then plan the big one).

1. Lands in a day with a brief + small backend change. Immediate felt improvement for every admin editing a menu.
2. Can run in parallel with planning (3). Catches issues that (3) would otherwise bake-in.
3. Prototype only before committing — the token bridge is where this will sink or swim.

Alternative path: **skip to (3)** if the user interviews point at "I can't tell what the page will look like" as the bigger pain than "I had to upload the PDF to Dropbox first." Worth confirming with real admin feedback before committing to the order.

---

## Not on this list (deliberately)

The audit's remaining landmines (staging environment, GDPR/DSR flow, en-NZ hardcoding, SEO `sitemap.xml` + `robots.txt`) are still the long tail toward 9/10 overall, but they aren't *build quality / editor UX* work — they're ops + market reach. Treat them as their own tracks via `audit-2026-11-11.md § Priority queue`.
