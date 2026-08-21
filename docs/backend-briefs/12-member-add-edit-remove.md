# Member Add / Edit / Remove — Frontend Implementation Brief

**Feature:** the three individual-member management endpoints that sit alongside the bulk-import + roster surfaces. Powers the "+ Add member" button, per-row "Manage" actions (change role, change tier, remove), and the settings-page committee list.

**Related:** `frontend-club-members-list-brief.md` (roster + search), `frontend-bulk-member-import-brief.md` (CSV import), `frontend-onboarding-brief.md` (Step 4 tiers are what these tie members to).

**Status:** all three endpoints live in prod on the CRM CDK stack.

---

## TL;DR

- **`POST /clubs/{club_id}/members`** — add one member. Existing user → link. New email → invite by default; pass `send_invite=false` to silently create a stub user (no email).
- **`PATCH /clubs/{club_id}/members/{user_id}`** — change role / title / notes / membership tier. Owner-only for admin role changes; admin can shuffle committee ↔ player.
- **`POST /clubs/{club_id}/members/{user_id}/payments`** — manually mark a member as paid. Records the payment + updates `payment_status` on the current membership. Supports `waived` as a first-class method for life members / complimentary access.
- **`DELETE /clubs/{club_id}/members/{user_id}`** — soft-remove. Sets `revoked_at`; drops out of "active" counts; row stays for audit + potential re-linking.
- **Owner + self are protected.** Can't edit/delete the owner via these endpoints (use the future ownership-transfer flow). Can't delete yourself (use a "leave club" flow).
- **Membership tiers wire through** — passing `membership_type_id` or `membership_type` string creates/updates a `club_memberships` record with the tier's `annual_fee`. Onboarding wizard must have run first (otherwise no tiers exist).

---

## Base URL

```ts
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

Same base + JWT as `/me`, claims, admin queue, onboarding, bulk import, roster.

---

## 1. `POST /clubs/{club_id}/members`  (🔒 owner or admin)

Add one member. Mirrors the bulk-import row logic but for a single row.

**Request:**
```json
{
  "email":              "marcus@example.com",
  "first_name":         "Marcus",
  "last_name":          "Tuilagi",
  "phone":              "+61 400 123 456",
  "dob":                "1990-04-12",
  "role":               "player",
  "title":              "Coach",
  "membership_type_id": 4,
  "membership_type":    "Playing member",
  "send_invite":        true
}
```

| Field | Required | Notes |
|---|---|---|
| `email` | ✅ | RFC-ish email. Lowercased server-side. |
| `first_name`, `last_name`, `phone`, `dob` | optional | Only used when creating a new user (invite or stub paths). Ignored when linking to an existing user (their existing profile wins). |
| `role` | optional | `"committee"` or `"player"` — defaults to `"player"`. Use PATCH for admin promotion. |
| `title` | optional | Free-text, ≤ 80 chars, e.g. `"Vice President"`. |
| `membership_type_id` | optional | Preferred way to attach a tier. Integer PK from the wizard's Step 4 output. |
| `membership_type` | optional | Free-text tier name (`"Playing member"`, `"Social member"`) — resolved against `type_code → slug → type_name`. Falls back to default tier if empty. |
| `send_invite` | optional | Defaults to `true` for new emails. `false` = silently create a stub user (they'll never get an email; they can claim their account later via password reset). |

**Response (201) — four resolutions:**

```json
{
  "status": "success",
  "data": {
    "resolution":         "linked",              // "linked" | "relinked" | "invited" | "stub_created"
    "user_id":            88,                    // omitted on 'invited'
    "invite_id":          17,                    // only on 'invited'
    "club_id":            4,
    "role":               "player",
    "member_number":      42,                    // omitted on 'invited'
    "membership_type_id": 4,
    "accept_url":         "https://torny.com/invites/…",   // only on 'invited'
    "expires_in_days":    30                      // only on 'invited'
  }
}
```

- **`linked`** — email matched an existing Torny user; roster row created.
- **`relinked`** — email matched a previously-removed member (revoked); un-revoked in place, `member_number` preserved.
- **`invited`** — no existing user, `send_invite=true`. Row lands in `club_invites`, email fires (once SendGrid template ships), UI shows a "pending" chip. Accept URL is returned so the admin can copy-link if the invite email bounces.
- **`stub_created`** — no existing user, `send_invite=false`. New user created without a password; roster + billing row land immediately.

**Errors — machine-readable `code`:**

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_email` | Missing / malformed email |
| `400` | `invalid_role` | role isn't 'committee' or 'player' |
| `400` | `unknown_type` | `membership_type_id` doesn't belong to this club |
| `400` | `bad_json` | body isn't valid JSON |
| `401` | `unauthorized` | no bearer token |
| `403` | | caller isn't admin+ on this club |
| `409` | `already_member` | email matches an active member |
| `409` | `invite_exists` | a pending invite already exists for this email on this club |
| `409` | `race_email_exists` | rare — someone else registered the email between check + create |
| `500` | `internal` |

