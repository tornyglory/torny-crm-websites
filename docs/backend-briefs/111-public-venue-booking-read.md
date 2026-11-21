# Brief 111 — Public read of a venue booking by `booking_ref`

**Scope:**
- API (Venue stack): new public read endpoint — `GET /public/clubs/:slug/venue-bookings/:booking_ref`. Returns the renter-safe subset of a booking row so the Stripe-redirect "You're booked in" page can render real details (package, slot, date, deposit paid, balance due, confirmation email) instead of just a reference code.
- FE (`tornyglory/torny-crm-websites`, `apps/club-sites`): swap `/book/complete` from a query-param-only confirmation into a real summary that fetches the booking by `?booking_ref=…` and renders it. One call site, no state wiring.

**Prereq:** brief 109 shipped (`POST /public/clubs/:slug/venue-bookings` + `/checkout` are live, so the `booking_ref` the redirect carries is persisted server-side). Brief 110 §4.1 open — this new endpoint should key the same way the author aligns the rest of the Venue-stack endpoints, so the FE's slug/subdomain choice is consistent.

> **Why now:** today, after a successful Stripe deposit the renter lands on `naenae-bowling-club.torny.pro/book/complete?booking_ref=BK-2026-A60C38&result=success` and sees a thank-you card with the booking ref as a code string. No package name, no date, no slot, no amount. First impression after paying is thin. The webhook has already set the booking's `payment_status = 'paid'` — all we need is a renter-safe read to hydrate the confirmation.

---

## 1. The endpoint

```http
GET /public/clubs/:slug/venue-bookings/:booking_ref
```

- **Auth:** none. Public. Rate-limited by IP (same bucket as the other `/public/clubs/*` endpoints).
- **Lookup key:** `:booking_ref` is the human-readable code (`BK-YYYY-XXXXXX`). The row only renders when it belongs to the `:slug` club — mismatched slug → 404 `not_found`, never leak another club's booking.
- **Cache:** `Cache-Control: no-store`. The confirmation page is read once immediately after the Stripe webhook fires; caching serves stale `payment_status` back into the renter's face.

### 1.1 Response shape

```json
200 {
    "status": "success",
    "data": {
        "booking_ref": "BK-2026-A60C38",
        "status": "confirmed",
        "payment_status": "paid",

        "package": {
            "name": "The clubhouse",
            "slug": "the-clubhouse"
        },
        "slot": {
            "id": 12,
            "label": "Afternoon · 2pm – 6pm",
            "sub": "4 hours · $720",
            "duration_hours": 4,
            "default_start_time": "14:00:00"
        },
        "addons": [
            { "name": "Grazing platters", "quantity": 6, "amount_cents": 51000 },
            { "name": "Bar tab · Prepaid", "quantity": 1, "amount_cents": 40000 }
        ],
        "bond_cents": 30000,
        "bond_label": "Security bond (refundable)",

        "booking_date": "2026-12-18",
        "attendee_count": 40,

        "subtotal_cents": 162000,
        "deposit_cents": 24300,
        "deposit_paid_cents": 24300,
        "balance_cents": 137700,
        "balance_due_days_before": 21,
        "balance_due_date": "2026-11-27",

        "full_name": "Ruth Willis",
        "email": "ruth@example.com",

        "paid_at": "2026-11-21T01:12:04Z",
        "received_at": "2026-11-21T01:08:33Z"
    }
}
```

Fields grouped by what the page renders:

- **Identity + state** — `booking_ref`, `status`, `payment_status`. Lets the FE show the right badge ("Deposit paid" / "Pending" / "Cancelled") without relying on the `?result=` query param, which a nervous renter can edit.
- **What was booked** — `package.name`, `slot.label`, `booking_date`, `attendee_count`, selected `addons[]`. Lets the confirmation card read like a receipt rather than a token.
- **Money** — `subtotal_cents`, `deposit_cents`, `deposit_paid_cents`, `balance_cents`, `balance_due_date`. Also `bond_cents` so the "plus bond" line renders.
- **Contact** — `full_name`, `email`. Allows the page to tell the renter which email will get the confirmation, so they know where to look.
- **Timestamps** — `paid_at`, `received_at`. Used for the "booked on" eyebrow if we want it.

