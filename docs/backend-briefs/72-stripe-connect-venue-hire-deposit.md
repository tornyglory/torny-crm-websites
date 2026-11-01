# Stripe Connect onboarding + venue-hire deposit checkout

**Feature:** turn venue hire into a real revenue stream for Torny. Clubs connect their Stripe account once; after that, every public venue-hire booking charges a 15% deposit at checkout, split 7% to Torny + 8% to the club via Stripe Connect `application_fee_amount`. This is the first of three Stripe-powered flows (venue hire now; tournament entries next in brief 73; member subscription billing for Torny itself later).

**Status:** backend not started. FE will build the Settings → Payments connect-flow UI + the public booking checkout against this brief's shape — the booking skeleton (`venue_bookings`) + the FE booking form already exist from brief 62/63; this brief wires the money.

**Related briefs:**
- brief 54 — `wrapClubEmail()` helper (receipts + confirmation emails use the same wrap).
- brief 62 — venue-bookings resource + admin flow (existing booking record is what we attach payment to).
- brief 63 — venue booking on the block allowlist (the public booking form that triggers checkout).
- Pricing model doc (`docs/pricing-model.md`) — the decisions this brief implements.

---

## TL;DR

1. **`POST /clubs/{cid}/stripe-connect/onboard`** — mints a Stripe AccountLink and returns the hosted-onboarding URL. Admin follows it, finishes Stripe KYC, Stripe redirects back to the CRM.
2. **`GET /clubs/{cid}/stripe-connect/status`** — returns the current connect state: `account_id`, `charges_enabled`, `payouts_enabled`, `details_submitted`. The CRM polls this when the admin returns from Stripe to show a green "ready to accept bookings" state.
3. **`POST /clubs/{cid}/stripe-connect/dashboard`** — mints a short-lived AccountLink to Stripe's hosted dashboard so admins can view their payouts without a separate Stripe login UI on our side.
4. **`POST /public/clubs/{slug}/venue-bookings/checkout`** — creates a `venue_bookings` row (status `pending_payment`) + a Stripe PaymentIntent with `application_fee_amount` and `transfer_data.destination` set to the club's connected account. Returns a `client_secret` for Stripe.js to confirm card-side.
5. **`POST /webhooks/stripe/connect`** — handles `payment_intent.succeeded` (flip booking → `confirmed`), `payment_intent.payment_failed`, `account.updated` (keep connect-status cache fresh), `charge.refunded` (write a refund audit row).
6. **`POST /clubs/{cid}/venue-bookings/{id}/refund`** — refund the deposit. Admin picks whether to refund the Torny service fee too (standard: yes when the club cancels, no when the renter cancels).

Everything else about a venue booking (modal state, calendar display, confirmation email) stays unchanged — this brief only adds the money layer.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin JWT on `club_members` for all `/clubs/{cid}/stripe-connect/*` + refund endpoints. The public checkout is public (no auth — the renter is a stranger). The webhook endpoint is public but signature-verified.

---

## 1. `POST /clubs/{cid}/stripe-connect/onboard` — start / resume onboarding

### Behaviour

1. If the club has no `stripe_account_id` yet, call Stripe's **Accounts** API to create a new **Standard** connected account:
   ```
   type: 'standard'
   country: 'NZ'                        // from clubs_data.country, fallback 'NZ'
   email:   <owner's email>
   business_profile.name: <club.name>
   business_profile.url:  https://<club.slug>.torny.co
   metadata.torny_club_id: <club.id>
   ```
   Store the returned `account_id` on `clubs.stripe_account_id`.

2. Create a Stripe **AccountLink** (`type: 'account_onboarding'`) with:
   ```
   account:      <stripe_account_id>
   refresh_url:  https://<app>/crm/settings/payments?connect=refresh
   return_url:   https://<app>/crm/settings/payments?connect=complete
   type:         'account_onboarding'
   ```
   AccountLinks expire ~5 minutes after creation — the admin needs to click promptly.