---

## 2. `PATCH /clubs/{club_id}/members/{user_id}`  (🔒 owner or admin)

Change a member's role, title, notes, or membership tier. Partial-update — send only the fields you're changing.

**Request:**
```json
{
  "role":    "committee",
  "title":   "Secretary",
  "notes":   "Prefers cheque payments.",
  "type_id": 5
}
```

| Field | Notes |
|---|---|
| `role` | `"admin"` \| `"committee"` \| `"player"`. Only owner can add/remove `admin`; admin can shuffle committee ↔ player. `"owner"` is not allowed — use ownership transfer. |
| `title` | String or `null` (to clear). Max 80 chars. |
| `notes` | String or `null` (to clear). Free-text admin notes visible only to club admins on the member roster. |
| `type_id` | Integer tier PK, or `null` (to clear the membership record's tier link — the row stays for payment history). |

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "club_id":    4,
    "user_id":    88,
    "role":       "committee",
    "title":      "Secretary",
    "updated_at": "2026-08-21T10:14:22.000Z",
    "membership": {
      "type_id":   5,
      "type_name": "Social member",
      "cadence":   "annual",
      "fee":       60
    }
  }
}
```

`membership` is `null` if the member has no `club_memberships` row (e.g. was added without a tier).

**Errors:**

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_role` | role not in the enum |
| `400` | `owner_via_transfer` | Tried to set role to `owner` |
| `400` | `invalid_title` | title isn't a string or null |
| `400` | `invalid_type_id` | not a positive integer |
| `400` | `unknown_type` | tier doesn't exist on this club |
| `400` | `bad_json` | |
| `401` | `unauthorized` | |
| `403` | | Admin trying to add/remove admin role |
| `404` | | Club or member not found |
| `409` | `member_revoked` | Target member has been removed — recreate via POST first |
| `409` | `owner_immutable` | Trying to edit the owner via this endpoint |
| `500` | `internal` |

---

## 3. `POST /clubs/{club_id}/members/{user_id}/payments`  (🔒 owner or admin)

Manually mark a member as paid. Inserts a `membership_payments` row (audit trail) and updates the member's current `club_memberships` row (`payment_status`, `last_payment_date`, `last_payment_amount`, `payment_reference`).

Also handles the "waive fees" case (life members, complimentary access) — pass `payment_method: "waived"` with `amount: 0` and the membership flips to `payment_status: "waived"`.

**Request:**
```json
{
  "amount":            240,
  "payment_date":      "2026-08-21",
  "payment_method":    "bank_transfer",
  "payment_reference": "ANZ-12345",
  "notes":             "Cleared July invoice"
}
```

| Field | Required | Notes |
|---|---|---|
| `amount` | ✅ | Integer or decimal dollars, ≥ 0. Use `0` for `waived`. |
| `payment_date` | optional | `YYYY-MM-DD`. Defaults to today. |
| `payment_method` | optional | `"cash"` \| `"card"` \| `"bank_transfer"` \| `"cheque"` \| `"other"` \| `"waived"`. Default `"other"`. |
| `payment_reference` | optional | Free-text (≤ 100 chars) — receipt no., bank ref, cheque no., etc. |
| `notes` | optional | Free-text — visible on the payment record. |

**Response (201):**
```json
{
  "status": "success",
  "data": {
    "payment_id":        17,
    "membership_id":     33,
    "club_id":           4,
    "user_id":           88,
    "amount":            240,
    "payment_date":      "2026-08-21",
    "payment_method":    "bank_transfer",
    "payment_reference": "ANZ-12345",
    "payment_status":    "paid"
  }
}
```

`payment_status` in the response is the **resulting** status on the membership after this payment:

| Trigger | Resulting `payment_status` |
|---|---|
| `payment_method: "waived"` | `"waived"` |
| `amount >= annual_fee` (or `annual_fee` is null) | `"paid"` |
| `0 < amount < annual_fee` | `"partial"` |
| `amount == 0` (non-waived) | unchanged |

Multiple payments accumulate independently in `membership_payments`; the `club_memberships` row reflects the **most recent** payment. So a $120 partial followed by another $120 leaves the row at `partial` (each payment is treated in isolation) — client code that needs "total paid this season" should sum `membership_payments` rows for the season.

