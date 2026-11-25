# Paid add-on blocks

**Feature:** a catalog of first-party paid content blocks (Tournament Pro, Rep Team Selection, Email Marketing Pro, etc.) that clubs can subscribe to on top of their Starter/Pro base plan. In the CRM block picker each add-on block shows a lock badge; clicking it opens an upsell modal → Stripe checkout → instant unlock via webhook. Public sites render a placeholder for any block whose entitlement has lapsed so the admin notices (and can reinstate) rather than the page breaking.

**Status:** specced here, nothing shipped. Written from the strategic discussion on 2026-11-26 — we want the add-on model to lift ARPU and give clubs a way to self-upgrade without a sales call. "Marketplace" in conversation = *first-party catalog only*; no third-party devs, no SDK, no review process. That's a deliberate scope gate (see non-goals §8).

**Why this shape, not something else:**
- Per-block add-ons let clubs opt in without a plan jump. "Just give me Tournaments Pro" is cleaner than "upgrade to Pro+Tournaments tier."
- First-party only avoids the two-sided-market trap. We can graduate to third-party later if we hit 50+ paying clubs and there's proven block demand; the entitlement system below is designed so that migration doesn't require a rewrite.
- No trials in V1 — billing complexity (prorations, trial-end notifications, pause states) isn't worth it for a < $30/month SKU.

**Related briefs:**
- brief 93 (plan on session hydrate / feature gating) — owning brief for the `plan` field on `/me` + `/site`. Add-ons extend that model with an `addons` list; same session-hydration path.
- brief 92 (Stripe Portal switch plans) — Portal already handles subscription changes; add-ons are new line items on the same subscription object, so the Portal path stays single-source-of-truth.
- brief 115 (public-site footer config) — the footer's plan badge already surfaces `plan`; leave it alone (don't badge add-ons publicly). Add-ons are internal to the CRM.

---

## 1. Data model — `addons` on the club payload

Extend the existing session + site payloads with an opaque list of entitlement ids.

```jsonc
// GET /me response (and GET /sites/{host} for public SSR)
{
  "club": {
    "id": 123,
    "plan": "pro",                    // existing, brief 93
    "addons": [                        // NEW
      "tournaments-pro",
      "email-marketing-pro"
    ],
    ...
  }
}
```

**Shape rules:**
- `addons` is always present (empty array when the club has none — never `null` or omitted). Simplifies the FE guard.
- Ids are kebab-case, stable, and map 1:1 to a Stripe Price (see §2). Never reuse an id across different features — once published, an id is forever.
- Order is not meaningful; the FE sorts alphabetically for display.

**Storage:** probably a join table `club_addon_entitlements (club_id, entitlement_id, active_from, active_until, stripe_subscription_item_id)`. Soft-delete by setting `active_until`; keep history for audit + reactivation. The `/me` payload only returns currently-active ids (where `active_until IS NULL OR active_until > NOW()`).

---

## 2. Stripe setup

**One Stripe Product per add-on, one Price per add-on.** Monthly recurring. Price metadata carries the entitlement id so the webhook handler doesn't need a lookup table:

```
Product: "Tournament Management Pro"
Price:   price_abc123 (NZD 19.00 / month, recurring)
Price metadata:
  torny_entitlement_id: "tournaments-pro"
```

**Billing shape:** add-ons attach to the club's existing subscription as additional subscription items. Clubs see one invoice per month covering their base plan + every active add-on, which keeps the Stripe Portal UX simple (one "manage subscription" button handles everything, brief 92).

**Webhook contract:** the existing `customer.subscription.created / updated / deleted` handler picks up add-on changes for free — the handler walks subscription items, reads `price.metadata.torny_entitlement_id`, and reconciles `club_addon_entitlements` against the current set. No new webhook topic needed.

**Cancellation behaviour:** when a club cancels an add-on via the Portal, Stripe sets `cancel_at_period_end: true` on that item. Our handler should mark `active_until = period_end` so the entitlement stays live until the paid-up period ends (same semantics as plan cancellation).

---

## 3. Backend endpoints

### 3.1 `GET /clubs/{club_id}/addons/catalog` — list available add-ons

Returns the published catalog. Public to any authenticated club user (used to render the locked-block upsell modal with a real price).

```jsonc
[
  {
    "id": "tournaments-pro",
    "name": "Tournament Management Pro",
    "tagline": "Brackets, grading, live scoring, public ladder.",
    "description": "Full writeup for the upsell modal.",
    "stripe_price_id": "price_abc123",
    "monthly_price_cents": 1900,
    "currency": "NZD",
    "pitch_bullets": [
      "Auto-generated brackets from the entrant list",
      "A / B / C grading with configurable fees",
      "Public results page for post-tournament share"
    ],
    "screenshot_urls": ["https://.../tournaments-pro-1.png"]
  }
]
```

Catalog entries live in a seed table / config — not user-editable. Changes ship via migration.

### 3.2 `POST /clubs/{club_id}/addons/checkout-session` — create a Stripe Checkout Session

Body:
```jsonc
{ "entitlement_id": "tournaments-pro" }
```

Server resolves the Stripe Price id, creates a Checkout Session with the club's existing customer id, returns the Checkout URL. The FE redirects. On success Stripe redirects back to `/crm/settings/billing?addon=tournaments-pro`; the Billing view polls `/me` until the entitlement lands (webhook typically < 2 s).

Errors to define:
- `club_not_on_billing_plan` — the club is on a free/trial state that can't add paid blocks. Returns 409.
- `addon_already_active` — defensive; FE shouldn't let this happen. 409.
- `unknown_entitlement_id` — 404.

