# Stripe subscriptions — phase 2 of the Torny OS subscription model

**Feature:** turn brief 86's static plan tiers into a real billing flow. Clubs subscribe to Starter ($39/mo) or Pro ($79/mo) via Stripe-hosted Checkout → Torny's platform Stripe account charges the club monthly → webhook keeps `clubs.plan` in sync with whatever the subscription says. Trial period baked in so clubs can explore Pro before paying.

**Status:** this brief is phase 2 of four. Phase 1 (brief 86) lands the plan column + feature gating + superadmin manual toggle. This brief replaces that superadmin-only toggle with a real subscription lifecycle — admins pay through Stripe, webhook flips the plan. Phases 3 (public pricing page) + 4 (in-app upgrade UX) build on this.

**Critical distinction vs brief 72:** brief 72 is **Stripe Connect** — clubs charging *their renters* for venue-hire deposits, money flows onto the club's connected account. This brief is **Stripe Subscriptions** on the **Torny platform account** — Torny charging *the clubs* for CRM access. Different accounts, different products, different webhooks. Don't cross the streams.

**Related briefs:**
- Brief 72 — Stripe Connect for venue-hire deposits. Platform fee flow and webhook plumbing patterns are reused here; subscription fields and events are strictly separate.
- Brief 86 — plan tiers + feature gating. This brief depends on it (adds the billing layer under the plan column).
- Brief 83 — brand overrides. Same shape pattern for the plan field on hydrate endpoints.

---

## TL;DR

- Two new columns on `clubs`: `stripe_customer_id VARCHAR(64) NULL`, `stripe_subscription_id VARCHAR(64) NULL`.
- One new column on `clubs`: `subscription_status ENUM('none','trialing','active','past_due','canceled','unpaid') NOT NULL DEFAULT 'none'`. Mirrors Stripe's subscription status with `'none'` for clubs that haven't subscribed yet.
- Two new endpoints: `POST /clubs/{cid}/billing/checkout` (mint a Stripe Checkout Session) + `POST /clubs/{cid}/billing/portal` (mint a Customer Portal URL for payment method changes, cancellation, invoices).
- One new read: `GET /clubs/{cid}/billing/status` returning the subscription state for the Settings → Billing UI.
- Webhook `/stripe/webhook/platform` handles subscription events: `customer.subscription.created`, `.updated`, `.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.trial_will_end`.
- **Plan derivation rule:** `clubs.plan` = whatever tier the subscription says when `subscription_status ∈ ('trialing','active','past_due')`; else `'starter'`. Phase 1's superadmin PATCH stays as a manual override but is now informational only — real lifecycle is Stripe-driven.
- 30-day free trial on first subscription. Card captured up front; charged on day 31 unless cancelled.

---

## 1. Stripe setup (one-time, out-of-band)

Live + test Stripe products on the **platform** account (NOT any connected account):

| Product | Price ID (test) | Price ID (live) | Amount | Interval |
|---|---|---|---|---|
| Torny OS — Starter | `price_starter_test_…` | `price_starter_live_…` | $39.00 NZD | month |
| Torny OS — Pro | `price_pro_test_…` | `price_pro_live_…` | $79.00 NZD | month |

Store both price IDs in environment config (`STRIPE_PRICE_STARTER_TEST` / `STRIPE_PRICE_PRO_TEST` and live variants). The backend reads the appropriate one based on `STRIPE_ENV`.

Stripe Customer Portal config (one-time in the Stripe dashboard): allow plan switching between Starter + Pro, enable cancellation (effective at period end), enable invoice history, allow updating payment method. Disable adding tax IDs for now.

---

## 2. Schema — migration 149

```sql
ALTER TABLE clubs
  ADD COLUMN stripe_customer_id      VARCHAR(64) NULL,
  ADD COLUMN stripe_subscription_id  VARCHAR(64) NULL,
  ADD COLUMN subscription_status     ENUM('none','trialing','active','past_due','canceled','unpaid')
                                     NOT NULL DEFAULT 'none',
  ADD COLUMN subscription_current_period_end TIMESTAMP NULL,
  ADD COLUMN trial_ends_at           TIMESTAMP NULL;
```

