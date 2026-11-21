# Brief 111 — Public read of a venue booking by `booking_ref`

> **STATUS — SHIPPED 2026-11-21** (commit `3d278a3`). Endpoint live at
> `GET https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/:slug/venue-bookings/:booking_ref`.
> See §3 for verified smokes. Two small corrections to the originally proposed shape:
>
> - **`payment_status` enum** — the real DB enum is `'unpaid' | 'deposit_paid' | 'paid' | 'refunded' | 'partially_refunded'` (not `'pending'`). "Deposit paid via Stripe" is `deposit_paid`; `paid` means the balance is also settled.
> - **`balance_due_days_before`** is derived from the persisted dates (`booking_date - balance_due_date`), not from a live join against `club_venue_settings`. That way an owner changing the lead-day setting later doesn't retroactively rewrite a renter's receipt.

**Scope:**
- API (Venue stack): new public read endpoint `GET /public/clubs/:slug/venue-bookings/:booking_ref`.
- FE (`tornyglory/torny-crm-websites`, `apps/club-sites`): swap `/book/complete` from a query-param-only confirmation into a real summary that fetches the booking by `?booking_ref=…`.

**Prereq:** brief 109 shipped (`POST /public/clubs/:slug/venue-bookings` + `/checkout` are live). Brief 110 shipped — the `data.slug` the FE receives from `/clubs/resolve` is the canonical slug this endpoint keys on.

---

## 1. The endpoint

```http
GET /public/clubs/:slug/venue-bookings/:booking_ref
```

- **Auth:** none. Public.
- **Lookup key:** `:booking_ref` is the human-readable code (`BK-YYYY-XXXXXX`). The row only renders when it belongs to the `:slug` club — mismatched slug → 404 `not_found`, never leaks another club's booking.
- **Cache:** `Cache-Control: no-store`. Reload-after-webhook is the normal flow; stale `payment_status` is not OK.
- **Soft-deletes:** `deleted_at IS NOT NULL` rows return 404.

### 1.1 Response shape (real)

```json
200 {
    "status": "success",
    "data": {
        "booking_ref": "BK-2026-A60C38",
        "status": "confirmed",
        "payment_status": "deposit_paid",

        "package": {
            "name": "The clubhouse",
            "slug": "the-clubhouse"
        },
        "slot": {
            "id": 14,
            "label": "Full Day · 9am – 11pm",
            "sub": "Exclusive all-day venue takeover for conferences, tournaments & weddings · 15% multi-slot save.",
            "duration_hours": 14,
            "default_start_time": "09:00:00"
        },
        "addons": [
            { "name": "Corporate Working Lunch & Tea", "quantity": 40, "amount_cents": 128000 },
            { "name": "Bowls on the Green · 90-min Session", "quantity": 40, "amount_cents": 80000 }
        ],
        "bond_cents": 30000,
        "bond_label": "Security bond (refundable)",

        "booking_date": "2026-12-18",
        "attendee_count": 40,

        "subtotal_cents": 442000,
        "deposit_cents": 70800,
        "deposit_paid_cents": 70800,
        "balance_cents": 401200,
        "balance_due_days_before": 21,
        "balance_due_date": "2026-11-27",

        "full_name": "Corporate Booking",
        "email": "corporatebooking@torny.pro",

        "paid_at": "2026-11-21T00:13:18.000Z",
        "received_at": "2026-11-21T00:12:44.000Z"
    }
}
```

**Field notes:**

