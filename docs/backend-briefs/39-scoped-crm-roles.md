# Scoped CRM Roles

**Feature:** replace the current three-role model (`owner` / `admin` / `committee`) with an eight-role model so clubs can grant scoped access — a Selector only sees Team selections, a Content editor never sees member PII, a Treasurer only handles payments, etc.

**Status:** designed 2026-08-26. Awaiting backend implementation. Frontend gating comes in a follow-up brief once permissions[] ships on `/me`.

**Related briefs:**
- brief 29 (roster + add/patch member) — extends the `role` enum + adds a permission-check pass before every write.
- brief 30 (post-onboarding fixes) — `/me` gains `permissions[]`.
- brief 35 (members + player profile) — the public directory position_group is orthogonal to CRM role.
- brief 38 (applications) — Membership officer + Owner + Admin can approve/reject; nobody else.

---

## 1. The eight roles

Ordered by seniority. Higher rows can do everything lower rows can, except where noted.

| Slug | Label | One-line purpose |
|---|---|---|
| `owner` | Owner | Founder / president. Full control including billing, ownership transfer, danger zone. One per club. |
| `admin` | Admin | GM or trusted deputy. Same as owner minus billing / danger zone / role management of admins+. |
| `membership_officer` | Membership officer | Members + Applications + Enquiries + Communications. No website, honour board, or settings. |
| `content_editor` | Content editor | Website + Events + Honour board + Communications. **No member PII at all.** |
| `treasurer` | Treasurer | Members read + record payments, Applications read, Settings → billing only. |
| `selector` | Selector | Team selections (full) + Events (read) + Members (read, no PII beyond name + position). |
| `coach` | Coach | Team selections (read) + Events (create for training) + Members (read) + Communications (send). |
| `committee` | Committee | Read-only across almost everything. Can add internal notes on members. AGM visibility, no operational power. |

**Legacy:** existing rows keep `owner` / `admin` / `committee`. `player` is unchanged and stays as the "regular playing member with no CRM access" marker.

---

## 2. Permission model

Resource × action strings, namespaced with a colon. The backend evaluates permissions server-side on every write — the frontend hides UI to prevent surprises but never trusts the client-side check.

### 2.1 The permission strings

```
dashboard:view
members:read              — see the roster
members:read_pii          — see DOB, address, email, phone, notes
members:write             — add + edit
members:remove            — revoke membership
members:note              — add internal notes on a member row
payments:record           — log a payment against a member
payments:read             — see payment history / totals
applications:read
applications:review       — approve / reject / add notes
enquiries:read
enquiries:respond
website:view              — see the Website section (read-only preview)
website:edit              — save + publish pages, edit navigation/brand
events:read
events:write              — create / edit / delete
team_selections:read
team_selections:edit
honour_board:read
honour_board:edit
communications:read
communications:send
settings:brand            — logo, palette, fonts, style preset
settings:membership       — cadence, first-year discount, tiers (brief 36)
settings:hours            — opening hours
settings:integrations     — Stripe, GCal, mail
settings:billing          — Torny plan + invoices
settings:danger           — archive / delete / ownership transfer
settings:manage_team      — invite + change CRM roles for other users
```

### 2.2 Role → permission matrix

`✓` = granted. `✓*` = granted with a scope constraint (see notes). `—` = not granted.

| Permission | Owner | Admin | Memb. officer | Content editor | Treasurer | Selector | Coach | Committee |
|---|---|---|---|---|---|---|---|---|
| dashboard:view                | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| members:read                  | ✓ | ✓ | ✓ | — | ✓ | ✓* | ✓ | ✓ |
| members:read_pii              | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| members:write                 | ✓ | ✓ | ✓ | — | — | — | — | — |
| members:remove                | ✓ | ✓ | ✓ | — | — | — | — | — |
| members:note                  | ✓ | ✓ | ✓ | — | — | — | — | ✓ |
| payments:record               | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| payments:read                 | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| applications:read             | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ |
| applications:review           | ✓ | ✓ | ✓ | — | — | — | — | — |
| enquiries:read                | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ |
| enquiries:respond             | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| website:view                  | ✓ | ✓ | — | ✓ | — | — | — | ✓ |
| website:edit                  | ✓ | ✓ | — | ✓ | — | — | — | — |
| events:read                   | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| events:write                  | ✓ | ✓ | — | ✓ | — | — | ✓* | — |
| team_selections:read          | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| team_selections:edit          | ✓ | ✓ | — | — | — | ✓ | — | — |
| honour_board:read             | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| honour_board:edit             | ✓ | ✓ | — | ✓ | — | — | — | — |
| communications:read           | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| communications:send           | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | — |
| settings:brand                | ✓ | ✓ | — | ✓ | — | — | — | — |
| settings:membership           | ✓ | ✓ | ✓ | — | — | — | — | — |
| settings:hours                | ✓ | ✓ | — | ✓ | — | — | — | — |
| settings:integrations         | ✓ | ✓ | — | — | — | — | — | — |
| settings:billing              | ✓ | — | — | — | ✓ | — | — | — |
| settings:danger               | ✓ | — | — | — | — | — | — | — |
| settings:manage_team          | ✓ | ✓* | — | — | — | — | — | — |