3. Return the `url` so the CRM can `window.location = url` to Stripe-hosted onboarding.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "url":        "https://connect.stripe.com/setup/s/acct_1A2B3C/…",
    "account_id": "acct_1A2B3C",
    "expires_at": "2026-11-01T05:12:00.000Z"
  }
}
```

### Errors

| HTTP | code                 | meaning                                                        |
|------|----------------------|----------------------------------------------------------------|
| 400  | `country_unsupported`| club country isn't on Stripe Connect's supported list          |
| 500  | `stripe_error`       | Stripe API returned an error — body carries the Stripe message |
| 403  | `forbidden`          | caller not owner/admin                                         |

---

## 2. `GET /clubs/{cid}/stripe-connect/status` — current state

### Behaviour

Fetch the connected Stripe account via `Accounts.retrieve()` and return a trimmed view of what the CRM needs. Cache for ~60s to avoid Stripe API rate limits.

### 200 response (connected + ready)

```jsonc
{
  "status": "success",
  "data": {
    "account_id":        "acct_1A2B3C",
    "charges_enabled":   true,
    "payouts_enabled":   true,
    "details_submitted": true,
    "requirements": {
      "currently_due":   [],
      "eventually_due":  [],
      "past_due":        [],
      "disabled_reason": null
    },
    "country":  "NZ",
    "default_currency": "nzd",
    "connected_at": "2026-10-30T04:12:00.000Z"
  }
}
```

### 200 response (never connected)

```jsonc
{
  "status": "success",
  "data": {
    "account_id":        null,
    "charges_enabled":   false,
    "payouts_enabled":   false,
    "details_submitted": false,
    "requirements": null,
    "country":  null,
    "default_currency": null,
    "connected_at": null
  }
}
```

### 200 response (connected but KYC incomplete)

```jsonc
{
  "status": "success",
  "data": {
    "account_id":        "acct_1A2B3C",
    "charges_enabled":   false,
    "payouts_enabled":   false,
    "details_submitted": false,
    "requirements": {
      "currently_due":   ["external_account", "individual.verification.document"],
      "eventually_due":  [],
      "past_due":        [],
      "disabled_reason": null
    },
    "country":  "NZ",
    "default_currency": "nzd",
    "connected_at": null
  }
}
```

The CRM uses `charges_enabled && payouts_enabled` as the single boolean for "venue hire checkout can go live." Everything else is informational — surface `requirements.currently_due` as a friendly "Still need to add: bank account, ID document" list.

---

## 3. `POST /clubs/{cid}/stripe-connect/dashboard` — hosted dashboard link

### Behaviour

Mint a Stripe **Login Link** (`AccountLinks.create` with `type: 'account_update'`, or if the admin wants read-only payouts, `Dashboard.LoginLinks.create`). Return the URL. Admin clicks it, lands in Stripe's hosted dashboard, closes the tab, done.

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "url": "https://connect.stripe.com/express/…",
    "expires_at": "2026-11-01T05:12:00.000Z"
  }
}
```

### Errors

| HTTP | code                | meaning                                 |
|------|---------------------|-----------------------------------------|
| 400  | `not_connected`     | club has no `stripe_account_id`         |
| 500  | `stripe_error`      | Stripe API error                        |

---

## 4. `POST /public/clubs/{slug}/venue-bookings/checkout` — the money bit

Create a booking + PaymentIntent in a single call. **Public** — the renter is a stranger, not signed in.

### Request

```jsonc
{
  "venue_booking": {
    "space":         "hall",                              // from club.venues.spaces[]
    "start":         "2026-12-14T10:00:00+13:00",         // RFC3339 w/ tz
    "end":           "2026-12-14T16:00:00+13:00",
    "booking_value": 400.00,                              // NZD; full value, not deposit
    "contact": {
      "name":  "Grace Whittaker",
      "email": "grace@example.co.nz",
      "phone": "+64 21 123 4567"
    },
    "notes": "60th birthday, catered"
  }
}
```

