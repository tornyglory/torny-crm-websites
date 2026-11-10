# Scoped CRM access — FE contract

Backend companion to brief 94. **All four phases shipped.** Permissions ride on `/me` + `/login`, every write endpoint enforces them, invite flow is live, PATCH permissions with concurrency guard works, PII filter nulls fields when the caller lacks `members:read_pii`, plan cross-check rejects Pro-only grants on Starter clubs, `team.permissions_changed` email fires on PATCH.

Supersedes `94-scoped-crm-access-phase-1-live.md` (which only covered phase 1).

## Base URLs

```
VENUE = https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
CRM   = https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
SAM   = https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod
```

**Routing note:** the invite endpoints are on `VENUE_BASE`, not `CRM_BASE`. CrmStack hit the CloudFormation 500-resource cap, so the invite router + its 4 routes landed on the venue stack (fresh budget). Everything else stays where it was — members, payments, website, settings, enquiries, applications, events, tournaments, honour board, venues are all CRM. Billing + signup + plan + invites are VENUE.

## `/me` and `/login` — permissions on every club

Every clubs[] entry carries a `permissions: string[]` field. Owner → `['*']`, admin → full explicit bundle, member → stored JSON (or committee default on NULL), player → `['dashboard:view']`.

```jsonc
{
  "status": "success",
  "data": {
    "id": 4177,
    "email": "denise@example.com",
    "role": "owner",
    "clubs": [
      {
        "id": 5,
        "name": "Naenae Bowling Club",
        "role": "owner",
        "title": null,
        "plan": "starter",
        "permissions": ["*"]
      },
      {
        "id": 42,
        "name": "Kelburn Bowling Club",
        "role": "member",
        "title": null,
        "plan": "pro",
        "permissions": [
          "dashboard:view",
          "members:read", "members:read_pii", "members:note",
          "events:read", "events:write",
          "communications:read", "communications:send"
        ]
      }
    ]
  }
}
```

## Permission strings — the full allowlist

```
dashboard:view

members:read          members:read_pii       members:write
members:remove        members:note
payments:read         payments:record

applications:read     applications:review
enquiries:read        enquiries:respond
events:read           events:write
communications:read   communications:send
website:view          website:edit

team_selections:read  team_selections:edit     ← Pro-only
tournaments:read      tournaments:edit         ← Pro-only
honour_board:read     honour_board:edit        ← Pro-only
venue_bookings:read   venue_bookings:manage    ← Pro-only
venue_packages:read   venue_packages:edit      ← Pro-only

settings:brand        settings:membership      settings:hours
settings:enquiries    settings:integrations
```

