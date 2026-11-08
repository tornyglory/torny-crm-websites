# Per-slot capacity — `venue_slots.max_bookings`

**Feature:** today each venue slot can hold exactly one booking per date — the first booking wins and the slot is marked fully taken. For clubs with larger venues that can run multiple events in parallel (main hall + mezzanine during the same afternoon), one-per-slot is too restrictive. This brief adds a per-slot `max_bookings` count so an admin can say "the clubhouse afternoon can take 3 simultaneous bookings."

**Status:** backend owes one column + two query tweaks. FE public contract doesn't change — `/venue-availability` still returns `(date, slot_id)` tuples, just only when the slot is actually at capacity. Admin FE adds one input in the venue-package slot editor.

**Related briefs:**
- Brief 62 — venue-bookings resource. Introduced the `venue_slots` table.
- Brief 77 — public Stripe Checkout. The `/checkout` endpoint's conflict-detection logic needs the same COUNT swap.
- Brief 84 — public availability endpoint. Same COUNT swap for the "which slots are taken" query.

---

## TL;DR

- **Schema:** `ALTER TABLE venue_slots ADD COLUMN max_bookings INT NOT NULL DEFAULT 1 CHECK (max_bookings >= 1)`.
- **PATCH slot:** `max_bookings` is a new optional field on `/clubs/{cid}/venue-packages/{pid}/slots/{sid}`. Reject with 400 `below_current_count` when an admin tries to drop it below the number of currently-confirmed bookings for that slot on any future date.
- **`/venue-availability`:** change from `EXISTS` to `COUNT`. Emit a row in `taken[]` only when `COUNT(bookings_for_date_and_slot) >= max_bookings`.
- **`/checkout` + `/venue-bookings` (public submit):** same `COUNT >= max_bookings` guard. Reject with 409 `slot_full` when over capacity.
- **Existing rows:** DEFAULT 1 means every slot in prod behaves identically to today. Zero behaviour change for the 99% of clubs that only ever had one-at-a-time.

---

## 1. Schema

```sql
ALTER TABLE venue_slots
  ADD COLUMN max_bookings INT NOT NULL DEFAULT 1;

-- Soft constraint — enforce at the handler layer so the backend can
-- return a friendly 400 instead of a DB error.
ALTER TABLE venue_slots
  ADD CONSTRAINT venue_slots_max_bookings_positive CHECK (max_bookings >= 1);
```

No backfill — DEFAULT 1 takes care of every existing row. Keeps today's "one booking per slot per date" semantics unchanged for every live club.

---

## 2. Slot PATCH — `/clubs/{cid}/venue-packages/{pid}/slots/{sid}`

### Request — add one optional field

```jsonc
{
  "label":              "Afternoon",
  "start_time":         "14:00",
  "duration_minutes":   240,
  "price_cents":        30000,
  "max_bookings":       3,          // NEW — 1..999, default 1
  "disabled":           false,
  "default_selected":   false
}
```

Rules:
- `max_bookings` — integer, 1..999. Missing = no-op. `null` is **not** valid — pass 1 to "effectively disable" multi-booking.

### 400 `below_current_count`

When an admin tries to drop `max_bookings` below the current number of **confirmed** (or `pending_payment` within the brief 84 freshness window) bookings for that slot on any future date, reject the PATCH:

```jsonc
{
  "status": "error",
  "code": "below_current_count",
  "message": "Slot already has 2 confirmed bookings on 2026-12-14. Cancel or move them before lowering the capacity.",
  "data": {
    "field": "max_bookings",
    "conflicting_dates": [
      { "date": "2026-12-14", "booked_count": 2 }
    ]
  }
}
```

Why reject instead of accept-and-oversubscribe: cleaner mental model. Oversubscribed slots would show "Booked" in the public calendar but let one more renter through on `/checkout` because COUNT(2) < max(1) is false — that's confusing. Forcing admins to resolve conflicts first keeps the system's invariants honest.

### 400 `bad_max_bookings`

Standard value validation:

```jsonc
{ "status": "error", "code": "bad_max_bookings", "message": "max_bookings must be an integer between 1 and 999" }
```

### 200 response

Echoes the full slot row with the new field:

```jsonc
{
  "status": "success",
  "data": {
    "id":               17,
    "label":            "Afternoon",
    "start_time":       "14:00",
    "duration_minutes": 240,
    "price_cents":      30000,
    "max_bookings":     3,
    "disabled":         false,
    "default_selected": false
  }
}
```

The public `/venue-packages` endpoint also starts carrying `max_bookings` on each slot — not consumed by the FE today (the public calendar works off the derived `taken[]` state) but there for admins building custom integrations.

---

## 3. `/venue-availability` — switch EXISTS → COUNT

Brief 84's endpoint currently returns a `(date, slot_id, package_id)` row for any slot that has at least one booking (`confirmed`, `pending`, or fresh `<24h pending_payment`). Change to COUNT-based:

```sql
-- Pseudocode — adjust for your actual query shape.
SELECT b.booking_date AS date, b.slot_id, b.package_id
  FROM venue_bookings b
  JOIN venue_slots s ON s.id = b.slot_id
 WHERE b.booking_date BETWEEN :from AND :to
   AND b.status IN ('confirmed', 'pending')
       OR (b.status = 'pending_payment' AND b.created_at > NOW() - INTERVAL 24 HOUR)
   AND b.deleted_at IS NULL
 GROUP BY b.booking_date, b.slot_id, b.package_id, s.max_bookings
HAVING COUNT(*) >= s.max_bookings
 ORDER BY b.booking_date, b.slot_id;
```

Response shape is unchanged — FE sees the same `{ taken: [{ date, slot_id, package_id }] }`, just emitted only when the slot is actually full. A date/slot combo with 2 bookings against a `max_bookings=3` slot won't appear; one with 3 bookings will.

---

## 4. `/checkout` + `/venue-bookings` — same COUNT guard

Both the public Stripe checkout (brief 77 §1) and the direct submit (brief 62 §3) currently reject with `409 slot_unavailable` when any booking already exists for the `(date, slot_id)`. Swap to:

```sql
SELECT COUNT(*)
  FROM venue_bookings
 WHERE booking_date = :date
   AND slot_id = :slot_id
   AND status IN ('confirmed', 'pending', 'pending_payment')  -- fresh only for pending_payment
   AND deleted_at IS NULL
```

If `COUNT(*) >= slot.max_bookings` → 409 `slot_full` (rename from `slot_unavailable` is optional — if the current code is `slot_unavailable`, keep it to avoid FE copy churn; new semantics, same code). FE already surfaces whatever message the backend returns.

---

## 5. Public `/venue-packages`

Add `max_bookings` to the slot shape so admin tools + the admin CRM editor have the value. The public venue-booking block doesn't consume it — all capacity logic flows through `/venue-availability`'s derived `taken[]` — but it's part of a complete slot payload and costs nothing to include.

```jsonc
{
  "data": {
    "packages": [
      {
        "id": 42,
        "slots": [
          {
            "id": 17,
            "label": "Afternoon",
            "start_time": "14:00",
            "price_cents": 30000,
            "max_bookings": 3,
            "disabled": false
          }
        ]
      }
    ]
  }
}
```

---

## 6. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set max_bookings = 3 on an existing slot.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/42/slots/17" \
  -d '{"max_bookings": 3}'
# → 200 { data: { id: 17, max_bookings: 3, ... } }

# 2. Two bookings against that slot for 2026-12-14. Neither shows as taken.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-12-01&to=2026-12-31&package_id=42"
# → 200, no entry for (2026-12-14, slot 17).

# 3. Third booking fills the slot.
# The next GET returns an entry for (2026-12-14, slot 17, package 42).

# 4. Fourth attempt via /checkout.
curl -X POST "$VENUE/public/clubs/nae-nae-bowling-club/venue-bookings/checkout" \
  -d '{ "slot_id": 17, "booking_date": "2026-12-14", ... }'
# → 409 { code: 'slot_unavailable' } (or slot_full — pick one)

# 5. Admin tries to drop max_bookings below current count.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/42/slots/17" \
  -d '{"max_bookings": 1}'
# → 400 { code: 'below_current_count', data: { conflicting_dates: [{ date: '2026-12-14', booked_count: 3 }] } }

# 6. Out-of-range value.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/42/slots/17" \
  -d '{"max_bookings": 0}'
# → 400 { code: 'bad_max_bookings' }

# 7. Public packages carries the field.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-packages" | jq '.data.packages[0].slots[0].max_bookings'
# → 3
```

### Pass criteria

- ✓ `venue_slots.max_bookings` column exists with DEFAULT 1.
- ✓ PATCH accepts 1..999; rejects 0, negatives, non-integers, nulls.
- ✓ PATCH rejects 400 `below_current_count` + a `conflicting_dates` hint when dropping below live bookings.
- ✓ `/venue-availability` emits `taken[]` rows only when count >= max.
- ✓ `/checkout` + public submit 409 at capacity.
- ✓ `/venue-packages` carries `max_bookings` on each slot.
- ✓ Existing clubs behave identically to today (DEFAULT 1).

---

## 7. Non-goals

- **No cross-slot capacity** (e.g. "the physical hall can only host 2 events at once regardless of which slot they're in"). That's a venue-level resource-pooling problem for a later brief.
- **No time-overlap detection**. Two slots that overlap in real time (e.g. "Afternoon 2-6pm" and "Evening 4-10pm") still book independently. The admin configures slots without overlap today; this brief doesn't change that assumption.
- **No per-booking size check**. A slot with `max_bookings=3` could take three bookings of 200 guests each — the backend doesn't compare the renters' `attendee_count` against a physical cap. If a club needs a hard-cap on total guests across concurrent bookings, that's a separate feature.
- **No admin dashboard surface for utilisation**. This brief just makes capacity configurable; "show me how booked up December is" is a reporting feature to design separately.
