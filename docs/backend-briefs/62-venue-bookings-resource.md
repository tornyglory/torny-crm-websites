# Venue bookings — proper resource with deposit payments

**Feature:** graduate the venue-hire booking flow from the v1 sink-into-enquiries hack into a dedicated `venue_bookings` resource. The CRM gets its own inbox for bookings (distinct from general enquiries), deposits actually get charged, hosts can be assigned, bookings block the calendar for other bookings, and admins can accept / amend / cancel from the CRM.

**Status:** backend not started. Frontend shipped — `VenueBookingBlock.vue` + `/venue-hire/book` page both wired, writing into `enquiries.create()` with `topic: 'facilities'` and a formatted plaintext message. Admins read the booking in the Enquiries inbox today, same as any other message. Works, but has three problems that this brief fixes:

1. **No deposit.** The booking confirmation UI shows "deposit paid" but nothing is actually charged.
2. **No calendar block.** The same slot can be booked twice because availability isn't tracked server-side.
3. **No workflow.** Admins can't change state (pending → confirmed → cancelled) or assign a host; they just reply to the enquiry.

**Related briefs:**
- brief 41 — enquiries (what we're sinking into for v1).
- brief 54 — communications history (any transactional email from this resource should log through the shared send helper from brief 54).
- brief 47 — tournaments resource (closest shape in the codebase; same pending/confirmed/cancelled lifecycle, use its handlers as the template).

---

## TL;DR

1. New tables: `venue_packages`, `venue_slots`, `venue_addons`, `venue_bookings`, `venue_booking_addons`, `venue_booking_payments`, `venue_availability_blocks`.
2. Public endpoints: availability lookup per package + month, booking submission (returns a payment intent client secret for Stripe).
3. CRM endpoints: list / detail / state transitions / host assignment / messages.
4. Payment: Stripe PaymentIntent for the deposit on submit, scheduled charge for the balance 14 days out.
5. Email flows: booking received, deposit paid, balance due reminder, balance paid, cancellation.

Scope v1 as the data model + the public submit path + CRM inbox read-only. v1.5 adds state transitions + host assignment + manual deposit charge (cash / bank transfer). v2 adds Stripe integration + auto balance charging.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Public submit uses the public prefix (`/public/clubs/:slug/venue-bookings`). CRM endpoints use `/clubs/:cid/venue-bookings`.

---

## 1. Schema

### `venue_packages`

```
id              BIGSERIAL  PK
club_id         INTEGER    NOT NULL  REFERENCES clubs(id)
slug            VARCHAR    NOT NULL              -- 'the-clubhouse' — must be unique per club
name            VARCHAR    NOT NULL              -- "The clubhouse"
sub             VARCHAR    NULL                  -- "Timber-lined main room · seated 80 · standing 140"
bond_amount     INTEGER    NULL                  -- fixed refundable bond added to every booking
bond_label      VARCHAR    NULL                  -- "Refundable bond"
display_order   INTEGER    NOT NULL  DEFAULT 0
is_active       BOOLEAN    NOT NULL  DEFAULT TRUE
created_at      TIMESTAMP  NOT NULL  DEFAULT NOW()
updated_at      TIMESTAMP  NOT NULL  DEFAULT NOW()

UNIQUE (club_id, slug)
INDEX (club_id, is_active)
```

### `venue_slots`

```
id              BIGSERIAL  PK
package_id      BIGINT     NOT NULL  REFERENCES venue_packages(id) ON DELETE CASCADE
label           VARCHAR    NOT NULL              -- "Afternoon · 2pm – 6pm"
sub             VARCHAR    NULL                  -- "4 hours · $720 · Most booked"
price_cents     INTEGER    NOT NULL              -- base slot price (cents)
duration_hours  NUMERIC(4,2) NOT NULL            -- 4.00, 5.00, 14.00
default_start_time TIME    NULL                  -- "14:00" — admin can override per booking day
is_disabled     BOOLEAN    NOT NULL  DEFAULT FALSE
display_order   INTEGER    NOT NULL  DEFAULT 0

INDEX (package_id)
```

### `venue_addons`

```
id              BIGSERIAL  PK
package_id      BIGINT     NOT NULL  REFERENCES venue_packages(id) ON DELETE CASCADE
name            VARCHAR    NOT NULL              -- "Grazing platters"
description     VARCHAR    NULL
price_cents     INTEGER    NOT NULL
price_suffix    VARCHAR    NULL                  -- "/ platter"
countable       BOOLEAN    NOT NULL  DEFAULT FALSE
default_quantity INTEGER   NULL                  -- 6 (irrelevant when countable=false)
default_selected BOOLEAN   NOT NULL  DEFAULT FALSE
display_order   INTEGER    NOT NULL  DEFAULT 0

INDEX (package_id)
```

### `venue_bookings`

```
id                   BIGSERIAL  PK
club_id              INTEGER    NOT NULL  REFERENCES clubs(id)
package_id           BIGINT     NOT NULL  REFERENCES venue_packages(id)
slot_id              BIGINT     NOT NULL  REFERENCES venue_slots(id)
booking_date         DATE       NOT NULL              -- 2026-10-10
start_time           TIME       NOT NULL              -- resolved from slot.default_start_time or admin override
end_time             TIME       NOT NULL
booking_ref          VARCHAR    NOT NULL              -- public ref — "NBC-2026-1091"

status               VARCHAR    NOT NULL  DEFAULT 'pending'  -- pending | confirmed | cancelled | completed | no_show
host_user_id         INTEGER    NULL      REFERENCES users(id)

-- Customer snapshot (never mutate once set — booking is a historical record)
customer_name        VARCHAR    NOT NULL
customer_email       VARCHAR    NOT NULL
customer_phone       VARCHAR    NULL
booking_for          VARCHAR    NULL                  -- "Willis family"

-- Event detail snapshot
occasion             VARCHAR    NULL                  -- "Birthday"
guest_count          INTEGER    NULL
setup_style          VARCHAR    NULL
notes                TEXT       NULL

-- Pricing snapshot (frozen at booking time so later edits to the
--  package/slot/addon rows don't rewrite history)
slot_price_cents     INTEGER    NOT NULL
addons_total_cents   INTEGER    NOT NULL  DEFAULT 0
bond_cents           INTEGER    NOT NULL  DEFAULT 0
total_cents          INTEGER    NOT NULL              -- slot + addons + bond
deposit_cents        INTEGER    NOT NULL
balance_cents        INTEGER    NOT NULL              -- total - deposit
deposit_percent      INTEGER    NOT NULL              -- the % the club had set at submit time

-- Payment state
deposit_paid_at      TIMESTAMP  NULL
balance_due_date     DATE       NULL                  -- 14 days before booking_date
balance_paid_at      TIMESTAMP  NULL
cancelled_at         TIMESTAMP  NULL
cancellation_reason  VARCHAR    NULL                  -- 'customer_cancelled' | 'admin_cancelled' | 'force_majeure'

created_at           TIMESTAMP  NOT NULL  DEFAULT NOW()
updated_at           TIMESTAMP  NOT NULL  DEFAULT NOW()

INDEX (club_id, booking_date)
INDEX (club_id, status, booking_date)
INDEX (slot_id, booking_date)         -- availability lookups
INDEX (host_user_id, booking_date)    -- "my bookings" for host users
UNIQUE (booking_ref)
```

### `venue_booking_addons`

```
id                BIGSERIAL  PK
booking_id        BIGINT     NOT NULL  REFERENCES venue_bookings(id) ON DELETE CASCADE
addon_id          BIGINT     NULL      REFERENCES venue_addons(id)   -- NULL if the addon was deleted after this booking
name_snapshot     VARCHAR    NOT NULL  -- snapshotted so history survives addon renames
unit_price_cents  INTEGER    NOT NULL
quantity          INTEGER    NOT NULL  DEFAULT 1
subtotal_cents    INTEGER    NOT NULL              -- unit_price * quantity

INDEX (booking_id)
```

### `venue_booking_payments`

```
id                BIGSERIAL  PK
booking_id        BIGINT     NOT NULL  REFERENCES venue_bookings(id) ON DELETE CASCADE
amount_cents      INTEGER    NOT NULL
kind              VARCHAR    NOT NULL              -- 'deposit' | 'balance' | 'refund' | 'adjustment'
method            VARCHAR    NOT NULL              -- 'stripe' | 'cash' | 'bank_transfer' | 'cheque'
status            VARCHAR    NOT NULL              -- 'pending' | 'succeeded' | 'failed' | 'refunded'
provider_ref      VARCHAR    NULL                  -- Stripe payment_intent_id, or admin-supplied receipt no.
recorded_by_user_id INTEGER  NULL      REFERENCES users(id)  -- NULL for Stripe webhook writes
notes             VARCHAR    NULL
created_at        TIMESTAMP  NOT NULL  DEFAULT NOW()

INDEX (booking_id)
INDEX (provider_ref)                             -- Stripe webhook lookup
```

### `venue_availability_blocks`

Admins block out dates (closures, maintenance, members-only). Takes precedence over the slot-availability derivation.

```
id              BIGSERIAL  PK
club_id         INTEGER    NOT NULL  REFERENCES clubs(id)
package_id      BIGINT     NULL      REFERENCES venue_packages(id)   -- NULL = all packages
starts_on       DATE       NOT NULL
ends_on         DATE       NOT NULL                              -- inclusive
reason          VARCHAR    NULL                                  -- shown on the admin calendar
created_by_user_id INTEGER NOT NULL  REFERENCES users(id)
created_at      TIMESTAMP  NOT NULL  DEFAULT NOW()

INDEX (club_id, starts_on, ends_on)
```

---

## 2. Public endpoints

### `GET /public/clubs/:slug/venue-packages`

Returns the full package list + slot + addon structure the booking block needs. No auth. Cached 60s edge.

```jsonc
{
  "status": "success",
  "data": {
    "packages": [
      {
        "slug": "the-clubhouse",
        "name": "The clubhouse",
        "sub": "Timber-lined main room · seated 80 · standing 140",
        "bond_cents": 30000,
        "bond_label": "Refundable bond",
        "slots": [
          { "id": 12, "label": "Afternoon · 2pm – 6pm", "sub": "4 hours · $720 · Most booked", "price_cents": 72000, "duration_hours": 4 }
        ],
        "addons": [
          { "id": 7, "name": "Grazing platters", "description": "Serves 8 per platter", "price_cents": 8500, "price_suffix": "/ platter", "countable": true, "default_quantity": 6, "default_selected": true }
        ]
      }
    ],
    "deposit_percent": 25
  }
}
```

### `GET /public/clubs/:slug/venue-packages/:packageSlug/availability?year=2026&month=10`

One month at a time. Returns a per-day map of slot availability so the Paper calendar can colour cells free / some slots / booked.

```jsonc
{
  "status": "success",
  "data": {
    "year": 2026,
    "month": 10,
    "days": {
      "2026-10-01": { "state": "some_slots", "available_slot_ids": [12, 13] },
      "2026-10-03": { "state": "booked", "available_slot_ids": [] },
      "2026-10-10": { "state": "free", "available_slot_ids": [11, 12, 13, 14] }
    }
  }
}
```

`state` is derived server-side: `booked` when all slots have confirmed bookings or a blanket availability block, `some_slots` when at least one is taken, `free` when all are open.

### `POST /public/clubs/:slug/venue-bookings`

Public submit. Rate-limited (1 per minute per IP + per email). Creates a booking in `pending` status + initializes a Stripe PaymentIntent for the deposit. Returns the intent `client_secret` so the FE can run Stripe Elements to collect card detail.

```jsonc
// request
{
  "package_slug": "the-clubhouse",
  "slot_id": 12,
  "booking_date": "2026-10-10",
  "customer_name": "Ruth Willis",
  "customer_email": "ruth@thewillis.co",
  "customer_phone": "027 543 8891",
  "booking_for": "Willis family",            // optional
  "occasion": "Birthday",
  "guest_count": 42,
  "setup_style": "Long tables + bar",
  "notes": "Two guests use wheelchairs. Cake delivered 5:30.",
  "addons": [
    { "addon_id": 7, "quantity": 6 },
    { "addon_id": 9, "quantity": 1 }
  ],
  "consent_terms": true,
  "hp": ""                                   // honeypot — same as enquiries
}

// response
{
  "status": "success",
  "data": {
    "booking_ref": "NBC-2026-1091",
    "total_cents": 193000,
    "deposit_cents": 50000,
    "balance_cents": 143000,
    "balance_due_date": "2026-09-26",
    "payment": {
      "provider": "stripe",
      "intent_client_secret": "pi_3Nxxx_secret_xxx",
      "publishable_key": "pk_live_xxx"
    }
  }
}
```

**Error codes:**

| HTTP | code | When |
|---|---|---|
| 400 | `missing_required` | Required field missing |
| 400 | `bad_email` | malformed |
| 400 | `bad_date` | Not a real date / in the past / before lead-time cutoff |
| 400 | `invalid_addon` | Addon id not in this package |
| 409 | `slot_unavailable` | Date is already booked or an availability block covers it |
| 429 | `rate_limited` | > 1 submit per minute from this IP or email |
| 503 | `bookings_closed` | Club has disabled the resource |

The server MUST re-derive availability inside a transaction (SELECT FOR UPDATE on the slot row scoped to that date) so two parallel submits for the same slot/date resolve to exactly one booking + one 409.

### `POST /public/venue-bookings/:ref/confirm`

Called by the Stripe webhook (`payment_intent.succeeded`) and also by the FE directly on success as a redundancy. Flips the booking to `confirmed` + sets `deposit_paid_at`. Idempotent — multiple hits are safe.

---

## 3. CRM endpoints

Owner / admin / committee role on `club_members` (same scope as Enquiries).

### `GET /clubs/:cid/venue-bookings`

Paginated inbox feed. Default sort: `booking_date ASC`.

**Query params:**
- `status` — comma list. Defaults to `pending,confirmed`.
- `host_user_id` — int. Filter to a specific host.
- `from`, `to` — date range on `booking_date`.
- `search` — matches name / email / booking_ref.
- `limit`, `cursor` — pagination.

**Response:** rows with the fields a CRM list view needs (ref, status, booking date, slot label, customer, host, total, deposit status).

### `GET /clubs/:cid/venue-bookings/:bookingId`

Full detail — same shape plus the add-on list + payment history + any admin notes thread.

### `POST /clubs/:cid/venue-bookings/:bookingId/transitions`

State transitions. Body: `{ to: 'confirmed' | 'cancelled' | 'completed' | 'no_show', reason?: string }`. Rules:

- `pending → confirmed` — allowed any time. If deposit isn't paid yet, this records a manual confirmation and leaves `deposit_paid_at` null until an admin logs a payment.
- `pending → cancelled` — allowed. Nothing to refund.
- `confirmed → cancelled` — allowed. If deposit was paid > 14 days before `booking_date`, triggers an automatic refund; else keeps the deposit (configurable per club later).
- `confirmed → completed` — allowed after `booking_date` has passed.
- `confirmed → no_show` — allowed after `booking_date` + 1 day.
- Any → `cancelled` can also include `reason` → gets stored on the row.

### `POST /clubs/:cid/venue-bookings/:bookingId/assign-host`

Body: `{ host_user_id: number | null }`. Must be a `club_members` row for this club with role `owner` / `admin` / `committee`. Null unassigns.

### `POST /clubs/:cid/venue-bookings/:bookingId/payments`

Admin-logged payment (cash, bank transfer, cheque). Body:

```jsonc
{ "amount_cents": 50000, "kind": "deposit", "method": "cash", "notes": "Paid at the clubhouse", "provider_ref": "receipt-00123" }
```

Server validates the kind + amount against the booking's totals, writes a `venue_booking_payments` row, and updates `deposit_paid_at` / `balance_paid_at` if the booking is now paid up.

### `POST /clubs/:cid/venue-bookings/:bookingId/refund`

Admin refund. Body: `{ amount_cents, reason }`. Writes a `kind: 'refund'` payment row, triggers the Stripe refund if the original was Stripe, no-op for cash. Updates the booking total paid accordingly.

### Package / slot / addon CRUD

```
GET    /clubs/:cid/venue-packages
POST   /clubs/:cid/venue-packages
PATCH  /clubs/:cid/venue-packages/:packageId
DELETE /clubs/:cid/venue-packages/:packageId
POST   /clubs/:cid/venue-packages/:packageId/slots
PATCH  /clubs/:cid/venue-slots/:slotId
DELETE /clubs/:cid/venue-slots/:slotId
POST   /clubs/:cid/venue-packages/:packageId/addons
PATCH  /clubs/:cid/venue-addons/:addonId
DELETE /clubs/:cid/venue-addons/:addonId
```

**Deletion safety** — if a package / slot / addon is referenced by any `venue_bookings` row, the row MUST be soft-deleted (`is_active = false`) rather than physically removed. The admin UI shows soft-deleted rows under an "Archived" filter so historical bookings keep their names.

### Availability blocks

```
GET    /clubs/:cid/venue-availability-blocks
POST   /clubs/:cid/venue-availability-blocks
DELETE /clubs/:cid/venue-availability-blocks/:blockId
```

---

## 4. Payment integration — Stripe

### Setup

Each club connects its own Stripe account via Stripe Connect (direct, not platform fees for v1). The `clubs` table (or a new `club_payment_providers` table) stores `stripe_account_id` once connected.

### Flow

1. Public submit → server creates `PaymentIntent` with:
   ```js
   stripe.paymentIntents.create({
     amount: booking.deposit_cents,
     currency: 'nzd',
     metadata: { booking_id, booking_ref, club_id },
     on_behalf_of: club.stripe_account_id,
     transfer_data: { destination: club.stripe_account_id }
   })
   ```
2. FE confirms the intent with Stripe Elements using the returned `client_secret`.
3. On success, FE calls `POST /public/venue-bookings/:ref/confirm` to speed up the state flip (webhook may lag by a few seconds).
4. Stripe webhook `payment_intent.succeeded` is the authoritative source — fires regardless of whether the FE confirmation call happened. Idempotency via `provider_ref` lookup.

### Balance charge

Scheduled job that runs daily at 03:00 NZT:

```sql
SELECT id FROM venue_bookings
WHERE status = 'confirmed'
  AND balance_paid_at IS NULL
  AND balance_due_date <= CURRENT_DATE
```

For each hit, create a Stripe PaymentIntent off the saved customer / payment method (if the club has set up off-session charges). Falls back to emailing the customer a "pay balance" link if off-session isn't configured.

### What ships in v1 vs. v2

| Scope | v1 (sink into enquiries) | v1.5 (resource, manual) | v2 (Stripe) |
|---|---|---|---|
| Public submit lands as | enquiry | `venue_bookings` row (pending) | `venue_bookings` + PaymentIntent |
| Deposit charged | no | admin logs cash / bank | Stripe |
| Balance charged | no | admin logs | Stripe scheduled |
| CRM inbox | enquiries | dedicated | dedicated |
| State transitions | reply to enquiry | confirmed / cancelled | + refund |
| Calendar block | no | yes (confirmed row blocks slot) | yes |

**Recommend building v1.5 as the first backend ship** — delivers 80% of the value (dedicated CRM inbox, deposit tracking, host assignment, calendar block) without the Stripe lift. v2 can follow once a club actually wants auto-charging.

---

## 5. Email flows

All route through `recordTransactionalEmail` from brief 54 so sends land in the Communications history. Flavors:

| Flavor | When | Recipient |
|---|---|---|
| `venue_booking_received` | public submit → pending | customer |
| `venue_booking_received_admin` | public submit → pending | club owner + assigned host (if any) |
| `venue_booking_confirmed` | status → confirmed | customer |
| `venue_booking_balance_due` | 7 days before `balance_due_date` | customer |
| `venue_booking_balance_paid` | balance_paid_at set | customer |
| `venue_booking_cancelled` | status → cancelled | customer |
| `venue_booking_host_assigned` | assign-host transition | assigned host user |

Templates live in the email-template system from brief 45. Default copy ships in the migration; owners can customise via Settings → Email flavours.

---

## 6. Frontend contract summary

New api-client resource `packages/api-client/src/resources/venueBookings.ts`:

```ts
export interface VenueBooking { /* fields per §1 */ }
export interface SubmitBookingInput { /* fields per POST public submit */ }
export interface SubmitBookingResult { booking_ref: string; total_cents: number; deposit_cents: number; balance_cents: number; balance_due_date: string; payment: { intent_client_secret: string; publishable_key: string } }

export const venueBookings = {
  // Public
  getPackages(slug: string): Promise<...>,
  getAvailability(slug: string, packageSlug: string, year: number, month: number): Promise<...>,
  submit(slug: string, input: SubmitBookingInput): Promise<SubmitBookingResult>,
  confirm(ref: string): Promise<...>,
  // CRM
  list(clubId: number, params?: ListParams): Promise<...>,
  get(clubId: number, bookingId: number): Promise<VenueBooking>,
  transition(clubId: number, bookingId: number, to: BookingStatus, reason?: string): Promise<...>,
  assignHost(clubId: number, bookingId: number, hostUserId: number | null): Promise<...>,
  logPayment(clubId: number, bookingId: number, input: LogPaymentInput): Promise<...>,
  // Package CRUD
  listPackages(clubId: number): Promise<...>,
  createPackage(clubId: number, input: CreatePackageInput): Promise<...>,
  // etc.
}
```

### FE migration plan

Once the resource ships:

1. `VenueBookingBlock.vue` swaps the `enquiries.create` call for `venueBookings.submit`.
2. The block fetches package definitions from the backend on mount (when the block is dropped on a CMS page) instead of reading from the configured `packages` prop — admin configures packages in CRM Settings → Venue hire, not inline on the block.
3. The block mounts Stripe Elements to collect card detail on Step 2 rather than skipping to a fake confirmation.
4. New CRM view at `/crm/venue-bookings` with the inbox + detail panel + inline state transition controls. Shape mirrors the Enquiries + Applications pattern.
5. Existing bookings sitting in Enquiries don't migrate — they stay as-is. Clubs that have the v1 flow enabled will see new bookings in the new resource; historical ones remain accessible via the Enquiries inbox.

---

## 7. Error table (new codes)

```
400  missing_required          — payload shape
400  bad_email                 — malformed
400  bad_date                  — not real / in the past / before lead-time
400  invalid_addon             — addon id not in package
400  invalid_slot              — slot id not in package / disabled
400  invalid_amount            — payment amount doesn't match booking state
400  invalid_transition        — status flip not allowed from current state
403  forbidden                 — role doesn't allow this action
404  booking_not_found         — ref or id doesn't exist for this club
404  package_not_found
404  slot_not_found
409  slot_unavailable          — concurrency / availability block
409  booking_not_pending       — tried to collect deposit on a confirmed booking
429  rate_limited              — public submit throttle
503  bookings_closed           — club has venue_bookings_enabled = false
```

---

## 8. Verification (please attach outputs)

```bash
# 1. Package list reads back the admin-authored structure
curl -s "$API/public/clubs/$SLUG/venue-packages" | jq '.data.packages | length'

# 2. Availability for a month
curl -s "$API/public/clubs/$SLUG/venue-packages/the-clubhouse/availability?year=2026&month=10" | jq '.data.days | keys | length'

# 3. Submit a booking (v1.5 mode — no Stripe yet)
curl -X POST "$API/public/clubs/$SLUG/venue-bookings" \
  -H "Content-Type: application/json" \
  -d '{"package_slug":"the-clubhouse","slot_id":12,"booking_date":"2026-10-10","customer_name":"Ruth Willis","customer_email":"ruth@thewillis.co","consent_terms":true,"addons":[{"addon_id":7,"quantity":6}]}'
# → 200, booking_ref returned

# 4. Same slot/date again → 409
# ↳ repeat #3 → expect {"status":"error","code":"slot_unavailable"}

# 5. CRM lists the booking as pending
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/venue-bookings?status=pending"

# 6. Admin confirms + logs cash deposit
curl -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  "$API/clubs/$CID/venue-bookings/$ID/transitions" -d '{"to":"confirmed"}'
curl -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  "$API/clubs/$CID/venue-bookings/$ID/payments" -d '{"amount_cents":50000,"kind":"deposit","method":"cash"}'

# 7. Email trail landed in brief 54's communications feed
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/communications?flavor=venue_booking_confirmed"
```

Pass criteria:

- ✓ Concurrent submits for same slot/date resolve to one booking + one 409.
- ✓ Deleting a referenced package / slot / addon soft-deletes rather than erroring.
- ✓ `balance_due_date` is calculated server-side as `booking_date - 14 days` (configurable per club later).
- ✓ Transitioning `cancelled` on a booking with a paid Stripe deposit triggers a refund PaymentIntent (v2 only).
- ✓ Scheduled balance-charge job is idempotent (safe to re-run same day).
- ✓ CRM list query filtered by `host_user_id` returns only bookings assigned to that user.

---

## 9. Non-goals (v1)

- **No multi-day bookings.** One date per booking. Clubs needing weekend-long takeovers split into two bookings today; a `booking_dates[]` extension is a follow-up.
- **No admin-side quoting.** Request-a-quote packages (like the Naenae "Whole shebang") sink into enquiries, not bookings, for v1. A quote → booking promotion endpoint is v3.
- **No partial refunds via the public flow.** All refunds are admin-initiated.
- **No seat / table assignment.** We tell the admin "42 guests, long tables + bar" and they handle the room layout themselves.
- **No dependency on calendar sync.** Google / Apple calendar export is deferred to a follow-up — v1 ships "Add to calendar" as an iCal download served from the booking confirmation page.

---

## 10. Contact

Ping Felicity in the frontend channel when v1.5 (resource + manual payments) ships. The FE swap is small — one resource import + one submit-path rewrite + a new CRM view. Stripe (v2) can follow weeks later without blocking the first wave.