**Hard-coded (role-gated, NEVER returned in a member's bundle):**

- `settings:billing` → owner only
- `settings:danger` → owner only
- `settings:manage_team` → owner + admin

Check role (`club.role === 'owner'` etc.) for these, not `permissions.includes(...)`.

## Server-enforced writes — every endpoint 403s on missing permission

Phases 2a + 2b + 2c landed guards on ~100 CRM write endpoints. On insufficient permission the response is:

```jsonc
{
  "status": "error",
  "code": "forbidden_permission",
  "message": "Your role can't do that.",
  "required": "members:write"
}
```

HTTP 403. The `required` field is the exact permission string that was missing — surface it in a targeted "you need X" message instead of generic "forbidden."

Coverage by section (every write now gated):

| Section | Permission |
|---|---|
| Members (add / edit) | `members:write` |
| Members (remove) | `members:remove` |
| Member notes + member communications | `members:note` |
| Payments (log / reverse) | `payments:record` |
| Bulk member import (preview + commit) | `members:write` |
| Applications (approve / reject / notes / join-requests) | `applications:review` |
| Enquiries (read / reply / archive / patch / notes) | `enquiries:respond` |
| Events (manage-club-events) | `events:write` |
| Team selections + announcements | `team_selections:edit` |
| Tournaments (create / patch / publish / close / results / entry mgmt / refund) | `tournaments:edit` |
| Honour board (categories, entries, special achievements) | `honour_board:edit` |
| Venue bookings + booking enquiries | `venue_bookings:manage` |
| Venue packages + venue settings | `venue_packages:edit` |
| Website page builder + pages CRUD + block images/videos + nav + SEO | `website:edit` |
| Brand (logo, colour scheme, font, style preset, email template, email flavor) | `settings:brand` |
| Membership tiers + settings + seasons | `settings:membership` |
| Enquiry settings | `settings:enquiries` |
| Stripe Connect + tournament settings | `settings:integrations` |
| Bulk email + template test-send | `communications:send` |

Role-gated (NOT permission-gated):

| Action | Rule |
|---|---|
| Promote member → admin | owner only |
| Ownership transfer | owner only |
| Settings → Billing | owner only |
| Settings → Danger zone | owner only |
| Team access (invites + PATCH permissions) | owner + admin |

## Invite flow (VENUE_BASE)

### 1. `POST /clubs/{club_id}/invites` — send an invite

Admin+. Owner-only when `role: "admin"` (brief 94 §2.1 hard-coded).

```http
POST /clubs/42/invites
Authorization: Bearer <JWT>

{
  "email":   "sarah@example.com",
  "role":    "member",           // "admin" | "member"
  "permissions": [               // required when role=member; ignored when role=admin
    "dashboard:view",
    "members:read", "members:read_pii", "members:write", "members:note",
    "communications:read", "communications:send",
    "settings:membership"
  ],
  "message": "Kia ora — you'll have CRM access for membership stuff."
}
```

**201 response:**

```jsonc
{
  "status": "success",
  "data": {
    "invite": {
      "id": 117,
      "email": "sarah@example.com",
      "role": "member",
      "expires_at": "2026-11-16T04:12:00.000Z",
      "email_sent": true
    }
  }
}
```

**Error codes:**

| HTTP | code | meaning |
|---|---|---|
| 400 | `invalid_email` | not a valid address |
| 400 | `bad_role` | role not 'admin' or 'member' |
| 400 | `bad_permissions` | permissions missing for role=member |
| 403 | `forbidden` | caller isn't admin+ (or owner-only required for admin invite) |
| 409 | `already_member` | that email is already on the roster |
| 409 | `invite_pending_exists` | there's already a pending invite for that email |
| 422 | `invalid_permission` | one of the strings isn't in the allowlist |
| 422 | `permission_not_grantable` | tried to grant billing/danger/manage_team |
| 422 | `permission_requires_plan` | tried to grant a Pro-only permission on a Starter club. Body includes `required_plan: "pro"` |

### 2. `POST /invites/{token}/accept` — public accept

Public, no auth. The magic-link in the email goes to this endpoint (the FE route `/accept-invite/{token}` on `torny.co` should POST this on mount).

```http
POST /invites/abc123…xyz/accept
Content-Type: application/json

{
  "name":     "Sarah Whittaker",     // required only if the email doesn't have a Torny account yet
  "password": "a-long-password"      // required only if the email doesn't have a Torny account yet
}
```

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "user": {
      "id": 5821,
      "name": "Sarah Whittaker",
      "email": "sarah@example.com",
      "new_account": true
    },
    "club": {
      "id": 42,
      "name": "Kelburn Bowling Club",
      "slug": "kelburn"
    },
    "auth_token": "eyJhbGciOi…"      // 30-day JWT — treat like /auth/login's response
  }
}
```

**Error codes:**

| HTTP | code | meaning |
|---|---|---|
| 404 | `invite_not_found` | unknown token |
| 409 | `already_member` | they're already on the roster (invite still marked accepted) |
| 410 | `invite_expired` | past the 7-day window — ask the club to resend |
| 410 | `invite_revoked` | the club revoked the invite |
| 410 | `invite_already_accepted` | the token's one-time use is spent — route to /auth/login |
| 400 | `bad_name` / `bad_password` | needed for new accounts; `password` must be ≥ 12 chars |

**FE sequence:** store `auth_token` the same way `/auth/login` does, then route into the CRM home with `data.club.id` as the active club.

### 3. `GET /clubs/{club_id}/invites` — list pending + recent

Admin+. Powers the Settings → Team access card.

```jsonc
{
  "status": "success",
  "data": {
    "invites": [
      {
        "id": 117,
        "email": "sarah@example.com",
        "role": "member",
        "status": "pending",            // 'pending' | 'accepted' | 'expired' | 'revoked'
        "permissions": ["dashboard:view", "members:read", ...],
        "invited_by": { "id": 3, "name": "Marcus O." },
        "created_at": "2026-11-09T04:12:00.000Z",
        "expires_at": "2026-11-16T04:12:00.000Z",
        "accepted_at": null
      }
    ]
  }
}
```

### 4. `DELETE /clubs/{club_id}/invites/{invite_id}` — revoke

Admin+. Only revokes pending invites; accepted ones return `409 invite_already_accepted` (remove the materialised member via `DELETE /clubs/{cid}/members/{user_id}` instead).

**200 response:**

```jsonc
{ "status": "success", "data": { "invite": { "id": 117, "status": "revoked" } } }
```

## PATCH /clubs/{cid}/members/{user_id} — edit a member's permissions

**On CRM_BASE** (not venue). Existing endpoint, now accepts a new field.

```http
PATCH /clubs/42/members/5821
Authorization: Bearer <JWT>