Nullable IDs because every existing club is in `'none'` state until their first checkout. `current_period_end` + `trial_ends_at` populate from the Stripe subscription row — surfaced in the CRM billing UI ("Next charge: 2026-12-09") and in grace-period logic.

### Plan derivation — handler helper

```ts
function derivePlan(club: Club): 'starter' | 'pro' {
  const sub = club.subscription_status
  const active = sub === 'trialing' || sub === 'active' || sub === 'past_due'
  if (!active) return 'starter'
  // Decide which tier the subscription represents by checking stripe_subscription_id's
  // price ID in Stripe (cached in the subscription row's items[0].price.id).
  // Store the resolved tier on clubs.plan so every read doesn't hit Stripe.
  return club.plan
}
```

`clubs.plan` is still the source of truth for feature gating at read time — webhook updates it whenever the Stripe subscription changes price. No live Stripe call on any hot path.

---

## 3. `POST /clubs/{cid}/billing/checkout` — mint a Stripe Checkout Session

Owner / admin. Creates a Stripe Customer if the club doesn't have one yet, then mints a Checkout Session for the requested plan.

### Request

```jsonc
{
  "plan": "pro",                          // 'starter' | 'pro'
  "success_url": "https://torny.co/crm/settings/billing?checkout=success",
  "cancel_url":  "https://torny.co/crm/settings/billing?checkout=cancelled"
}
```

Validation:
- `plan` — must be one of `'starter' | 'pro'`. Reject 400 `bad_plan` otherwise.
- `success_url` / `cancel_url` — required, HTTPS, max 2048 chars.

### Server behaviour

1. **Create or fetch Stripe Customer.** If `clubs.stripe_customer_id` is null, call `Customers.create()` with:
   ```
   email:   <owner's email>
   name:    <club.name>
   metadata.torny_club_id: <club.id>
   ```
   Save the returned id.
2. **Build the Checkout Session** on the platform account:
   ```
   mode: 'subscription'
   customer: <club.stripe_customer_id>
   line_items: [{ price: <PRICE_ID_FOR_PLAN>, quantity: 1 }]
   subscription_data: {
     trial_period_days: 30,               // only applies on FIRST subscription
     metadata: { torny_club_id, plan_key: 'pro' }
   }
   success_url + cancel_url from the request body
   automatic_tax: { enabled: false }       // phase 4 problem
   allow_promotion_codes: true             // Stripe handles discount coupon inputs
   ```
3. If the club already has an **active** subscription, this endpoint returns 409 `already_subscribed` with the portal URL — plan changes go through the Customer Portal, not a fresh Checkout. Exception: when the existing subscription is `canceled` or `unpaid`, a new Checkout is allowed (re-subscribe flow).
4. Return the Checkout Session URL.

### 200

```jsonc
{
  "status": "success",
  "data": {
    "checkout_url":        "https://checkout.stripe.com/c/pay/cs_test_…",
    "checkout_session_id": "cs_test_…"
  }
}
```

