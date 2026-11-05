# Stripe Connect + venue-booking deposit payments

**Feature:** turn venue hire into a paid flow. Clubs connect their Stripe account once via OAuth; after that, the renter pays the deposit at booking time on the club's public website using Stripe Checkout, direct-charged to the club's connected account. Torny's cut rides along as `application_fee_amount`.

**Status:** Stripe Connect onboarding + an admin-triggered Checkout Session (phone-in path) are **shipped** on TornyVenueStack. The **primary public-pay flow** — customer pays at booking time on the club website — is **not yet shipped** and is the main ask of this brief. §4 defines that new endpoint. §5 documents the already-shipped admin path so we don't rebuild it.

**Related briefs:**
- brief 54 — `wrapClubEmail()` helper (booking confirmation + payment-receipt emails use the same wrap).
- brief 62 — venue-bookings resource + admin flow (the booking record this attaches payments to).
- brief 63 — venue booking on the block allowlist (the public booking form that will call §4).
- Pricing model doc (`docs/pricing-model.md`).

---

## TL;DR — the target architecture

1. **Club connects Stripe once via OAuth.** `POST /clubs/{id}/stripe/connect-start` → Stripe-hosted OAuth → `GET /stripe/connect/callback` → `clubs_data.stripe_account_id` populated. **Shipped.**
2. **Status + disconnect endpoints.** `GET /clubs/{id}/stripe/status` + `POST /clubs/{id}/stripe/disconnect`. **Shipped.**
3. **🆕 Public renter pays at booking time.** `POST /public/clubs/{slug}/venue-bookings/checkout` — creates a `venue_bookings` row (`status='pending_payment'`, `payment_status='unpaid'`) AND a Stripe Checkout Session on the club's connected account (direct charge, `application_fee_amount` for Torny) in one call. Returns `checkout_url`. The public block redirects the renter straight to Stripe-hosted Checkout. **NOT SHIPPED — this brief's main ask.**
4. **Admin-triggered Checkout (phone-in bookings).** `POST /clubs/{id}/venue-bookings/{id}/confirm` mints a Checkout Session the same way, admin forwards the URL to the renter. **Shipped.** This stays as a secondary path for bookings taken by phone / WhatsApp / at the clubroom bar.
5. **Webhook flips state.** `checkout.session.completed` + `payment_intent.succeeded` → `payment_status='deposit_paid'`, `status='confirmed'`, `deposit_paid_at` stamped. **Shipped** (handler is shared — public and admin-mint produce the same event shape).
6. **Refund endpoint.** `POST /clubs/{id}/venue-bookings/{id}/refund`. **Shipped** (currently hardcodes full refund + `refund_application_fee: true`; see §10).
7. **Deposit % and platform fee % are per-club.** `club_venue_settings.deposit_percent` (default 15) + `platform_fee_percent` (default 5). Admin tunable.

---

## Base URL — Venue API (TornyVenueStack)

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin JWT on `club_members` for every `/clubs/{cid}/stripe/*` and `/clubs/{cid}/venue-bookings/*` endpoint. Public booking submit + public checkout + webhook are unauthenticated.

---

## 1. `POST /clubs/{club_id}/stripe/connect-start` — OAuth onboarding `[SHIPPED]`

Admin-or-owner. Builds a Stripe Connect OAuth authorize URL. The admin's browser redirects to it; Stripe handles sign-up/login/KYC; Stripe redirects back to `GET /stripe/connect/callback`.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "authorize_url": "https://connect.stripe.com/oauth/authorize?response_type=code&client_id=ca_…&scope=read_write&state=…&redirect_uri=…",
    "already_connected": false,
    "current_status": "none"
  }
}
```

### Errors

| HTTP | code             | meaning                                                   |
|------|------------------|-----------------------------------------------------------|
| 400  | `not_configured` | `STRIPE_CONNECT_CLIENT_ID` env var missing on the Lambda  |
| 403  | `forbidden`      | caller is not admin or owner                              |
| 404  | `not_found`      | `club_id` doesn't exist                                   |

### OAuth callback — not a FE concern

`GET /stripe/connect/callback` (called by Stripe) exchanges the code for `stripe_user_id`, stores it on `clubs_data.stripe_account_id`, sets `stripe_account_status='onboarding'` or `ready`, stamps `stripe_connected_at`, then 302-redirects to `{CRM_URL}/crm/settings/stripe/callback?result=success` (or `?result=error&reason=…`).

**FE job:** host `/crm/settings/stripe/callback` as a thin landing page that reads `?result` and re-polls `getStatus()`.

---

## 2. `GET /clubs/{club_id}/stripe/status` — current Connect state `[SHIPPED]`

Committee-or-above. Live-checks Stripe (non-fatal; falls back to DB cache).

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "connected": true,
    "stripe_account_id_masked": "acct_1A2B3C…XY4Z",
    "status": "ready",
    "connected_at": "2026-10-30T04:12:00.000Z",
    "requirements_due": []
  }
}
```

