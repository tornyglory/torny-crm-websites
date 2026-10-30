# Payment corrections — delete a mis-recorded payment, support partial payments on the read path

**Feature:** two gaps surfaced the moment the new Record Payment modal shipped on 2026-10-30:

1. **Reverse a mistake.** An admin picks the wrong tier / amount / member / season / method and clicks Save. Today there's no way to undo it — brief 55 §5 explicitly deferred `PATCH /payments` and never added `DELETE /payments` either. The CRM needs `DELETE /clubs/{club_id}/members/{user_id}/payments/{payment_id}` so admins can nuke a row and re-record cleanly. (Deleting + re-recording is what brief 55 said admins should do — but the delete endpoint doesn't exist yet.)
2. **Partial payments.** `payment_status: 'partial'` has been in the enum since brief 12, and the Record Payment modal lets admins type any amount (not just the full fee), so the write path already produces partial rows. But the roster response doesn't currently expose `total_paid_this_season` and `balance_owed` consistently, and the per-member payments-list endpoint (brief 64 §3, not yet live) is what the admin needs to see *"$120 of $260 collected · one row paid · one row due"*. Confirm the write-side math is right and the read-side fields are returned.

**Related briefs:**
- brief 12 — base `POST /members/{user_id}/payments` endpoint + the `payment_status` enum (`'paid' | 'unpaid' | 'partial' | 'overdue' | 'waived'`).
- brief 13 — roster response shape — the `RosterMembership` fields that drive the hero *"Owing $X"* number.
- brief 51, 52 — two prior payment-row fixes. Precedent for small payment-flow fixes.
- brief 55 — payments `season_id` write path. §5 explicitly deferred PATCH; this brief turns that deferral into a DELETE instead (simpler, same business outcome).
- brief 64 §3 — the per-member payments-list endpoint. Still waiting on backend. Once live, admins see every partial-top-up row inline.

**Status:** FE shipped 2026-10-30 — the `RecordPaymentModal` captures method / amount / reference / date / notes and POSTs cleanly, and the Payments tab reads `balance_owed` + `total_paid_this_season` when the server returns them. But admins have no delete affordance (and no PATCH either), so any mistake is permanent on the roster until a backend touches the DB directly.

---

## TL;DR

1. **Ship `DELETE /clubs/{club_id}/members/{user_id}/payments/{payment_id}`** — soft-delete the row (set `deleted_at = NOW()`), recompute the member's `total_paid_this_season` + `payment_status` + `balance_owed` from the surviving rows, and return the fresh membership snapshot so the CRM can re-render without a second GET. Admin / owner only.
2. **Confirm partial-payment aggregation** — when a member pays $120 against a $260 fee, the server should set `payment_status='partial'`, `total_paid_this_season=120`, `balance_owed=140`. The next $140 payment flips it to `payment_status='paid'`, `balance_owed=0`. Confirm this is wired and surface the two aggregate fields on every roster response (currently nullable per brief 13 — the FE now relies on them when present).
3. **Add one error code** so the CRM can distinguish the two safe-to-handle delete failures from a generic 500: `payment_not_found`, `payment_locked` (reserved for future "already reconciled to Xero" state — soft-fail for now).

---

## 1. The repro cases

### 1a. Mistake on method / amount
Admin opens Nev Rodda's detail page, taps **Mark paid**, picks **Cash** by muscle memory, enters **$260**, clicks Save. In reality Nev paid by **bank transfer** and only sent **$120** (partial). Today the row is permanent — there's no edit button on the Payments tab row and no API path for it. Workaround: ask backend to delete it manually.

### 1b. Mistake on member
Admin starts recording a payment on Jayden Burns's page but gets interrupted. When they come back they're on Nev's page and record Jayden's cheque against Nev. Same story — no undo.

### 1c. Mistake on season
Admin on the Payments tab in October 2026 records a payment, forgets the backend defaults to the current season (2026/27), should have been attributed to a late-arriving 2025/26 top-up. Brief 55 §5 said *"delete + re-record"* — but delete doesn't exist.

### 1d. Partial payment follow-up
Nev transfers $120 on 1 October → row 1 inserted, status becomes `partial`, balance = $140. He tops up $140 on 20 October → row 2 inserted, server recomputes aggregate ($120 + $140 = $260 = fee), flips `payment_status` to `paid`, balance = 0. Both rows should survive and the Payments tab shows both (needs brief 64 §3 read endpoint for the real list — but the aggregate should already be correct on the roster row today).

---

## 2. `DELETE /clubs/{club_id}/members/{user_id}/payments/{payment_id}`

### 2a. Request

```
DELETE /clubs/5/members/8/payments/882
Authorization: Bearer <JWT>
```

No body. Admin / owner only. Committee + player → 403.

### 2b. Server behaviour

