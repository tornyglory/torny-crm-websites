# Payments → explicit season attribution

**Feature:** make the season a payment attaches to an explicit property on the payment row, not a derivation from `payment_date` + implicit "current season" at write time. CRM admins need to back-date into a past season (someone paid in October for last season's fees) and pre-pay a future season — today, both silently land in whatever `is_current_season = true` was at the moment the POST ran.

**Status:** frontend shipped 2026-10-22 — the Record payment modal now surfaces a Season picker defaulted to the page's season context, Mark paid on the member detail page omits `season_id` (and expects the server to default to current + echo back which season it chose). `RecordPaymentInput` now carries `season_id?: number`; `RecordPaymentResult` reads back `season_id` + `season_name`. Backend currently ignores the new field and the result shape works whether the server echoes it or not — nothing is broken, but the attribution is still implicit.

**Related briefs:**
- brief 12 (member add / edit / remove) — defined the original `POST /members/{user_id}/payments` endpoint.
- brief 13 (members page audit) — defined the summary endpoint that groups payments by season.
- brief 51 / 52 — recent payment-row fixes.
- brief 36 — membership tiers, which define the `fee` and `cadence` a payment satisfies.

---

## TL;DR

1. **Add `payments.season_id INT NULL REFERENCES seasons(id)`.** Backfill existing rows by matching `payment_date` to the season whose `[start_date, end_date]` range contains it; rows outside every season window stay `NULL`.
2. **Accept `season_id` on `POST /clubs/{id}/members/{user_id}/payments`.** Server behaviour:
   - Explicit `season_id` → validate it belongs to the club, store it as-is.
   - Omitted → attribute to the club's current season (`is_current_season = true`). If no current season exists → 400 `no_current_season`.
3. **Echo attribution back in the response** — `season_id` + `season_name`. The CRM uses this to tell the admin which season the money actually landed in.
4. **Make `GET /members/summary?season_id=X` honour `payments.season_id`** (not a `payment_date` range) for the Collected / Outstanding / collection-rate numbers. Date-range derivation stays as a fallback for the backfilled-null rows.
5. **Add two error codes** so the CRM can distinguish them: `no_current_season`, `unknown_season`.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin only (same as today — payments are a financial write).

---

## 1. Schema change

```sql
ALTER TABLE payments
  ADD COLUMN season_id INTEGER NULL REFERENCES seasons(id);

CREATE INDEX idx_payments_season ON payments (season_id, user_id);
CREATE INDEX idx_payments_club_season ON payments (club_id, season_id, payment_date DESC);
```

Keep `payment_date` — it's still the receipt date and drives the ordering in the per-member payments list on the detail page. Only the **attribution** moves to the explicit column.

### Backfill

Run once, in a migration:

```sql
UPDATE payments p
SET season_id = s.id
FROM seasons s
WHERE p.club_id = s.club_id
  AND p.season_id IS NULL
  AND p.payment_date BETWEEN s.start_date AND s.end_date;
```

Rows outside every season window (early payments before the club defined their first season) stay `NULL`. That's fine — the summary endpoint keeps the `payment_date BETWEEN …` fallback for null rows, so nothing disappears from historical totals.

Clubs with overlapping seasons (allowed today — e.g. a Summer and Winter season that overlap by two weeks) hit the first match. Flag any ambiguous rows in the migration log; don't fail the migration.

---

## 2. `POST /clubs/{club_id}/members/{user_id}/payments`

### Request — add `season_id`

```jsonc
{
  "amount": 240,
  "payment_date": "2026-10-22",
  "payment_method": "bank_transfer",
  "payment_reference": "ANZ-12345",
  "notes": "Cleared October invoice",
  "season_id": 17                    // NEW — optional
}
```

### Server behaviour

| Case | Behaviour |
|---|---|
| `season_id` present, valid for this club | Store it. |
| `season_id` present, from another club | 400 `unknown_season`. |
| `season_id` present, soft-deleted / archived | 400 `unknown_season`. |
| `season_id` omitted, club has a current season | Store `current.id`. |
| `season_id` omitted, no current season | 400 `no_current_season` with `{"hint":"Create a season on this club first — Members → New season."}` |

The CRM happily defaults to the picker's selection, so the omitted-case fallback matters most for the member-detail page's Mark paid button (no picker on that view) and for API clients that want to stay simple.

### Response — echo attribution

Extend `RecordPaymentResult`:

```jsonc
{
  "status": "success",
  "data": {
    "payment_id":       882,
    "membership_id":    120,
    "club_id":          5,
    "user_id":          88,
    "amount":           240,
    "payment_date":     "2026-10-22",
    "payment_method":   "bank_transfer",
    "payment_reference":"ANZ-12345",
    "payment_status":   "paid",

    "season_id":        17,                     // NEW
    "season_name":      "2026/27 Season"        // NEW — human-readable
  }
}
```

The CRM toasts "Payment recorded against 2026/27 Season." when `season_name` is present, falling back to the old "Payment recorded." when the field is absent (migration-safe — no FE change needed when this ships).

### New error table rows

| Status | code | When |
|---|---|---|
| `400` | `unknown_season` | `season_id` doesn't belong to the club or has been archived |
| `400` | `no_current_season` | `season_id` omitted and the club has no `is_current_season = true` row |

Existing codes (`invalid_amount`, `invalid_method`, `invalid_date`, `forbidden`, `member_revoked`) are unchanged.

---

## 3. `GET /clubs/{club_id}/members/summary?season_id={id}`

Today the summary derives per-season totals by `payment_date BETWEEN season.start_date AND season.end_date`. Flip that to prefer `payments.season_id` when present, fall back to the date range for backfilled-null rows:

```sql
SELECT COALESCE(SUM(amount), 0) AS collected
FROM payments
WHERE club_id = $1
  AND (
    season_id = $2
    OR (season_id IS NULL AND payment_date BETWEEN $3 AND $4)
  );
```

Why the fallback matters — any pre-brief-55 payment that fell inside a season boundary stays attributed correctly; anything outside every season boundary stops silently sliding into "whatever season you're looking at today."

### Response — unchanged shape

The existing `MembersSummary.season_id` + `season_name` + `is_current_season` fields keep working. No wire change here, just a query change.

---

## 4. `GET /clubs/{club_id}/members` — per-row fee state

The roster response's `membership.payment_status`, `membership.total_paid_this_season`, `membership.last_payment_amount`, `membership.last_payment_date`, `membership.balance_owed` are all computed against **the club's current season today**. That stays the right default — the roster is "where do people stand right now" and the Standing pill shouldn't change when an admin flips the picker on the Members page.

Longer-term we might want a `season_id` query param on the roster endpoint so the pills follow the picker, but that's out of scope for v1 of this brief. Flag it in the migration ticket as a follow-up.

---

## 5. Deletion / correction flow (out of scope, but think it through)

If an admin records a payment to the wrong season, today the only fix is to delete the row and re-record. That still works — delete endpoint takes `payment_id` and doesn't care about seasons. A follow-up brief could add `PATCH /payments/{payment_id}` to re-attribute without losing the receipt, but v1 of this brief doesn't need it.

---

## 6. Frontend contract summary (already shipped)

- `packages/api-client/src/resources/members.ts` — `RecordPaymentInput.season_id?: number`, `RecordPaymentResult.season_id?: number | null`, `season_name?: string | null`. Both are optional in TypeScript so the FE is forward-compatible: the server shipping these fields is a pure additive upgrade.
- `apps/crm/src/views/members/MembersView.vue` — the Record payment modal reads a Season field (defaults to `selectedSeasonId`, the picker on the page). Toast shows the attached season when the server echoes it back.
- `apps/crm/src/views/members/MemberDetailView.vue` — Mark paid omits `season_id` and shows the echoed season name in the toast.

Nothing to coordinate — ship the backend change and the FE lights up on the next deploy.

---

## 7. Verification (please attach outputs)

```bash
# 1. Create a season + a past-dated payment pointing at it explicitly
curl -X POST "$API/clubs/$CID/seasons" -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"season_name":"2025/26 Season","start_date":"2025-08-01","end_date":"2026-07-31","set_current":false}'
# → returns season_id = 16

curl -X POST "$API/clubs/$CID/members/$UID/payments" -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"amount":200,"payment_date":"2026-02-14","season_id":16}'
# → 200, response.season_id = 16, response.season_name = "2025/26 Season"

# 2. Omit season_id — defaults to current
curl -X POST … -d '{"amount":240,"payment_date":"2026-10-22"}'
# → 200, response.season_id = current season's id

# 3. Attach to another club's season
curl -X POST … -d '{"amount":240,"season_id":999}'
# → 400 { code: "unknown_season" }

# 4. Omit season_id when no current season exists
#    (set is_current_season=false on every season, retry)
curl -X POST … -d '{"amount":240}'
# → 400 { code: "no_current_season", hint: "…" }

# 5. GET summary — Collected rolls up per season
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/summary?season_id=16"
# → data.collected = 200 (just the payment above)

curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/summary?season_id=17"
# → data.collected = 240 (just the current-season payment)
```

Pass criteria:
- ✓ Backfill migration leaves no row's season_id set to the wrong season when a season window clearly contains it.
- ✓ Summary numbers for a past season don't change when a new current season is created.
- ✓ Toasts in the CRM show the correct season name after Record payment and Mark paid.
- ✓ Explicit `season_id: null` in the request body is treated identically to omitting the field.
- ✓ Owner-of-another-club can't record a payment with a season_id from their own club into this club (double-protected: season belongs to the URL's club).

---

## 8. Non-goals (v1)

- **No PATCH payments.** Correcting a mis-attributed payment is still delete + re-record.
- **No per-row season context on the roster endpoint.** Standing pills stay "current season" state. Follow-up brief.
- **No automatic rollover of unpaid balances between seasons.** Setting a new current season does not auto-create "carried over from last season" rows. Admins record what members actually pay against each season.
- **No overlap-handling policy.** If two seasons overlap and a payment lands in the overlap window, the CRM picks whichever season the admin's picker is on. Backfill picks the first match. We'll add a lint if overlapping seasons become common.

---

## 9. Contact

Ping Felicity when migration + endpoint change ships. The FE is already waiting on the response fields; nothing to coordinate on the UI side.
