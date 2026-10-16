# PATCH member — Billing fields (tier / status / joined date / payment due) silently drop on save

**Feature:** fix the `PATCH /clubs/{club_id}/members/{user_id}` endpoint so the four Billing fields in the Edit modal — **Membership tier**, **Status**, **Joined date**, **Payment due date** — reliably persist, instead of appearing to save (200 OK, modal closes) and then reverting to the previous values on reload.

**Related briefs:**
- brief 12 (member add / edit / remove) — defines the PATCH endpoint + its `membership_type_id` / `status` / `joined_date` / `payment_due_date` fields.
- brief 51 (PATCH 404 on pending roster rows) — same root cause family: the LIST query returns rows the mutation query can't touch, so the UI feels broken even when the API claims success.

**Status:** reported by Felicity on 2026-10-16 — opening a member who has no tier assigned, setting a **Joined date** of `16/10/2026`, clicking Save, modal closes cleanly, toast fires "Member updated." On reload, the Joined date is blank again and the Profile → Membership block in the rail still reads `TIER —` / `JOINED DATE —` / `PAYMENT DUE —`. Same behaviour for the Status dropdown and the Payment due date field. The Membership tier dropdown does appear to save sometimes — but inconsistently.

---

## TL;DR

1. **The frontend sends the four billing fields in the PATCH body** (`apps/crm/src/views/members/MemberDetailView.vue:398-401`) and the API client types them as supported (`packages/api-client/src/resources/members.ts:666-672`). The payload is correct.
2. **The backend returns 200 OK but doesn't persist the billing fields** when the member has no existing `club_memberships` row. No error code, no error body — the response just shows `membership: null` and the user's work is gone.
3. **Fix: on PATCH, if the member has no `club_memberships` row AND the request includes a `membership_type_id`, INSERT a new row with the supplied `status` / `joined_date` / `payment_due_date` baked in.** Mirrors `ensureBillingHasTier()` on the frontend, which already backfills `membership_type_id` for this exact case.
4. **If the request touches billing fields but still has no `membership_type_id`** (no existing row, no tier being set), return the existing `400 no_membership_row` code consistently — don't fall through to a silent 200.

---

## Repro

1. Sign in as owner of Naenae Bowling Club.
2. Open `/crm/members` → click a member with no tier assigned (e.g. Jayden Burns or any member whose rail Profile shows `TIER —`).
3. Click **Edit** → scroll to the **Billing** section:
   - Membership tier: pick `Full member` from the dropdown.
   - Status: pick `Active`.
   - Joined date: enter `16/10/2026`.
   - Payment due date: enter `16/08/2027`.
4. Click **Save changes** → modal closes, toast says "Member updated."
5. Reload the page.
6. Profile → Membership block shows:
   - `TIER — Full member` ✅ (sometimes)
   - `STATUS —` ❌ (not saved)
   - `JOINED DATE —` ❌ (not saved)
   - `PAYMENT DUE —` ❌ (not saved)

Expected: all four fields render the values the user just typed.

---

## What the frontend sends

`buildPatchDiff()` only sends fields that actually changed. For step 3 above the request body is:

```json
PATCH /clubs/{club_id}/members/{user_id}
{
  "membership_type_id": 4,
  "status":             "active",
  "joined_date":        "2026-10-16",
  "payment_due_date":   "2027-08-16"
}
```

`ensureBillingHasTier()` already guards the "touches billing but has no row and no tier" case (`MemberDetailView.vue:408-420`) — if the user set Joined date without touching the tier dropdown, we re-send the current `editForm.membership_type_id` so the backend has what it needs to create the `club_memberships` row.

So the ball is firmly in the backend's court.

---

## What the backend is doing (observed)

- `200 OK` on every attempt.
- Response body includes `"membership": null`.
- `SELECT * FROM club_memberships WHERE club_id = $1 AND user_id = $2` returns zero rows after the PATCH, same as before.
- No `club_memberships` row is being INSERT-ed, even though the request body carries both `membership_type_id` and the dates needed to seed one.

