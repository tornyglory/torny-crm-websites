# Club Membership — Release Endpoint

**Feature:** let an authenticated user drop an existing club membership so the CRM can offer a "Leave this club" / "Change club" flow. Complements the existing `claims.submit` (create) flow with a mirror-image release (destroy) flow that's safe for owners and admins alike.

**Status:** requested — CRM currently has no way to remove a user from a club they've claimed. If a user picks the wrong club during onboarding, they're stuck with it as a dormant record forever (or an engineer runs SQL). Comes up any time a club is misclaimed, folded, or an owner rotates off.

**Related:** `packages/api-client/src/resources/claims.ts` (existing submit/mine), `apps/crm/src/stores/club.ts` (client state), `docs/backend-briefs/01-auth-and-club-claim.md` (original claim flow).

---

## TL;DR

- **`DELETE /clubs/:club_id/memberships/me`** — user releases their own membership from a club they belong to.
- **`POST /clubs/:club_id/memberships/me/release`** as an alternative if DELETE-with-body feels wrong; body carries a short `reason`.
- **Guard against the last-owner case** — you cannot release the last owner of a club. Return `400 last_owner` with a hint to transfer ownership first.
- **No admin approval required for MVP.** Trust the user; the audit log records it. If abuse becomes a problem, add approval later.
- **Auto-published data (pages, events, honour board) stays where it is.** Ownership passes to the remaining owners; if the released user was the last owner and we're blocking that (see above), no data changes hands.

---

## Base URL

`CRM_BASE`, bearer JWT. Same base as `/clubs/*` and `/claims/*`.

---

## 1. Data model

Today, a user's membership in a club is stored in whatever table underpins `auth.user.clubs[]` and `GET /me`. That table already has a `role` (`owner | admin | committee | player`) and `club_id`. Release means either:

1. **Soft-delete** — add a `left_at TIMESTAMPTZ NULL` column and filter it out everywhere.
2. **Hard-delete** — remove the row. Recompute counts anywhere they matter.

Preference: **soft-delete**. Owners occasionally want to rejoin a club they left; soft-delete gives us that for free. Also cheaper to audit ("who left when, and why").

```sql
ALTER TABLE club_memberships
  ADD COLUMN left_at TIMESTAMPTZ,
  ADD COLUMN leave_reason TEXT;

CREATE INDEX club_memberships_active
  ON club_memberships (club_id, user_id)
  WHERE left_at IS NULL;
```

Every existing query that reads memberships needs `WHERE left_at IS NULL` — check `auth.user.clubs[]` shaping first, that's the most-loaded read.

---

## 2. Endpoint

### `DELETE /clubs/:club_id/memberships/me`  (🔒 authenticated)

Release the caller's own membership from this club.

**Query params:**

- `reason` — optional, ≤ 500 chars. Free text, stored on the row for the audit log. Sample values: "Wrong club during onboarding", "Committee rolled off", "Moved regions".

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "club_id": 42,
    "user_id": 3,
    "left_at": "2026-08-24T09:15:32Z"
  }
}
```

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| No membership on this club | 404 | `not_a_member` |
| Caller is the last owner | 400 | `last_owner` |
| Membership already released | 400 | `already_released` |

`last_owner` prompts the frontend to explain: *"You're the last owner of this club. Transfer ownership to another member before you can leave."* We haven't shipped ownership transfer yet — that's a separate future brief. For now, an owner who wants out can add another owner via the existing member management + role change, then leave.

### `POST /clubs/:club_id/memberships/me/restore`  (🔒 platform-admin only for now)

Un-release a soft-deleted membership. Not exposed on the CRM UI initially — this is a support tool that the ops team hits directly (or via a future admin UI).

Same 200 response shape; `left_at` and `leave_reason` cleared.

---

## 3. Side-effects

When a user releases their membership:

- **`GET /me` no longer lists that club** in `user.clubs[]`. The CRM's `useClubStore` sees the club disappear and falls back to another club the user is on (or clears state, sending them back to `/claim` if they're on none).
- **Published pages, events, honour board entries, published site payload** — no change. The club still exists; the released user just no longer has permissions to edit any of it.
- **Draft pages the user was editing** — become owned by the club (already are — `layout_draft` isn't per-user). No cleanup needed.
- **RSVPs the released user submitted** — kept, since events belong to the club and the user was on it at the time.
- **Pending claims by the released user against the same club** — auto-cancel any `pending` claim rows (rare edge case, but tidy).

---

## 4. Auth + tenancy

- Any authenticated user can release *their own* membership. There's no cross-user attack surface — you can only DELETE `/memberships/me`, not `/memberships/:someone_else`.
- Admin/platform-admin can't release *other* users' memberships via this endpoint — that would need a separate `/admin/memberships/:id` endpoint (out of scope; use existing member-remove).
- **Audit log:** every release writes an audit event with `{ user_id, club_id, reason, released_by: 'self', left_at }`. Same table + shape as claim decisions today.

---

## 5. Migration + rollout

1. Migration adds `left_at` + `leave_reason` columns + partial index on active memberships.
2. Update `GET /me` / `user.clubs[]` shaping to filter `left_at IS NULL` (this is the query that's called on every page load — check it works before shipping the endpoint).
3. Ship `DELETE /clubs/:club_id/memberships/me` with the three error codes.
4. Ship `POST /clubs/:club_id/memberships/me/restore` for platform-admin.
5. Regression test: existing member-management APIs (add/remove/update) shouldn't touch soft-deleted rows. `/roster` returns active members only.
6. Frontend ships in the same window — a "Leave this club" button in Settings + a `last_owner` warning modal.

---

## 6. Frontend implications

- `apps/crm/src/stores/club.ts` — after a successful release, call `syncFromUserClubs(user.value?.clubs)` again to pick a new default (or clear state → route to `/claim`).
- Settings page gains a "Leave this club" section under a dangerous-actions accordion. Confirms with the club name typed out (like GitHub's repo-delete). Shows a `last_owner` warning inline.
- Sidebar workspace switcher becomes useful the moment users can be on more than one club — pair this brief with the existing "Claim another club" flow already shipping.

---

## 7. Non-goals

- **Ownership transfer.** Separate future brief. For now, `last_owner` blocks the release and the user has to add another owner first.
- **Admin-driven release of other users.** Existing member-remove already covers this — no new API needed.
- **Undo timer.** Once released, the user's out. Restore is admin-only for MVP.
- **Bulk release / leave all clubs.** Not needed — sign out already exists.
- **Notification to remaining owners.** Nice-to-have; skip for MVP, add via the existing comms brief later.

---

## 8. Open questions for backend

1. Is `club_memberships` actually the table name, or is membership derived from `claim_approvals`? If the latter, soft-deleting a claim is a bigger change — worth calling out early.
2. Should `leave_reason` be exposed publicly on the audit log, or only to platform-admin? MVP: platform-admin-only, since it can contain sensitive commentary.
3. Timing of `last_owner` check — count active owners *after* the caller's row is set to left, or *before*? Should be *after*, but the SQL should be `SELECT COUNT(*) FROM club_memberships WHERE club_id = X AND role = 'owner' AND left_at IS NULL AND user_id <> :caller` for clarity.
4. What happens to a released user's public profile page (`/players/:slug`) — do they still appear as a member of the club? Recommend: no, filter released memberships out of public shaping too.
