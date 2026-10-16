# PATCH member — 404 on self-declared / pending roster rows

**Feature:** fix the `PATCH /clubs/{club_id}/members/{user_id}` endpoint so it stops returning `404 Member not found on this club` for members who show up fine in `GET /clubs/{club_id}/members`.

**Related briefs:**
- brief 12 (member add / edit / remove) — defines the PATCH endpoint + its error table.
- brief 13 (members-page audit) — defines the LIST endpoint that disagrees with PATCH here.

**Status:** reported by Felicity on 2026-10-16 — Jayden Burns renders correctly on `/crm/members/{jayden_user_id}` (hero + Profile card both populated), but clicking Save in the Edit modal flashes "Member not found on this club" in the error banner. The frontend now handles the 404 with a friendlier message + background roster reload (see `apps/crm/src/views/members/MemberDetailView.vue:443`), but the root cause is a divergence between the LIST and PATCH queries that the backend has to fix.

---

## TL;DR

1. **`GET /clubs/{club_id}/members` includes rows that `PATCH /clubs/{club_id}/members/{user_id}` can't find** — self-declared / pending roster entries that are linked via `users` + `user_clubs` but have **no `club_members` row yet**.
2. **Fix option A (preferred): auto-create the missing `club_members` row inside the PATCH handler** when the target user is attached to the club but doesn't yet have a `club_members` row. Mirrors the "lazy create" behaviour the roster already assumes.
3. **Fix option B: exclude self-declared rows from `GET /clubs/{club_id}/members`** so the frontend never offers an Edit button for rows that can't be patched. Simpler but hides members until an admin manually re-adds them.
4. Either way, add a dedicated `member_pending` error code so the CRM can tell "truly unknown user" (403/404 with no code) apart from "user is attached but no `club_members` row" and show a specific CTA.

---

## Repro

1. Sign in as owner of Naenae Bowling Club.
2. Open `/crm/members` → scroll to Jayden Burns. Row renders with name, email, phone — nothing marks them as different from any other member.
3. Click into the detail page `/crm/members/{jayden_user_id}` → hero, contact rows, Roster group all render.
4. Open the Edit modal → every field is pre-populated from the roster response.
5. Click Save → modal banner: **"Member not found on this club"** (HTTP 404 with no `code` field in the body).

The PATCH URL that fails:

```
PATCH /clubs/{naenae_club_id}/members/{jayden_user_id}
```

The LIST URL that returns Jayden fine:

```
GET /clubs/{naenae_club_id}/members?limit=200&include_invites=false
```

Same `club_id`, same `user_id` — but PATCH 404s.

---

## Why it happens

Per the `RosterMember` type (`packages/api-client/src/resources/members.ts:66`):

> `joined_at: string | null` — ISO 8601 UTC when the `club_members` row was created. **Null for self-declared / pending rows that never got a `club_members` row.**

So the LIST endpoint joins `users` ↔ `user_clubs` (membership intent) + `club_members` (admin-ratified link). If a user is in `user_clubs` but not `club_members`, they still appear on the roster — just with `joined_at: null`.

The PATCH handler keys off `club_members` directly:

```sql
UPDATE club_members
SET …
WHERE club_id = $1 AND user_id = $2;
```

Rows affected = 0 → the handler returns `404 Member not found on this club` (no `code` field, per brief 12 line 158).

---

## Fix option A — auto-create the `club_members` row (preferred)

Inside the PATCH handler, before the UPDATE, check whether a `club_members` row exists:

```sql
SELECT id, revoked_at FROM club_members
WHERE club_id = $1 AND user_id = $2;
```

Three branches:

| State | Action |
|---|---|
| Row exists, `revoked_at IS NULL` | Current behaviour — proceed with UPDATE. |
| Row exists, `revoked_at IS NOT NULL` | Return `409 member_revoked` — unchanged. |
| No row, but `user_clubs` row exists | **New:** INSERT a `club_members` row (`joined_at: NOW()`, `role: 'player'` by default), then proceed with UPDATE. |
| No row and no `user_clubs` row | Return `404` — unchanged. The user genuinely isn't attached to the club. |