**Scope constraints:**
- `members:read` for Selector — the roster query strips `email`, `phone`, `dob`, `address`, `notes`, `member_number`, `last_active_at`. Only name / avatar / position_group / display_name / trophies_count come back.
- `events:write` for Coach — can create/edit events where `event_type='training'`. All other event types are 403.
- `settings:manage_team` for Admin — can invite / edit / remove any role **except** `owner` and other `admin` rows. Only Owner can promote to Admin or remove another Admin.

---

## 3. Database

### 3.1 Migration 102 — extend the enum

```sql
ALTER TABLE club_members
  MODIFY COLUMN role ENUM(
    'owner','admin','membership_officer','content_editor',
    'treasurer','selector','coach','committee','player'
  ) NOT NULL;
```

Existing rows keep their current value. No data migration needed — none of the new slugs collide with legacy values.

### 3.2 No separate permissions table

Permissions are derived from `role` at request time via a fixed map in code (`utils/role-permissions.js`). Same pattern as brief 22 (font pairs) and brief 37 (colour schemes): the curated list lives in a JS module. Adding a permission is a code change + deploy — same effective outcome as a table with no live editing, less moving parts.

If we ever add per-user custom overrides ("Denise is a Content editor but also gets communications:send") we'll move to a `club_member_permissions` overrides table then. Not scope for v1.

---

## 4. `/me` payload — add `permissions[]`

Every `/me` response gains a `permissions` array per club membership. Same shape as before, extended:

```jsonc
{
  "status": "success",
  "data": {
    "user": {
      "user_id": 4177,
      "email": "denise@example.com",
      "…": "existing user fields"
    },
    "clubs": [
      {
        "id": 5,
        "name": "Kelburn Bowling Club",
        "slug": "kelburn",
        "role": "content_editor",
        "role_label": "Content editor",
        "permissions": [
          "dashboard:view",
          "website:view", "website:edit",
          "events:read", "events:write",
          "honour_board:read", "honour_board:edit",
          "communications:read", "communications:send",
          "enquiries:read", "enquiries:respond",
          "settings:brand", "settings:hours"
        ]
      }
    ]
  }
}
```

The frontend reads `permissions` to render the sidebar + gate route entry. Reading `role` still works for display-only ("You're logged in as Content editor").

---

## 5. Endpoint impact

Every write endpoint runs `requirePermission(clubId, 'resource:action')` after `requireAuth`. If missing, respond:

```jsonc
{
  "status": "error",
  "code": "forbidden_permission",
  "message": "Your role can't do that.",
  "required": "members:write"
}
```

HTTP status: **403**.

### Additional guards

- **Members roster (`GET /clubs/:id/members`)** — the response strips PII fields when the caller lacks `members:read_pii`. `phone`, `email`, `dob`, `address`, `notes`, `member_number`, `last_active_at` become `null`. This keeps the same endpoint working for Selectors without a separate route.
- **Events (`POST/PATCH/DELETE /clubs/:id/events`)** — Coach role: reject with `403 forbidden_scope` if the request body's `event_type !== 'training'` (or the existing row's event_type is not training on PATCH/DELETE).
- **Role changes (`PATCH /clubs/:id/members/:userId` role field)** — matrix of allowed transitions:

| Caller role | Can set target to | Cannot set target to |
|---|---|---|
| Owner | Any role including `admin` | `owner` (use ownership transfer instead) |
| Admin | Any role **except** `admin`, `owner` | `admin`, `owner` |
| Everyone else | — | anything |

Attempts return `403 forbidden_role_transition` with a `required` hint.

- **Ownership transfer** stays a separate flow (`POST /clubs/:id/transfer`) — Owner only, requires the target's email + confirmation.

---

## 6. Invite flow (brief 29 + new)