1. Load the payment row by id. 404 `payment_not_found` if it doesn't exist, belongs to another club, or is already soft-deleted.
2. Soft-delete: `UPDATE payments SET deleted_at = NOW() WHERE id = $1`.
3. Recompute the member's `club_memberships` snapshot:
   - `total_paid_this_season` = `SUM(amount)` across surviving rows for the current season.
   - `balance_owed` = `fee - total_paid_this_season` (floor at 0 for pre-pays).
   - `payment_status` reroll:
     - `balance_owed === 0` AND `total_paid_this_season > 0` → `paid`.
     - `balance_owed === fee` → `unpaid` (or `overdue` if past `payment_due_date`).
     - Otherwise → `partial`.
   - `last_payment_date` / `last_payment_amount` → the newest surviving row, or `NULL` if none remain.
4. 200 response — see shape below.

### 2c. 200 response

```jsonc
{
  "status": "success",
  "data": {
    "payment_id":   882,
    "deleted_at":   "2026-10-30T22:14:03.000Z",
    "membership": {
      "membership_id":          120,
      "type_id":                4,
      "type_name":              "Playing member",
      "fee":                    260.00,
      "cadence":                "annual",
      "payment_status":         "partial",       // recomputed
      "total_paid_this_season": 120.00,          // recomputed
      "balance_owed":           140.00,          // recomputed
      "last_payment_date":      "2026-10-01",    // the newest surviving row
      "last_payment_amount":    120.00
    }
  }
}
```

The CRM swaps the row's local state for `data.membership` without re-fetching the roster.

### 2d. Error table

| Status | code | When |
|---|---|---|
| `404` | `payment_not_found` | Row doesn't exist, is already soft-deleted, or belongs to another club. |
| `403` | `forbidden` | Caller is below admin on the club. |
| `409` | `payment_locked` | Reserved — payment has been reconciled externally (future Xero/MYOB sync). v1 returns a stub `null` for this; soft-fail. |

### 2e. Audit

Soft delete only. The row stays in the DB with `deleted_at` set. Keep a `deleted_by_user_id` + `deleted_reason` column so later audits can trace *"who nuked this payment and why?"* (admins increasingly get asked for this when NZ clubs do their yearly treasurer handovers). `deleted_reason` is optional — accept via query string or body if we want to collect it later.

---

## 3. Partial payment math — confirm the write path

Brief 12's `POST /payments` already accepts any `amount` — the server shouldn't bounce an amount less than `fee`. Confirm:

1. **First partial** — $120 against $260 fee → `payment_status = 'partial'`, `total_paid_this_season = 120`, `balance_owed = 140`.
2. **Second partial that completes** — another $140 → `payment_status = 'paid'`, `total_paid_this_season = 260`, `balance_owed = 0`.
3. **Over-pay** — admin records $300 against $260 fee → `payment_status = 'paid'`, `total_paid_this_season = 300`, `balance_owed = 0` (not `-40`). Over-pay is accepted but doesn't carry forward.
4. **Explicit waive** — `payment_method: 'waived'` sets `payment_status = 'waived'`, `balance_owed = 0` regardless of amount.

### 3a. Response echo
Extend `RecordPaymentResult` to echo the aggregated snapshot the same way DELETE does, so the FE doesn't need a second GET to show the updated hero / standing pill:

```jsonc
{
  "status": "success",
  "data": {
    "payment_id":        883,
    "amount":            140.00,
    "payment_date":      "2026-10-20",
    "payment_method":    "bank_transfer",
    "payment_reference": "ANZ-98765",
    "payment_status":    "paid",
    "season_id":         17,
    "season_name":       "2026/27 Season",
    "membership": {                                 // NEW on POST — already present on DELETE above
      "payment_status":         "paid",
      "total_paid_this_season": 260.00,
      "balance_owed":           0.00,
      "last_payment_date":      "2026-10-20",
      "last_payment_amount":    140.00
    }
  }
}
```

The existing top-level fields are unchanged — this is purely additive. The CRM reads `data.membership` if present, falls back to a `loadRoster()` roundtrip if the field is omitted (migration-safe).

### 3b. Roster response — reaffirm the aggregate fields
Brief 13's `RosterMembership` already declared `total_paid_this_season` + `balance_owed` as nullable. Confirm they're populated on every row (not just rows that have a payment history). For members with no payments yet:
- `total_paid_this_season = 0`
- `balance_owed = fee ?? 0`

Null on these fields is treated as "unknown" by the CRM and we fall back to displaying the fee — that's defensible but loses the partial-payment nuance.

---

## 4. Frontend contract summary

