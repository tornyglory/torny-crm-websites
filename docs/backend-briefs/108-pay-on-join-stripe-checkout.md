# Brief 108 — Pay-on-join Stripe Checkout for membership applications

**Scope:**
- API (VenueStack): new Checkout-session mint on application create, webhook to flip `payment_status`, per-tier opt-in flag.
- CRM FE / club-sites (`tornyglory/torny-crm-websites`): consume the new `stripe_checkout_url` returned from `POST /public/clubs/:slug/applications`, surface a per-tier toggle in Settings → Membership types.

**Prereq:**
- Brief 36 (tiers + fees + cadence) shipped.
- Stripe Connect wired per club (`settings/stripe/callback` already live — `clubs_data.stripe_account_id` populated).
- Brief 105/106 variant + custom facets shipped (not a strict dependency, just confirming the join form is the shape we're submitting).

> **Why now:** today the public join form POSTs an application and the applicant lands on an "Application received" screen. Admin then manually records payment in the CRM after committee approval. Clubs on Starter/Pro expect Stripe-collected fees at submission so first-season cash flow lines up with the application pipeline.

---

## 1. The ask

Three contained pieces:

1. **Per-tier opt-in** — add a `collect_payment_on_join` boolean to `membership_types` so clubs can decide per tier whether to collect at submission (Social / Playing) vs. keep manual (Life / Invited / $0 tiers).
2. **Checkout session on submit** — when `tier.collect_payment_on_join = true` and `tier.fee > 0`, `POST /public/clubs/:slug/applications` creates a Stripe Checkout session (destination charge via the club's connected account) and returns `stripe_checkout_url` alongside the usual `application_id` / `status`.
3. **Webhook** — on `checkout.session.completed`, mark the application `payment_status = 'paid'` + persist the Checkout session id + payment intent id. Committee approval stays manual (brief 108 does **not** auto-approve paid applications).

Refunds stay out of scope for v1 — admins handle them from the Stripe dashboard if committee rejects a paid applicant. (See §6 non-goals.)

---

## 2. Schema

### 2.1 `membership_types` — new opt-in

```sql
ALTER TABLE membership_types
    ADD COLUMN collect_payment_on_join TINYINT(1) NOT NULL DEFAULT 0
    AFTER fee;
```

- Default `0` so existing tiers don't change behaviour.
- CRM Settings → Membership types UI will expose a switch per tier (FE work in §4).
- Backend validation: only honour the flag when `fee IS NOT NULL AND fee > 0`.

### 2.2 `applications` — Stripe session tracking

```sql
ALTER TABLE applications
    ADD COLUMN stripe_checkout_session_id VARCHAR(128) NULL,
    ADD COLUMN stripe_payment_intent_id   VARCHAR(128) NULL,
    ADD COLUMN payment_status             ENUM('unpaid','pending','paid','refunded','waived') NOT NULL DEFAULT 'unpaid',
    ADD COLUMN paid_at                    DATETIME NULL,
    ADD COLUMN paid_amount_cents          INT NULL,
    ADD INDEX idx_apps_stripe_session (stripe_checkout_session_id);
```

- `payment_status = 'pending'` while a Checkout session is open but not yet completed (used to distinguish "applicant started paying" from "didn't need to pay").
- `payment_status = 'paid'` set by the webhook.
- `paid_amount_cents` lets the CRM reconcile actual charged amount against `tier.fee` (handles Stripe rounding / processing fees if the club decides to pass them on later).

Existing applications on NULL / default values = behaves exactly like today.

---

## 3. Endpoints

### 3.1 Application create — now returns a Checkout URL when applicable

```http
POST /public/clubs/:slug/applications
Content-Type: application/json

{ "tier_id": 7, "full_name": "…", "email": "…", … }
```

**Response when the tier opts into pay-on-join + fee > 0:**

```json
200 {
    "status": "success",
    "data": {
        "application_id": 42,
        "status": "pending",
        "received_at": "2026-11-19T02:30:00Z",
        "payment_status": "pending",
        "stripe_checkout_url": "https://checkout.stripe.com/c/pay/cs_test_...",
        "stripe_checkout_session_id": "cs_test_..."
    }
}
```

**Response when payment is not collected (current behaviour):**

```json
200 {
    "status": "success",
    "data": {
        "application_id": 42,
        "status": "pending",
        "received_at": "2026-11-19T02:30:00Z",
        "payment_status": "unpaid"
    }
}
```

FE contract: if `stripe_checkout_url` is present, redirect the browser there. Otherwise show the existing "Application received" screen.

### 3.2 Checkout session details

- Mode: `payment` (one-time charge, not a subscription — subscriptions are a future brief).
- Line item: one, amount = `tier.fee * 100` in the club's Stripe currency (today everyone's NZD; honour `clubs_data.currency` when that column lands).
- `payment_method_types`: `['card']` + whatever else backend already enables for tournaments.
- `client_reference_id`: `application_id` so the webhook can lookup without a separate db roundtrip.
- `customer_email`: prefill with the applicant's email.
- `metadata`:
  ```json
  {
      "torny_application_id": "42",
      "torny_club_id": "5",
      "torny_tier_id": "7",
      "torny_source": "membership_join_form"
  }
  ```
- `destination`: the club's connected Stripe account (`clubs_data.stripe_account_id`); `application_fee_amount` = platform fee if we're taking one on applications (same rate as tournaments today or `0` if not).
- `success_url`: `https://<primary_host>/membership/thanks?application={CHECKOUT_SESSION_ID}`
- `cancel_url`: `https://<primary_host>/membership?application=cancelled`

### 3.3 Webhook — `checkout.session.completed`

Existing webhook endpoint (`POST /webhooks/stripe` or similar). Add a handler for `metadata.torny_source === 'membership_join_form'`:

1. Load application by `session.client_reference_id`.
2. Guard: skip if `payment_status === 'paid'` (idempotency — Stripe retries).
3. Update:
   ```sql
   UPDATE applications SET
       payment_status = 'paid',
       stripe_payment_intent_id = ?,
       paid_at = NOW(),
       paid_amount_cents = ?
   WHERE application_id = ?;
   ```
4. Fire the existing `member_application_received` / `application_paid` CRM notification. (Brief 40 convention — new notification kind `application_paid` would be nice but not required for v1.)
5. Return 200 fast; don't gate on side-effects.

Expired sessions (`checkout.session.expired`): no action needed — application stays with `payment_status = 'pending'` and committee can decide to approve + follow up manually or reject.

### 3.4 Errors

| HTTP | code | When |
|---|---|---|
| 400 | `stripe_disconnected` | Club hasn't completed Stripe Connect onboarding (no `stripe_account_id`). FE should fall back to "Application received" with a hint that payment will be arranged out of band. |
| 400 | `tier_fee_missing` | `collect_payment_on_join = true` but `tier.fee` is null or 0. Config error on the tier — treat as "no payment required" (log + proceed). |
| 502 | `stripe_session_failed` | Stripe API error when creating the session. Retry once; on second failure the application row is still created (don't lose the submission) but no `stripe_checkout_url` is returned. FE falls back to "Application received" + flags the application for admin follow-up. |

The non-fatal shape of all three is deliberate: a Stripe hiccup should never block an applicant from getting their application on the committee's desk.

---

## 4. FE work

### 4.1 Settings → Membership types — per-tier switch

- Add a "Collect payment at submission" switch per tier in `apps/crm/src/views/settings/SettingsView.vue` (membership section).
- PATCH the tier with `{ collect_payment_on_join: true/false }` on toggle.
- Default off — admins opt in per tier.
- Disable the switch + show a tooltip when `fee` is null / 0 ("Set a fee before enabling pay-on-join").

### 4.2 Public join form — redirect on checkout URL

`packages/content-blocks/src/blocks/MembershipJoinFormBlock.vue`, `onSubmit`:

```ts
const res = await applications.create(clubSlug.value, payload)
if (res.stripe_checkout_url) {
  window.location.href = res.stripe_checkout_url
  return
}
submitted.value = true
if (props.successHref) window.location.href = props.successHref
```

Update the api-client `CreateApplicationResult` type to carry the new optional fields:

```ts
export interface CreateApplicationResult {
    application_id: number
    status: 'pending'
    received_at: string
    payment_status?: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'waived'
    stripe_checkout_url?: string
    stripe_checkout_session_id?: string
}
```

### 4.3 Cancel + thanks pages

- `/membership?application=cancelled` — the existing membership page already renders at that URL; add a top-of-form banner "Your application wasn't submitted — your payment was cancelled. Try again or get in touch." Only shows when the query param is set, dismissible.
- `/membership/thanks?application={session_id}` — new route (or query param on `/membership`). Shows "Payment received. Welcome — we'll be in touch within a week." Fetches the application by session id (new public read) if we want to show tier details, otherwise just a thank-you.

Per-club `successHref` on the Join form block prop still wins if set — admin override takes priority.

### 4.4 CRM → applications detail

Payment status + Stripe session id surface on the application detail page so admins can see what was paid. New pill next to the existing "pending" status:

| `payment_status` | Pill |
|---|---|
| `unpaid`    | hidden (default behaviour for non-pay tiers) |
| `pending`   | "Payment pending" (amber) |
| `paid`      | "Paid" (ink) with tooltip showing `paid_amount_cents` + `paid_at` |
| `refunded`  | "Refunded" (slate) |
| `waived`    | "Waived" (ghost) |

Clicking the pill opens the Stripe session in Stripe dashboard (`https://dashboard.stripe.com/.../checkout/sessions/{id}`).

---

## 5. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CLUB=5
SLUG=naenae-bowling-club
TIER=7  # a tier with fee > 0

# 1. Opt the tier in to pay-on-join (admin side; owner JWT)
TOKEN="…"
curl -s -X PATCH "$VENUE/clubs/$CLUB/membership-types/$TIER" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"collect_payment_on_join":true}' | jq

# 2. Submit a public application → should return stripe_checkout_url
curl -s -X POST "$VENUE/public/clubs/$SLUG/applications" \
  -H "Content-Type: application/json" \
  -d '{
    "tier_id": '"$TIER"',
    "full_name": "Test Applicant",
    "dob": "1990-01-01",
    "email": "test@example.com",
    "mobile": "+64211234567",
    "address": {"street":"1 Test","suburb":"Wellington","postcode":"6011"},
    "emergency_contact": {"name":"Someone","phone":"+64211111111"},
    "consent": {"terms":true}
  }' | jq '.data | { application_id, payment_status, stripe_checkout_url }'