### Behaviour

1. Validate the slot (`space` is a known venue, no overlap with an existing confirmed booking).
2. Compute amounts (all in cents):
   - `deposit_amount` = 15% of `booking_value` → **6000c** on a $400 booking
   - `application_fee` = 7% of `booking_value` → **2800c**
   - Club receives on payout: `deposit_amount - application_fee - stripe_fee` → 6000c - 2800c - (~2.9% + 30c Stripe) ≈ **3086c** (~$30.86)
3. Insert a `venue_bookings` row:
   ```
   status:          'pending_payment'
   venue_space:     'hall'
   start_at / end_at
   booking_value_cents:   40000
   deposit_amount_cents:  6000
   application_fee_cents: 2800
   contact_name / email / phone, notes
   ```
4. Create a Stripe PaymentIntent on the **platform** account (not the connected account) with `transfer_data`:
   ```
   amount:                 6000                      // cents
   currency:               'nzd'
   application_fee_amount: 2800
   transfer_data:          { destination: '<club.stripe_account_id>' }
   on_behalf_of:           '<club.stripe_account_id>' // Stripe tax + payout jurisdiction
   automatic_payment_methods: { enabled: true }
   metadata: {
     torny_booking_id:  <venue_booking_id>
     torny_club_id:     <club_id>
     torny_object_type: 'venue_booking_deposit'
   }
   receipt_email:          <contact.email>
   statement_descriptor_suffix: 'VENUE'              // appears on card statement
   ```
5. Store `stripe_payment_intent_id` on the booking row.
6. Return the booking id + the PaymentIntent `client_secret` so the FE can confirm with Stripe.js:

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "venue_booking_id": 128,
    "deposit_amount":   60.00,
    "application_fee":  28.00,
    "club_receives":    32.00,
    "currency":         "nzd",
    "client_secret":    "pi_3O…_secret_X",
    "publishable_key":  "pk_live_…"
  }
}
```

Why `publishable_key` is in the response: lets the FE initialise Stripe.js without a build-time env var for every environment, and lets us flip test/live keys server-side.

### Errors

| HTTP | code                     | meaning                                                       |
|------|--------------------------|---------------------------------------------------------------|
| 400  | `slot_unavailable`       | overlap with an existing confirmed booking                    |
| 400  | `unknown_space`          | `space` not in `club.venues.spaces[]`                         |
| 400  | `bad_times`              | start >= end, or outside the venue's opening hours            |
| 400  | `bad_value`              | booking_value <= 0 or non-numeric                             |
| 400  | `missing_contact`        | contact.email missing                                         |
| 409  | `club_not_payment_ready` | club's `charges_enabled` is false — reject with clear message |
| 500  | `stripe_error`           | PaymentIntent create failed                                   |

The `club_not_payment_ready` case is the big one — surface a renter-friendly *"This club isn't accepting online bookings yet — please contact them directly"* with the club's email + phone from the public site data.

---

## 5. `POST /webhooks/stripe/connect` — event ingestion

### Behaviour

1. Verify the Stripe signature header (`Stripe-Signature`) against the connect webhook secret.
2. Idempotency: check `stripe_events.event_id` first — if we've seen this `evt_…` id, 200 immediately.
3. Switch on `event.type`:

   | event.type                   | action                                                                                      |
   |------------------------------|---------------------------------------------------------------------------------------------|
   | `payment_intent.succeeded`   | Find the booking by `metadata.torny_booking_id`, flip `status: 'confirmed'`, set `deposit_paid_at`, `stripe_charge_id`. Fire the booking confirmation email to the renter + a notification to the club admin. |
   | `payment_intent.payment_failed` | Flip booking to `payment_failed`, store `payment_failure_reason`, email the renter a "try again" link that re-opens the modal pre-filled. |
   | `payment_intent.canceled`    | Flip booking to `cancelled`, free the slot.                                                 |
   | `charge.refunded`            | Insert `venue_booking_refunds` audit row with amount + whether the application fee was refunded. |
   | `account.updated`            | Refresh `clubs.stripe_connect_status_cache` so the Settings UI reflects KYC state within ~1 webhook of change. |
   | `account.application.deauthorized` | Clear `clubs.stripe_account_id` + related flags. Admin will have to re-connect. |

4. Return 200 regardless of whether the matching record exists (Stripe retries on non-2xx; we don't want to retry a payment for a deleted booking).

### Signature verification

Use Stripe's `webhooks.constructEvent(body, sig, secret)` — pass the raw request body, not a JSON-parsed one. API Gateway + Lambda: use the `body` string + `isBase64Encoded` handling.

---

## 6. `POST /clubs/{cid}/venue-bookings/{id}/refund` — refund the deposit

### Request

```jsonc
{
  "amount":                  60.00,     // optional; default = full charge amount
  "refund_application_fee":  true,      // optional; default = false (renter cancellation)
  "reason":                  "club_cancelled_event"   // optional; free text for the audit trail
}
```

### Behaviour

1. Load the booking. Reject if `status !== 'confirmed'` (nothing to refund) → 409 `not_refundable`.
2. Compute refund amount in cents.
3. Call Stripe `Refunds.create()`:
   ```
   charge:                 <stripe_charge_id>
   amount:                 <amount_cents>              // partial refunds allowed
   refund_application_fee: <true|false>
   reverse_transfer:       true                        // claws back from club's balance
   metadata.torny_reason:  <reason>
   ```
4. On success, append to `venue_booking_refunds` + flip booking `status: 'refunded'` (full refund) or `partial_refund` (partial).
5. The `charge.refunded` webhook then fires separately and does the audit insert — so we race-protect by using the `stripe_events` idempotency check (§5 step 2).

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "refund_id":              "re_1A2B3C",
    "amount":                 60.00,
    "application_fee_refunded": true,
    "booking_status":         "refunded"
  }
}
```

