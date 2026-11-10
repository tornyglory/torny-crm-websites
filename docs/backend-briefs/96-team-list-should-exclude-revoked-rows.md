# Brief 96 — Team access roster should exclude revoked members

**Scope:** CRM_BASE · `GET /clubs/{cid}/members` — one query-param addition (or alternative: a dedicated team-list endpoint). No behaviour change on existing callers.

**Prereq:** none. Builds on brief 94-live (scoped CRM access) by giving the Settings → Team access page a clean way to render only the current team.

---

## 1. The ask

After `DELETE /clubs/{cid}/members/{uid}` soft-removes a team member (sets `revoked_at` on their `club_members` row), that row is still returned by `GET /clubs/{cid}/members`. The FE's Team access page (`TeamAccessCard.vue`) currently filters `roster.members` by `club_role !== 'player'` to pick out team members — it has no way to know a given row has been revoked without reading `revoked_at` on every row.

Add an opt-in param so the FE can ask for only non-revoked rows:

```http
GET /clubs/{cid}/members?exclude_revoked=true
```

- Unset / `false` (default): unchanged — every row the caller is permitted to see.
- `true`: exclude rows where `revoked_at IS NOT NULL`.

Alternative, if you'd rather not add a param: a new dedicated endpoint `GET /clubs/{cid}/team-members` that returns the current team only (owner + admins + members, non-revoked) with the same `RosterMember` shape. See §3 for the comparison — either is acceptable.

---

## 2. Why

**User-visible symptom.** On the Settings → Team access screen, after an owner/admin removes a team member:

1. DELETE succeeds, toast confirms. Row stays visible (bug).
2. Admin clicks the ✕ again on the same row → 409 `already_revoked` → error toast reads "Member is already removed", which is confusing because the member is right there in the list.
3. Full page refresh — the row is *still* there.

Root cause: the roster list returns revoked rows, and the Team access page has no server-side way to exclude them.

**Why fix it on the backend.** The FE has shipped a client-side filter today (`m.revoked_at == null`) as a stopgap, but it carries two risks:

1. Pagination off-by-one: if revoked rows count against the `limit`, admins may see fewer team members than expected.
2. Any consumer that forgets the filter gets stale rows. The Members page also calls this endpoint and may or may not want the same treatment — the current ambiguity means every caller has to make a judgement call.

A server-side filter is cheap (`WHERE revoked_at IS NULL` on the existing query), authoritative, and eliminates the pagination drift.

**Why not just hide revoked rows by default.** The Members page deliberately shows lapsed members (status = `lapsed`) because committees want to see "who used to be a member". Those rows do have `revoked_at` set. Flipping the default would break that screen. Opt-in via `exclude_revoked=true` is the safer move.

---

## 3. Behaviour spec

### 3.1 Option A — query param on existing endpoint (preferred)

```http
GET /clubs/42/members?exclude_revoked=true&limit=200&include_invites=false
```

