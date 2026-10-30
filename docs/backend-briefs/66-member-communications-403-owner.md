# `GET /members/{user_id}/communications` returns 403 for the club owner

**Feature:** fix the auth gate on the `member_communications` endpoints so the club **owner** (and admin/committee) can read the per-member communications feed. Today every caller — including the owner — is rejected with `403 "You do not have access to this club"`, which means the Notes + Communications tabs on the Member Detail page are completely blank in production.

**Related briefs:**
- brief 54 — communications history (the resource this bug sits on).
- brief 39 — scoped CRM roles. If this bug is a role-name mismatch (`'owner'` vs `'viewer'` / `'manager'`), §4 of 39 is the vocabulary the gate should match.
- Reference the backend-side response doc (shared with the FE as `backend-notes-and-email-response.md`) — §2 says *"Role required: viewer+ on the club"*. Owner should definitely clear a `viewer+` threshold; it does not.

**Status:** reported by Felicity on 2026-10-30 — the FE migration landed the same day (`apps/crm/src/views/members/MemberDetailView.vue` + `packages/api-client/src/resources/communications.ts`) and both tabs flipped to error states on first load. Zero notes / emails render for any user.

---

## Repro

1. Sign in as the owner of Naenae Bowling Club (Nigel Upper, `nigel@torny.co`, `club_role='owner'` on `club_members`).
2. Open `/crm/members/8` (Nev Rodda — any member works).
3. Click into the **Notes** or **Communications** tab.
4. Network tab shows two requests, both 403:

```
GET /Prod/clubs/5/members/8/communications?limit=100
GET /Prod/clubs/5/members/8/communications?limit=100
```

Response body on both:

```json
{"status":"error","message":"You do not have access to this club"}
```

No `code` field, no `details`.

For comparison, the exact same JWT on the exact same club returns 200 for:

```
GET /Prod/clubs/5/members?limit=200&include_invites=false
```

So the JWT is valid, the `club_id=5` resolves correctly, Nigel's `club_members` row for Naenae is intact. The communications endpoint is applying a stricter — and wrong — check.

---

## Why we think it happens

Two likely root causes:

### Hypothesis A — role allowlist missing `owner`

The gate (probably `requireClubRole(['viewer','manager','admin'])` or similar) was built against the brief 39 role vocabulary but the production DB stores roles as `'owner' | 'admin' | 'committee' | 'player'`. If the allowlist is literally `['viewer','manager','admin']`, no production user matches — but admins slip through (via SQL coincidence) while owners don't. 403 for everyone except admins.

### Hypothesis B — scope lookup joins the wrong table

Something like:

```sql
SELECT 1 FROM club_memberships
WHERE club_id = $1 AND user_id = $2 AND status = 'active';
```

…when it should be:

```sql
SELECT 1 FROM club_members
WHERE club_id = $1 AND user_id = $2;
```

`club_memberships` is the paid-tier table — owners typically don't have a `club_memberships` row (they run the club, they're not a paying member). This would reject owners while admins + committee + player members (who do have `club_memberships` rows) pass.

A quick way to distinguish A from B: have the gate run for an admin caller (not owner). If an admin passes and only owner fails → Hypothesis B. If both fail → Hypothesis A.

---

## The fix

Whichever root cause, the resolved behaviour matches what brief 54 §4 promises:

| Role | Can read `GET /communications` | Can write (POST / PATCH / DELETE) |
|---|---|---|
| `owner` | yes | yes |
| `admin` | yes | yes |
| `committee` | yes | PATCH / DELETE on own-authored notes only |
| `player` | **no** | no |

Match the gate to **`club_members.club_role IN ('owner','admin','committee')`** on the GET endpoint. For PATCH + DELETE, the same list applies, but `committee` is allowed only when `communications.sent_by = caller.user_id` (per the shipped-doc §4 "author can edit own").

Add a `code` field to the 403 response so the FE can tell this apart from genuine "wrong club" errors:

```jsonc
{
  "status": "error",
  "code":    "forbidden",
  "message": "You do not have access to this club's communications"
}
```

---

## Endpoints affected

All four `member_communications` routes probably share the same guard. Please verify + fix on each:

- `GET    /clubs/{club_id}/members/{user_id}/communications`
- `POST   /clubs/{club_id}/members/{user_id}/communications`
- `PATCH  /clubs/{club_id}/members/{user_id}/communications/{communication_id}`
- `DELETE /clubs/{club_id}/members/{user_id}/communications/{communication_id}`

The bulk-email handler (`POST /clubs/{club_id}/members/bulk-email`) writes `member_communications` rows as a side-effect but does *not* share this guard — bulk send is still working, so emails are landing in the DB. Owners just can't read them back.

---

## Verification (please attach outputs)

Using Nigel's JWT (owner of Naenae = `club_id=5`):

```bash
# 1. GET feed — should 200 with the rows the bulk-email handler has been writing all week.
curl -i -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/communications?limit=10"
# → 200, items[].channel includes 'email' from recent sends.

# 2. POST a note — should 201.
curl -i -X POST -H "Authorization: Bearer $NIGEL_JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/members/8/communications" \
  -d '{"channel":"note","note_type":"call","body":"Testing from brief 66."}'
# → 201, note_id returned.

# 3. GET again — the note from step 2 shows up first.
curl -i -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/communications?limit=10"
# → 200, items[0].body = "Testing from brief 66.".

# 4. PATCH the note.
curl -i -X PATCH -H "Authorization: Bearer $NIGEL_JWT" -H "Content-Type: application/json" \
  "$API/clubs/5/members/8/communications/$NOTE_ID" \
  -d '{"body":"Edited from brief 66."}'
# → 200, body echoed back, updated_at > created_at.

# 5. DELETE the note.
curl -i -X DELETE -H "Authorization: Bearer $NIGEL_JWT" \
  "$API/clubs/5/members/8/communications/$NOTE_ID"
# → 204.

# 6. Negative check — a player on the same club.
curl -i -H "Authorization: Bearer $PLAYER_JWT" \
  "$API/clubs/5/members/8/communications?limit=10"
# → 403 { code: "forbidden" }  (expected — players can't read others' notes)
```

Pass criteria:
- ✓ Owner, admin, and committee all return 200 on GET.
- ✓ Player returns 403 with `code: "forbidden"`.
- ✓ POST + PATCH + DELETE all 200/201/204 for owner.
- ✓ Error body always includes a `code` field (not just `status` + `message`).

---

## Frontend side

Nothing to change on the FE. The current migration:
- `apps/crm/src/components/modals/LogNoteModal.vue` → calls `communications.logNote()` with the shape from backend §1.
- `apps/crm/src/views/members/MemberDetailView.vue` → renders `communications.listForMember()` into Notes + Communications tabs with loading / error / empty states.
- `packages/api-client/src/resources/communications.ts` → full resource with the four endpoints.

Everything flips to green data the second this 403 clears. No deploy on our side needed.

---

## Contact

Ping Felicity in the frontend channel the moment the fix lands on prod — I'll re-test against Naenae's owner JWT and confirm the two tabs populate.