### `status` enum

| value | meaning |
|---|---|
| `none` | never connected — treat as "not connected" |
| `onboarding` | account exists but KYC incomplete; `requirements_due` lists what Stripe wants |
| `ready` | `charges_enabled && payouts_enabled && requirements.currently_due.length === 0` — the one "can accept bookings" boolean |
| `restricted` | Stripe disabled the account — contact Stripe |

### Errors

| HTTP | code         | meaning                        |
|------|--------------|--------------------------------|
| 403  | `forbidden`  | caller below committee role    |
| 404  | `not_found`  | club_id doesn't exist          |

---

## 3. `POST /clubs/{club_id}/stripe/disconnect` — revoke platform access `[SHIPPED]`

Owner-only. Calls `stripe.oauth.deauthorize()`, nulls `stripe_account_id` / `stripe_connected_at`, sets status=`none`.

### 200 response

```jsonc
{ "status": "success", "data": { "disconnected": true } }
```

Or if already disconnected:

```jsonc
{ "status": "success", "data": { "disconnected": false, "reason": "not_connected" } }
```

### Errors

| HTTP | code         | meaning                     |
|------|--------------|-----------------------------|
| 403  | `forbidden`  | caller is not owner         |
| 404  | `not_found`  | club_id doesn't exist       |

---

## 4. `POST /public/clubs/{slug}/venue-bookings/checkout` — public renter pays `[🆕 NOT SHIPPED]`

**This is the main ask of the brief.** Public, no auth. The renter has filled the booking form on the club's website; this endpoint creates the booking record AND the Stripe Checkout Session in one call, then the public block redirects the renter to Stripe-hosted Checkout.

### Request

Same shape as the existing `POST /public/clubs/{slug}/venue-bookings` submit (brief 62) with the addition that this endpoint always mints a Checkout Session.

```jsonc
{
  "package_id":    42,
  "slot_id":       17,
  "booking_date":  "2026-12-14",
  "setup_style":   "Long tables + bar",
  "guest_count":   40,
  "occasion":      "Corporate day",
  "addons": [
    { "addon_id": 7,  "quantity": 6 },
    { "addon_id": 12, "quantity": 30 }
  ],
  "contact": {
    "name":        "Grace Whittaker",
    "email":       "grace@example.co.nz",
    "phone":       "+64 21 123 4567",
    "booking_for": "Willis family"
  },
  "notes": "Two guests use wheelchairs. Cake delivery at 5:30."
}
```

### Server behaviour

1. **Pre-flight:**
   - Load the club by slug. If `stripe_account_status !== 'ready'` → 409 `club_not_payment_ready`. Surface the club's contact details in the response body so the FE can show "Sorry — this club can't take online payments yet. Call them on {phone}."
   - Validate package + slot + date + add-ons the same way the existing submit does.
   - Reject slot collisions with confirmed bookings → 409 `slot_unavailable`.
2. **Compute money (all cents):**
   - `total_cents` = slot price + add-on prices (by quantity) + bond.
   - `deposit_cents` = `total_cents * club_venue_settings.deposit_percent / 100` (default 15%).
   - `platform_fee_cents` = `deposit_cents * club_venue_settings.platform_fee_percent / 100` (default 5%).
3. **Write a booking row:**
   ```
   status:                         'pending_payment'
   payment_status:                  'unpaid'
   club_id, package_id, slot_id, booking_date
   contact_name / email / phone / booking_for, notes
   total_cents, deposit_cents
   platform_fee_cents, platform_fee_percent_snapshot
   ```
