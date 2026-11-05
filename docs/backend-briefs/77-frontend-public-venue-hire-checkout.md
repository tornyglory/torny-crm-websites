# Public venue-hire checkout — renter pays deposit on submit

**Feature:** the public venue-hire booking form now pays the deposit at submit time via Stripe-hosted Checkout, instead of landing a `pending` booking that waits for admin review. Direct-charges the club's connected Stripe account; Torny takes the platform fee as `application_fee_amount`. The admin-submit-then-review flow stays as a secondary path for phone-in bookings.

**Status:** backend live on TornyVenueStack as of 2026-11-06. The only piece left is the FE wiring the public block + building the `/book/complete` landing page. No feature flag — the endpoint 409s cleanly for clubs that haven't onboarded to Stripe, so the FE can ship this everywhere and it just falls back to the old "contact the club directly" messaging for unconnected clubs.

**Related briefs:**
- `frontend-stripe-venue-bookings-brief.md` — full shipped-state reference for the Stripe Connect foundation + webhook + refund flow. Read first for context on the status enum, the admin confirm path, and why the public checkout is a separate endpoint from the public submit.
- Brief 62 (venue bookings) — the existing `POST /public/clubs/{slug}/venue-bookings` submit endpoint stays unchanged; this brief adds a sibling `/checkout` endpoint.
- Brief 63 (venue booking block on the public site) — the block that calls the new endpoint.
- `docs/backend-briefs/72-stripe-connect-venue-hire-deposit.md` — internal implementation brief for context on what landed on the backend.

---

## TL;DR

1. New endpoint: `POST /public/clubs/{slug}/venue-bookings/checkout`. Same request body as the existing submit endpoint, plus it responds with a `checkout_url`.
2. On success → `window.location.href = data.checkout_url` to send the renter to Stripe-hosted Checkout (handles cards, Apple Pay, Google Pay, 3DS, receipt email).
3. On `409 club_not_payment_ready` → show the club's contact details and fall back to the existing submit flow (or disable the "Pay now" CTA altogether if the block is checkout-only).
4. Build a thin landing page at `/book/complete` to catch Stripe's return redirect (both success + cancel).
5. The booking state (`confirmed` + `deposit_paid`) is flipped **by the webhook**, not the FE — the landing page just needs to poll / re-fetch when `result=success`.

---

## Base URL