This way the first Edit on a self-declared member silently promotes them to a formal roster entry — no "re-add from scratch" workflow needed, no UI dead-ends, no data loss.

### Response shape

Keep the existing `UpdateMemberResponse` (brief 12 §2). Flag the lazy create in the response so the frontend can toast an informational message:

```json
{
  "status": "success",
  "data": {
    "club_id":        4,
    "user_id":        88,
    "role":           "player",
    "title":          "Secretary",
    "position_group": "member",
    "preferred_position": "Skip",
    "playing_level":  "A",
    "public_visible": true,
    "bio":            null,
    "membership":     null,
    "updated_at":     "2026-10-16T02:11:00.000Z",
    "resolution":     "linked_now"   // NEW — one of: "updated", "linked_now"
  }
}
```

`resolution: "linked_now"` tells the CRM "this is the first proper save for this member — show a one-time toast like `Jayden Burns is now a full member of Naenae Bowling Club.`"

---

## Fix option B — exclude pending rows from LIST

Only consider going down this path if option A hits a schema constraint we can't resolve quickly.

Scope `GET /clubs/{club_id}/members` to rows that have a `club_members` entry:

```sql
… INNER JOIN club_members cm ON cm.user_id = u.id AND cm.club_id = $1
```

Side effects to think through:

- Admins lose visibility of self-declared members — if a user self-attaches via the public club site, they won't appear in the CRM until an admin manually adds them. That's probably not what we want.
- The public "meet the club" grid (brief 35) stays consistent — it reads from `users` + `user_clubs` too, so the public page would still show Jayden while the CRM wouldn't.

Prefer **option A** unless there's a hard reason not to.

---

## Error table update

Whichever option we pick, extend brief 12's error table so the CRM can route the "pending" case specifically. Suggested addition to `UpdateMemberErrorCode`:

| Status | `code` | When |
|---|---|---|
| `404` | `user_not_on_club` | User isn't linked to the club at all — the `user_clubs` row is missing too. (Only possible if option A is chosen and the backend still rejects truly-unknown users.) |

The existing codeless 404 should go away under option A — every PATCH 404 will have a reason.

---

## Frontend will do

1. On `resolution: "linked_now"`, show a one-time toast ("Jayden Burns is now linked to Naenae Bowling Club.") in addition to the usual "Member updated." toast.
2. On `code: "user_not_on_club"`, keep the existing banner message pointing admins at Members → Add member (`apps/crm/src/views/members/MemberDetailView.vue:443`).
3. Drop the "self-declared" guess from the error copy once the backend ships option A — the CRM will stop seeing codeless 404s for live roster rows.

---

## Verification

```bash
# 1. GET returns Jayden
curl -s -H "Authorization: Bearer <TOKEN>" \
  "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{naenae_club_id}/members?limit=200" \
  | jq '.data.members[] | select(.name == "Jayden Burns")'

# 2. PATCH used to 404 — should 200 after fix
curl -s -X PATCH -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{naenae_club_id}/members/{jayden_user_id}" \
  -d '{"title":"Pennant captain"}'

# 3. Second PATCH should return resolution:"updated" (not "linked_now") — row now exists
curl -s -X PATCH … -d '{"title":"Vice captain"}'
```

Pass criteria:

- Call #2 returns `200` with `resolution: "linked_now"`.
- `SELECT * FROM club_members WHERE user_id = {jayden_user_id} AND club_id = {naenae_club_id}` returns one row with `joined_at = NOW()` and `revoked_at = NULL`.
- Call #3 returns `200` with `resolution: "updated"`.
- The roster LIST now reports Jayden with a non-null `joined_at`.
