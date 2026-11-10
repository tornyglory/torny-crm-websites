# Invite endpoint auto-promotes existing player rows — FE contract

Narrow follow-up to `94-scoped-crm-access-live.md`. Changes `POST /clubs/{cid}/invites` behaviour for the common case where the invited email is already on the club's roster as a playing member. Everything else about the invite flow (list, revoke, accept) is unchanged.

Live on VENUE now. 20/20 E2E tests green.

## Base URL (unchanged)

```
VENUE = https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
```

## What changed

Previously: any existing `club_members` row → `409 already_member`. FE had to catch-then-PATCH for the common "promote a player into CRM access" case.

Now: three branches based on current roster state.

| Roster state                       | HTTP | Behaviour |
|---|---|---|
| No row                             | 201  | **Unchanged.** Creates `club_invites` row + magic-link email. Invitee hits `POST /invites/{token}/accept` to materialise their membership. |
| `role: 'player'`                   | 201  | **NEW.** Auto-promote in place — `role` flips to `member` (or `admin` for owner-only `role: "admin"` invites), permissions bundle written to `club_members.permissions`. Same team-invited email but with a direct `/crm/dashboard` CTA (no token — they already have a Torny account). |
| `role` in `owner` / `admin` / `member` | 409  | New code `already_team_member` + `legacy_code: 'already_member'` for one release while you migrate. |

## Request body — unchanged

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

## Response — net-new path (201)

```jsonc
{
  "status": "success",
  "data": {
    "invite": {
      "id": 118,
      "email": "brand-new@test.co.nz",
      "role": "member",
      "expires_at": "2026-11-17T04:12:00.000Z",
      "email_sent": true,
      "promoted_existing_member": false          // NEW — always present now
    }
  }
}
```

## Response — auto-promote path (201)

```jsonc
{
  "status": "success",
  "data": {
    "invite": {
      "id": 119,                                 // CHANGED (was null) — magic-link invite row now
                                                 //   created so the invitee can set/use their password
      "email": "denise@example.com",
      "role": "member",
      "expires_at": "2026-11-17T04:12:00.000Z",  // CHANGED (was null) — matches net-new path
      "email_sent": true,
      "promoted_existing_member": true,          // the signal for "this was an upgrade in place"
      "user_id": 5821                            // the promoted member's user_id — route to
                                                 //   /clubs/{cid}/members/{user_id} to see their row
    }
  }
}
```

**Why `id` and `expires_at` are now set:** the auto-promote email contains a magic-link to `/accept-invite/{token}` (not `/crm/dashboard` as originally shipped) because a promoted player may have been added to the roster by an admin via `POST /clubs/{id}/members` — those users start with `users.passwordHash = NULL` and can't log in with a password until they set one. The accept flow handles the password step; see §Accept flow below.

The `promoted_existing_member: true` flag is still the FE's branching signal for toast copy — nothing changes there.

## Error — already on the roster as CRM user (409)

```jsonc
{
  "status": "error",
  "code": "already_team_member",                 // NEW canonical code
  "legacy_code": "already_member",               // transition-only; drops in a later release
  "message": "This person already has CRM access.",
  "role": "admin"                                // their existing role on the club
}
```

**Recommendation:** read `code` first, fall back to `legacy_code` for one release while you cut over.

## Validation guarantees (unchanged)

All of brief 94-live's `invalid_permission`, `permission_not_grantable`, `permission_requires_plan`, `bad_permissions`, `forbidden` responses still fire **before** any roster write. A 422 on an auto-promote branch never leaves a half-modified `club_members` row. Confirmed by the test suite.

## FE toast copy (suggested)

Per brief 95 §10:

| Response field | Toast |
|---|---|
| `invite.promoted_existing_member === true` | `"${invite.email} now has CRM access."` — plus "View" linking to `/clubs/{cid}/members/${invite.user_id}` |
| `invite.promoted_existing_member === false` | `"Invite sent to ${invite.email}."` (current behaviour) |
| `code === 'already_team_member'` (or `legacy_code === 'already_member'`) | `"${req.email} already has CRM access."` + button to open their member row |

## Email behaviour

Both paths now send a magic-link to `/accept-invite/{token}`:

- Net-new → subject `"You're invited to {{club_name}} on Torny"`, CTA "Accept invite".
- Auto-promote → subject `"You've got CRM access to {{club_name}}"`, CTA "Accept access".

Same SES pipeline, same `respectOverride: false`, no SendGrid template. Copy differs only in subject + opening paragraph.

## Accept flow — `POST /invites/{token}/accept`

Updated to handle three user states cleanly:

| User state | `body` requirement | Side effect |
|---|---|---|
| New account (email not in `users`) | `{ name, password }` both required | Creates user, hashes password (bcrypt), inserts membership |
| Existing user with real password | Empty `{}` is fine; body ignored | Mints JWT, marks invite accepted |
| **Existing user with NULL password** (stub from admin-added roster row) | `{ password }` required (≥ 12 chars) | bcrypt + `UPDATE users SET passwordHash = …`, marks invite accepted |

If the auto-promote path updated `club_members` already, accept just re-asserts role+permissions (defensive sync for the "admin changed the row between send + accept" edge case) — it won't double-insert.

### Response

```jsonc
{
  "status": "success",
  "data": {
    "user": {
      "id": 5821,
      "name": "Denise W",
      "email": "denise@example.com",
      "new_account": false,                       // true only for net-new users
      "password_was_set": true                    // true when the accept step bcrypted + wrote a password
                                                  //   (either new_account OR existing-stub-user case)
    },
    "club": { "id": 42, "name": "Carterton Hall", "slug": "carterton" },
    "auth_token": "eyJhbGciOi…"                   // 30-day JWT
  }
}
```

### New error on accept

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_password` | existing user has `passwordHash = NULL` and body didn't supply a valid password (≥ 12 chars). Message: `password is required (≥ 12 chars) — this account has no password yet`. FE should render a password-setup form and POST again. |

Existing accept errors (`invite_not_found`, `invite_expired`, `invite_revoked`, `invite_already_accepted`, `bad_name`) are unchanged.

### FE accept-invite page behaviour (suggested)

1. On mount, POST the token with empty body.
2. If 200 → store `auth_token`, route to `/crm/dashboard`.
3. If 400 `bad_password` + `password_was_set` isn't in response:
   - Render "Set your password" form (single password field, confirm field).
   - POST again with `{ password }`.
4. If 400 `bad_name` (net-new, no user yet): render name + password form, POST with both.
5. If 410 → show the specific error (expired / revoked / already-accepted), route to `/auth/login`.

## Audit (minor backend note)

Brief 95 §6 asks for an `audit_log` row with `source: 'invite_auto_promote'`. No such table exists in the schema yet — the backend emits a structured `console.log` instead (`audit: member.role_changed`, queryable via CloudWatch Logs Insights). Proper audit-table work is a later brief. No FE impact.

## Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # admin JWT
CLUB=42

# 1. Net-new email
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"brand-new@test.co.nz","role":"member","permissions":["dashboard:view","members:read"]}' \
  | jq '.data.invite | {id, email_sent, promoted_existing_member, expires_at}'
# → id is a number, promoted_existing_member=false, expires_at set

# 2. Existing player on the club
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"denise@example.com","role":"member","permissions":["dashboard:view","members:read","members:note"]}' \
  | jq '.data.invite | {id, promoted_existing_member, user_id, role}'
# → id numeric, promoted_existing_member=true, user_id set, role='member'

# 3. Existing CRM user
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"someone-with-access@example.com","role":"member","permissions":["dashboard:view"]}'
# → 409 { code: 'already_team_member', legacy_code: 'already_member', role: 'admin' }

# 4. Validation still guards before any write
curl -s -X POST "$VENUE/clubs/$CLUB/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"denise@example.com","role":"member","permissions":["events:fly"]}'
# → 422 invalid_permission, and denise's row is untouched
```

## Pass criteria

- ✓ `invite.promoted_existing_member` present on every 201 response.
- ✓ `invite.user_id` present only on the auto-promote 201.
- ✓ `invite.id` numeric on both paths; `expires_at` set on both paths.
- ✓ 409 responses carry both `code: 'already_team_member'` and `legacy_code: 'already_member'`.
- ✓ 422 / 400 / 403 still land before any write.
- ✓ After auto-promote, `GET /clubs/{cid}/members/{user_id}` shows `role: "member"` (or `"admin"`) with the requested permissions.
- ✓ Accept with empty body on a stub-user (NULL password) → 400 `bad_password`, no state change.
- ✓ Accept with `{ password }` on a stub-user → 200, `password_was_set: true`, `users.passwordHash` now populated.

## Out of scope

- `PATCH /clubs/{cid}/members/{user_id}` — unchanged. Editing an existing CRM member's permissions still goes through PATCH; the invite endpoint is only the entry point.
- Member picker in the invite modal — not needed. Admin just types the email; backend does the right thing.

## Contact

Nev on Slack `#torny-eng`. If you need the `already_member` → `already_team_member` cutover accelerated (i.e. drop `legacy_code` in the next release instead of the one after), say so — one line change.