**Errors:**

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_amount` | Missing or negative |
| `400` | `invalid_method` | Not in the enum |
| `400` | `invalid_date` | Not `YYYY-MM-DD` |
| `400` | `bad_json` | |
| `401` | `unauthorized` | |
| `403` | | Caller isn't admin+ on this club |
| `404` | | Member has no current `club_memberships` row — assign a tier first (via PATCH or add) |
| `500` | `internal` |

---

## 4. `DELETE /clubs/{club_id}/members/{user_id}`  (🔒 owner or admin)

Soft-remove a member. Sets `club_members.revoked_at = NOW()` and demotes the current `club_memberships` row (`is_current = 0`, `left_date = today`, `status = 'inactive'`). The row stays in the DB so payment history + audit are preserved.

The removed member appears under **Lapsed** on the roster and is filtered out of `all`/`active` counts.

**No request body.**

**Response (200):**
```json
{
  "status": "success",
  "data": {
    "club_id":    4,
    "user_id":    88,
    "revoked_at": "2026-08-21T10:14:22.000Z"
  }
}
```

**Errors:**

| Status | `code` | When |
|---|---|---|
| `403` | `forbidden` | Caller isn't admin+, OR admin trying to remove another admin |
| `404` | | Club or member not found |
| `409` | `already_revoked` | Member is already removed |
| `409` | `owner_immutable` | Cannot remove the club owner — transfer ownership first |
| `409` | `cannot_remove_self` | Cannot remove yourself — use a leave-club flow |
| `500` | `internal` |

### To re-add a removed member later

Hit `POST /clubs/{club_id}/members` again with the same email. If the previously-removed row exists, you get `resolution: "relinked"` — the original `member_number` is preserved, `revoked_at` is cleared, and the membership tier is refreshed.

---

## Wire-up

```ts
// packages/api-client/src/resources/members.ts
import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

export const members = {
  add(clubId: number, payload: {
    email: string
    first_name?: string
    last_name?: string
    phone?: string
    dob?: string
    role?: 'committee' | 'player'
    title?: string
    membership_type_id?: number
    membership_type?: string
    send_invite?: boolean
  }) {
    return authedFetch(`${CRM_BASE}/clubs/${clubId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  update(clubId: number, userId: number, patch: {
    role?: 'admin' | 'committee' | 'player'
    title?: string | null
    notes?: string | null
    type_id?: number | null
  }) {
    return authedFetch(`${CRM_BASE}/clubs/${clubId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },
  remove(clubId: number, userId: number) {
    return authedFetch(`${CRM_BASE}/clubs/${clubId}/members/${userId}`, {
      method: 'DELETE',
    })
  },
}
```

### Suggested UI flows

**"+ Add member" modal:**
1. Email + name + phone fields, plus a "Send invite email" toggle (default ON).
2. Tier dropdown populated from the club's onboarded tiers (call the roster endpoint or a future `/clubs/:id/membership-tiers` — pluck from any existing member's `.membership.type_id` for now).
3. On submit → `members.add(clubId, payload)`. Show a toast keyed on `resolution` — "Marcus was added" / "Invite sent to marcus@…" / "Marcus was already a member" / etc.

**Per-row "Manage" menu on the roster:**
- **Change role** → dropdown → `members.update({ role: … })`. Hide the "Admin" option when the caller is admin (not owner).
- **Edit title** → inline text field → `members.update({ title: … })`.
- **Change tier** → dropdown → `members.update({ type_id: … })`. Optimistically update `membership.type_name` in the roster row; rollback on error.
- **Remove** → destructive confirmation modal → `members.remove(…)`. Optimistically flip `computed_status` to `'lapsed'`; rollback on error.

**Bulk actions** (select N rows + apply role/tier/remove) — client-side loop over these endpoints. The server has no bulk PATCH/DELETE today; flag if the roster grows big enough that the round-trips hurt.

---

## Auth matrix — who can do what

| Action | Owner | Admin | Committee | Player |
|---|---|---|---|---|
| Add member (any role ≤ committee) | ✅ | ✅ | ❌ | ❌ |
| PATCH — change role to `admin` | ✅ | ❌ | ❌ | ❌ |
| PATCH — change role committee ↔ player | ✅ | ✅ | ❌ | ❌ |
| PATCH — change title / tier | ✅ | ✅ | ❌ | ❌ |
| PATCH — edit the owner | ❌ | ❌ | ❌ | ❌ |
| DELETE — admin | ✅ | ❌ | ❌ | ❌ |
| DELETE — committee / player | ✅ | ✅ | ❌ | ❌ |
| DELETE — owner | ❌ | ❌ | ❌ | ❌ |
| DELETE — self | ❌ | ❌ | ❌ | ❌ |

---

## What's still coming

- **Ownership transfer** (`POST /clubs/{id}/transfer-ownership`) — the only way to change the owner. Not built yet.
- **"Leave club" flow** — the self-removal counterpart to DELETE. Also unbuilt.
- **Invite emails** — POST /clubs/{id}/members with `send_invite=true` writes a `club_invites` row but the actual SendGrid email doesn't fire until the invite-email template ships. The `accept_url` is returned so the admin can copy-link in the meantime.
- **Bulk PATCH / DELETE** — client-side loops are fine at current scale.

---

## Contact

Same as previous briefs — `#torny-eng` on Slack.