`POST /clubs/:id/members/invite` gets a validated `role` field accepting any of the eight CRM roles (not `player` — that's the join-form path).

- Owner-only for `admin` invites.
- Owner + Admin for the other six CRM roles.
- 403 otherwise with `forbidden_permission` + `required: "settings:manage_team"`.

The invite email says which role they'll receive so recipients aren't surprised.

---

## 7. Error codes (new + reused)

| code | HTTP | Cause |
|---|---|---|
| `forbidden_permission` | 403 | Caller's role lacks the required permission for this action |
| `forbidden_role_transition` | 403 | Caller can't set the target user's role to the requested value |
| `forbidden_scope` | 403 | Caller has the permission but the specific record is outside their scope (e.g. Coach editing a non-training event) |
| `owner_immutable` | 409 | Existing (brief 29) — can't edit the owner via this endpoint |
| `owner_via_transfer` | 409 | Existing (brief 29) — use ownership transfer instead |

All errors ship a machine-readable `required` field where relevant so the frontend can show a targeted "you need X" hint.

---

## 8. Client contract summary

**What the frontend does:**
- Reads `permissions[]` off `/me`'s `clubs[]` for the active club and renders sidebar items conditionally.
- Route guards check the same array before letting the router mount a view. Any bypass hits the 403 backstop.
- `members:read_pii === false` → the roster columns for phone/email/dob/etc. render `—` instead of the value (the API already sends null, but this saves a paint).
- Coach event editor hides the event-type dropdown and pre-fills `training`.
- Admin role dropdown in the "Edit member" modal only shows roles the caller can grant.

**What the frontend does NOT do:**
- Trust its own permission check. Every write endpoint is guarded server-side. The check exists so the UI doesn't offer buttons that would 403.

---

## 9. Migration for existing installs

- No behavioural change for existing owner / admin / committee rows.
- `/me` starts returning `permissions[]` for every membership as soon as this ships — front-ends that ignore the field keep working (they still read `role`).
- Frontend gating rolls out per-section behind a `PERMISSIONS_V2` feature flag so we can compare against the legacy role-string checks during the transition. Once every check has moved to `permissions.includes(...)`, drop the flag.

---

## 10. Verification (implement + attach test outputs)

- ✓ `PATCH /clubs/:id/members/:userId` from an Admin trying to set another user to `admin` → 403 `forbidden_role_transition`
- ✓ Same request from Owner → 200
- ✓ Selector calling `GET /clubs/:id/members` → 200, response rows have `null` phone / email / dob / notes
- ✓ Selector calling `PATCH /clubs/:id/members/:userId` → 403 `forbidden_permission`, `required: 'members:write'`
- ✓ Coach `POST /clubs/:id/events` with `event_type='tournament'` → 403 `forbidden_scope`
- ✓ Coach `POST /clubs/:id/events` with `event_type='training'` → 200
- ✓ Content editor calling `GET /clubs/:id/members` → 403 `forbidden_permission`, `required: 'members:read'`
- ✓ Treasurer `PATCH /clubs/:id/settings` for `brand.accent_colour` → 403 (they only have `settings:billing`)
- ✓ Treasurer `POST /clubs/:id/members/:userId/payments` → 200
- ✓ Membership officer approving an application → 200
- ✓ Committee member on a member row: `PATCH /clubs/:id/members/:userId` with `notes` field only → 200 (`members:note`); with any other field → 403
- ✓ `/me` for an eight-role membership returns the exact permission list from §2.2
- ✓ Invite with `role='selector'` from an Admin → 200; from a Coach → 403

---

## 11. Non-goals

- Per-user permission overrides (Denise gets one extra permission on top of her role). Add via a follow-up brief if we hit real demand.
- Multi-club roles (a single user having different roles across clubs) — already supported by `club_members`; nothing to change.
- Fine-grained scoping like "Selector for the men's pennant only, not women's" — v1 grants at the resource level, not the row level.
- Custom role definitions per club — the eight roles are fixed. If a club wants "Bar Manager sees only opening hours" we build them a new role globally, we don't let each club define their own.

---

## 12. Frontend follow-up brief (out of scope here)

Once this ships, the CRM will need:
- `usePermissions()` composable reading the active club's `permissions[]` from the auth store.
- Sidebar + route guards.
- Edit-member modal role dropdown filtered by caller.
- Empty-state copy for each blocked section ("Your role doesn't include Website — ask the owner if you need this.").

That work lives in a separate CRM-side ticket. This brief is the backend contract only.

---

## 13. Contact

Same as prior briefs. Ping if the permission matrix needs a row I've missed — better to add a permission string now than to retrofit it after clients depend on the shape.
