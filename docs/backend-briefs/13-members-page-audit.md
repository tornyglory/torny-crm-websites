# Members page — backend gaps audit

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm/src/views/members/MembersView.vue` + `packages/api-client/src/resources/members.ts`
**Related:** briefs 07 (bulk import), 09 (bulk import live), 12 (add/edit/remove)
**Status:** Full page is wired to real endpoints; several UI surfaces render `—` or use approximations because the roster payload doesn't yet carry the fields required for accuracy.

---

## TL;DR

The Members page currently renders **6 things inaccurately or with placeholders** because the roster endpoint's row shape is missing fields we designed the UI around. In rough priority:

1. **`computed_status` doesn't update after a payment** — e.g. a member who was `pending` (never paid) still shows `pending` after `POST /payments` records a `paid` payment. Status looks stuck. See §Status semantics below.
2. **`Collected` / `Outstanding` / `Collection rate` panels are wrong** — they sum `last_payment_amount` (a single most-recent-payment number) instead of a per-season cumulative total. A member who paid $120 twice this season shows as if they paid $120.
3. **Detail modal fields `dob`, `address`, `title` show `—`** — RosterMember doesn't include them, so the "Contact" and "Membership" sections are half-populated for real data.
4. **`Last active`, `Events attended` are hardcoded to `—` / `0`** — no fields on RosterMember or a related endpoint.
5. **Tier dropdown in Edit / Add falls back to derived tiers** — no `/clubs/:id/membership-tiers` endpoint exists, so we pluck distinct tiers off the roster. Tiers that no member is on yet are invisible.
6. **Top-tier stat panel is a proxy** — client-side name grouping. Would be cleaner as a roster-summary endpoint.

Everything else on the page is real and accurate.

---

## Page inventory — what's real vs what's not

### Header + counts

| Surface | Data source | Accurate? |
|---|---|---|
| `N total · N active` sub-heading | `counts.total`, `counts.active` from `GET /clubs/:id/members` | ✅ Real |
| Filter chips (All / Active / Pending / Lapsed) with counts | Local filter over the loaded 200-row page | ⚠ Accurate for what's loaded; if a club has > 200 members the filter counts are page-local, not global |
| Dues filter dropdown | Local filter over the loaded page | ⚠ Same caveat |
| Sidebar `Members 142` (now `Members {N}`) | Fetched via `listRoster(clubId, { limit: 1 })` on club change + refreshed via a `torny:roster-count` window event | ✅ Real |

### Stat panels above the roster ⚠ **inaccurate**

| Panel | Current calc | Why it's wrong |
|---|---|---|
| **Expected fees** | `sum(m.fee) for non-lapsed` | Mostly right — but only reflects members loaded on the current page (200 cap). Global total would need a server-side sum. |
| **Collected** | `sum(m.last_payment_amount) for paid + partial` | `last_payment_amount` is a single payment, not a cumulative total. Members who paid across multiple instalments are under-counted. Members whose last payment was $240 last year still count as `$240` collected this year. |
| **Outstanding** | `sum(m.fee - m.last_payment_amount) for due + overdue` | Same underlying issue. Also assumes the "annual" cadence uniformly — for monthly/season memberships the math is meaningless. |
| **Top tier** | Client-side group-by on `membership.type_name` | Works but includes only tiers currently used by loaded members. |

### Desktop table

| Column | Field | Accurate? |
|---|---|---|
| Name — avatar | `avatar_url` | ✅ Real |
| Name — text | `name` | ✅ Real |
| Name — badges (Life / Junior / Committee / Coach / Volunteer) | Derived from `membership.type_name` + `club_role` + local title heuristic | ⚠ Coach / Junior / Volunteer badges only fire on locally-set titles that the API doesn't return — so real data never shows them |
| Name — sub `{member_number} · joined {date}` | `member_number`, `joined_at` | ✅ Real (nullable) |
| Email | `email` | ✅ Real |
| Membership — type name | `membership.type_name` | ✅ Real |
| Membership — fee sub-line | `membership.fee` + `membership.cadence` | ✅ Real |
| Dues — pill | Derived from `membership.payment_status` | ✅ Real |
| Dues — amount sub-line | Derived from `fee` + `last_payment_amount` + `payment_status` | ⚠ Uses `last_payment_amount` — same accuracy caveat as the Collected panel |
| Status pill | `computed_status` | ✅ Real |

### Mobile card — same story, same gaps.

### Detail modal

| Section / field | Source | Accurate? |
|---|---|---|
| Hero — avatar, name, membership, role | `avatar_url`, `name`, `membership.type_name`, `club_role` | ✅ Real |
| Hero — meta line `{member_number} · joined {date}` | `member_number`, `joined_at` | ✅ Real |
| Stat: Dues + amount hint | `payment_status`, `fee`, `last_payment_amount` | ⚠ Same caveat |
| Stat: Events attended | Hardcoded `0` | ❌ No backend field |
| Stat: Last active | Hardcoded `—` | ❌ No backend field |
| Contact — Email, Phone | `email`, `phone` | ✅ Real |
| Contact — DOB | Hardcoded `—` for API rows | ❌ Not on RosterMember |
| Contact — Address | Hardcoded `—` for API rows | ❌ Not on RosterMember |
| Membership — Type | `membership.type_name` | ✅ Real |
| Membership — Member # | `member_number` | ✅ Real |
| Membership — Joined | `joined_at` | ✅ Real |
| Membership — Role | `club_role` | ✅ Real |
| Membership — Fee | `membership.fee` + `cadence` | ✅ Real |
| Membership — Last paid | `membership.last_payment_amount` | ✅ Real (single-payment scope) |
| Notes | Hardcoded `undefined` for API rows | ❌ Not on RosterMember |

### Modal actions

| Action | Endpoint | Accurate? |
|---|---|---|
| Send message | Toast placeholder | ❌ No endpoint |
| Record payment | `POST /clubs/:id/members/:userId/payments` | ✅ Real |
| Edit member (role / title / tier) | `PATCH /clubs/:id/members/:userId` | ⚠ `title` field exists in the API contract but doesn't come back on `GET /clubs/:id/members`, so we never pre-fill it |
| Remove | `DELETE /clubs/:id/members/:userId` | ✅ Real |
| Tier dropdown source | Derived from `type_id`s on the loaded roster | ⚠ Silent gap: any tier without a member won't appear |

### Add member modal — same tier dropdown source gap.

---

## What backend needs to add

Ordered by impact.

### 0. Recompute `computed_status` after payments — **P0**

Concrete repro: Noah Rodda was `pending` (existed but had never paid dues). Admin ran `POST /clubs/:id/members/:userId/payments` for the full annual fee → payment record was inserted, `membership.payment_status` flipped to `paid`, `last_payment_amount` and `last_payment_date` populated. But **his top-level `computed_status` is still `pending`** on the next `GET /clubs/:id/members` call.

That's likely because `computed_status` derives from `club_members.status` (or a similar column) that isn't touched by the payments endpoint. Expected behaviour: any successful payment (`paid` or `waived` result) should transition `pending` → `active`.

Suggested fix:
- After the payments insert, if the caller's current `club_members.status` is `pending`, set it to `active` in the same transaction.
- Alternatively, if `computed_status` is genuinely computed at read time, teach the query to treat `pending + paid` as `active`.

Also worth defining explicitly in the response:
- `pending` = row exists on `club_members`, no active membership yet
- `active` = row exists, `is_current = 1`, `payment_status IN ('paid','partial','waived')`
- `lapsed` = row revoked (`revoked_at IS NOT NULL`) — the current mapping is correct here

### 1. Cumulative payment field(s) on `RosterMember.membership` — **P0**

Add either:
- `total_paid_this_period: number | null` — sum of `membership_payments.amount` for the current season/period, OR
- `total_paid_this_season: number | null` (per the note in brief 09)

This unblocks accurate:
- Dues sub-line on rows ("$120 of $240" partial)
- Collected / Outstanding / Collection rate stat panels
- Detail modal Dues stat

For the calculation the frontend needs the concept of "this period" defined server-side (calendar year? membership anniversary? explicit season dates?). Recommend:
- Simplest MVP: sum all `membership_payments` where the current `club_memberships.is_current = 1` — the row already resets on renewals so "this period" is implicit.
- Better: add `period_start` + `period_end` on `club_memberships` and sum payments within that range.

### 2. Missing PII / profile fields on `RosterMember` — **P1**

Add to the roster row (either always or via `?include=profile`):
- `dob` (from `users.dob` if the user filled it in)
- `address` (from `users.address` — may not exist yet; mobile-app profile has this)
- `title` (from `club_members.title` — already stored, just not returned)
- `notes` (freeform per-member notes — the CRM UI expects this; new column on `club_members`)

Without these the detail modal renders half-empty for real data.

### 3. Roster-summary endpoint — **P1**

New: `GET /clubs/:clubId/members/summary`

```json
{
  "status": "success",
  "data": {
    "expected_fees":   36400,
    "collected":       28800,
    "outstanding":     7600,
    "collection_rate": 79,
    "counts": { "total": 142, "active": 138, "lapsed": 4 },
    "top_tiers": [
      { "type_id": 4, "type_name": "Playing member", "count": 98 },
      { "type_id": 5, "type_name": "Social member", "count": 32 }
    ],
    "period_start": "2026-01-01",
    "period_end":   "2026-12-31"
  }
}
```

Replaces the client-side sums. Cheap to compute server-side (single grouped query). Frontend swaps the reactive `rosterStats` computed for this response.

### 4. Membership-tiers endpoint — **P1**

New: `GET /clubs/:clubId/membership-tiers`

Returns the club's active tiers regardless of whether any member is currently on them:

```json
{
  "status": "success",
  "data": {
    "tiers": [
      { "id": 4, "type_name": "Playing member", "cadence": "annual", "fee": 240, "is_default": true },
      { "id": 5, "type_name": "Social member",  "cadence": "annual", "fee": 60,  "is_default": false },
      { "id": 6, "type_name": "Junior",         "cadence": "annual", "fee": 40,  "is_default": false }
    ]
  }
}
```

Frontend uses this to populate the Edit + Add modal tier dropdowns. Currently we derive from `distinct(type_id)` across the roster — brittle, misses empty tiers.

### 5. Activity fields — **P2**

- `last_active_at` on `RosterMember` — already exists on `users` per brief 02 §7; just return it.
- `events_attended` count — needs a join to `event_attendance` (once events endpoints ship).

Nice-to-have for the detail modal "Activity" stat tiles.

### 6. Global counts vs page-local counts — **P2**

The filter chips (All / Active / Pending / Lapsed) currently count over the loaded 200-row page. `counts.total` etc. from the response already reflect the global figures — we just need to consume them for the chip counts too. That's a frontend fix, not a backend gap. Flagged here for completeness.

---

## Frontend-side follow-ups (once backend lands)

- Swap `rosterStats` client computed for the `/summary` response — one useApi call on club change.
- Consume the `/membership-tiers` response in Add + Edit modals; retire the `availableTiers` distinct-derivation.
- Replace hardcoded `eventsAttended: 0` / `lastActive: '—'` with real fields.
- Populate `title` on Member from the roster response so Edit modal pre-fills it.
- Populate `dob`, `address`, `notes` in the detail modal.
- Add copy in the detail modal when the roster's period ends soon ("Renewal due in N days") if the summary endpoint carries `period_end`.

Estimate: ~2 hours once §§1, 3, 4 are live.

---

## Contact

`#torny-eng` on Slack.