### Errors

| HTTP | code                 | meaning                                       |
|------|----------------------|-----------------------------------------------|
| 404  | `booking_not_found`  | id doesn't belong to this club                |
| 409  | `not_refundable`     | booking status isn't `confirmed`              |
| 400  | `bad_amount`         | amount exceeds the original charge            |
| 500  | `stripe_error`       | Stripe refund API error                       |

### Policy — what we recommend for the CRM UI

- **Club cancels** (e.g. clubroom damaged, event cancelled by committee) → full refund, `refund_application_fee: true`. Torny gives up its 7% because it's not the renter's fault. We eat the Stripe processing fee.
- **Renter cancels** (standard case) → refund the 8% club portion if within the cancellation window, keep the 7% service fee. `refund_application_fee: false`.
- **No-show / renter cancels day-of** → nothing refunded; both sides keep their cut.

The CRM presents these as named presets ("Full refund (we cancelled)", "Standard cancellation", "No refund") rather than making the admin check boxes.

---

## 7. Schema notes (migration 132)

```sql
-- Club-level connect state
ALTER TABLE clubs
  ADD COLUMN stripe_account_id    VARCHAR(64)  NULL,
  ADD COLUMN charges_enabled      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN payouts_enabled      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN details_submitted    BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN connect_connected_at TIMESTAMP    NULL,
  ADD COLUMN connect_country      VARCHAR(2)   NULL,
  ADD COLUMN connect_currency     VARCHAR(3)   NULL,
  ADD COLUMN connect_requirements JSONB        NULL;

CREATE UNIQUE INDEX idx_clubs_stripe_account_id
  ON clubs (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- Booking-level money fields
ALTER TABLE venue_bookings
  ADD COLUMN booking_value_cents    INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN deposit_amount_cents   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN application_fee_cents  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN stripe_payment_intent_id VARCHAR(64) NULL,
  ADD COLUMN stripe_charge_id       VARCHAR(64)   NULL,
  ADD COLUMN deposit_paid_at        TIMESTAMP     NULL,
  ADD COLUMN payment_failure_reason VARCHAR(255)  NULL;

-- Expand the status enum
-- existing: 'pending' | 'confirmed' | 'cancelled'
-- add:      'pending_payment' | 'payment_failed' | 'refunded' | 'partial_refund'

CREATE INDEX idx_venue_bookings_payment_intent
  ON venue_bookings (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Refund audit
CREATE TABLE venue_booking_refunds (
  id                       BIGSERIAL PRIMARY KEY,
  venue_booking_id         BIGINT    NOT NULL REFERENCES venue_bookings(id) ON DELETE CASCADE,
  stripe_refund_id         VARCHAR(64) NOT NULL,
  amount_cents             INTEGER   NOT NULL,
  application_fee_refunded BOOLEAN   NOT NULL,
  reason                   VARCHAR(255) NULL,
  refunded_by              INTEGER   NULL REFERENCES users(id),  -- null = webhook-initiated
  refunded_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_venue_booking_refunds_stripe_id
  ON venue_booking_refunds (stripe_refund_id);

-- Idempotency ledger
CREATE TABLE stripe_events (
  event_id        VARCHAR(64)  PRIMARY KEY,
  event_type      VARCHAR(64)  NOT NULL,
  received_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  processed       BOOLEAN      NOT NULL DEFAULT false,
  payload         JSONB        NOT NULL
);
CREATE INDEX idx_stripe_events_type_received
  ON stripe_events (event_type, received_at DESC);
```