{
  "permissions": [
    "dashboard:view",
    "members:read", "members:read_pii",
    "events:read", "events:write"
  ],
  "expected_updated_at": "2026-11-09T04:12:00.000Z"   // optional — concurrency guard
}
```

Full-replace semantics. FE sends the complete new array; backend writes exactly that.

### `expected_updated_at` — optional concurrency guard

If present and doesn't match the DB's current `club_members.updated_at`, backend returns 409:

```jsonc
{
  "status": "error",
  "code": "stale_state",
  "message": "This member has been updated since you opened the drawer. Reload and try again.",
  "current_updated_at": "2026-11-09T04:18:12.000Z"
}
```

Omit the field to skip the check (last-write-wins, same as today).

### Error codes

| HTTP | code | meaning |
|---|---|---|
| 403 | `forbidden_permission` | caller lacks `members:write` or hits a role-based rule |
| 409 | `owner_immutable` | tried to change owner's role |
| 409 | `stale_state` | `expected_updated_at` mismatch |
| 422 | `permissions_only_on_member` | tried to set `permissions[]` on an owner / admin / player row |
| 422 | `invalid_permission` | one string isn't in the allowlist |
| 422 | `permission_not_grantable` | tried to grant billing/danger/manage_team |
| 422 | `permission_requires_plan` | Pro-only permission on a Starter club |

## Permission change notification

After a successful PATCH that touches `permissions[]`, backend fires a **team.permissions_changed** email to the affected member. Body says:

> Hi {name}, Your CRM access to {club} was updated by {actor}. If you weren't expecting this, reply so the club can check.

No FE action needed — just know that editing permissions sends mail.

## PII filter on `GET /clubs/{club_id}/members`

When the caller's bundle doesn't include `members:read_pii`, the following fields are **nulled server-side** on every roster row and every pending-invite row:

```
users:        email, phone, dob, address, last_active_at
club_members: notes, member_number
```

No separate route, no opt-in flag — just the same endpoint with a different payload shape depending on who's calling. Example for a Selector hitting the roster:

```jsonc
{
  "user_id": 823,
  "name": "Tom Phillips",
  "handle": "tomp",
  "email": null,            // was members@…, now null
  "phone": null,
  "dob": null,
  "address": null,
  "last_active_at": null,
  "avatar_url": "https://…",
  "member_number": null,
  "club_role": "player",
  "title": null,
  "notes": null,
  "member_status": "member",
  "position_group": "committee",    // kept — this is brief-34 org structure, not role
  ...
}
```

**FE can show `—` for null values without having to hide the column.** Already matches what `usePermissions().can('members:read_pii') === false` would gate client-side.

## Plan tier interaction

`permission_requires_plan` fires on both invite send and PATCH when a Starter-plan club tries to grant a Pro-only permission (team_selections, tournaments, honour_board, venue_bookings, venue_packages). Response:

```jsonc
{
  "status": "error",
  "code": "permission_requires_plan",
  "message": "Permission \"tournaments:edit\" requires the Pro plan.",
  "field": "tournaments:edit",
  "required_plan": "pro"
}
```

**FE should hide Pro-only section toggles entirely on Starter clubs** (greyed with "Upgrade to Pro to grant access"). Reads `club.plan` on `/me`.

Existing clubs that downgrade keep their Pro-only permissions in the JSON bundle (we don't destructively mutate on downgrade). Write guards still reject — member can see Pro-only sections exist but their writes fail. On re-upgrade, access resumes automatically.

## `usePermissions()` composable (unchanged from phase 1)

```ts
function usePermissions(club: Club) {
  const perms = computed(() => club.permissions ?? [])
  const can = (perm: string) =>
    perms.value.includes('*') || perms.value.includes(perm)
  const canAny = (...ps: string[]) =>
    perms.value.includes('*') || ps.some(p => perms.value.includes(p))
  return { perms, can, canAny }
}
```

## Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # admin JWT

# 1. /me carries permissions[] per club
curl -s "$CRM/me" -H "Authorization: Bearer $TOKEN" | jq '.data.clubs[0].permissions[:3]'

# 2. Send an invite
curl -s -X POST "$VENUE/clubs/42/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"sarah@test.co.nz","role":"member","permissions":["dashboard:view","members:read","members:read_pii","members:note"]}'

# 3. List pending invites
curl -s "$VENUE/clubs/42/invites" -H "Authorization: Bearer $TOKEN" | jq '.data.invites'

# 4. Try to grant a Pro-only permission on a Starter club
curl -s -X POST "$VENUE/clubs/42/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"x@y.co","role":"member","permissions":["tournaments:edit"]}'
# → 422 permission_requires_plan if clubs_data.plan = 'starter'

# 5. Try to grant a hard-coded permission
curl -s -X POST "$VENUE/clubs/42/invites" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"x@y.co","role":"member","permissions":["settings:billing"]}'
# → 422 permission_not_grantable

# 6. Accept an invite (use token from step 2's email)
curl -s -X POST "$VENUE/invites/<token>/accept" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sarah W","password":"long-good-password"}'
# → 200 with auth_token + club + user.new_account:true

# 7. PATCH a member's permissions with concurrency guard
curl -s -X PATCH "$CRM/clubs/42/members/5821" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"permissions":["dashboard:view","events:read"],"expected_updated_at":"2026-11-09T04:12:00.000Z"}'

# 8. Write-guard spot check — a non-admin trying to add a member
curl -s -X POST "$CRM/clubs/42/members" \
  -H "Authorization: Bearer $PLAYER_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"nope@test.co"}'
# → 403 forbidden_permission, required: "members:write"

# 9. PII filter — roster from a Selector token (no members:read_pii)
curl -s "$CRM/clubs/42/members" -H "Authorization: Bearer $SELECTOR_TOKEN" \
  | jq '.data.members[0] | {name, email, phone, member_number}'
# → email/phone/member_number all null; name still present
```