```
https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

(TornyVenueStack — distinct from the CDK + CRM API bases.)

**No auth.** The renter is a stranger. The webhook is signature-verified, not JWT-auth'd.

---

## 1. `POST /public/clubs/{slug}/venue-bookings/checkout`

### Request

Exactly the same body shape as the existing `POST /public/clubs/{slug}/venue-bookings` submit endpoint — no new fields.

```jsonc
{
  "full_name":     "Grace Whittaker",
  "email":         "grace@example.co.nz",
  "phone":         "+64 21 123 4567",
  "package_id":    42,
  "slot_id":       17,
  "booking_date":  "2026-12-14",
  "attendee_count": 40,
  "message":       "60th birthday, catered",
  "addons": [
    { "addon_id": 7, "quantity": 6 },
    { "addon_id": 12 }
  ]
}
```

Field rules (same as submit):
- `full_name` — required, ≤ 200 chars.
- `email` — required, standard email format, ≤ 255 chars.
- `booking_date` — required, `YYYY-MM-DD`, not in the past.
- `package_id` / `slot_id` — required integers, must resolve to active rows on this club.
- `phone` — optional, ≤ 32 chars.
- `attendee_count` — optional, 0..10000.
- `message` — optional, ≤ 4000 chars.
- `addons` — optional array; each `addon_id` must belong to the chosen package; `quantity` is 0..1000 (defaults to the addon's `default_quantity` if omitted for countable addons, else 1).

### 200 response

```jsonc
{
  "status": "success",
  "data": {
    "venue_booking_id":    128,
    "booking_ref":         "BK-2026-A3F9C2",
    "total_cents":         29000,
    "deposit_cents":       4350,
    "platform_fee_cents":  218,
    "club_receives_cents": 4132,
    "currency":            "nzd",
    "checkout_url":        "https://checkout.stripe.com/c/pay/cs_test_…",
    "checkout_session_id": "cs_test_…"
  }
}
```

- **`checkout_url`** is the only field the FE strictly needs — it's the Stripe-hosted Checkout page.
- The money breakdown is included so the FE can show a "here's what you're paying" confirmation step before the redirect, if desired.
- `club_receives_cents` = `deposit_cents − platform_fee_cents` (pre-Stripe-processing-fees). Useful for admin-side "what the club will net" summaries later; not critical for the renter UI.
- `currency` is `'nzd'` for now (brief non-goal: multi-currency).

### What the backend does in this one call

- Validates the request + loads the club/package/slot/addons.
- Checks `clubs_data.stripe_account_status === 'ready'`. If not → 409 (see §2).
- Computes `total_cents`, `deposit_cents = total × deposit_percent / 100`, `platform_fee_cents = deposit × platform_fee_percent / 100`. Percents come from `club_venue_settings` (defaults 15% / 5%).
- Inserts a booking with `status='pending_payment'`, `payment_status='unpaid'`. Snapshots both percentages onto the row.
- Creates a Stripe Checkout Session on the club's connected account (direct charge) with `application_fee_amount` for Torny.
- Writes `stripe_checkout_session_id` + `stripe_payment_intent_id` onto the booking row.
- Returns the response above. **No email fires** at this step — the renter will get Stripe's own receipt after paying, plus our confirmation email once the webhook flips the booking to confirmed.

### What the FE does with the response

```ts
const { data } = await api.post(`/public/clubs/${slug}/venue-bookings/checkout`, payload)
// Option A: redirect immediately
window.location.href = data.checkout_url
// Option B: show a confirmation step first with the breakdown, then redirect on "Pay now"
```

**No Stripe.js, no Elements, no `confirmCardPayment`.** Stripe-hosted Checkout handles card entry, 3DS, wallet payments, and the success/cancel redirects. The FE never touches card details.

---

## 2. Error responses

### 400 — validation failures

Same codes as the submit endpoint:

| code | when |
|---|---|
| `bad_body` | request body isn't valid JSON |
| `bad_full_name` | missing / empty / > 200 chars |
| `bad_email` | missing / invalid format / > 255 chars |
| `bad_booking_date` | not `YYYY-MM-DD`, or in the past |
| `bad_package_id` / `bad_slot_id` | missing / not an integer |
| `bad_attendee_count` | outside 0..10000 |
| `bad_addon` | `addons[].addon_id` isn't a known addon on this package |
| `bad_addon_quantity` | outside 0..1000 |
| `package_inactive` | `venue_packages.is_active = 0` |
| `slot_disabled` | `venue_slots.is_disabled = 1` |
| `venue_hire_paused` | `club_venue_settings.is_active = 0` |
| `bad_value` | computed deposit is $0 (nothing to charge) |

### 404 — references don't resolve

| code | when |
|---|---|
| `not_found` | slug doesn't resolve to a club, or `package_id` doesn't belong to the club |

### 409 `club_not_payment_ready` — the critical one

Returned when the club's `stripe_account_status` isn't `'ready'` (i.e. they haven't onboarded, haven't finished KYC, or Stripe has restricted the account). Response body carries the club's contact details so the FE can render a renter-friendly fallback.

```jsonc
{
  "status": "error",
  "code": "club_not_payment_ready",
  "message": "Naenae Bowling Club isn't accepting online payments yet — please contact them directly to book.",
  "data": {
    "club_contact": {
      "name":  "Naenae Bowling Club",
      "email": "bookings@naenae.co.nz",
      "phone": "+64 4 567 8910"
    }
  }
}
```

**Suggested UX:** show the message + a mailto/tel link. Optionally fall back to the existing `POST .../venue-bookings` submit endpoint (which doesn't require Stripe) so the renter can still get the booking into the club's queue for manual follow-up.

Either of `club_contact.email` / `club_contact.phone` may be `null` — render whichever is present.

### 502 — Stripe failed

| code | when |
|---|---|
| `stripe_checkout_create_failed` | Stripe rejected the session create. Body carries Stripe's message; useful for admin debugging but safe to show the renter a generic "something went wrong, please try again" toast. |

### 500 — generic

Treat as retryable with the same payload.

---

## 3. Stripe-hosted Checkout — the renter's experience

After `window.location.href = data.checkout_url`:

1. Stripe renders its hosted Checkout page (styled with the club's Stripe brand settings — not our brand, that's a Stripe product limitation).
2. Renter enters card (or taps Apple Pay / Google Pay — Stripe auto-enables based on their device).
3. Stripe handles 3DS challenges inline.
4. On successful payment, Stripe redirects to:
   ```
   https://torny.co/book/complete?booking_ref=BK-2026-A3F9C2&result=success
   ```
5. On cancel (renter clicks the back-arrow or closes the tab), Stripe redirects to:
   ```
   https://torny.co/book/complete?booking_ref=BK-2026-A3F9C2&result=cancelled
   ```

The `FRONTEND_URL` base is `https://torny.co` — if the renter is on a club-custom domain, consider whether to rewrite the success URL to land back on the club's own site. For v1, torny.co is fine (the landing page can read the `booking_ref`, fetch the booking's `payment_status`, and show the club name from the booking row).

