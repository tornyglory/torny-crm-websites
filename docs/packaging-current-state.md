# Torny OS — Packaging: as-shipped baseline

Snapshot of how Torny's own SaaS subscription model works today (clubs paying Torny — not clubs taking payments from members). Use this as the source-of-truth input when redesigning pricing with real numbers.

> Companion doc: `docs/pricing-model.md` holds the open strategic decisions (what $79 unlocks, annual discount, trial length). This doc stays factual — what's actually running right now.

Last audited: 2026-11-19. Covers code at `main` through `47349db`.

---

## 1. Summary

Two plans live in production:

| Plan | Price | Trial | Default for new clubs |
|---|---|---|---|
| **Starter** | $39 NZD / month | 30 days, card required | ✓ |
| **Pro** | $79 NZD / month | 30 days, card required | — |

Plan state flows from Stripe → `clubs.plan` column → `/me` / `/login` / `/register` → FE route + nav gating. Prices live in two places as hardcoded strings (CRM Settings → Billing and the torny-web signup wizard) — there's no `/plans` config endpoint. 1461 existing clubs sit on Starter by default.

---

## 2. Plan model

- **Enum.** Two slugs in code: `starter`, `pro`. Typed as `PlanKey` in `packages/api-client/src/resources/billing.ts:13`.
- **Database.** `clubs.plan` ENUM, default `'starter'`. Shipped by backend brief 86 §1.
- **Session hydration.** Included on the `UserClub` payload returned from `/me`, `/login`, `/register` (brief 93). Typed as `UserClub.plan?: PlanKey` in `packages/api-client/src/resources/auth.ts:19`.
- **Derivation.** When `clubs.subscription_status ∈ {trialing, active, past_due}`, plan reflects the subscription's price id; otherwise defaults to `starter`. Logic lives on backend (brief 87 §2), FE just reads the flattened value.
- **Public rendering.** Also published on `/clubs/resolve` and `/public/clubs/{slug}/site` so the public club site can hide Pro-only blocks on Starter tenants (brief 86 §6).

---

## 3. Feature gating

The FE gate is a two-layer system: route meta flag + sidebar filter.

- **Gate location.** `permissionGate` navigation guard — `apps/crm/src/router/guards.ts:91-125`. Reads `meta.requiresPro` off the destination route; on Starter plans it bounces to Dashboard with a toast.
- **Sidebar filter.** `apps/crm/src/layouts/CrmShell.vue:609-640` (`visibleSidebarGroups`). Hides Pro items on Starter so they don't appear in nav or the mobile "More" sheet.

Every module Torny ships today, bucketed by plan:

| Module | Starter | Pro | Gated at |
|---|---|---|---|
| Dashboard, Members, Applications, Enquiries, Events, Communications, Payments, Website, Settings, Profile, Account, Honour board (read-only) | ✓ | ✓ | n/a |
| **Team selections** (`/crm/teams`, `/teams/:id`) | — | ✓ | `requiresPro: true`, `permission: 'team_selections:read'` |
| **Tournaments** (list, settings, new, detail, edit, results) | — | ✓ | `requiresPro: true`, `permission: 'tournaments:*'` |
| **Venue bookings** (list + detail) | — | ✓ | `requiresPro: true`, `permission: 'venue_bookings:*'` |
| **Venue packages** (list, settings, new, edit) | — | ✓ | `requiresPro: true`, `permission: 'venue_packages:*'` |

All five gated groups are declared alongside other route meta in `apps/crm/src/router/index.ts:70-85`. There is no soft-gated feature right now — every Pro module is hard-hidden on Starter, no "upgrade to use this" placeholder cards.

Brief 105's `variant.modules` map is a separate axis (vertical neutrality, e.g. hide tournaments for a nursing-org vertical). Plan gating runs on top of module visibility: a module has to be allowed by the variant AND covered by the plan to appear.

---

## 4. Billing endpoints

Three CRM-side calls, all typed in `packages/api-client/src/resources/billing.ts`:

- **`GET /clubs/:cid/plan`** — returns `PlanState { plan, features[], price_cents, currency, subscription_status, trial_ends_at, current_period_end, has_stripe_customer }`. Used by the Settings → Billing panel.
- **`POST /clubs/:cid/billing/checkout`** — creates a Stripe Checkout session for a new sub or upgrade. Required body: `{ plan, success_url, cancel_url }`. Returns a hosted Checkout URL.
- **`POST /clubs/:cid/billing/portal`** — returns a Stripe Customer Portal URL for plan changes, payment method, cancellation. Required body: `{ return_url }`.

Stripe products + prices (platform account, not club-connected):

- `price_starter_test` / `price_starter_live` → $39 NZD / month
- `price_pro_test` / `price_pro_live` → $79 NZD / month

Env vars: `STRIPE_PRICE_STARTER_{TEST,LIVE}` + `STRIPE_PRICE_PRO_{TEST,LIVE}`. Wired via brief 87.