4. **Create a Stripe Checkout Session on the connected account** (direct charge — `stripeAccount: club.stripe_account_id`):
   ```
   stripe.checkout.sessions.create({
     mode: 'payment',
     currency: 'nzd',
     line_items: [{
       price_data: {
         currency: 'nzd',
         unit_amount: booking.deposit_cents,
         product_data: {
           name: `Deposit — ${package_name}`,
           description: `${booking_ref} · ${booking_date} · ${slot_label}`,
         },
       },
       quantity: 1,
     }],
     payment_intent_data: {
       application_fee_amount: platform_fee_cents,   // Torny's cut
       metadata: { torny_booking_id, torny_booking_ref, torny_club_id, payment_type: 'deposit' },
     },
     metadata: { torny_booking_id, torny_booking_ref, torny_club_id, payment_type: 'deposit' },
     customer_email: booking.contact.email,
     success_url: 'https://{club_site}/venue-hire/complete?booking_ref={ref}&session_id={CHECKOUT_SESSION_ID}&result=success',
     cancel_url:  'https://{club_site}/venue-hire/complete?booking_ref={ref}&result=cancelled',
   }, { stripeAccount: club.stripe_account_id })
   ```
   - `{club_site}` = the club's published site origin (from `clubs_data.site_url` or fallback `https://{slug}.torny.co`).
   - `{CHECKOUT_SESSION_ID}` is Stripe's template placeholder — Stripe fills it in on redirect.
5. **Persist session ids** on the booking row: `stripe_checkout_session_id`, `stripe_payment_intent_id`.
6. **Return** booking ref + checkout URL + fee breakdown so the public block can render a summary before redirecting.
7. **No email fired here.** The booking confirmation email fires from the `checkout.session.completed` webhook once payment lands.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "booking_ref":           "NB-0128",
    "venue_booking_id":      128,
    "total_cents":           29000,
    "deposit_cents":         4350,
    "platform_fee_cents":    218,
    "club_receives_cents":   4132,
    "currency":              "nzd",
    "checkout_url":          "https://checkout.stripe.com/c/pay/cs_test_…",
    "checkout_session_id":   "cs_test_…"
  }
}
```

The FE immediately does `window.location.href = checkout_url` — no modal, no custom card form. Stripe-hosted Checkout handles PCI scope.

### Errors

| HTTP | code                           | meaning                                                                                 |
|------|--------------------------------|-----------------------------------------------------------------------------------------|
| 400  | `missing_contact`              | contact.email absent                                                                    |
| 400  | `bad_value`                    | total_cents computed to <= 0 or a line item is negative                                 |
| 400  | `unknown_package` / `unknown_slot` / `unknown_addon` | id doesn't belong to this club / package                              |
| 400  | `bad_date`                     | date in the past or outside the slot's lead-time                                        |
| 409  | `slot_unavailable`             | overlap with a confirmed booking                                                        |
| 409  | `club_not_payment_ready`       | `stripe_account_status !== 'ready'`. Response body includes `club_contact` so FE can show a helpful fallback. |
| 502  | `stripe_checkout_create_failed`| Stripe rejected the session create (Stripe message in `message`)                        |

### `club_not_payment_ready` response shape

Rather than a bare 409, return the normal error envelope + a `data.club_contact` block the FE can use for the fallback message:

```jsonc
{
  "status": "error",
  "code":   "club_not_payment_ready",
  "message": "This club isn't accepting online payments yet.",
  "data": {
    "club_contact": {
      "name":  "Naenae Bowling Club",
      "email": "bookings@naenaebowls.co.nz",
      "phone": "+64 4 567 8900"
    }
  }
}
```

### Success-URL landing page

Stripe redirects the renter to `{club_site}/venue-hire/complete?booking_ref=…&session_id=…&result=success`. The public club site should host this page and:
- GET `/public/clubs/{slug}/venue-bookings/by-ref/{booking_ref}` (existing endpoint — brief 62) to re-fetch the booking.
- If `payment_status='deposit_paid'` already → render the confirmation screen immediately.
- If still `unpaid` → poll for ~15s (webhook race) then show "We're waiting for Stripe to confirm — we'll email you the moment it lands."
- `result=cancelled` → render "You stepped away — your slot is held for 15 minutes" with a re-pay CTA that re-calls `/checkout`.

---

## 5. `POST /clubs/{club_id}/venue-bookings/{booking_id}/confirm` — admin-triggered Checkout `[SHIPPED]`

**Secondary path.** For phone-in / walk-in bookings where the admin takes the booking out-of-band and wants to text the renter a pay link. The booking exists as `status='pending'` (admin created it manually, or the public submit from §4 fell through); this endpoint flips it to `confirmed` and mints the same Checkout Session shape as §4.

Admin+. Flow is the shipped one — not rebuilt.

### Server behaviour

1. Load booking. Reject if not `status='pending'` → 409.
2. If club is Stripe-ready, mint the Checkout Session the same way §4 does (same `line_items`, same `application_fee_amount`, same metadata, same `stripeAccount: club.stripe_account_id`).
3. Write `stripe_checkout_session_id` + `stripe_payment_intent_id` + `platform_fee_cents` + `platform_fee_percent_snapshot` onto the row.
4. Flip `status='confirmed'`, stamp `confirmed_at`/`confirmed_by_user_id`.
5. Fire the `venue_booking_confirmed` email (includes the Checkout URL).

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "id": 128,
    "club_id": 5,
    "booking_ref": "NB-0128",
    "status": "confirmed",
    "payment_status": "unpaid",
    "deposit_cents": 6000,
    "platform_fee_percent_snapshot": 5,
    "platform_fee_cents": 300,
    "stripe_payment_intent_id": "pi_3O…",
    "stripe_checkout_session_id": "cs_test_…",
    "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_…",
    "confirmed_at": "2026-11-06T22:14:00.000Z"
  }
}
```