### The `/book/complete` landing page (FE must build)

The FE needs to host a page at `/book/complete` that handles both outcomes:

**`?result=success` path:**

- Parse `booking_ref` from the query string.
- Fetch the booking's current state. We don't have a public "get booking by ref" endpoint yet — **so the simplest v1 is:** show a "Payment received — [Club name] will be in touch with the details" success state immediately, without an API call. The webhook flips the booking to `confirmed` + `deposit_paid` within a few seconds of the renter landing on this page, and an email with the full booking details fires to them automatically at that point.
- If you want the page to show live status (paid/pending), we'd need a new public endpoint like `GET /public/venue-bookings/{booking_ref}` that returns the trimmed booking row. Say the word and I'll add it.

**`?result=cancelled` path:**

- Parse `booking_ref`.
- Show a "Payment cancelled — your booking slot has been released" state.
- CTA to go back to the booking form. The booking row stays in `pending_payment` / `unpaid` state in the DB — it'll naturally sit there until it ages out (follow-up job; no cleanup today). If the renter comes back and submits again for the same slot, the old row isn't blocking anything since `pending_payment` bookings don't hold the slot.

Neither path needs to hit any protected API. The success path can be fully static if you want.

---

## 4. Lifecycle — where state transitions happen

```
Renter submits form
       │
       │  POST /public/clubs/{slug}/venue-bookings/checkout
       ▼
┌─────────────────────────────────────────────┐
│ Backend: validate, insert booking (pending_ │
│ payment, unpaid), create Stripe Checkout    │
│ Session on connected account, return URL.   │
└─────────────────────────────────────────────┘
       │
       │  200 { checkout_url }
       ▼
FE does window.location.href = checkout_url
       │
       ▼
Stripe-hosted Checkout page (card / Apple Pay / Google Pay / 3DS)
       │
       ├── Renter pays ──► Stripe redirects to /book/complete?result=success
       │                           │
       │                           │  Stripe fires checkout.session.completed
       │                           ▼
       │                   Our webhook handler:
       │                   - Inserts stripe_events row (dedupe)
       │                   - Flips booking: status='confirmed',
       │                     payment_status='deposit_paid',
       │                     deposit_paid_at, confirmed_at populated
       │                   - Fires confirmation email to renter + alert to club
       │
       └── Renter cancels ──► /book/complete?result=cancelled
                                   │
                                   ▼
                           Booking stays at pending_payment / unpaid,
                           FE shows the cancelled state
```