## Pass criteria

- ✓ Owner's `permissions` = `['*']`
- ✓ Admin's `permissions` = full allowlist minus the 3 hard-coded strings
- ✓ Member with NULL column = 15-string read-only bundle (committee default)
- ✓ Member with explicit JSON = exactly that array, unknown strings filtered
- ✓ Invite send → 201 + email arrives + token appears in `/invites` list
- ✓ Invite accept → 200 + `auth_token` + `user.new_account` true for fresh accounts
- ✓ Invite revoke → status flips to 'revoked'
- ✓ PATCH permissions → 200 + email fires to affected member
- ✓ Stale PATCH with `expected_updated_at` → 409 `stale_state`
- ✓ Pro-only permission on Starter club invite → 422 `permission_requires_plan`
- ✓ Hard-coded permission in body → 422 `permission_not_grantable`
- ✓ Unknown permission string → 422 `invalid_permission`
- ✓ Member without `members:write` trying to POST /members → 403 `forbidden_permission` with `required: "members:write"`
- ✓ Member without `members:read_pii` hitting the roster → PII fields null in response

## Backend-side open items

- `send_invite` flag on `POST /clubs/{id}/members` (roster add) is still a silent no-op — no roster-claim email fires. Wait on a future phase or drop the flag from the FE payload.
- Legacy `manage-member-position` + `add-member-position` handlers have custom auth (self-claim + organiser fallback) and weren't guarded in this pass. They'll land in a surgical follow-up.
- `team.permissions_changed` email body is inline HTML with no SendGrid template. Can swap to a template when design has a visual pass.