```ts
// packages/api-client/src/resources/members.ts

export interface MembershipSnapshot {
  membership_id: number | null
  type_id: number | null
  type_name: string | null
  fee: number | null
  cadence: MembershipCadence | null
  payment_status: PaymentStatus
  total_paid_this_season: number | null
  balance_owed: number | null
  last_payment_date: string | null
  last_payment_amount: number | null
}

export interface DeletePaymentResult {
  payment_id: number
  deleted_at: string
  membership: MembershipSnapshot
}

/** DELETE /clubs/{clubId}/members/{userId}/payments/{paymentId} — soft delete + recompute. */
export async function deletePayment(
  clubId: number,
  userId: number,
  paymentId: number,
): Promise<DeletePaymentResult>

// RecordPaymentResult extended:
export interface RecordPaymentResult {
  …
  membership?: MembershipSnapshot    // NEW — optional for backward compat
}

export type RecordPaymentErrorCode =
  | 'invalid_amount'
  | 'invalid_method'
  | 'invalid_date'
  | 'forbidden'
  | 'member_revoked'
  | 'unknown_season'       // brief 55
  | 'no_current_season'    // brief 55
  | 'payment_not_found'    // NEW — only fires on DELETE
  | 'payment_locked'       // NEW — reserved for future
```

### FE views that light up when this ships

- `MemberDetailView.vue` Payments tab — each row gets an overflow menu (`⋯`) with **Delete** when `callerCanEdit`. Confirm dialog: *"Delete this $260 cash payment? The season total will drop by $260."* Soft-fails open the error banner inline.
- The hero *"Owing $X"* re-renders instantly from `data.membership.balance_owed` after both record + delete, no second roundtrip.

---

## 5. Verification

Using Nigel's JWT, Nev's user id, Naenae club 5:

```bash
# 1. Record a partial — $120 of $260
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/members/8/payments" \
  -d '{"amount":120,"payment_method":"bank_transfer","payment_reference":"ANZ-11111"}'
# → 200, data.payment_status='partial', data.membership.total_paid_this_season=120, balance_owed=140

# 2. Top up — $140 completes
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/members/8/payments" \
  -d '{"amount":140,"payment_method":"bank_transfer","payment_reference":"ANZ-22222"}'
# → 200, data.payment_status='paid', data.membership.total_paid_this_season=260, balance_owed=0

# 3. Nuke the top-up — status drops back to partial
curl -X DELETE -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/payments/$TOPUP_PAYMENT_ID"
# → 200, data.membership.payment_status='partial', balance_owed=140

# 4. Nuke the first partial too — status drops to unpaid, last_payment_date=NULL
curl -X DELETE -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/payments/$FIRST_PAYMENT_ID"
# → 200, data.membership.payment_status='unpaid', total_paid_this_season=0, last_payment_date=null

# 5. Try to delete again — 404 payment_not_found
curl -i -X DELETE -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/payments/$FIRST_PAYMENT_ID"
# → 404 { code: "payment_not_found" }

# 6. Committee caller delete — 403
curl -i -X DELETE -H "Authorization: Bearer $COMMITTEE_JWT" \
  "$API/clubs/5/members/8/payments/$SOME_PAYMENT_ID"
# → 403 { code: "forbidden" }

# 7. Over-pay doesn't leak carry-over
curl -X POST -H "Authorization: Bearer $NIGEL_JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/members/8/payments" \
  -d '{"amount":300,"payment_method":"cash"}'
# → 200, data.membership.balance_owed=0 (not -40)
```

Pass criteria:
- ✓ Partial payments add up correctly across multiple rows.
- ✓ Deleting a payment recomputes `payment_status` / `total_paid_this_season` / `balance_owed` / `last_payment_date` / `last_payment_amount` from the surviving rows atomically.
- ✓ `data.membership` snapshot on both POST and DELETE responses lets the FE skip the roster re-fetch.
- ✓ Over-pay sets `balance_owed=0` and doesn't carry negative.
- ✓ Soft-delete leaves the audit row intact (`deleted_at` set, no SELECT returns the row via normal paths).
- ✓ Committee + player callers get 403 on DELETE.

---

## 6. Non-goals (v1)

- **No PATCH `/payments`.** Keep brief 55 §5's call — correcting a payment is still *delete + re-record*. PATCH tempts admins to tweak amounts in place, which breaks the audit trail. The DELETE path above with a short `deleted_reason` is clearer for compliance.
- **No undelete / restore.** v1 is one-way delete. A deleted payment stays deleted; if admins want it back they re-record. Soft-delete only for audit, not for UI undo.
- **No bulk delete.** One payment at a time. If a batch mistake happens, admins work through them one by one — forces a sanity check per row.
- **No per-season `balance_owed` on the roster list.** The roster row's `balance_owed` is current-season only (brief 13's convention). Multi-season balance aggregation lives on the per-member payments-list endpoint (brief 64 §3) once that ships.
- **No external reconciliation.** `payment_locked` 409 is a stub for a future Xero / MYOB sync — v1 never actually returns it. Keep the code reserved so the FE can be rolled out proactively.
- **No notification on delete.** Deleting a payment doesn't email the member. If admins want to tell the member they fixed it they log a note or send an email manually.

---

## 7. Contact

Ping Felicity when §2 ships — the FE adds the row overflow menu + confirm dialog as a one-PR follow-up. §3's response-shape bump can land in the same PR or a follow-up; the FE handles both legacy and extended responses defensively.