Key invariant: **the FE never writes the booking's final state.** The webhook is the source of truth for "paid" transitions. This matters because Stripe's `/book/complete?result=success` redirect fires immediately after the renter clicks Pay, but the webhook can arrive a second or two later — if the landing page tries to read booking state, it may briefly see `pending_payment`. Treat `result=success` as authoritative on the FE and don't block on an API fetch.

---

## 5. FE contract — api-client

```ts
// packages/api-client/src/resources/venueBookings.ts (extend existing resource)

export interface VenueBookingCheckoutInput {
  full_name: string
  email: string
  phone?: string
  package_id: number
  slot_id: number
  booking_date: string            // 'YYYY-MM-DD'
  attendee_count?: number
  message?: string
  addons?: Array<{ addon_id: number; quantity?: number }>
}

export interface VenueBookingCheckoutResult {
  venue_booking_id: number
  booking_ref: string
  total_cents: number
  deposit_cents: number
  platform_fee_cents: number
  club_receives_cents: number
  currency: 'nzd' | string
  checkout_url: string
  checkout_session_id: string
}

export interface ClubNotPaymentReadyError {
  code: 'club_not_payment_ready'
  message: string
  data: {
    club_contact: {
      name:  string
      email: string | null
      phone: string | null
    }
  }
}

export const venueBookings = {
  // existing submit() stays as-is
  submit(slug: string, input: VenueBookingCheckoutInput): Promise<VenueBooking>,

  // new: start a paid checkout — returns the Stripe-hosted URL
  checkout(slug: string, input: VenueBookingCheckoutInput): Promise<VenueBookingCheckoutResult>,
}
```

---

## 6. FE surface that lights up

### Public venue-hire block (the renter-facing form)

- **Primary CTA** flips from "Request booking" → "Pay deposit & book". Only applies when the club is Stripe-connected (see below for how the FE knows).
- Before posting, show an itemised preview if the page design calls for it — the backend doesn't need to return this; the FE already has the package price + addons locally.
- Button handler:
  ```ts
  try {
    const { data } = await venueBookings.checkout(slug, payload)
    window.location.href = data.checkout_url
  } catch (err) {
    if (err?.code === 'club_not_payment_ready') {
      // Fall back — either show the contact block, or re-POST to submit()
      showContactFallback(err.data.club_contact)
    } else {
      // Normal validation error — show inline
      showFieldError(err.code, err.message)
    }
  }
  ```

### Knowing whether the club is Stripe-connected without a probe call

The public site data already returned by `GET /public/clubs/{slug}/site` (or wherever the public block hydrates from) can carry `payment_mode: 'online' | 'contact_club'` if we want to avoid the 409 round-trip. **Not implemented today** — v1, just hit `/checkout` and handle the 409. If you want the probe, add an issue and I'll surface the flag.

### `/book/complete` landing page

- `?result=success` → "Payment received. We've emailed you a confirmation."
- `?result=cancelled` → "Payment cancelled. Your slot has been released." + "Try again" CTA back to the booking form.
- Static content, no auth, no API call needed for v1.

### Admin CRM

No FE work here — admin booking detail already shows `payment_status` and the refund button. Booking will flip from `pending_payment` to `confirmed` + `deposit_paid` automatically; admin re-fetch will pick it up.

---

## 7. Verification — curl