Hypothesis: the PATCH handler updates `club_memberships` only when a row already exists (fall-through `UPDATE`), and ignores billing fields entirely when it doesn't. The response then echoes back `membership: null` because the SELECT after the (no-op) UPDATE finds nothing.

That matches the `no_membership_row` error the brief 12 table defines, but the error isn't firing here — the handler is silently taking the happy path.

---

## Fix

Inside the PATCH handler, after the identity/roster UPDATEs, branch on whether a `club_memberships` row exists for `(club_id, user_id)`:

| Request has `membership_type_id`? | Row exists? | Action |
|---|---|---|
| yes | yes | UPDATE the row — set any of `type_id`, `status`, `joined_date`, `payment_due_date` that were sent. |
| yes | no  | **INSERT** a new row with `type_id = $membership_type_id`, `status = $status ?? 'active'`, `joined_date = $joined_date ?? NOW()`, `payment_due_date = $payment_due_date`, `fee = (SELECT fee FROM membership_tiers WHERE id = $membership_type_id)`. |
| no  | yes | UPDATE the row with the other three fields. |
| no  | no  | Return `400 no_membership_row` — don't silently drop the billing fields. |

Then re-SELECT the (possibly new) row and return it in the response as `membership`, exactly as the brief 12 §2 response schema promises. The frontend's post-save `loadRoster()` call (`MemberDetailView.vue:440`) will then show the correct values on the Profile rail without a reload.

### Response shape (unchanged)

Keep `UpdateMemberResponse` as-is. Return a populated `membership` object instead of `null` when the INSERT path fires.

Optionally — nice-to-have, not blocking — mirror the "lazy create" signal from brief 51:

```json
"membership": {
  "membership_id":    81,
  "type_id":          4,
  "type_name":        "Full member",
  "status":           "active",
  "joined_date":      "2026-10-16",
  "payment_due_date": "2027-08-16",
  "fee":              60,
  "payment_status":   "unpaid",
  …
},
"billing_resolution": "created"    // optional — "created" | "updated"
```

---

## Verification

```bash
# 1. Confirm the member has no club_memberships row yet
psql -c "SELECT * FROM club_memberships WHERE club_id = {naenae_club_id} AND user_id = {jayden_user_id};"
# → 0 rows

# 2. PATCH with full billing block
curl -s -X PATCH -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{naenae_club_id}/members/{jayden_user_id}" \
  -d '{
    "membership_type_id": 4,
    "status":             "active",
    "joined_date":        "2026-10-16",
    "payment_due_date":   "2027-08-16"
  }' | jq .

# 3. Row should now exist with the submitted values
psql -c "SELECT type_id, status, joined_date, payment_due_date FROM club_memberships WHERE club_id = {naenae_club_id} AND user_id = {jayden_user_id};"

# 4. PATCH billing fields without membership_type_id for a different user who still has no row
curl -s -X PATCH … -d '{ "joined_date": "2026-10-16" }'
# → 400 { "code": "no_membership_row" }

# 5. PATCH an existing row — plain UPDATE, no INSERT
curl -s -X PATCH … -d '{ "payment_due_date": "2027-09-01" }'
# → 200, row's payment_due_date updated, no duplicate rows
```

Pass criteria:

- Step 3 shows a single row with `type_id = 4`, `status = 'active'`, `joined_date = 2026-10-16`, `payment_due_date = 2027-08-16`.
- Step 4 returns `400 no_membership_row` — no silent 200.
- Step 5 returns 200 and `SELECT COUNT(*) FROM club_memberships WHERE club_id = … AND user_id = …` stays at 1.
- The CRM's rail Profile → Membership block renders the values immediately after save (no reload needed) because the server returns a populated `membership` object and `loadRoster()` picks it up.

---

## Frontend will do

Nothing — the frontend already sends the right fields, surfaces the right error codes, and reloads the roster post-save. Once the backend INSERT path lands, the user's typed values will stick on the first save.