### 3.3 `POST /clubs/{club_id}/addons/{entitlement_id}/cancel` — cancel at period end

Optional for V1 (clubs can cancel via the Stripe Portal). Ship this if users complain about having to leave the CRM to cancel.

---

## 4. Block metadata — each block declares its entitlement

In `packages/content-blocks/src/registry.ts` (or wherever the block registry lives), each block gets an optional `requiresEntitlement` field:

```ts
export const BLOCK_REGISTRY = {
  'rich-text': {
    component: RichTextBlock,
    requiresEntitlement: null,  // free
  },
  'tournament-management-pro': {
    component: TournamentManagementProBlock,
    requiresEntitlement: 'tournaments-pro',
  },
}
```

**BlockRenderer gate:** on both CRM preview and public site render, if `requiresEntitlement` is set, check `club.addons.includes(id)`. If not, render:
- **CRM preview:** a placeholder with "Unlock this block — $X/mo" CTA that opens the upsell modal.
- **Public site:** a quiet placeholder — small text that says "This feature isn't active on this site" styled as a neutral state. Deliberately visible so the admin notices (prevents silently-broken pages after cancellation).

---

## 5. CRM UX

### 5.1 Block picker

Every add-on block in the picker shows:
- A lock icon next to the block name
- A monthly price chip (`$19/mo`)
- Click → upsell modal, not insertion

Free blocks look exactly as they do today. The picker's visual hierarchy should put included blocks first, add-ons in a labelled section below ("Add-on blocks — upgrade to unlock").

### 5.2 Upsell modal

Fetched from `/addons/catalog`. Shows:
- Block name + tagline
- Screenshot carousel
- Bullet list of value prop
- Monthly price + "Add to plan" primary CTA → calls `/addons/checkout-session` → redirect to Stripe

### 5.3 Billing page (Settings → Billing)

Already exists per brief 92. Add a new "Add-on blocks" section showing:
- Currently-active add-ons (name, next billing date, "Manage in Stripe Portal" link — don't rebuild portal UI in CRM)
- A "Browse add-ons" CTA that opens the catalog modal (same content as 5.1 but all add-ons listed, not filtered by page type)

---

## 6. V1 scope — ship these, nothing else

- `addons` field on club payload (backend)
- One add-on: **Tournament Management Pro**. Build the block, ship it, catalog it.
- Catalog endpoint (3.1) with just that one entry
- Checkout session endpoint (3.2)
- Webhook reconciliation of the `addons` list
- Block picker lock badge, upsell modal, public-site placeholder for cancelled entitlements
- Billing page add-on section

**Why one add-on first:** proves the plumbing end-to-end against one real block. Once the Tournament Pro add-on cycles (purchase → use → cancel → re-purchase) work cleanly, cloning the pattern for Rep Teams, Email Pro, etc. is mechanical (just a new block + a new Stripe price + a new catalog entry).

---

## 7. Follow-up add-ons — ordered by willingness-to-pay

Scope separately as they ship. Listed here for roadmap context, not V1 scope.

1. **Rep Team Selection** — regional bodies and ambitious clubs. Niche enough to charge well ($29/mo-ish).
2. **Email Marketing Pro** — automations, segmentation, templates. Captures spend clubs already send to Mailchimp.
3. **Tournament Pro: Public Ladder add-on** — follow-on to Tournament Pro, standalone SKU for clubs who want the ladder but don't run tournaments themselves.
4. **Grants / Funding Tracker** — regional bodies again. Smaller market, higher price.

---

## 8. Non-goals

- **Third-party marketplace.** No SDK, no block manifest format for external devs, no review process, no rev-share. The entitlement system is designed to support third-party later if we ever hit the scale that justifies it, but V1 is first-party only. Not even scaffolded.
- **Trials.** No "try Tournament Pro free for 14 days" in V1. Billing complexity isn't worth it for sub-$30 SKUs; the upsell modal has to sell on its own.
- **Bundles.** "Competitions Bundle = Tournaments Pro + Rep Teams + Ladder for $29" is a good follow-up but not V1 — ship à la carte first and watch which add-ons co-purchase before building bundles.
- **Per-club discounts or coupons.** Stripe Portal handles promo codes if ever needed; we don't surface a coupon field in the Checkout session.
- **Entitlement grants for non-paying clubs.** No "give Bowls Wellington Tournament Pro for free" flow in V1. If we need that for strategic deals (brief 122's twin discussion re: BW), do it manually in Stripe via a 100%-off recurring coupon; don't build a comp mechanism yet.

---

## 9. Verification checklist

Before marking shipped:

- [ ] A club with `addons: []` sees every add-on block locked in the picker, clicks one, gets the upsell modal
- [ ] "Add to plan" → Stripe Checkout → successful payment → webhook fires → `/me` returns the new entitlement in `addons` within 5 s
- [ ] The locked block the club just paid for is immediately available in the picker and renders on the public site after re-publish
- [ ] Cancelling via Stripe Portal flips the entitlement to `active_until = period_end`; the block keeps working until the period ends, then the public site renders the "not active" placeholder and the picker re-locks it
- [ ] Attempting to checkout an already-active entitlement 409s with `addon_already_active`
- [ ] Attempting to checkout an unknown entitlement 404s with `unknown_entitlement_id`
- [ ] A free-tier / trial club gets `club_not_on_billing_plan` with a clear FE message steering them to upgrade their base plan first
