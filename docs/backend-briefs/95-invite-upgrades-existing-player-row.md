# Brief 95 — `POST /clubs/{cid}/invites` should upgrade an existing player row

**Scope:** VENUE_BASE · `POST /clubs/{cid}/invites` (brief 94-live §Invite flow 1) · error-code change + behaviour change on one branch. No new endpoint.

**Prereq:** brief 94-live (scoped CRM access + invites endpoint). Nothing in the permissions model changes — this is purely about how the invite handler treats an email that's already on the club's roster.

---

## 1. The ask

Today the invite handler rejects with `409 already_member` whenever the email matches *any* existing `club_members` row on the club. That's the right call when the email is already an admin or a team member (they already have CRM access — duplicate invite is nonsense). It's the **wrong** call when the email is a `role: 'player'` row — those are regular playing members who the club wants to promote into helping run the CRM. That's the common case.

Change the handler so:

- Email **not on the roster at all** → unchanged. Create the invite + send email, 201.
- Email already on the roster as `role: 'player'` → **upgrade in place**. Flip the row to `role: 'member'`, write the requested `permissions[]`, send the same `team.invited` email, respond 201 with the same shape but a new field `promoted_existing_member: true` so the FE can show a slightly different success toast ("Denise now has CRM access" vs "Invite sent to sarah@…").
- Email already on the roster as `role: 'owner'` / `'admin'` / `'member'` → unchanged. Still 409. Keep the code but split it into two codes (see §3).

---

## 2. Why

The Settings → Team access screen's invite flow is how clubs grant CRM access to their committee / managers / treasurer — virtually all of whom are already on the roster as playing members. A FE workaround (two-step: catch the 409, then PATCH the member with permissions) means the admin has to click twice for the common path. One-click is the right UX; the backend is the only place where this can be done atomically without creating an "invite that has no user to attach to."

Also matches the backend's existing pattern: brief 02's flow already describes the invite endpoint as the single source of truth for team-access grants. This change aligns actual behaviour with that promise.

---

## 3. Behaviour spec

### 3.1 Request body — unchanged

```http
POST /clubs/42/invites
Authorization: Bearer <JWT>

{
  "email": "denise@example.com",
  "role": "member",
  "permissions": [
    "dashboard:view",
    "members:read", "members:read_pii", "members:write", "members:note",
    "communications:read", "communications:send",
    "settings:membership"
  ],
  "message": "Kia ora — you'll have CRM access for membership + comms."
}
```

### 3.2 Branching on the email's current roster state

| Current row state                                   | Behaviour                                                                                              | HTTP |
|---|---|---|
| No row (new to the club)                            | Create invite row + send email. Unchanged.                                                             | 201  |
| `role: 'player'` row                                | Update row in place: `role = 'member'`, `permissions = <requested>`, bump `updated_at`. Send `team.invited` email with the same subject + body. Mark invite as `accepted` in the audit log with `source: 'auto_promote'`. | 201 |
| `role: 'member'` row with any `permissions` set     | Reject with `409 already_team_member`                                                                  | 409  |
| `role: 'admin'` row                                 | Reject with `409 already_team_member`                                                                  | 409  |
| `role: 'owner'` row                                 | Reject with `409 already_team_member`                                                                  | 409  |

For the player-upgrade branch, the response shape is:

```jsonc
{
  "status": "success",
  "data": {
    "invite": {
      "id": null,                            // no club_invites row was created for this path
      "email": "denise@example.com",
      "role": "member",
      "expires_at": null,
      "email_sent": true,
      "promoted_existing_member": true,      // NEW — only true on the auto-promote path
      "user_id": 5821                        // NEW — included on the auto-promote path so the FE can
                                             //       navigate straight to the member detail if desired
    }
  }
}
```

For the net-new invite (no existing row), response stays exactly as brief 94-live §Invite flow 1 described, optionally with `promoted_existing_member: false` for symmetry.

### 3.3 Admin-role invites on a player row

If the caller is the owner and sets `role: 'admin'` on the invite, the branch is the same: player row gets promoted straight to `role: 'admin'` with the fixed admin bundle (no `permissions[]` honoured — admins get the standard bundle per brief 94 §2.1). Return 201 with `promoted_existing_member: true`.

### 3.4 Plan + permission validation unchanged

All of brief 94-live's existing guards apply on the auto-promote branch:
- `invalid_permission` → 422 before any write.
- `permission_not_grantable` → 422 before any write.
- `permission_requires_plan` → 422 before any write.
- `bad_permissions` when `role: 'member'` and permissions missing → 400 before any write.
- `forbidden` when the caller can't invite admins → 403 before any write.

I.e. validate first, read the existing row second, branch third. Never half-promote.

---

## 4. Error-code change

The current `already_member` code conflates two cases that need different FE responses. Split it:

| code | HTTP | Cause |
|---|---|---|
| `already_team_member` | 409 | Email is already on the roster as owner / admin / member — can't invite again. FE message: "This person already has CRM access." |
| `already_member` | 409 | **DEPRECATED.** Keep returning for one deploy to avoid breaking any other callers, then remove. |

Rollout: start returning both codes in parallel for admin/member/owner conflicts for one release, document `already_team_member` as the canonical name, remove `already_member` after the FE ships the new handling.

---

## 5. Email template

Reuse `team.invited`. On the auto-promote branch:
- Subject: same.
- Body: same "You've been invited to help manage {{clubName}} on Torny" copy — it works whether the invitee is brand-new or an existing member.
- CTA button points to `/accept-invite/{magic-token}` only when a token was actually minted. For the auto-promote path, no token is needed (the user already has an account and a club_members row) — swap the CTA to a direct `/crm/dashboard` login link.

If swapping the CTA based on branch is awkward, a second template `team.access_granted` is acceptable. Either works for the FE; choose whichever is simpler to maintain.

---

## 6. Audit log

- Net-new invite path: existing audit entry (invite_created) unchanged.
- Auto-promote path: write an entry `member.role_changed` with `before.role='player'`, `after.role='member'` + `permissions`, `actor_user_id=<caller>`, `source='invite_auto_promote'`. Same retention as every other audit entry.

---

## 7. Verification

```bash
VENUE="…"
CRM="…"
TOKEN="…"  # admin JWT
CLUB=42

# 1. Net-new email — unchanged behaviour
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"brand-new@test.co.nz","role":"member","permissions":["dashboard:view","members:read"]}'
# → 201 { invite: { id: 118, email_sent: true, promoted_existing_member: false } }

# 2. Email already on the club as a player
# Pre-condition: insert a player row for denise@example.com on $CLUB
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"denise@example.com","role":"member","permissions":["dashboard:view","members:read","members:read_pii","members:note"]}'
# → 201 { invite: { id: null, email_sent: true, promoted_existing_member: true, user_id: 5821 } }
# → GET /clubs/$CLUB/members/5821 now reports role='member' with the requested permissions
# → team.invited (or team.access_granted) email arrives at denise@example.com
# → audit_log has a `member.role_changed` row with source='invite_auto_promote'

# 3. Email already on the club as an admin
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"existing-admin@example.com","role":"member","permissions":["dashboard:view"]}'
# → 409 already_team_member (and, during the deprecation window, 409 already_member)

# 4. Auto-promote on a Starter-plan club trying to grant a Pro-only permission
# Pre-condition: $CLUB on Starter plan, denise is a player there
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"denise@example.com","role":"member","permissions":["tournaments:edit"]}'
# → 422 permission_requires_plan — denise's row is NOT modified (validate-first guarantee)

# 5. Role: admin invite on a player row by owner
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"denise@example.com","role":"admin"}'
# → 201 { invite: { promoted_existing_member: true, role: "admin" } }
# → denise now has role=admin, the standard admin bundle, email delivered
```

---

## 8. Pass criteria

- ✓ Net-new email → 201 with `promoted_existing_member: false` (or field omitted).
- ✓ Existing player → 201, row promoted in place, `promoted_existing_member: true`, `user_id` returned.
- ✓ Existing admin / member / owner → 409 `already_team_member` (and, during the transition, also 409 `already_member`).
- ✓ Validation errors (invalid/not-grantable/requires-plan/bad-permissions) fire before any write — a 422 never leaves a half-promoted row.
- ✓ Email arrives for both the net-new and auto-promote cases.
- ✓ Audit log entry exists with the correct `source` string.

---

## 9. Non-goals

- Changing anything about the `PATCH /members/{id}` endpoint. Admins editing an existing CRM member's permissions still go through PATCH; this brief is only about the invite entry point.
- Changing the accept flow. The auto-promote path doesn't mint a token or require `/invites/{token}/accept` — that endpoint is only for genuinely-new users.
- UI for picking an existing member to promote (member picker, type-ahead). Not needed — admin just types the email, backend does the right thing.

---

## 10. FE follow-up (out of scope here, tracking so nothing's forgotten)

Once this ships, `TeamAccessCard.vue`'s `sendInvite` will:
- On `promoted_existing_member: true`, toast `"${name} now has CRM access."` and refresh.
- On the net-new path, toast `"Invite sent to ${email}."` (current behaviour).
- On `already_team_member` 409, toast `"${email} already has CRM access."` — no more "that email is already on the roster" copy that was wrong for the common case.

---

## 11. Contact

Nev on Slack (`#torny-eng`). Small scope — one handler, one error-code split, one new response field. Should slot into the same deploy as any other invite-handler tidy-up.
