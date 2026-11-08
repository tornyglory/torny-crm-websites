# Per-slot capacity — `venue_slots.max_bookings`

**Feature:** today each venue slot can hold exactly one booking per date — the first booking wins and every subsequent attempt gets 409'd. For clubs with larger venues that can run multiple events in parallel (main hall + mezzanine during the same afternoon), one-per-slot is too restrictive. This brief adds a per-slot `max_bookings` count so an admin can say "the clubhouse afternoon can take 3 simultaneous bookings."

**Status:** backend live on 2026-11-09 (migration 148, TornyCrmStack + TornyVenueStack redeploys). Public contract on `/venue-availability` is unchanged — it still returns `(date, slot_id, package_id)` tuples, just only when the slot is actually at capacity. Admin FE adds one input in the venue-package slot editor.

**Clarification vs the pasted draft:** the draft said "both the public Stripe checkout and the direct submit currently reject with 409 `slot_unavailable` when any booking already exists for the (date, slot_id)." That wasn't true — the submit/checkout handlers didn't have any slot conflict check at all. So this brief **adds** the capacity guard (with the COUNT >= max_bookings logic) rather than modifying an existing one. Backward-compatible: `DEFAULT 1` on every existing row means prod now behaves as the draft assumed it already did.

**Related briefs:**
- Brief 62 — venue-bookings resource. Introduced the `venue_slots` table.
- Brief 77 — public Stripe Checkout. The `/checkout` endpoint's conflict detection is wired here.
- Brief 84 — public availability endpoint. The COUNT swap is wired here.

---

## TL;DR

- **Schema:** migration 148 — `ALTER TABLE venue_slots ADD COLUMN max_bookings INT NOT NULL DEFAULT 1`.
- **Package PATCH** (`PATCH /clubs/{cid}/venue-packages/{pid}`): each slot now accepts a `max_bookings` field. Validator enforces 1..999 as an integer; reject with 400 `bad_max_bookings` otherwise. When an admin lowers a slot's capacity below the live booking count on any future date, reject with 400 `below_current_count` + a `data.conflicts` block that lists the offending dates per slot.
- **`/venue-availability`:** swapped from a per-row SELECT to GROUP BY + HAVING `COUNT(*) >= s.max_bookings`. Response shape unchanged.
- **`/checkout` + direct submit** (`POST /public/clubs/{slug}/venue-bookings[/checkout]`): both now run a COUNT guard against the slot's `max_bookings` before inserting. Over-cap returns `409 slot_unavailable` with `data: { slot_id, date, capacity }`.
- **Public `/venue-packages`:** each slot now carries `max_bookings` on the response shape.
- **Existing rows:** `DEFAULT 1` means every slot in prod behaves identically to before migration 148. Zero behaviour change for clubs that haven't bumped the capacity on any slot.

---

## 1. Schema — migration 148

```sql
ALTER TABLE venue_slots
    ADD COLUMN max_bookings INT NOT NULL DEFAULT 1;
```

Handler layer enforces 1..999. No `CHECK` constraint on the column — the admin PATCH is the only write path for `max_bookings`, so DB-level enforcement would just produce less friendly errors.

---

## 2. Package PATCH — slot field

Request (existing shape, plus `max_bookings` on each slot):

```jsonc
{
  "name": "Clubhouse",
  "slots": [
    {
      "id": 17,                      // optional — null for new slot
      "label": "Afternoon",
      "sub": "2pm – 6pm",
      "price_cents": 30000,
      "duration_hours": 4,
      "default_start_time": "14:00",
      "is_disabled": false,
      "display_order": 10,
      "max_bookings": 3              // NEW — integer 1..999, defaults to 1
    }
  ]
}
```

Rules:
- `max_bookings` — integer, 1..999. Missing = 1 (default). `null` not accepted; pass `1` to explicitly disable multi-booking.
- `below_current_count` — when the incoming `max_bookings` is strictly less than the current stored value AND any future date has `COUNT(live bookings) > incoming value`, the whole PATCH is rejected. Live = `confirmed` + `pending` + fresh (<24h) `pending_payment`, same rules as `/venue-availability`.