### Errors

| HTTP | code                           | meaning                                                         |
|------|--------------------------------|-----------------------------------------------------------------|
| 409  | `bad_status`                   | booking isn't `pending`                                         |
| 502  | `stripe_checkout_create_failed`| Stripe rejected the session create                              |
| 403  | `forbidden`                    | caller below admin                                              |
| 404  | `not_found`                    | booking id doesn't match this club                              |

### If the club isn't Stripe-ready

Confirm still flips to `confirmed` but omits `checkout_url` + `stripe_*` fields — the booking becomes "offline paid" and the admin collects payment out-of-band.

---

## 6. `POST /stripe/webhook` and `POST /stripe/webhook/connected` — webhook receivers `[SHIPPED — covers §4 for free]`

Two endpoints, two signing secrets (`STRIPE_WEBHOOK_SECRET` for platform, `STRIPE_CONNECTED_WEBHOOK_SECRET` for connected). Signature-verified via `webhooks.constructEvent()`.

The same handler serves both §4 (public) and §5 (admin) because both mint Checkout Sessions on the same connected account with the same metadata shape. No new webhook code needed to light up §4.

### Event coverage

| event.type                       | scope         | behaviour                                                                                       |
|----------------------------------|---------------|-------------------------------------------------------------------------------------------------|
| `account.updated`                | platform      | Refreshes `clubs_data.stripe_account_status`.                                                   |
| `account.application.deauthorized` | platform    | Clears `stripe_account_id`, sets status=`none`.                                                 |
| `checkout.session.completed`     | connected     | Flips `payment_status='deposit_paid'`, flips `status` → `confirmed` if it was `pending_payment` (§4 path), stamps `deposit_paid_at`, stores `stripe_payment_intent_id`. Fires `venue_booking_paid` email to renter + `new_paid_booking` notification to club. |
| `payment_intent.succeeded`       | connected     | Defensive backup to `checkout.session.completed` — same state flip. Routes by metadata.         |
| `payment_intent.payment_failed`  | connected     | **Log-only today.** No DB write, no `payment_failure_reason` persisted. Gap — see §10.          |
| `charge.refunded`                | connected     | Flips `payment_status='refunded'` (full) or `partially_refunded` (partial). Stamps `refunded_at`, stores `stripe_refund_id`. |

**Small change required for §4:** the `checkout.session.completed` handler currently only flips `payment_status`. For §4 bookings (`status='pending_payment'`), it must also flip `status='confirmed'`. One-line conditional — see §13 verification.

Idempotency: **not implemented today.** No `stripe_events` ledger table. The §4 public path makes this slightly more urgent — a double-fired `checkout.session.completed` currently flips a `pending_payment` to `confirmed` + `deposit_paid`, then does it again (idempotent in effect). But a double-fired `charge.refunded` is less safe. See §10.

---

## 7. `POST /clubs/{club_id}/venue-bookings/{booking_id}/refund` — refund the deposit `[SHIPPED]`