```bash
API="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Happy path — Stripe-ready club. Returns a checkout_url.
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/nae-nae-bowling-club/venue-bookings/checkout" \
  -d '{"full_name":"Grace Whittaker","email":"grace@example.co.nz","phone":"+64211234567","package_id":42,"slot_id":17,"booking_date":"2026-12-14","attendee_count":40,"message":"60th birthday","addons":[{"addon_id":7,"quantity":6}]}'
# → 200 { data: { venue_booking_id, booking_ref, checkout_url, ... } }

# 2. Open checkout_url in a browser. Use Stripe test card 4242 4242 4242 4242, any future expiry, any CVV.
#    Stripe redirects to FRONTEND_URL/book/complete?booking_ref=…&result=success.

# 3. Verify the webhook flipped the booking (as the club admin).
curl -H "Authorization: Bearer $JWT" "$API/clubs/5/venue-bookings/128"
# → status: 'confirmed', payment_status: 'deposit_paid', deposit_paid_at populated.

# 4. Unconnected club → 409 with contact block.
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/some-unconnected-club/venue-bookings/checkout" -d '{…}'
# → 409 { code: 'club_not_payment_ready', data: { club_contact: {…} } }

# 5. Missing full_name → 400.
curl -X POST -H "Content-Type: application/json" \
  "$API/public/clubs/nae-nae-bowling-club/venue-bookings/checkout" -d '{}'
# → 400 { code: 'bad_full_name' }

# 6. Idempotency sanity — Stripe retry of the same event is a no-op.
#    Replay checkout.session.completed from Stripe dashboard → booking state unchanged, no duplicate email.
```

Pass criteria:
- ✓ Happy path returns `checkout_url` that resolves to Stripe-hosted Checkout.
- ✓ Paying flips the booking to `confirmed` + `deposit_paid` within ~2s of the renter clicking Pay.
- ✓ 409 payload carries a usable `club_contact` block.
- ✓ Replay of `checkout.session.completed` doesn't double-send email or double-flip state.
- ✓ Cancelling at Stripe leaves the booking at `pending_payment` / `unpaid` (no cleanup; FE just renders the cancelled state).

---

## 8. Non-goals (v1)

- **No Stripe Elements / embedded card form.** Stripe-hosted Checkout only. Simpler to ship, covers wallets + 3DS for free.
- **No multi-currency.** NZD only. AUD lands with the first Aussie club.
- **No slot hold during Checkout.** Two renters clicking Pay on the same slot within a minute: both get Checkout URLs, both might pay. Admin picks one, refunds the other. Slot-hold is a follow-up.
- **No "pay the balance" flow yet.** Only the deposit (default 15%) flows through Stripe. The remaining `balance_cents` is settled between the club and the renter offline. The DB has forward scaffolding (`stripe_balance_charge_id` column, `payment_status='paid'` enum) for when the balance flow lands.
- **No public "get booking by ref" endpoint.** The `/book/complete` landing page can't check the booking's live payment state without one. Not a blocker for the success path (webhook fires fast + the renter gets an email), but worth adding if the FE wants to show "paid" vs "pending" on the landing page itself.
- **No FE-side signal of "is this club Stripe-ready?"** The block currently probes by posting and handling the 409. If this gets annoying, we'll surface a `payment_mode` flag on the public site hydrate.
- **No special handling for expired `pending_payment` bookings.** They sit in the DB. A cleanup job (sweep anything `pending_payment` older than 24h) is on the backlog but not today.

---

## 9. Contact

Ping Felicity (felicity@seadigital.co.nz) when the public block + `/book/complete` landing page are on staging. Smoke: submit a booking against Naenae (`club_id=5`, `slug=nae-nae-bowling-club` — Stripe-ready in prod), pay with test card `4242 4242 4242 4242`, confirm the admin side of the CRM shows the booking flip to `confirmed` / `deposit_paid` within a couple of seconds.

Heads up on prod data: **Naenae and Richmond currently share the same `stripe_account_id`** (`acct_1UXpJvKbFlKLKd4q`) — a test-fixture artifact. Any payment against either club will land in the same Stripe account. Not an issue for testing, but worth separating before either club genuinely goes live with real customers.