### 400 `below_current_count`

```jsonc
{
  "status": "error",
  "code": "below_current_count",
  "message": "Slot 17 already has 2 bookings on 2026-12-14. Cancel or move them before lowering the capacity.",
  "data": {
    "field": "max_bookings",
    "conflicts": [
      {
        "slot_id":       17,
        "requested_max": 1,
        "dates": [
          { "date": "2026-12-14", "booked_count": 2 },
          { "date": "2026-12-21", "booked_count": 3 }
        ]
      }
    ]
  }
}
```

`conflicts` is always an array — multi-slot PATCHes that lower several capacities at once can produce multiple entries. The `message` summarises the first conflict for the common one-slot case.

### 400 `bad_max_bookings`

```jsonc
{ "status": "error", "code": "bad_max_bookings", "message": "slot[0].max_bookings must be an integer between 1 and 999" }
```

### 200 response

Each slot in the echoed package now carries `max_bookings`:

```jsonc
{
  "data": {
    "slots": [
      {
        "id": 17,
        "label": "Afternoon",
        "price_cents": 30000,
        "duration_hours": 4,
        "default_start_time": "14:00",
        "is_disabled": false,
        "max_bookings": 3,
        "display_order": 10
      }
    ]
  }
}
```

---

## 3. `/venue-availability` — COUNT + HAVING

Prior logic emitted a row for every (date, slot, package) with at least one live booking. New query groups + filters by slot capacity:

```sql
SELECT DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS date,
       b.venue_slot_id    AS slot_id,
       b.venue_package_id AS package_id
  FROM venue_bookings b
  JOIN venue_slots s ON s.id = b.venue_slot_id
 WHERE b.club_id = ? AND b.deleted_at IS NULL
   AND b.booking_date BETWEEN ? AND ?
   [AND b.venue_package_id = ?]
   AND (
     b.status IN ('pending', 'confirmed')
     OR (b.status = 'pending_payment' AND b.created_at >= (NOW() - INTERVAL 24 HOUR))
   )
 GROUP BY b.booking_date, b.venue_slot_id, b.venue_package_id, s.max_bookings
HAVING COUNT(*) >= s.max_bookings
 ORDER BY b.booking_date, b.venue_slot_id;
```

Response shape is **unchanged** — FE still gets `{ taken: [{ date, slot_id, package_id }, …] }`. A date/slot combo with 2 bookings against a `max_bookings=3` slot won't appear; one with 3 bookings will.

---

## 4. `/checkout` + public submit — COUNT guard

Both `POST /public/clubs/{slug}/venue-bookings` and `POST /public/clubs/{slug}/venue-bookings/checkout` now run a capacity check after resolving the slot and before writing anything:

```sql
SELECT COUNT(*) FROM venue_bookings
 WHERE venue_slot_id = ? AND booking_date = ? AND deleted_at IS NULL
   AND (
     status IN ('pending', 'confirmed')
     OR (status = 'pending_payment' AND created_at >= (NOW() - INTERVAL 24 HOUR))
   )
```

If `COUNT(*) >= slot.max_bookings` → 409 `slot_unavailable`:

```jsonc
{
  "status": "error",
  "code": "slot_unavailable",
  "message": "That slot is already fully booked for the selected date — please choose a different time or date.",
  "data": { "slot_id": 17, "date": "2026-12-14", "capacity": 3 }
}
```

`slot_unavailable` is the code the pasted brief suggested; I kept it so the FE's existing error-handling copy still fires.

### Residual race condition (unchanged non-goal)

Two renters hitting `/checkout` for the slot's last capacity slot within the same ~100ms window can both pass the COUNT check (both see N-1 bookings) and both insert — admin ends up with N+1 bookings. Brief 77's deferred slot-hold feature is the real fix. In practice this is rare and the admin can refund the loser via the existing refund endpoint.

---

## 5. Public `/venue-packages`

Each slot in the response now carries `max_bookings`:

```jsonc
{
  "data": {
    "packages": [
      {
        "id": 42,
        "slots": [
          { "id": 17, "label": "Afternoon", "price_cents": 30000, "max_bookings": 3, ... }
        ]
      }
    ]
  }
}
```