- When `exclude_revoked=true`, every row in the response's `members[]` has `revoked_at: null`.
- `counts.lapsed` in the response reflects the *unfiltered* count (so we don't lie about how many lapsed members the club has — the caller asked only to be shown non-revoked rows, not for a different total).
- `pagination.total_items` reflects the *filtered* count (so `has_next_page` behaves correctly).
- `filters.status` in the echoed filter block is unchanged; `exclude_revoked` can be echoed back as a new field for debuggability, but it isn't required.

Omitted or `false` → current behaviour. Byte-for-byte compatible for every existing caller.

### 3.2 Option B — new endpoint

```http
GET /clubs/42/team-members
Authorization: Bearer <JWT>
```

- Returns only rows with `club_role IN ('owner', 'admin', 'member')` AND `revoked_at IS NULL`.
- Shape: same `RosterMember[]` the current endpoint uses, so the FE can reuse its types.
- No filters/pagination needed for v1 — team sizes are bounded (think 2–30 people, not thousands).
- Optional: include each member's current `permissions[]` in the response. Today the roster doesn't carry permissions, which forces the FE to show "Full access" as a blanket label instead of the actual grant summary. Not a blocker; nice-to-have.

### 3.3 Field reference

`RosterMember.revoked_at` (already exists): ISO 8601 UTC string when the membership was soft-removed, or `null`. Set by `DELETE /clubs/{cid}/members/{uid}`.

### 3.4 Permissions

Caller must be able to see the roster (existing permission check). No new permission.

---

## 4. The idempotent DELETE is fine as-is

`DELETE /clubs/{cid}/members/{uid}` returning `409 already_revoked` when the row is already soft-removed is the right shape — the FE now treats it as a soft-success (refresh, nudge the user). No change needed here. Noting it so the handler isn't accidentally "fixed" to swallow the second call silently; the current code surfaces the race correctly.

---

## 5. Verification

```bash
CRM="…"
TOKEN="…"   # owner/admin JWT
CLUB=42

# Pre-condition: 3 team members (1 owner, 1 admin, 1 member). Soft-remove the member.
curl -s -X DELETE "$CRM/clubs/$CLUB/members/9981" -H "Authorization: Bearer $TOKEN"
# → 200 { data: { revoked_at: "2026-11-11T…" } }

# 1. Default behaviour — unchanged
curl -s "$CRM/clubs/$CLUB/members?limit=200" -H "Authorization: Bearer $TOKEN" | jq '.data.members | length'
# → 3  (owner + admin + revoked member still in list)

# 2. exclude_revoked=true — new path
curl -s "$CRM/clubs/$CLUB/members?limit=200&exclude_revoked=true" -H "Authorization: Bearer $TOKEN" | jq '.data.members | length'
# → 2  (owner + admin, revoked member excluded)
# → every row in `.data.members[]` has `revoked_at == null`
# → `.data.pagination.total_items == 2`
# → `.data.counts.lapsed` unchanged (still counts the revoked row — it's a stat about the club, not the filter)

# 3. Idempotent delete still errors clearly
curl -s -X DELETE "$CRM/clubs/$CLUB/members/9981" -H "Authorization: Bearer $TOKEN"
# → 409 { code: "already_revoked", message: "Member is already removed" }

# 4. Un-revoke path, if one exists — exclude_revoked=true now includes the row again
#    (sanity check that the filter reads revoked_at live, not a stale flag)
```

If you pick Option B, replace step 2 with `GET /clubs/$CLUB/team-members` and assert the returned length + role mix.

---

## 6. Pass criteria

- ✓ Existing callers without `exclude_revoked` see exactly the same response bytes.
- ✓ `exclude_revoked=true` filters out every row with `revoked_at IS NOT NULL`.
- ✓ `counts.*` continues to describe the full roster (lapsed is still counted).
- ✓ `pagination.total_items` reflects the filtered count.
- ✓ `DELETE /members/{uid}` continues to return `409 already_revoked` on the second call.

---

## 7. Non-goals

- Changing the DELETE behaviour. Soft-remove + `already_revoked` is correct.
- Changing the Members page's default rendering. That screen deliberately shows lapsed rows.
- Un-revoke / "undo remove" flow. Separate brief when we need it — the FE doesn't offer undo today.
- Adding `exclude_revoked` to any other list endpoint (tiers, payments, enquiries). Only the members list has the symptom.

---

## 8. FE follow-up (out of scope here, tracking so nothing's forgotten)

Once this ships, `TeamAccessCard.vue`'s `load()` drops the client-side `revoked_at == null` filter and passes `exclude_revoked: true` (Option A) or switches to `membersApi.listTeamMembers(cid)` (Option B). The idempotent-success branch in `removeMember()` stays — it's still the right handling for a legitimate race.

---

## 9. Contact

Nev on Slack (`#torny-eng`). Tiny scope — one `WHERE` clause (Option A) or one thin handler (Option B). Please pick whichever is cheaper to ship; FE will adapt either way.