Admin+. Only valid when `status='confirmed'` AND `payment_status='deposit_paid'` AND the booking has a `stripe_payment_intent_id`.

### Request body

Currently empty / ignored. Hardcoded:
- `refund_application_fee: true`
- `reverse_transfer: false` (direct charges have no transfer to reverse)
- Full refund only

### Server behaviour

1. Load booking + club, validate state.
2. `stripe.refunds.create({ payment_intent, refund_application_fee: true, reverse_transfer: false, metadata: { torny_booking_id, torny_booking_ref } }, { stripeAccount: club.stripe_account_id })`.
3. Write `stripe_refund_id` onto the booking.
4. Return refreshed booking row.

### 200 response

Full booking row (same shape as `GET /clubs/{id}/venue-bookings/{id}`) with `stripe_refund_id` set. `payment_status` flips to `refunded` once `charge.refunded` lands (seconds later).

### Errors

| HTTP | code                   | meaning                                                            |
|------|------------------------|--------------------------------------------------------------------|
| 400  | `no_payment_intent`    | booking has no Stripe payment to refund                            |
| 400  | `not_connected`        | club no longer has a `stripe_account_id` (post-disconnect refund)  |
| 409  | `bad_payment_status`   | `payment_status` isn't `deposit_paid`                              |
| 502  | `stripe_refund_failed` | Stripe rejected the refund                                         |
| 403  | `forbidden`            | caller below admin                                                 |
| 404  | `not_found`            | booking id doesn't match this club                                 |

---

## 8. Schema — what's in the DB today + what §4 needs

### `clubs_data` (migration 135) `[SHIPPED]`

| Column | Type | Notes |
|---|---|---|
| `stripe_account_id` | `VARCHAR(128) NULL` | Stripe `acct_…` id |
| `stripe_account_status` | `ENUM('none','onboarding','ready','restricted')` | Derived; updated by connect-callback, getStatus live-check, `account.updated` webhook |
| `stripe_connected_at` | `TIMESTAMP NULL` | When first non-null `stripe_account_id` stored |

### `venue_bookings` (migrations 134 + 136 + 🆕 `status` enum extension)

| Column | Type | Purpose | Status |
|---|---|---|---|
| `total_cents` | INT | Full booking value | shipped |
| `deposit_cents` | INT | Deposit amount | shipped |
| `platform_fee_cents` | INT NULL | Torny's cut (snapshot at session mint) | shipped |
| `platform_fee_percent_snapshot` | DECIMAL NULL | % used at mint | shipped |
| `stripe_payment_intent_id` | VARCHAR(64) NULL | Set at session mint or by webhook | shipped |
| `stripe_checkout_session_id` | VARCHAR(64) NULL | Set at session mint | shipped |
| `stripe_refund_id` | VARCHAR(64) NULL | Set by refund endpoint | shipped |
| `deposit_paid_at` | TIMESTAMP NULL | Set by webhook | shipped |
| `refunded_at` | TIMESTAMP NULL | Set by `charge.refunded` | shipped |
| `payment_status` | ENUM | `unpaid` / `deposit_paid` / `refunded` / `partially_refunded` | shipped |
| `status` | ENUM | `pending` / `confirmed` / `declined` / `cancelled` / `completed` / `🆕 pending_payment` | **needs enum value added** |

### 🆕 `status` enum extension

```sql
-- Add 'pending_payment' for §4-created bookings between POST /checkout and webhook landing.
ALTER TABLE venue_bookings
  MODIFY COLUMN status ENUM('pending','pending_payment','confirmed','declined','cancelled','completed') NOT NULL;
```

Lifecycle:
- §4 public checkout: writes `pending_payment`. Webhook `checkout.session.completed` flips to `confirmed`.
- §5 admin confirm: writes `confirmed` directly (admin has pre-approved; payment lands later).

### `club_venue_settings` (migrations 134 + 136) `[SHIPPED]`

| Column | Default | Purpose |
|---|---|---|
| `deposit_percent` | 15 | Deposit % charged on booking submit |
| `platform_fee_percent` | 5 | Torny's cut of the deposit |

### Tables that DO NOT exist (see §10)

- `venue_booking_refunds` audit table
- `stripe_events` idempotency ledger

---

## 9. Frontend contract summary