Not consumed by the public venue-booking block today (the calendar's greyout logic flows through `/venue-availability`'s derived `taken[]`), but makes the slot payload complete.

---

## 6. Verification — live

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set max_bookings = 3 on an existing slot via the package PATCH.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/9" \
  -d '{"slots":[{"id":12,"label":"Afternoon","price_cents":30000,"duration_hours":4,"default_start_time":"14:00","is_disabled":false,"max_bookings":3}]}'
# → 200 { data: { slots: [{ id: 12, max_bookings: 3, ... }] } }

# 2. Two bookings against slot 12 for 2026-12-17. That date disappears from /venue-availability.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-availability?from=2026-12-01&to=2026-12-31&package_id=9"
# → 200, no entry for (2026-12-17, slot 12).

# 3. Third booking fills the slot. /venue-availability now includes it.
# (Insert one more via the admin CRM or /venue-bookings submit.)

# 4. Fourth attempt via /checkout.
curl -X POST "$VENUE/public/clubs/nae-nae-bowling-club/venue-bookings/checkout" \
  -d '{ "slot_id": 12, "booking_date": "2026-12-17", ... }'
# → 409 { code: 'slot_unavailable', data: { slot_id: 12, date: '2026-12-17', capacity: 3 } }

# 5. Admin tries to drop max_bookings to 1 with 3 live bookings already on 2026-12-17.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/9" \
  -d '{"slots":[{"id":12,"label":"Afternoon","price_cents":30000,"duration_hours":4,"default_start_time":"14:00","is_disabled":false,"max_bookings":1}]}'
# → 400 { code: 'below_current_count', data: { conflicts: [{ slot_id: 12, requested_max: 1, dates: [{ date: '2026-12-17', booked_count: 3 }] }] } }

# 6. Out-of-range value.
curl -X PATCH -H "Authorization: Bearer $JWT" \
  "$CRM/clubs/5/venue-packages/9" \
  -d '{"slots":[{"id":12,"label":"Afternoon","price_cents":30000,"max_bookings":0}]}'
# → 400 { code: 'bad_max_bookings' }

# 7. Public /venue-packages carries the field.
curl "$VENUE/public/clubs/nae-nae-bowling-club/venue-packages" | jq '.data.packages[0].slots[0].max_bookings'
# → 3
```

### Pass criteria

- ✓ `venue_slots.max_bookings` column exists with `DEFAULT 1`.
- ✓ Package PATCH accepts `max_bookings` 1..999; rejects 0, negatives, non-integers.
- ✓ Package PATCH rejects 400 `below_current_count` + `data.conflicts` when lowering below live bookings.
- ✓ `/venue-availability` emits `taken[]` rows only when count >= max.
- ✓ `/checkout` + public submit 409 at capacity with a usable `data` block.
- ✓ Public `/venue-packages` carries `max_bookings` on each slot.
- ✓ Existing clubs behave identically to pre-148 (`DEFAULT 1`).

---

## 7. Non-goals

- **No per-slot PATCH endpoint.** The pasted brief assumed `PATCH /clubs/{cid}/venue-packages/{pid}/slots/{sid}` exists — it doesn't. Slot edits all flow through the package-level PATCH today (diff-based: rows with `id` → UPDATE, without → INSERT, missing → DELETE). Keeping that shape; `max_bookings` is just another field on each slot entry.
- **No cross-slot capacity** (e.g. "the physical hall can only host 2 events at once regardless of which slot they're in"). That's a venue-level resource-pooling problem for a later brief.
- **No time-overlap detection.** Two slots that overlap in real time (e.g. "Afternoon 2-6pm" and "Evening 4-10pm") still book independently.
- **No per-booking size check.** A slot with `max_bookings=3` could take three bookings of 200 guests each — the backend doesn't compare the renters' `attendee_count` against a physical cap.
- **No slot-hold / pessimistic locking** during Stripe Checkout. The race condition described in §4 persists; brief 77's deferred feature is the fix.
- **No admin dashboard surface for utilisation.** This brief just makes capacity configurable.
