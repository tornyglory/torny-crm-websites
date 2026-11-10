# Scoped CRM access — per-member permission bundles

**Feature:** replace the current three-role model (`owner` / `admin` / `committee`) with per-member permission bundles so an admin can invite someone and tick which sections of the CRM they can access (Members, Applications, Enquiries, Events, Team selections, Tournaments, Honour board, Venue bookings, Venue packages, Website, Communications). Optional presets (Membership officer, Content editor, Treasurer, Selector, Coach, Committee) pre-fill the toggles; admin can tweak before sending the invite.

**Status:** designed 2026-11-09, supersedes the fixed-eight-roles design previously in this brief (never built). Awaiting backend implementation.

**Why the change from v1 of this brief:** the original design locked clubs into eight canned roles with no per-user tweaking, which doesn't fit real clubs — a common pattern is "Jane does communications + venue bookings only" or "Dave does website + honour board but nothing else," and no preset covers that. Moving to per-member bundles with optional presets gives us both the convenience of canned roles (admin picks "Content editor" and it fills in) and the flexibility clubs actually want.

**Related briefs:**
- brief 02 (team access) — invite/revoke/list endpoints already designed; this brief extends them with a `permissions[]` field on invite and change-role operations.
- brief 29 (members CRUD) — all member writes get gated behind `members:write`.
- brief 93 (plan on session hydrate) — same pattern: additive field on `/me`, no behaviour change to existing endpoints.
- brief 86 (plan tiers) — Pro-only sections (team selections, tournaments, honour board, venue bookings, venue packages) still gate by plan FIRST. Permissions gate AFTER. A Starter-plan club can't grant `team_selections:edit` to anyone because the plan hides the whole section.

---

## 1. The ask

Two immutable roles, plus a flexible "member" bundle for everyone else:

- **Owner** — one per club, full access everything, can only change via ownership transfer. Unchanged from today.
- **Admin** — full access except billing / danger zone / owner promotion. Can invite and manage team members (except other admins and the owner). Unchanged from today.
- **Member** (new catch-all role, replaces today's `committee`) — carries a `permissions[]` array that controls which sections they can access and whether they can edit vs. view. Admin picks a preset (or "Custom") when inviting; the preset pre-fills the toggles; admin can tweak before sending.

Today's `committee` rows migrate to `member` with a read-only permission bundle (see §9).

---

## 2. The permission model

Backend stores a `permissions[]` text array on `club_members`. Values are `resource:action` strings. The admin UI never shows these strings — it shows section checkboxes with optional "can edit" sub-toggles. The mapping from UI toggle → canonical permission strings lives in the frontend (see §7).

### 2.1 The permission strings

```
dashboard:view                   always granted to any team member

members:read                     see the roster (name + avatar + position)
members:read_pii                 see email, phone, DOB, address, notes, member_number
members:write                    add / edit members
members:remove                   revoke membership
members:note                     add internal notes on a member
payments:read                    see payment history + totals
payments:record                  log a payment

applications:read
applications:review              approve / reject / add notes

enquiries:read
enquiries:respond

events:read
events:write                     create / edit / delete events

team_selections:read
team_selections:edit

tournaments:read
tournaments:edit

honour_board:read
honour_board:edit

venue_bookings:read
venue_bookings:manage            confirm / reschedule / cancel
venue_packages:read
venue_packages:edit

website:view                     preview pages in the editor
website:edit                     save + publish + edit nav/brand

communications:read              see campaign history + metrics
communications:send              compose + send

settings:brand                   logo, palette, fonts, style preset
settings:membership              tiers, cadence, first-year discount
settings:hours                   opening hours
settings:enquiries               enquiries config
settings:integrations            Stripe, GCal, mail
settings:billing                 Torny plan + invoices           — Owner only (hard-coded)
settings:danger                  archive / delete / transfer     — Owner only (hard-coded)
settings:manage_team             invite + change permissions     — Owner + Admin only (hard-coded)
```

**Hard-coded rules — not grantable via the member permissions[] array:**
- `settings:billing` — Owner only. Even an Admin can't see billing.
- `settings:danger` — Owner only.
- `settings:manage_team` — Owner + Admin only. An Admin cannot grant `manage_team` to a Member. (Admin itself is a role, not a permission.)
- Promoting a Member to Admin, or demoting/removing an Admin, is Owner-only (unchanged from brief 02 §3).

### 2.2 Section → permission mapping (frontend contract)

The admin-facing UI shows one row per nav section with a "can access" toggle and (where meaningful) a "can edit" sub-toggle. When the admin ticks a box, the UI sends the corresponding permission strings to the backend. This mapping is the single source of truth — if a backend check rejects a permission string, the UI's toggle labelling is wrong, not the backend.

| Section (UI label)   | "Can access" grants              | "Can edit" also grants                |
|---|---|---|
| Members              | `members:read`, `members:read_pii`, `payments:read` | `members:write`, `members:remove`, `members:note`, `payments:record` |
| Applications         | `applications:read`              | `applications:review`                 |
| Enquiries            | `enquiries:read`                 | `enquiries:respond`                   |
| Events               | `events:read`                    | `events:write`                        |
| Team selections      | `team_selections:read`           | `team_selections:edit`                |
| Tournaments          | `tournaments:read`               | `tournaments:edit`                    |
| Honour board         | `honour_board:read`              | `honour_board:edit`                   |
| Venue bookings       | `venue_bookings:read`            | `venue_bookings:manage`               |
| Venue packages       | `venue_packages:read`            | `venue_packages:edit`                 |
| Website              | `website:view`                   | `website:edit`                        |
| Communications       | `communications:read`            | `communications:send`                 |

**Members section — extra sub-toggle:** "Can see member PII (email, phone, DOB, address, notes)." If unticked, we drop `members:read_pii` from the bundle even when "Can access" is on. Reason: Selectors and Coaches typically shouldn't see contact details.

**Settings section — handled separately from the toggles.** Settings sub-sections grant individually:
- Settings → Club & brand → `settings:brand`
- Settings → Membership types → `settings:membership`
- Settings → Opening hours → `settings:hours`
- Settings → Enquiries → `settings:enquiries`
- Settings → Integrations → `settings:integrations`

Admin UI shows these as a second block ("Settings access") with one checkbox per sub-section. Billing, Team access, Danger zone are not in this list — they're hard-coded (see §2.1).

### 2.3 Presets (convenience, not enforcement)

When inviting, the admin picks a preset from a dropdown. This pre-fills the toggles — admin can then tick/untick before hitting Send. Backend does not store the preset slug; only the final `permissions[]`.

| Preset slug | Label | Sections pre-ticked (edit level) | PII |
|---|---|---|---|
| `custom` | Custom (start empty) | — | — |
| `membership_officer` | Membership officer | Members (edit), Applications (edit), Enquiries (edit), Communications (edit); Settings → Membership types | Yes |
| `content_editor` | Content editor | Website (edit), Events (edit), Honour board (edit), Communications (edit), Enquiries (edit); Settings → Brand, Opening hours | No |
| `treasurer` | Treasurer | Members (read + payments only, no edit of member record), Applications (read) | Yes |
| `selector` | Selector | Members (read, no PII), Events (read), Team selections (edit) | No |
| `coach` | Coach | Members (read, no PII), Events (read), Team selections (read), Communications (send) | No |
| `committee` | Committee | Read-only across every section; can add internal notes on members | No |

The preset list is presentational; backend doesn't validate against it. If we add/remove a preset later it's a frontend-only change.

---

## 3. Database

### 3.1 Migration — add permissions column

```sql
ALTER TABLE club_members
  ADD COLUMN permissions JSON NULL;
```

`permissions` is an array of strings. NULL means "use role default" (Owner = everything, Admin = everything-except-hard-coded). A Member row with NULL `permissions` behaves like legacy committee: read-only across every section (matches the brief 02 committee semantics — no surprise behaviour change on existing data).

### 3.2 Role enum — simplify back to three values

```sql
ALTER TABLE club_members
  MODIFY COLUMN role ENUM('owner','admin','member','player') NOT NULL;

UPDATE club_members SET role = 'member' WHERE role = 'committee';
```

Legacy `committee` rows map to `member` with `permissions = NULL` (read-only default). The `committee` label stays in the admin UI as a preset name, but it's no longer a database role.

`player` is unchanged — still the "regular playing member with no CRM access" marker, no `club_members` CRM row.

### 3.3 Why a JSON array not a join table

Permission bundles are small (max ~30 strings), read on every authenticated request (via `/me` + per-request guard), and churn rarely. A join table adds a hop for zero benefit. Same pattern as brief 25 nav items. If we ever need per-row scoping (e.g. "Selector for the men's pennant only") we'll denormalise then.

---

## 4. `/me` payload — add `permissions[]`

Every `/me`, `/login`, `/register` response gains a `permissions` array per club membership (mirrors brief 93's pattern — additive, no behaviour change to existing fields).

```jsonc
{
  "status": "success",
  "data": {
    "user": { "user_id": 4177, "email": "denise@example.com", "...": "..." },
    "clubs": [
      {
        "id": 5,
        "name": "Kelburn Bowling Club",
        "slug": "kelburn",
        "role": "member",
        "plan": "pro",
        "permissions": [
          "dashboard:view",
          "website:view", "website:edit",
          "events:read", "events:write",
          "honour_board:read", "honour_board:edit",
          "communications:read", "communications:send",
          "enquiries:read", "enquiries:respond",
          "settings:brand", "settings:hours"
        ]
      },
      {
        "id": 8,
        "name": "Naenae Bowling Club",
        "role": "owner",
        "plan": "starter",
        "permissions": ["*"]
      }
    ]
  }
}
```

**Owner shortcut:** Owner rows return `permissions: ["*"]` — the frontend treats `*` as "everything granted." Saves sending 30+ strings on every hydrate.

**Admin shortcut:** Admin rows return the full admin bundle explicitly (every permission except `settings:billing`, `settings:danger`, and `settings:manage_team` which is implicit on role=admin). Explicit so the frontend doesn't need a separate "is admin" branch — same `permissions.includes(...)` check works for both Admin and Member.

---

## 5. Endpoint impact

### 5.1 Write guards

Every write endpoint runs `requirePermission(clubId, 'resource:action')` after `requireAuth`. On failure:

```jsonc
{
  "status": "error",
  "code": "forbidden_permission",
  "message": "Your role can't do that.",
  "required": "members:write"
}
```

HTTP status: **403**.

### 5.2 Scoped reads

- **`GET /clubs/:id/members`** — response strips `email`, `phone`, `dob`, `address`, `notes`, `member_number`, `last_active_at` to `null` when the caller lacks `members:read_pii`. Single endpoint, different payload shape by permission — saves us a separate route.
- **`GET /clubs/:id/members/:memberId/payments`** — 403 unless caller has `payments:read`.

### 5.3 Invite endpoint — extend brief 02

`POST /clubs/:clubId/invites` (brief 02 §4.2) adds a `permissions` field:

```jsonc
POST /clubs/:clubId/invites
{
  "email": "new-teammate@club.co.nz",
  "role": "member",                      // "admin" | "member" — NEVER "owner"
  "permissions": [                        // required when role === "member"; ignored when role === "admin"
    "dashboard:view",
    "members:read", "members:read_pii", "members:write", "members:note", "members:remove",
    "payments:read", "payments:record",
    "applications:read", "applications:review",
    "enquiries:read", "enquiries:respond",
    "communications:read", "communications:send",
    "settings:membership"
  ],
  "message": "Kia ora — you'll now have CRM access for membership stuff…"
}
```

- `role: "admin"` — Owner-only (per brief 02 §3). `permissions` field ignored (backend assigns the full admin bundle on accept).
- `role: "member"` — Owner + Admin. Backend validates every string in `permissions[]` against the allowlist in §2.1. Unknown strings → 422 `invalid_permission`. Attempting to grant a hard-coded permission (`settings:billing`, `settings:danger`, `settings:manage_team`) → 422 `permission_not_grantable`.
- An empty `permissions: []` is valid — the invitee gets `dashboard:view` only and sees an empty shell. Odd but not an error.

### 5.4 Change permissions on an existing member

New endpoint (extends brief 02 §4.6, which currently only handles role changes):

```jsonc
PATCH /clubs/:clubId/members/:memberId
Authorization: Bearer <owner-or-admin-with-manage_team>
{
  "permissions": [ "dashboard:view", "events:read", "events:write", ... ]
}

200 { "id": "cmb_...", "permissions": [...], "updated_at": "..." }
```

- Caller must have `settings:manage_team` (Owner + Admin).
- Target row must be role=member. Editing an Admin's permissions is not allowed (Admin bundle is fixed — to change their access, demote to Member first or promote them higher via role change).
- Owner's permissions are immutable (Owner always = `["*"]`).
- `permissions` field uses full-replace semantics (not merge) — frontend sends the complete new array.
- Fires `team.permissions_changed` email to the affected member with a one-line summary ("Your access to Members was removed by Marcus. Reply to this email if that's a mistake.").

### 5.5 Role change endpoint (unchanged from brief 02, with clarification)

`PATCH /clubs/:clubId/members/:memberId` with `role` field:
- Owner → Admin or Member: Owner-only.
- Admin → Member or vice versa: Owner-only.
- Nothing → Owner: use the ownership transfer endpoint (brief 02 §6).
- When role changes member → admin, server resets `permissions` to the admin bundle (or NULL — equivalent). When role changes admin → member, server sets `permissions` to the Committee preset (read-only across everything) as a safe default; admin can then edit.

---

## 6. Error codes

| code | HTTP | Cause |
|---|---|---|
| `forbidden_permission` | 403 | Caller's permissions[] lacks the required string |
| `forbidden_role` | 403 | Action requires role=owner or role=admin (billing, team mgmt, etc.) |
| `invalid_permission` | 422 | Request body contains a permission string not in the §2.1 allowlist |
| `permission_not_grantable` | 422 | Request body tries to grant a hard-coded permission (billing / danger / manage_team) |
| `owner_immutable` | 409 | Can't edit the owner's row (existing, brief 02) |

All errors include `required` (the missing permission string) or `field` (the offending permission in the request) so the frontend can show a targeted message.

---

## 7. Frontend contract summary

**What the frontend does:**
- Reads `permissions[]` off `/me`'s active club. Treats `*` as "all granted."
- `usePermissions()` composable exposes `can('members:write')` and `canAny('website:view', 'website:edit')`.
- Sidebar nav filters items by permission:
  - Members visible if `can('members:read')`
  - Applications visible if `can('applications:read')`
  - … etc. per §2.2 mapping
- Route guards check the same before mounting a view. Any bypass hits the 403 backstop.
- `members:read_pii === false` → roster columns for phone/email/dob/etc. render `—` instead of the value (backend already sends null; this saves a paint).
- Settings nav sub-items filter by `settings:*` permissions. Billing / Danger zone / Team access hidden unless role matches hard-coded rules.
- The invite modal:
  - Preset dropdown (§2.3 list)
  - Section checkboxes with "can access" + "can edit" toggles (§2.2)
  - "Settings access" block with sub-section checkboxes
  - On Send, UI composes the final `permissions[]` from the toggles and POSTs.
- The Team access card in Settings:
  - Lists members with a "Permissions" summary ("Members, Communications, Events + 2 more" or "Full access" for Admin / Owner).
  - Click → opens a drawer showing the same toggles as the invite modal, prefilled with current permissions, with a Save button.

**What the frontend does NOT do:**
- Trust its own permission check for security. Every write endpoint is guarded server-side. The check exists so the UI doesn't offer buttons that would 403.
- Store the preset slug anywhere — presets are presentational only. If a user's current permissions happen to match the Treasurer preset, we show "Treasurer" as the label; if they've customised, we show "Custom."

---

## 8. Plan-tier interaction

Pro-only sections (team selections, tournaments, honour board, venue bookings, venue packages — per brief 86) gate by **plan first**, permission second.

- Starter-plan club: the backend refuses to grant any Pro-only permission (e.g. `team_selections:edit`) even if requested. Returns 422 `permission_requires_plan` with `required_plan: "pro"`.
- When a club downgrades Pro → Starter: existing member rows that had Pro-only permissions keep them in the JSON array (no destructive migration), but the write guards reject with `forbidden_plan`. If they re-upgrade, access resumes immediately without a re-grant.
- The invite modal frontend hides the Pro-only section checkboxes entirely on Starter plan (greyed with "Upgrade to Pro to grant access to this section") — reads `/me`'s `plan` field (brief 93).

---

## 9. Migration for existing installs

- Existing `owner` rows: unchanged. `/me` starts returning `permissions: ["*"]` immediately.
- Existing `admin` rows: unchanged. `/me` returns the explicit admin bundle.
- Existing `committee` rows: role column rewritten to `member`, `permissions` left NULL. Frontend treats NULL as the Committee preset (read-only across every section) — identical observable behaviour to today's `committee` role.
- No forced re-invite, no email blast. Admins see the new per-section UI the next time they open a team member row; their current access is already correct.

---

## 10. Verification (implement + attach test outputs)

- ✓ `/me` for an Owner returns `permissions: ["*"]`
- ✓ `/me` for an Admin returns the full admin bundle (every string in §2.1 except `settings:billing`, `settings:danger`)
- ✓ `/me` for a legacy committee row returns the Committee preset bundle
- ✓ `POST /clubs/:id/invites` with `role: "member", permissions: ["members:read", "members:read_pii", "members:write"]` from an Owner → 201
- ✓ Same from an Admin → 201
- ✓ Same from a Member with `settings:manage_team` in their bundle → 403 (permission is hard-coded to role, not grantable via bundle)
- ✓ `POST /clubs/:id/invites` with `permissions: ["settings:billing"]` → 422 `permission_not_grantable`
- ✓ `POST /clubs/:id/invites` with `permissions: ["events:fly"]` → 422 `invalid_permission`
- ✓ `POST /clubs/:id/invites` with `role: "member", permissions: ["team_selections:edit"]` on a Starter-plan club → 422 `permission_requires_plan`
- ✓ `PATCH /clubs/:id/members/:memberId` with `permissions` field from Owner on a Member row → 200
- ✓ Same from Admin on a Member row → 200
- ✓ Same from Admin on another Admin row → 403 `forbidden_role` (admins can't edit each other)
- ✓ Same from Owner on the Owner's own row → 409 `owner_immutable`
- ✓ `GET /clubs/:id/members` from a Selector (no `members:read_pii`) → 200, PII fields null
- ✓ `POST /clubs/:id/members/:memberId/payments` from a Treasurer → 200
- ✓ Same from a Selector → 403 `forbidden_permission`, `required: "payments:record"`
- ✓ `PATCH /clubs/:id/pages/:slug` (website edit) from a Member without `website:edit` → 403
- ✓ `POST /clubs/:id/transfer-ownership` from Admin → 403 (owner-only)
- ✓ `team.permissions_changed` email fires on PATCH with permissions change

---

## 11. Non-goals

- **Custom role templates per club** — "Bar Manager sees only opening hours." The preset list in §2.3 is fixed and ships in the frontend bundle. If a club wants a new preset, they use Custom.
- **Row-level scoping** — "Selector for the men's pennant only." v1 grants at the resource level, not per-row.
- **Multi-club permissions sync** — a user can have different bundles across clubs; already supported by `club_members`.
- **Delegation** — "Admin can grant a Member the ability to invite others." Team management stays Owner + Admin, period.
- **Permission audit log UI** — the backend writes audit entries on every permissions change (per brief 02 §8), but surfacing them in the admin UI is a future ask.
- **Bulk permission edits** — change permissions one member at a time. If a club needs to re-bucket 10 people after a committee restructure, they do 10 clicks. Not worth the UI for an annual event.

---

## 12. Suggested build order

1. Migration: add `permissions` JSON column; rename `committee` → `member` enum value.
2. `/me` + `/login` + `/register` return `permissions[]` on each club (admin/owner get fixed bundles; member reads from the column).
3. `POST /clubs/:id/invites` accepts `permissions[]` on `role: "member"`; validates against allowlist.
4. `PATCH /clubs/:id/members/:memberId` accepts `permissions` field.
5. Per-endpoint write guards: start with Members + Payments (biggest blast radius for a wrong grant), then Website + Communications, then the rest.
6. PII filtering on `GET /clubs/:id/members`.
7. Plan-tier cross-check in invite + patch endpoints.
8. `team.permissions_changed` email.
9. Frontend swaps the mocked Team access card for live API + new invite/edit drawer.

Frontend work starts once step 2 ships — with `permissions[]` on `/me` the sidebar gating can land behind a feature flag, decoupled from the invite UX.

---

## 13. Contact

Nev on Slack (`#torny-eng`). Ping if a permission string needs splitting or a new section lands in the CRM that this brief doesn't cover.