### Errors

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_plan` | plan isn't `'starter' \| 'pro'` |
| 400 | `bad_url` | success/cancel URL missing, non-HTTPS, or > 2048 chars |
| 409 | `already_subscribed` | club has an active/trialing subscription; data carries the portal URL |
| 403 | `forbidden` | caller below admin |
| 502 | `stripe_checkout_create_failed` | Stripe rejected the session create |

---

## 4. `POST /clubs/{cid}/billing/portal` — mint a Customer Portal URL

Owner / admin. The Customer Portal is Stripe's hosted UI for updating payment methods, cancelling, swapping between Starter/Pro, and downloading invoices. We don't rebuild any of that ourselves.

### Request

```jsonc
{ "return_url": "https://torny.co/crm/settings/billing" }
```

### Server behaviour

1. Reject 400 `not_subscribed` if `clubs.stripe_customer_id` is null — no customer, no portal.
2. `BillingPortal.Sessions.create({ customer: <id>, return_url })`.
3. Return the portal URL.

### 200

```jsonc
{
  "status": "success",
  "data": { "portal_url": "https://billing.stripe.com/session/…" }
}
```

### Errors

| HTTP | code | meaning |
|---|---|---|
| 400 | `not_subscribed` | club has never subscribed |
| 400 | `bad_url` | return_url missing / non-HTTPS |
| 403 | `forbidden` | caller below admin |
| 502 | `stripe_portal_failed` | Stripe rejected |

---

## 5. `GET /clubs/{cid}/billing/status` — current subscription snapshot

Committee+. Returns the state the Settings → Billing card renders from. No Stripe call on this path — all values come from the `clubs` row, kept fresh by the webhook.

### 200

```jsonc
{
  "status": "success",
  "data": {
    "plan":                "pro",
    "is_pro":              true,
    "subscription_status": "active",
    "current_period_end":  "2026-12-09T10:00:00.000Z",
    "trial_ends_at":       null,
    "monthly_price_cents": 7900,
    "has_payment_method":  true,
    "can_upgrade":         false,
    "can_downgrade":       true,
    "can_cancel":          true
  }
}
```

### Status mapping — what the FE renders

| `subscription_status` | Banner | Primary action |
|---|---|---|
| `none` | "You're on Starter — upgrade to Pro for team announcements, tournaments, honour board, venue hire." | Upgrade button → POST `/billing/checkout` with `plan: 'pro'` |
| `trialing` | "Trial ends {trial_ends_at}. First charge: $79 on that day." | Portal button → POST `/billing/portal` |
| `active` | "Pro · next charge $79 on {current_period_end}." | Portal button |
| `past_due` | "We couldn't collect your last payment — update your card to keep Pro features." | Portal button (highlighted red) |
| `canceled` | "Pro ends {current_period_end}. After that you'll be on Starter." | Resubscribe → POST `/billing/checkout` |
| `unpaid` | "Pro suspended — update your card to restore." | Portal button (red) |

---

## 6. `POST /stripe/webhook/platform` — subscription events

Brief 72 established a `/stripe/webhook/platform` endpoint for Connect events. Reuse the same endpoint — the signature-verification code, the `stripe_events` idempotency ledger, and the dispatch pattern. Add handlers for the subscription event types below.

| event.type | behaviour |
|---|---|
| `customer.subscription.created` | First-time subscription. Store `stripe_subscription_id`, `subscription_status` (= `trialing` on day 1 since we set `trial_period_days=30`), `current_period_end`, `trial_ends_at`. Derive plan from the subscription's price ID; store on `clubs.plan`. |
| `customer.subscription.updated` | Plan swap or renewal. Re-derive plan from current price ID; refresh `subscription_status`, `current_period_end`. Fire an email to the admin: "You've upgraded to Pro" or "You've downgraded to Starter (effective {date})". |
| `customer.subscription.deleted` | Final cancellation (after any cancel_at_period_end has elapsed). Set `subscription_status = 'canceled'`, keep `stripe_subscription_id` for history. Derive plan → falls back to `starter` since status isn't active. |
| `invoice.payment_succeeded` | Routine monthly charge. Mostly informational; if `subscription_status` was `past_due`, flip back to `active`. Fire a receipt email with the Stripe-hosted invoice URL. |
| `invoice.payment_failed` | Card declined. Set `subscription_status = 'past_due'`. Fire a "Payment failed — update your card" email with a Customer Portal link (one-shot `BillingPortal.Sessions.create` for the email CTA). |
| `customer.subscription.trial_will_end` | 3 days before trial ends. Fire a "Trial ends in 3 days — $79 charge on {date}" email with a Customer Portal link. |
| `customer.updated` | Email change. If the club's contact email on Stripe changed via the Customer Portal, mirror it to `clubs.owner_email` (or whatever the equivalent is). Low priority — can skip for v1. |

Idempotency — same pattern as brief 72. Reject replays with 200 (don't retry Stripe).

---

## 7. Interaction with brief 86's superadmin PATCH

Brief 86 shipped `PATCH /clubs/{cid}/plan` as a superadmin-only override. Keep it — it's still useful for support cases (e.g. comping Pro for a strategic partner, or extending a trial by hand). Behaviour change in this brief:

- Superadmin PATCH sets `clubs.plan` directly, **does not** touch `stripe_subscription_id` / `subscription_status`.
- The derivation rule (§2) now checks subscription status FIRST. If a club is on `trialing`/`active`/`past_due`, their `plan` is whatever the subscription resolved to — the superadmin PATCH gets overwritten by the next webhook. So the manual override only sticks for clubs in `none`/`canceled`/`unpaid` state.
- To comp a paying club to Pro, the superadmin needs to also update their Stripe subscription (or use the Customer Portal on their behalf). For comp'd Pro on non-paying clubs, the PATCH is enough.

---

## 8. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Fresh club — no subscription yet.
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/status"
# → 200 { data: { plan: 'starter', subscription_status: 'none', ... } }

# 2. Start a Pro subscription.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/checkout" \
  -d '{"plan":"pro","success_url":"https://torny.co/crm/settings/billing?ok=1","cancel_url":"https://torny.co/crm/settings/billing?ok=0"}'
# → 200 { data: { checkout_url, checkout_session_id } }

# 3. Pay with Stripe test card 4242 4242 4242 4242 at the checkout_url.
#    Webhook customer.subscription.created fires.

# 4. Status reflects the subscription.
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/status"
# → 200 { data: { plan: 'pro', subscription_status: 'trialing', trial_ends_at: '...', ... } }

# 5. Portal URL.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/portal" \
  -d '{"return_url":"https://torny.co/crm/settings/billing"}'
# → 200 { data: { portal_url } }

# 6. Simulate failed payment via Stripe CLI.
stripe trigger invoice.payment_failed --override invoice:subscription=sub_…
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/status"
# → 200 { data: { subscription_status: 'past_due' } }

# 7. Cancel via portal, trigger customer.subscription.deleted.
#    Status → 'canceled', plan derives back to 'starter' at period end.

# 8. Attempt new checkout while already active — 409.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/billing/checkout" \
  -d '{"plan":"pro","success_url":"...","cancel_url":"..."}'
# → 409 { code: 'already_subscribed', data: { portal_url } }

# 9. Idempotent webhook — replay customer.subscription.created, no duplicate state changes.
```