### api-client resource `packages/api-client/src/resources/stripe.ts`

```ts
export type StripeStatus = 'none' | 'onboarding' | 'ready' | 'restricted'

export interface ConnectStartResult {
  authorize_url: string
  already_connected: boolean
  current_status: StripeStatus
}

export interface ConnectStatus {
  connected: boolean
  stripe_account_id_masked: string | null
  status: StripeStatus
  connected_at: string | null
  requirements_due: string[]
}

export const stripe = {
  connectStart(clubId: number): Promise<ConnectStartResult>,
  getStatus(clubId: number): Promise<ConnectStatus>,
  disconnect(clubId: number): Promise<{ disconnected: boolean; reason?: string }>,
}
```

### 🆕 Public checkout on the existing `venueBookings` resource

Extend `packages/api-client/src/resources/venueBookings.ts`:

```ts
export interface PublicCheckoutResult {
  booking_ref: string
  venue_booking_id: number
  total_cents: number
  deposit_cents: number
  platform_fee_cents: number
  club_receives_cents: number
  currency: 'nzd' | string
  checkout_url: string
  checkout_session_id: string
}

export interface ClubNotPaymentReadyData {
  club_contact: {
    name: string
    email: string
    phone: string | null
  }
}

export const venueBookings = {
  // …existing…
  publicCheckout(slug: string, input: VenueBookingInput): Promise<PublicCheckoutResult>,
}
```

### FE surface that lights up

- **Settings → Payments (CRM):** status chip (`none` → "Connect Stripe" CTA; `onboarding` → amber + `requirements_due` punch-list; `ready` → green; `restricted` → red). Click → `connectStart()` → redirect. Host `/crm/settings/stripe/callback` for the return.
- **Settings → Venue → Payments (CRM):** deposit% + platform fee% inputs via `PATCH /clubs/{id}/venue-settings`.
- **🆕 Public booking block (`VenueBookingBlock.vue`):**
  - On step-2 submit, call `venueBookings.publicCheckout(slug, input)`.
  - Render a brief "Taking you to Stripe…" state showing the fee breakdown (`deposit_cents` + where the money goes).
  - `window.location.href = result.checkout_url`.
  - On `club_not_payment_ready` 409: render the fallback with the club's contact details from `club_contact`.
  - **Delete the fake "DEPOSIT PAID" confirmation screen** — real confirmation is the `/venue-hire/complete` page (see below).
- **🆕 Public `/venue-hire/complete` page:** reads `?booking_ref` + `?session_id` + `?result`. On `result=success`, re-fetches the booking by ref and renders confirmation. On `result=cancelled`, offers a retry CTA.
- **CRM venue-booking detail:** payment card showing `deposit_cents`, `platform_fee_cents`, `payment_status`, "Copy Checkout URL" (admin path) when still unpaid, "Refund deposit" when `payment_status='deposit_paid'`.
- **CRM venue-bookings list:** `payment_status` filter chips.

---

## 10. Known gaps — real work still to do

These are real product debt. §4 is the headline add; everything else can land after.

0. **🆕 No public checkout endpoint.** This brief's main ask. See §4.
1. **`status='pending_payment'` enum value needs adding** — §8.
2. **`checkout.session.completed` handler needs one-line change** to flip `status` → `confirmed` for §4 bookings — §6.
3. **No idempotency ledger.** `stripe_events` table doesn't exist. Add before §4 ships to real traffic.
4. **`payment_intent.payment_failed` is log-only.** Need the column + handler + "try again" email that re-mints a Checkout Session.
5. **`payment_intent.canceled` not handled.** Add the case.
6. **No Stripe dashboard login-link endpoint.** Admins use Stripe's own login flow.
7. **Refund endpoint takes no body params.** Hardcodes full + `refund_application_fee: true`. Accept `{ amount?, refund_application_fee?, reason? }`.
8. **No `venue_booking_refunds` audit table.** Multiple refunds collapse to one `stripe_refund_id`.
9. **No raw booleans on status.** Only the rolled-up enum.

**Ship order for §4:** enum extension (gap 1) → `checkout.session.completed` handler update (gap 2) → `POST /public/.../checkout` handler + idempotency ledger (gaps 0 + 3) → FE block + `/venue-hire/complete` page.

---

## 11. Verification — curl against the deployed stack

Using Nigel's JWT, against the live TornyVenueStack:

```bash
API="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"

# ─── Shipped (sanity-check) ──────────────────────────────────────────

# 1. Connect-start.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/stripe/connect-start"

# 2. Status.
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/stripe/status"

# 3. Admin-confirm path mints a Checkout Session.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/128/confirm"
# → 200, checkout_url + stripe_* fields.

# ─── NEW (§4) ────────────────────────────────────────────────────────

# 4. Public checkout — no auth header.
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/naenae-bowls/venue-bookings/checkout" \
  -d '{
    "package_id": 42,
    "slot_id": 17,
    "booking_date": "2026-12-14",
    "setup_style": "Long tables + bar",
    "guest_count": 40,
    "occasion": "Corporate day",
    "addons": [{"addon_id": 7, "quantity": 6}],
    "contact": {"name":"Grace","email":"grace@example.co.nz","phone":"+64211234567"}
  }'
# → 200, booking_ref + checkout_url + deposit_cents + platform_fee_cents.

# 5. Pay the returned checkout_url with Stripe test card 4242 4242 4242 4242.
#    Stripe redirects back to {club_site}/venue-hire/complete?...&result=success.
#    Webhook checkout.session.completed fires.

# 6. Verify the booking flipped.
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/{id}"
# → status: 'confirmed', payment_status: 'deposit_paid', deposit_paid_at populated.

# 7. Unconnected club → 409 with club_contact body.
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/unconnected-club/venue-bookings/checkout" -d '…'
# → 409 { code: 'club_not_payment_ready', data: { club_contact: {…} } }

# 8. Slot collision → 409.
# Submit twice with the same date+slot before the first pays.
# → second call returns 409 slot_unavailable.

# ─── Shipped — refund (sanity-check) ─────────────────────────────────

# 9. Refund.
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/{id}/refund"
# → 200 with stripe_refund_id. charge.refunded webhook flips payment_status → 'refunded'.
```

Pass criteria:
- ✓ Onboarding URL opens Stripe Connect OAuth and returns to `/crm/settings/stripe/callback`.
- ✓ Status reflects Stripe-side state within one API call (live-check).
- ✓ **§4** Public checkout creates a `pending_payment` booking + Checkout Session in one call.
- ✓ **§4** Paying the Checkout URL flips booking to `status='confirmed'` + `payment_status='deposit_paid'`.
- ✓ **§4** `application_fee_amount` lands on the platform account; the rest lands on the club's connected account.
- ✓ **§4** Unconnected / KYC-incomplete clubs 409 with `club_not_payment_ready` + a usable contact block.
- ✓ **§4** Idempotent — replaying the same `checkout.session.completed` event doesn't double-send email or double-flip state.
- ✓ **§5** Admin confirm still works for phone-in bookings.
- ✓ Refund claws back both club-side and platform-side portions.

---

## 12. Non-goals (v1)

- **No AccountLink / Express onboarding.** Standard OAuth only.
- **No embedded Stripe Elements on the public block.** Stripe-hosted Checkout only (keeps PCI scope off us; Stripe handles 3DS + Apple Pay + Google Pay out of the box).
- **No balance collection.** Only the deposit flows through Torny. The remaining balance is between club and renter.
- **No multi-currency.** NZD only.
- **No disputes handling in CRM UI.** Stripe emails the club directly.
- **No payouts dashboard in CRM.** Admins go direct to Stripe.
- **No reconciliation report.** Stripe's own reporting is source of truth.
- **No slot-hold while the renter is at Stripe Checkout.** If two renters click "Pay deposit" for the same slot within a minute, both land at Stripe; the second webhook to arrive loses — booking flips to `cancelled`, we refund. Low-probability edge case; a proper hold-lock is a follow-up.

---

## 13. Contact

Ship order recommendation:
1. **Gap 1 + 2** (status enum + webhook handler tweak) — 1 PR, backward-compatible.
2. **§4 public checkout endpoint + idempotency ledger** — 1 PR.
3. **FE block rewrite + `/venue-hire/complete` page** — 1 PR, lands after §4 is live.
4. **CRM Settings → Payments UI + CRM booking payment card** — parallel track, can land any time after §1–3 are live.
5. **Known-gaps backlog (§10 items 4–9)** — follow-ups, not blockers.

Ping Felicity once §4 is deployed to staging so the FE can wire the block.