Webhook: `POST /stripe/webhook/platform`. Listens for `customer.subscription.{created,updated,deleted}`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.trial_will_end`. On each event, syncs `clubs.{plan, subscription_status, current_period_end, trial_ends_at}` back from Stripe.

Trial: 30 days, card required. Baked into every Checkout session via `trial_period_days: 30` (brief 87 §3). There is no non-card / trial-without-card flow.

---

## 5. Where prices surface to the admin

Prices are **hardcoded in two places** and manually kept in sync:

- **CRM Settings → Billing**, `apps/crm/src/views/settings/SettingsView.vue:819-854`.
  - Starter row: $39 / month, "essentials" copy (line 823).
  - Pro row: $79 / month, "venue + tournaments" copy (line 841).
- **Public signup wizard**, `apps/torny-web/pages/signup/index.vue:349, 375, 441`.
  - Step 3 (plan picker): $39 and $79 hardcoded.
  - Step 4 (review): same values repeated in the summary row at line 441.

The backend `GET /plan` endpoint returns a `price_cents` field, but the current UI doesn't consume it — the FE reads its own hardcoded copy. Changing prices today means updating two FE files, the Stripe price objects, AND the env vars, and hoping the four stay in step.

Marketing site (`apps/torny-web`) outside the signup flow does not currently render prices. Club-sites (public tenant sites) render feature *availability* based on `club.plan` (Pro-only blocks go dark on Starter) but never show prices to visitors.

---

## 6. Feature ladder today

Feature copy (as shipped, verbatim-ish):

**Starter — "The essentials."**
- Members, Applications, Enquiries
- Events + calendar
- Communications (Email, personal signature)
- Public website (block editor, custom domain, membership page)
- Settings, Payments manual recording

**Pro — "Everything in Starter, plus."**
- Team selections (brief 60s)
- Tournaments (tournament settings, results, honour board writes)
- Venue bookings (brief 73)
- Venue packages (brief 73)
- Honour board full edit

Anything not listed on a row is in both plans. There is no "add-on" product today — Pro is strictly a superset of Starter. Communications quotas, member counts, website pageviews, and storage are all unlimited (no usage caps have been implemented).

---

## 7. Related briefs

| # | Title | Role |
|---|---|---|
| 86 | Plan tiers + feature gating | Core: `clubs.plan` column, allowlist, superadmin PATCH, hydrate inclusion. |
| 87 | Stripe subscriptions for plan tiers | Billing: Checkout, Portal, webhook lifecycle, trial, plan derivation from Stripe state. |
| 88 | Public signup flow | Onboarding: 4-step wizard, plan picker, Stripe Checkout handoff. |
| 89 | Subscription & signup — what/why | Product rationale: ten org-type defaults, success metrics. |
| 90 | Outage: `/clubs/resolve` 500s on missing plan column | Bug fix: late migration for `clubs_data.plan`. |
| 91 | Billing checkout/portal: accept localhost URLs | Dev ergonomics only. |
| 93 | Plan on session hydrate for feature gating | Added `plan` to `UserClub` on `/me` / `/login` / `/register` so nav filters work first paint. |
| 72 | Stripe Connect venue-hire deposit | Related but distinct — member-side split payments (7% Torny / 8% club). Not platform subscription. |
| 108 | Pay-on-join Stripe checkout | Related but distinct — member-side application payments, uses the club's connected account. |

---

## 8. Known gaps relevant to a redesign

Called out so the strategy conversation knows what's *not* covered by the current implementation.

- **No `/plans` config endpoint.** Prices live as duplicated hardcoded strings. Any pricing change touches four surfaces.
- **No annual billing.** Monthly only. Stripe pricing object is a monthly recurring; no yearly price shipped.
- **No automatic tax.** `automatic_tax: false` on Checkout (brief 87 §9). GST handling on NZ-resident clubs is manual.
- **No per-seat / per-member usage pricing.** Every plan is flat; a 50-member club pays the same as a 500-member one.
- **No add-ons.** You can't buy tournaments without venues, or vice versa. Pro is monolithic.
- **No in-app "upgrade" CTA** when a Starter admin clicks a Pro-gated item. The router bounces with a toast; there's no modal that routes them to Settings → Billing / Stripe Checkout.
- **No trial-without-card** or "grace after trial expired" window.
- **No multi-club / agency pricing.** Each club is its own subscription even when the same user owns several.
- **No downgrade friction.** A Pro → Starter downgrade (via Portal) flips the plan at period end; nothing in the FE warns about losing access to tournaments / venue bookings / etc.

---

## 9. Suggested inputs for the redesign

What to come prepared with before the design session:

1. **Actual churn + plan mix** — how many clubs on Starter, on Pro, trial-only, delinquent. Stripe dashboard + `clubs.plan` tally.
2. **Average member count per club** — relevant if we want per-seat or tiered-by-size pricing. Comes from `members` counts + `clubs.id`.
3. **Feature usage telemetry** — which Pro modules do Pro clubs actually touch? If 70% of Pro clubs never use venue bookings, that changes the bundle math.
4. **Benchmark refresh** — Clubforce / Mindbody / Playbypoint / Omnify current list prices. The $79 anchor from `docs/pricing-model.md` was set against Nov 2025 data.
5. **GST / NZ-sales-tax position** — if we ship annual pricing, it needs to interact with `automatic_tax` and the club's registered-for-GST state.

Once those are locked, the redesign should produce: a plan ladder with real numbers (incl. annual column if agreed), the add-on model (if any), the feature gating diff, and a single pricing config shape that replaces the four hardcoded strings. A follow-up backend brief can then stand up `/plans` as the source of truth.