### Pass criteria

- ✓ Schema columns exist with correct defaults; existing clubs land on `subscription_status='none'`.
- ✓ Checkout endpoint returns a working Stripe session; paying flips the club to `trialing` within one webhook.
- ✓ Portal endpoint returns a working Customer Portal URL.
- ✓ Status endpoint reflects every subscription state correctly without live Stripe calls.
- ✓ Downgrade / cancel flow via portal: status flips through `canceled`, plan falls back to `starter` once `current_period_end` passes.
- ✓ Failed payment flips to `past_due`; FE banner shows the red card-update CTA.
- ✓ Trial-will-end webhook fires an email 3 days out.
- ✓ Replay any subscription event → 200, no duplicate state change.
- ✓ Superadmin PATCH still works on clubs in `none`/`canceled`/`unpaid` state.

---

## 9. Non-goals

- **No annual billing.** Monthly only in v1. Price IDs for annual can land in a follow-up without any schema change.
- **No proration UX built by us.** Stripe handles proration automatically on plan switches via the Customer Portal; we just reflect the new status.
- **No tax collection.** `automatic_tax: false` on the Checkout Session. When Torny crosses the NZ GST threshold ($60k/yr in local sales) this becomes a priority — for now, prices are inclusive.
- **No invoice PDF rehost.** Stripe-hosted invoice URLs land on invoice emails; we don't mirror the PDFs in our DB.
- **No dunning emails built by us.** Stripe's smart retries + "payment failed" sequence (configurable in Stripe dashboard) do the work.
- **No trial without card.** Admins enter card at Checkout — standard "don't forget to cancel" experience. Avoids trial abuse.
- **No multi-seat billing.** The plan is per-club, not per-admin. Every member of a Pro club has Pro access.
- **No usage-based pricing.** Flat monthly. Brief 72's venue-hire platform fee is independent revenue; this brief only covers the per-club SaaS subscription.
- **No cancellation feedback form.** Stripe Portal collects the cancel-reason if configured; we don't.
- **No "pause" state.** A paused subscription + its UX isn't shipped. Cancel → resubscribe is the pattern.

---

## 10. Contact

Phase 2 depends on phase 1 (brief 86) being live. Once that's deployed, this brief can ship independently of phases 3/4 — admins reach checkout + portal via the status endpoint before the public pricing page lands. FE wiring is a single commit on top (Settings → Billing card + webhooks confirmation page).
