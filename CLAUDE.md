# Torny — Claude Code project instructions

This file is loaded automatically at the start of every Claude Code session in this repo. It encodes the project's conventions, the feedback loop, and the gotchas that burn time.

---

## What this repo is

A pnpm + turborepo monorepo:

- `apps/crm` — Vue 3 + Vite CRM for club admins. **Dev server: port 5174.** The surface area most of the work lands on.
- `apps/club-sites` — Nuxt public club websites, rendered from the content-blocks package.
- `apps/torny-web` — marketing site.
- `packages/api-client` — typed resource layer wrapping the CRM API + bulk-email endpoints. Every FE call goes through here, not raw `fetch`.
- `packages/content-blocks` — Vue component library shared between the CRM editor and the club sites renderer.
- `packages/design-tokens` — CSS variables for brand (`--color-ink`, `--color-accent`, `--font-body`, radii, etc).

`docs/backend-briefs/` holds every brief written for the backend team. New briefs follow the numbered format (see brief 65 for a recent template).

---

## The feedback loop (default to this every time)

**After any CRM UI change:**

1. `pnpm --filter @torny/crm typecheck` — catches type regressions. Fast.
2. `pnpm --filter @torny/crm test` — vitest unit suite.
3. `pnpm --filter @torny/crm test:e2e` — Playwright smoke tests. Boots the dev server automatically.

If any step fails, **fix and re-run** before reporting back. Don't claim a task is done on a red suite. If a test fails for a reason unrelated to the change, say so explicitly and offer a plan rather than silently editing the test to pass.

**For visual / interactive debugging** when a test is failing or the behaviour is hard to reason about from code alone, use the Playwright MCP (`mcp__playwright__*` tools): navigate the running dev server, read the console, take screenshots, inspect the DOM live. Prefer this over guessing from logs.

**Console-error policy.** The smoke tests fail on any un-whitelisted `console.error` or page error. This caught the OPEN RATE hero regression (ink-on-ink text) by refusing to pass "silently renders but broken" UI. Keep it strict. If a legitimate warning starts firing in dev (e.g. Vite HMR noise), filter it in `apps/crm/e2e/smoke.spec.ts:isAllowedConsoleMessage` with a comment explaining why — never by relaxing the equality check.

---

## Running things

```sh
# Dev
pnpm dev:crm                           # Vite on :5174 (CRM)
pnpm dev:sites                         # Nuxt (club sites)

# Checks
pnpm --filter @torny/crm typecheck     # vue-tsc --noEmit
pnpm --filter @torny/crm test          # vitest
pnpm --filter @torny/crm test:e2e      # Playwright, headless
pnpm --filter @torny/crm test:e2e:ui   # Playwright, interactive UI
pnpm lint                              # turbo lint

# Build
pnpm build                             # turbo build (all apps)
```

The Playwright `webServer` config reuses an existing dev server when it finds one on 5174, so you can leave `pnpm dev:crm` running in another terminal and the E2E suite still works.

---

## Project conventions worth knowing

### UI

- **Native `<select>` is banned in CRM views.** Use `apps/crm/src/components/TornySelect.vue` (single) or `TornyMultiSelect.vue` (multi-value). The browser-painted dropdown doesn't honour the design system and can't be styled. Both components already handle right-edge overflow (flip the menu leftwards when it would spill past the viewport).
- **Views don't set their own outer padding.** The `CrmShell` layout owns the shell's padding. Setting `padding: 32px 32px 48px` on `.comms` or similar stacks on top of the shell's padding and looks visibly off compared to sibling pages. Views should only set `max-width` and internal `gap`.
- **Max width convention:** 1280px for most content views (Members, Applications, Communications, Templates). Dashboard is 1200px. Don't invent new widths without a reason.
- **Pills, not rounded rectangles.** Primary action buttons use `border-radius: 999px`. If a button in the top-bar or action row looks like a rounded square, assume it's a regression and fix it.
- **Hero cards on dark backgrounds.** When adding a dark-surfaced tile, remember `.stat__value` et al default to `color: var(--color-ink)`. Hero overrides MUST set `color: #fff` or inherit explicitly. This bit us on the OPEN RATE card.

### Data

- **Rate values from the API are 0..1 decimals, not 0..100.** Multiply by 100 at render. The `pct()` helper in `CommunicationsView.vue` is the reference pattern.
- **Season attribution** is server-authoritative. When presenting a "pick a season" affordance, default to the club's current season (null on the wire → server attaches to current). Explicit ids are for admins back-dating or accepting into a future season.
- **Payment status → UI dues label.** `paid` → "Paid"; `unpaid`/`partial` → "Due"; `overdue` → "Overdue"; `waived` → "Waived". Don't invent new buckets.

### Backend-first discipline

- Every FE change that assumes a new field, endpoint, or behaviour must have a matching brief in `docs/backend-briefs/`. Use the next free number. Briefs include: §1 the ask, §2+ the behaviour, verification checklist, non-goals. Mirror the shape of brief 65 for approve-with-season / welcome email.
- Don't invent error codes in the FE. If a case needs a new code, add it to the brief and the corresponding type in `packages/api-client`.

### Commit style

Sweep-style commits are fine when the surface is cohesive. Keep the subject line short (<80 chars); detail belongs in the body. Recent examples (see `git log`): `WIP sweep: logoInHeader toggle, approve-into-season, click/unsub tracking, TornySelect` or `CRM sweep: auth flow refresh, TornySelect propagation, SES delivery warning`.

---

## When something looks "silently broken"

Not every regression throws. If the user says "the number isn't showing" or "the modal pushed off-screen" and the code looks correct, check:

1. **Console errors** — run the Playwright smoke test, or open the running dev server with the Playwright MCP.
2. **Contrast / colour tokens** — dark surface + default ink text = invisible but structurally fine.
3. **Overflow / viewport spill** — dropdowns and popovers past the right edge of the viewport. `TornySelect` auto-flips; custom popovers often don't.
4. **Stacked padding** — a view adding padding on top of `CrmShell`'s.
5. **Backend contract drift** — a field renamed or newly nullable upstream. Rate-related fields are a repeat offender; prefer client-side derive (`numerator / delivered`) as a fallback.

If none of these fit, don't guess. Open the page with the Playwright MCP, inspect the live DOM, and screenshot.

---

## Non-goals / anti-patterns

- Don't add E2E tests that require a seeded backend DB until we have a test-data strategy. The current suite is static-rendering smoke only. Full-flow tests (sign in → navigate → submit) need a plan first.
- Don't `--no-verify` on commits.
- Don't invent `?new=1` style query handshakes without wiring the target view's watcher. `NewMenu.vue` and the three target views (Members, Events, Website) are the reference pattern.
- Don't propagate `TornySelect` into dropdowns that are deliberately native for accessibility reasons (e.g. date pickers that currently use `<input type="date">`). When in doubt, ask.