- **`status`** — enum: `pending | pending_payment | confirmed | declined | cancelled | completed`. Trust this over any `?result=` query param.
- **`payment_status`** — enum: `unpaid | deposit_paid | paid | refunded | partially_refunded`. `deposit_paid` is the post-Stripe-webhook state the confirmation page will usually see.
- **`package.name` + `slot.label`** — snapshotted on the booking row at submit time. Owner renames after the fact don't rewrite the renter's receipt.
- **`slot.sub` / `slot.duration_hours` / `slot.default_start_time`** — live from the current `venue_slots` row. These aren't safety-critical; if the owner edits them, the receipt refreshes to the current value.
- **`addons[]`** — snapshotted at submit time. Each entry carries `amount_cents` (the line total that priced into the booking) + `quantity` + `name`. Reads like a receipt.
- **`bond_label`** — live from `venue_packages.bond_label`. Falls back to null.
- **`deposit_paid_cents`** — equals `deposit_cents` when `deposit_paid_at` is set, else 0. No column tracks partial-deposit payments because the Stripe webhook marks it in one shot.
- **`balance_due_days_before`** — computed server-side from `booking_date - balance_due_date`. For the sample, 21 days. Null if either date is missing (shouldn't happen for a paid booking).
- **`paid_at`** — maps to `venue_bookings.deposit_paid_at`. ISO-8601 UTC. Null if unpaid.
- **`received_at`** — maps to `venue_bookings.created_at`. Always set.

### 1.2 Renter-safe subset

Deliberately **not** returned:

- Admin-only fields on the booking row (`admin_notes`, `decline_reason`, `confirmed_by_user_id`, `declined_by_user_id`, `cancelled_by_user_id`).
- Raw Stripe object ids (`stripe_payment_intent_id`, `stripe_checkout_session_id`, `stripe_balance_charge_id`, `stripe_refund_id`).
- The club's Stripe account id or any CRM-side state.
- Phone number + free-text message from the submit payload.

### 1.3 Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `bad_params` | `:slug` path param missing (shouldn't happen via API Gateway routing). |
| 400 | `bad_booking_ref` | Ref doesn't match `^BK-\d{4}-[A-Z0-9]{6}$`. |
| 404 | `not_found` | Ref doesn't exist, soft-deleted, or belongs to a different club. |
| 500 | `internal` | Unhandled error; message carried in the response. |

Deliberately no "pending yet" code — the webhook is the source of truth. If a renter reloads the page before the webhook fires, the backend returns `payment_status: "unpaid"` and the FE tells them to check back shortly.

---

## 2. FE wiring (small)

### 2.1 api-client

```ts
// packages/api-client/src/resources/venueBookings.ts
export interface PublicVenueBookingRead {
    booking_ref: string
    status: 'pending' | 'pending_payment' | 'confirmed' | 'declined' | 'cancelled' | 'completed'
    payment_status: 'unpaid' | 'deposit_paid' | 'paid' | 'refunded' | 'partially_refunded'
    package: { name: string | null; slug: string | null }
    slot: { id: number | null; label: string | null; sub: string | null; duration_hours: number | null; default_start_time: string | null }
    addons: Array<{ name: string; quantity: number; amount_cents: number }>
    bond_cents: number
    bond_label: string | null
    booking_date: string
    attendee_count: number | null
    subtotal_cents: number
    deposit_cents: number
    deposit_paid_cents: number
    balance_cents: number
    balance_due_days_before: number | null
    balance_due_date: string | null
    full_name: string
    email: string
    paid_at: string | null
    received_at: string
}

/** `GET /public/clubs/:slug/venue-bookings/:booking_ref` — brief 111. */
export async function publicGetByRef(
    slug: string,
    bookingRef: string,
    opts: { signal?: AbortSignal } = {},
): Promise<PublicVenueBookingRead> { … }
```

### 2.2 Completion page

`apps/club-sites/pages/book/complete.vue`:

```ts
const { data: booking } = await useAsyncData(
    () => `venueBooking:${bookingRef.value}`,
    async () => {
        const slug = club.value?.slug ?? null
        if (!slug || !bookingRef.value) return null
        return await venueBookings.publicGetByRef(slug, bookingRef.value)
    },
    { watch: [bookingRef, () => club.value?.slug] },
)
```

Render surfaces:

- **Package + slot + date** as the big summary line (use `package.name`, `slot.label`, `booking_date`).
- **Addons list** — map `addons[]` with `name × quantity → $(amount_cents/100)`.
- **Money card** — subtotal, deposit paid, balance, bond. Use `deposit_paid_cents` for the "you paid" line and `balance_cents` + `balance_due_date` for the "balance due" line.
- **Confirmation email sent to `{{ booking.email }}`** so the renter knows where to look.
- **Status badges**: `payment_status === 'deposit_paid'` → "Deposit paid", `=== 'paid'` → "Paid in full", `=== 'unpaid'` → "Awaiting payment" / "The club will be in touch" depending on `status`.
- **Fallback** — if the fetch 404s (ref invalid, or slug mismatch), show the current thin "You're booked in" card as a safety net rather than erroring.

Keep the `result=success` / `result=cancelled` query-param branches as a UX hint, but always prefer the server's `payment_status` as truth — a nervous renter can edit the URL, they can't edit the DB.

---

## 3. Verification (live against prod)

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
SLUG="nae-nae-bowling-club"
REF="BK-2026-A60C38"

# 1. Happy path — a deposit_paid booking (confirmed 2026-11-21)
curl -s "$VENUE/public/clubs/$SLUG/venue-bookings/$REF" | jq
#   → status: "success", data: { payment_status: "deposit_paid", … full summary }

# 2. Scope guard — wrong slug returns not_found
curl -s "$VENUE/public/clubs/the-wrong-club/venue-bookings/$REF" | jq
#   → status: "error", code: "not_found"

# 3. Bad ref shape
curl -s "$VENUE/public/clubs/$SLUG/venue-bookings/NOPE" | jq
#   → status: "error", code: "bad_booking_ref"

# 4. Valid shape but non-existent ref
curl -s "$VENUE/public/clubs/$SLUG/venue-bookings/BK-2026-000000" | jq
#   → status: "error", code: "not_found"

# 5. Cache-Control: no-store (reload-after-webhook must always refetch)
curl -sD /dev/stderr -o /dev/null "$VENUE/public/clubs/$SLUG/venue-bookings/$REF" | grep -i cache
#   → cache-control: no-store
```

---

## 4. Pass criteria

- ✓ Endpoint returns the shape in §1.1 for a paid booking.
- ✓ Returns `not_found` when the booking exists under a different club.
- ✓ Returns `bad_booking_ref` when the ref is malformed.
- ✓ `no-store` cache header lands at the client.
- ✓ `/book/complete?booking_ref=…` on `apps/club-sites` renders package name, slot, date, addons, deposit paid, balance due, and the email the confirmation went to.
- ✓ When the fetch 404s, the page falls back to the current thin "You're booked in" card rather than erroring.

---

## 5. Non-goals

- **Updating a booking from the public read.** Read-only. Admin UX stays in the CRM.
- **Rendering the Stripe receipt PDF.** Stripe's job; not linked from this response.
- **Cancelling / declining / refunding from the public surface.** Admin-only.
- **Enquiry-style (non-Stripe) bookings** still work: `payment_status: 'unpaid'`, `deposit_paid_cents: 0`, same shape, different copy branch on the FE.