### 1.2 Renter-safe subset

Must **not** return:

- Admin-only fields on the booking row (internal notes, admin message threads, raw Stripe objects beyond the cents totals).
- The club's Stripe account id / dashboard links.
- Other renters' details (goes without saying — scope is one `booking_ref`).

If the booking has been declined / cancelled, we still return the row with its final `status` so the Cancelled branch of `/book/complete` can render the right copy.

### 1.3 Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `bad_booking_ref` | Ref doesn't match `BK-YYYY-[A-Z0-9]{6}` |
| 404 | `not_found` | Ref doesn't exist, or doesn't belong to `:slug` |
| 429 | `rate_limited` | Same bucket as other public `/public/clubs/*` endpoints |

Deliberately no "pending yet" state — the webhook is the source of truth. If a renter reloads the page before the webhook fires, `payment_status: "pending"` is fine to render and the FE tells them to check back shortly.

---

## 2. FE wiring (small)

### 2.1 api-client

```ts
// packages/api-client/src/resources/venueBookings.ts
export interface PublicVenueBookingRead {
    booking_ref: string
    status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed'
    payment_status: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'waived'
    package: { name: string; slug: string }
    slot: { id: number; label: string; sub: string | null; duration_hours: number | null; default_start_time: string | null }
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

`apps/club-sites/pages/book/complete.vue` currently reads `?result=` + `?booking_ref=` and renders a static card. Rework:

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

Then render:

- **Package + slot + date** as the big summary line.
- **Addons list** below.
- **Money card** — subtotal / deposit paid / balance / bond.
- **Confirmation email** sent to `{{ booking.email }}` so the renter knows where to look.
- **Fallback** — if the fetch 404s (ref invalid, or slug mismatch), show the current thin "You're booked in" card as a safety net.

Keeps the `result=success` / `result=cancelled` query-param branches as a UX hint but always prefers the server's `payment_status` as truth.

---

## 3. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
SLUG="nae-nae-bowling-club"
REF="BK-2026-A60C38"

# 1. Happy path — a paid booking
curl -s "$VENUE/public/clubs/$SLUG/venue-bookings/$REF" | jq
# → payment_status: "paid", full package + slot + money details

# 2. Scope guard — a ref that belongs to another club
curl -s "$VENUE/public/clubs/some-other-club/venue-bookings/$REF" | jq
# → status: "error", code: "not_found"

# 3. Bad ref shape
curl -s "$VENUE/public/clubs/$SLUG/venue-bookings/NOPE" | jq
# → status: "error", code: "bad_booking_ref"
```

---

## 4. Pass criteria

- ✓ New endpoint returns the shape in §1.1 for a paid booking.
- ✓ Returns `not_found` when the booking exists under a different club.
- ✓ Returns `bad_booking_ref` when the ref is malformed.
- ✓ `no-store` cache header so a reload after the webhook lands always reflects the new `payment_status`.
- ✓ `/book/complete?booking_ref=…` on `apps/club-sites` renders package name, slot, date, addons, deposit paid, balance due, and the email the confirmation went to.
- ✓ When the fetch 404s, the page falls back to the current thin "You're booked in" card rather than erroring.

---

## 5. Non-goals

- **Updating a booking from the public read.** Read-only. Admin UX stays in the CRM.
- **Rendering the Stripe receipt PDF.** That's Stripe's job; linking to `stripe_receipt_url` from the response is OK if the backend has it on hand, but not required.
- **Soft-deleting bookings from the public surface.** Cancel / decline / refund stays admin-only.
- **Enquiry-style bookings (no Stripe).** The same endpoint should still return those — `payment_status` is `'unpaid'`, `deposit_paid_cents` is 0, and the page renders a different message ("The club will be in touch to confirm"). Same shape, different copy branch on the FE.

---

## 6. Contact

Nev on Slack (`#torny-eng`). Relates to brief 109 (public venue booking submit + checkout), brief 110 §4.1 (slug/subdomain alignment — pick one canonical key for this endpoint too so the FE doesn't have to encode which-endpoint-wants-which).
