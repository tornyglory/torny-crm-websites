# Public venue availability — real dates in the booking calendar

**Feature:** the public venue-booking calendar on each club site currently shows every future date past the configured lead-time as clickable, regardless of whether the club is already booked. This brief wires in a per-month availability lookup so dates with no slots left for the renter's currently-selected package are visibly greyed out and unclickable.

**Status:** FE calendar already renders the grid; it just doesn't know what's taken. Backend owes one new public endpoint. Once it ships, the FE fetches on package change + month nav, marks fully-booked dates grey.

**Related briefs:**
- Brief 77 — public venue-booking Checkout. §12 explicitly carved out "no slot-hold during Checkout" and "no availability lookup" as v1 non-goals. This brief closes the latter.
- Brief 62 — venue-bookings resource. The row shape referenced here was defined there.

---

## TL;DR

- New endpoint: `GET /public/clubs/{slug}/venue-availability?from=YYYY-MM-DD&to=YYYY-MM-DD[&package_id=…]`.
- Returns a thin array of `{ date, slot_id, package_id }` tuples — one entry per **already-taken** slot in the range.
- Public, no auth, cacheable (HTTP `Cache-Control: public, max-age=60`).
- FE fetches once per visible month + whenever the admin changes which package the renter has selected, then derives "fully booked" per-date by intersecting with the selected package's slot list.

**Does not solve** the Stripe-Checkout race condition (two renters paying for the same slot within the same minute). That's brief 77's deferred slot-hold feature — out of scope here.

---

## 1. `GET /public/clubs/{slug}/venue-availability`

### Query params

| name | type | required | notes |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | yes | Start of the window (inclusive). |
| `to`   | `YYYY-MM-DD` | yes | End of the window (inclusive). Max 95 days past `from` (reject with 400 `range_too_wide` otherwise — covers 3 visible months of the FE calendar with some slack). |
| `package_id` | integer | no | Optional filter. When set, only returns taken slots belonging to this package — the FE passes it so stale "other packages' bookings" don't grey out dates. When omitted, returns every taken slot across every package. |

### Response — 200

```jsonc
{
  "status": "success",
  "data": {
    "taken": [
      { "date": "2026-12-14", "slot_id": 17, "package_id": 42 },
      { "date": "2026-12-14", "slot_id": 18, "package_id": 42 },
      { "date": "2026-12-18", "slot_id": 23, "package_id": 51 }
    ]
  }
}
```

### Which bookings count as "taken"?

Return a row for every `venue_booking` whose `booking_date` is inside `[from, to]` AND whose status is one of:

- `confirmed` — admin confirmed it; it's going ahead.
- `pending` — admin hasn't actioned the enquiry yet, but the slot is implicitly reserved until they decide.
- `pending_payment` — brief 77's in-flight Stripe Checkout, but **only when `created_at` is less than 24 hours ago**. Older `pending_payment` rows are stale (renter walked away from Stripe); treat them as not taken and sweep them in a follow-up cleanup job.

Rows with `status` in (`declined`, `cancelled`, `refunded`, `partially_refunded`, `completed`) are **not** returned — those slots are free to rebook.

### 400 errors

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_from` / `bad_to` | missing or not a valid ISO date |
| 400 | `range_inverted` | `to` < `from` |
| 400 | `range_too_wide` | `to - from` > 95 days |
| 400 | `bad_package_id` | provided but not an integer |

### 404

| HTTP | code | meaning |
|---|---|---|
| 404 | `not_found` | slug doesn't resolve to a club, OR `package_id` was passed and doesn't belong to this club |

### Caching

Public, 60 seconds:

```
Cache-Control: public, max-age=60
```

A 60s stale window is the right trade — renters see new bookings quickly without hammering the DB on every month-hop. Admins taking a phone booking and wanting the calendar to reflect it instantly: that's what the admin CRM is for, not the public renter flow.

---

## 2. FE wiring (plan — not asking you to do this, just so the contract makes sense)

```ts
// packages/api-client/src/resources/venueBookings.ts
export interface TakenSlot { date: string; slot_id: number; package_id: number }
export interface VenueAvailabilityResult { taken: TakenSlot[] }

export async function publicAvailability(
  slug: string,
  from: string,
  to: string,
  opts?: { packageId?: number; signal?: AbortSignal },
): Promise<VenueAvailabilityResult>
```

In `VenueBookingBlock.vue`:
- On package change + month nav, fetch availability for the visible month (± a few days of overlap).
- Index the response by date: `Map<string, Set<number>>` mapping `YYYY-MM-DD → Set<slot_id>`.
- `isDateFullyBooked(cell)` = every non-disabled slot on the current package is in that date's set.
- `bookable: date >= earliestBookable && !isDateFullyBooked(cell)`.
- At step 2 (slot picker), individual slots that are taken for the selected date render disabled with a "already booked" tooltip.

---

## 3. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Normal month lookup.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-12-01&to=2026-12-31"
# → 200 { data: { taken: [{ date: '2026-12-14', slot_id: 17, package_id: 42 }, ...] } }

# 2. Package-filtered.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-12-01&to=2026-12-31&package_id=42"
# → 200, only entries with package_id=42.

# 3. Inverted range.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-12-31&to=2026-12-01"
# → 400 { code: 'range_inverted' }

# 4. Too wide.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-01-01&to=2026-12-31"
# → 400 { code: 'range_too_wide' }

# 5. Pending bookings count.
#    Admin creates a pending venue booking for 2026-12-20 slot 17.
#    Re-run (1) — the response includes { date: '2026-12-20', slot_id: 17 }.

# 6. Cancelled bookings DON'T count.
#    Admin cancels a confirmed booking for 2026-12-14 slot 17.
#    Re-run (1) — the entry for (2026-12-14, slot 17) is gone.

# 7. Stale pending_payment doesn't count.
#    Insert a venue_booking with status='pending_payment', created_at=NOW() - 48h.
#    Re-run (1) — that entry does NOT appear.
```

### Pass criteria

- ✓ Endpoint responds 200 with a flat `taken` array.
- ✓ Returns rows only for `confirmed`, `pending`, and fresh (<24h) `pending_payment` bookings.
- ✓ Package filter works — mismatched entries are excluded.
- ✓ Range validation 400s as spec'd.
- ✓ `Cache-Control` header set to `public, max-age=60`.
- ✓ 404 cleanly when slug or package don't resolve.
- ✓ Smoke from the FE: refresh the Naenae `/venue-hire/book` page, nav forward a month that has at least one confirmed booking. The booked date appears greyed out and non-clickable.

---

## 4. Non-goals

- **No per-day capacity.** A date is either fully-booked for the selected package or available. No "3 of 5 slots left" number on the calendar.
- **No slot-hold / pessimistic locking.** Two renters hitting Stripe Checkout at the same time for the same slot is still possible. Brief 77's follow-up.
- **No admin override surface.** This endpoint is read-only; admins can't mark individual dates as unavailable (holidays, maintenance) through it. That's a separate "blackout dates" feature.
- **No historical data.** Only forward-looking availability. `from` dates in the past still work (returns matching historical bookings) but no special treatment.
- **No cross-package conflicts.** If packages share physical space (e.g. "Function room" and "Full venue"), the FE only sees conflicts within the currently-selected package. Handling cross-package exclusivity is a data-modelling problem for a later brief.

---

## 5. Contact

Ping Felicity once the endpoint is deployed. The FE wiring is a single commit — swap the `bookable` computed in `VenueBookingBlock.vue` to consult the availability map, add the fetch on month nav + package change. No coordinated rollout needed; the endpoint shipping unlocks the UI immediately.