---

## 8. Frontend contract summary

### New api-client resource `packages/api-client/src/resources/stripe.ts`:

```ts
export interface ConnectStatus {
  account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  requirements: {
    currently_due: string[]
    eventually_due: string[]
    past_due: string[]
    disabled_reason: string | null
  } | null
  country: string | null
  default_currency: string | null
  connected_at: string | null
}

export interface ConnectOnboardResult {
  url: string
  account_id: string
  expires_at: string
}

export interface CheckoutResult {
  venue_booking_id: number
  deposit_amount: number
  application_fee: number
  club_receives: number
  currency: 'nzd' | 'aud' | string
  client_secret: string
  publishable_key: string
}

export interface RefundResult {
  refund_id: string
  amount: number
  application_fee_refunded: boolean
  booking_status: 'confirmed' | 'refunded' | 'partial_refund'
}

export const stripe = {
  startOnboarding(clubId: number): Promise<ConnectOnboardResult>,
  getStatus(clubId: number): Promise<ConnectStatus>,
  openDashboard(clubId: number): Promise<{ url: string; expires_at: string }>,
  checkoutVenueBooking(slug: string, input: VenueBookingInput): Promise<CheckoutResult>,
  refundVenueBooking(clubId: number, bookingId: number, input: RefundInput): Promise<RefundResult>,
}
```

### FE surface that lights up when this ships

- **Settings → Payments** (new section): status card ("Not connected" / "Connect Stripe" / "Connected, ready to accept bookings"). On click, redirects to `startOnboarding().url`. On return (query string `?connect=complete`), polls `getStatus()` and shows a success toast. Shows the `requirements.currently_due` list as a punch-list when KYC is incomplete.
- **Public venue-booking modal** (brief 63): "Pay deposit" button on step 2 calls `checkoutVenueBooking()` → `Stripe.confirmCardPayment(client_secret)` → confirmation screen. Fee breakdown ("Deposit $32 · Booking service fee $28 · Total $60") rendered itemised.
- **Venue booking detail (CRM admin)**: new "Payment" card showing deposit_amount + application_fee + Stripe charge id + "Refund" button with the preset picker (full / standard / no refund).