# 3. Opening stripe_checkout_url in a browser presents Stripe's hosted
#    Checkout, pay with test card 4242 4242 4242 4242.

# 4. After payment, the applications row should flip:
curl -s "$VENUE/clubs/$CLUB/applications/42" -H "Authorization: Bearer $TOKEN" \
  | jq '.data | { application_id, payment_status, paid_at, paid_amount_cents, stripe_payment_intent_id }'
# → payment_status: "paid", paid_at: <timestamp>, paid_amount_cents matches tier.fee * 100
```

---

## 6. Pass criteria

- ✓ Tiers with `collect_payment_on_join = true` + `fee > 0` return a `stripe_checkout_url` on `POST /applications`.
- ✓ Tiers with `collect_payment_on_join = false` OR `fee <= 0` OR null = no URL, current flow preserved.
- ✓ Clubs without Stripe Connect get `stripe_disconnected` and FE falls back gracefully.
- ✓ `checkout.session.completed` webhook sets `payment_status = 'paid'` + persists session + payment intent ids.
- ✓ Expired / cancelled sessions leave the application row intact at `payment_status = 'pending'`.
- ✓ Webhook is idempotent (replays don't double-write).
- ✓ Committee approval stays manual regardless of payment status.
- ✓ CRM applications detail surfaces payment status + Stripe links.

---

## 7. Non-goals

- **Auto-approve paid applications.** Committee review stays as the gate. Clubs who want pay-first-review-later can approve in batch.
- **Refunds.** Admin handles manually via Stripe dashboard. Future brief adds a `POST /applications/:id/refund` wrapper + `refunded` state transition.
- **Subscription billing on join.** v1 is one-shot payment for the first period's fee. Recurring subs will need a separate brief tied to the tier cadence (annual / monthly / season).
- **Promo codes / first-year discount on Stripe side.** The existing `first_year_discount` flag reduces the displayed price today; v1 applies the same reduction to the Checkout line item amount but doesn't expose Stripe Coupon objects.
- **Multi-currency.** Everyone's NZD today. When `clubs_data.currency` lands we'll key the Checkout currency off it.
- **Saving card for later.** No Stripe Customer object saved; this is a one-off Checkout per application.

---

## 8. Backend action items

Green-light and backend will:

1. Add migration for the two schema changes (tiers + applications).
2. Update `POST /public/clubs/:slug/applications` to:
   - Create the Checkout session when tier opts in + fee > 0 + Stripe is connected.
   - Persist `stripe_checkout_session_id` on the application row + flip `payment_status = 'pending'`.
   - Return `stripe_checkout_url` on the envelope.
3. Add the `checkout.session.completed` handler path keyed off `metadata.torny_source`.
4. Expose `collect_payment_on_join` on the tiers PATCH + response shape.
5. Expose `payment_status` + `stripe_*_id` + `paid_*` fields on the authed applications read.

Rough effort: ~1 day end-to-end including webhook idempotency tests.

---

## 9. Contact

Nev on Slack (`#torny-eng`). Related briefs: 36 (tier CRUD), 94 (permissions), 99 (custom domain — used for success/cancel URLs on `primary_host`), tournaments payment flow (existing `POST /tournaments/.../checkout-session` — same shape, lift the implementation pattern).