Views that pick up for free once the webhook fires:
- Venue booking list filter: `payment_failed` becomes a new filter chip.
- Enquiry notification pipeline (brief 62): the "new venue booking" email now mentions the deposit landed.

---

## 9. Verification

Using Nigel's JWT, against a test-mode Stripe account:

```bash
# 1. Connect onboarding
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/stripe-connect/onboard"
# → 200, url + account_id. Open url in browser, complete Stripe KYC.

# 2. Status after onboarding
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/stripe-connect/status"
# → 200, charges_enabled: true, payouts_enabled: true.

# 3. Public checkout
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/naenae-bowls/venue-bookings/checkout" \
  -d '{"venue_booking":{"space":"hall","start":"2026-12-14T10:00:00+13:00","end":"2026-12-14T16:00:00+13:00","booking_value":400,"contact":{"name":"Grace","email":"grace@example.co.nz","phone":"+64211234567"}}}'
# → 200, venue_booking_id + client_secret + deposit_amount: 60.00 + application_fee: 28.00.

# 4. Confirm payment client-side with Stripe test card 4242 4242 4242 4242.
#    Webhook fires payment_intent.succeeded → booking flips to 'confirmed'.

# 5. Verify booking state
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/128"
# → 200, status: 'confirmed', deposit_paid_at populated, stripe_charge_id present.

# 6. Refund (club cancellation)
curl -X POST -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/128/refund" \
  -d '{"refund_application_fee": true, "reason": "Hall roof leak"}'
# → 200, booking_status: 'refunded', application_fee_refunded: true.

# 7. Checkout against a club that hasn't connected
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/unconnected-club/venue-bookings/checkout" -d '…'
# → 409 { code: 'club_not_payment_ready' }

# 8. Idempotent webhook
# Replay the same payment_intent.succeeded event
# → 200, no duplicate email / no second deposit_paid_at write.
```

Pass criteria:
- ✓ Onboarding URL expires + refresh flow re-mints cleanly.
- ✓ Status polls return the real KYC state within 60s cache window.
- ✓ Checkout creates a pending booking + PaymentIntent in a single call.
- ✓ `transfer_data.destination` is the connected club account; `application_fee_amount` lands in the platform account.
- ✓ Webhook flips booking state on `payment_intent.succeeded` and sends the confirmation email once (not twice on replay).
- ✓ Refund with `refund_application_fee: true` claws back Torny's 7% from the platform balance.
- ✓ Unconnected / KYC-incomplete clubs 409 cleanly on checkout.

---

## 10. Non-goals (v1)

- **No balance collection.** We only charge the 15% deposit. The remaining 85% is between the club and the renter — Torny never sees it.
- **No Stripe Express or Custom account types.** Standard only. Express is a reasonable follow-up if admins find the full Stripe dashboard overwhelming, but Standard gives them real control and keeps us out of money-transmitter territory.
- **No multi-currency.** NZD only in v1 (clubs are AU/NZ). AUD comes with the first Aussie club.
- **No disputes handling in CRM UI.** Stripe emails the club directly for chargeback evidence; we surface the state as a flag on the booking but don't collect evidence.
- **No payouts dashboard in CRM.** Admins click through to Stripe's hosted dashboard for payouts. We're not rebuilding Stripe.
- **No idempotency key on checkout endpoint.** A duplicate submission creates two bookings — the FE must dedupe by disabling the button after first click. This is simpler than tracking idempotency keys server-side; revisit if it becomes a real problem.
- **No reconciliation report.** Stripe's own reporting is the source of truth for financial reconciliation. We provide the booking-level audit trail; monthly totals are a follow-up.

---

## 11. Contact

Ping Felicity when §§ 1–3 ship — the Settings → Payments UI can go live independently of checkout. §4 + §5 (checkout + webhook) can land together as a second PR; the public booking form will show "Online payment coming soon" until they're live. §6 (refunds) can be the third PR.
