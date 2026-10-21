# Prospect + Visitor Member Statuses

**Feature:** two new non-paying member statuses — `prospect` and `visitor` — plus the endpoints and audit trail to populate them. Shipped as one unit because the data-model changes overlap heavily (shared status enum, shared `source` columns, shared roster-shape additions, shared email-defaults change) and the UX for both lives in the same Add Member / Member Detail surfaces.

**Status:** backend not started. Frontend design + Vue modals already in place for the member use case; new UI slots described below.

**Related briefs:**
- brief 12 (member management) — `members.add` is the base endpoint we're extending.
- brief 38 (applications) — same approve-into-membership pattern we mirror for the enquiry convert flow.
- brief 41 (enquiries) — this brief extends the enquiry resource with one new endpoint + one new terminal state.
- brief 54 (communications history) — on convert / auto-archive we'd like a timeline entry; soft-depends.

---

## 1. The two statuses

Extend `MemberStatus` from `'active' | 'pending' | 'lapsed'` to:

```
'active' | 'prospect' | 'visitor' | 'pending' | 'lapsed'
```

| Status | Who | Why we track them |
|---|---|---|
| `active` | Paying member with an active `club_memberships` row | Normal operations |
| `prospect` | Lead sourced from an enquiry / application | Converting them to active; follow-up |
| `visitor` | Casual guest player — walk-in, friend of a member, out-of-town visitor | Insurance / attendance / roll-up / possible promotion |
| `pending` | Admin-invited, invite not yet accepted | Chase the invite |
| `lapsed` | Was active, membership expired / revoked | Winback campaigns |

**Why both?** A prospect has lead intent (we think they'll convert). A visitor is an operational fact (they're on our greens tonight, often with no intent to join). Collapsing them makes filters, counts, and workflows ambiguous — the admin's reason for tracking each is different.

**Both carry no `club_memberships` row.** Billing / payment columns are empty. The hero "Owing" on Member Detail reads `—`. The roster `membership` field is `null` — same shape as a current member with no tier assigned.

**Role stays `player` for both.** Status answers "what's their membership state"; role answers "what can they do in the club". Visitors and prospects have the lowest permission set — public site only, no CRM access.

**Standing pill tones (CRM):**
- Prospect — neutral/mute colour, copy: `Prospect` (or `Prospect · from enquiry` when source links back)
- Visitor — soft tint distinct from prospect, copy: `Visitor` (or `Visitor · guest of Grace` when the guest-of link exists)

**Roster filter chips** get two new presets: **Prospects** and **Visitors**, each with its own count returned by the roster endpoint.

---

## 2. Shared data changes

### 2a. Member provenance

Add two nullable columns to `club_members` (or wherever member provenance lives):

```sql
ALTER TABLE club_members
  ADD COLUMN source TEXT,         -- 'enquiry' | 'application' | 'manual' | 'import' | 'visitor_signin'
  ADD COLUMN source_ref_id INT;   -- enquiry_id / application_id / nullable for manual
```

Backfill existing rows with `source = 'manual'`.

### 2b. Visitor-specific columns

Only populated when `status === 'visitor'`:

```sql
ALTER TABLE club_members
  ADD COLUMN guest_of_user_id INT NULL,       -- the member who sponsored them
  ADD COLUMN visited_at TIMESTAMP NULL,       -- last recorded visit
  ADD COLUMN visit_count INT NOT NULL DEFAULT 0,
  ADD COLUMN visitor_expires_at TIMESTAMP NULL;
```

- `guest_of_user_id` → FK to `users.id`; `ON DELETE SET NULL`.
- `visit_count` + `visited_at` set by the sign-in action (§5).
- `visitor_expires_at` — nullable per-row soft expiry. Clubs that want "once a visitor, always a visitor" can leave it NULL.

**These live on `club_members`, not `users`,** so the same person can be a visitor at one club and a paying member at another.

### 2c. Enquiry-side columns (for the `converted` terminal state)

```sql
ALTER TABLE enquiries
  ADD COLUMN converted_user_id INT NULL,
  ADD COLUMN converted_at TIMESTAMP NULL;
```

---

## 3. Shared roster shape

```ts
interface RosterMember {
  // …existing fields
  computed_status: 'active' | 'prospect' | 'visitor' | 'pending' | 'lapsed'
  source: 'enquiry' | 'application' | 'manual' | 'import' | 'visitor_signin'
  source_ref_id: number | null
  // Only populated when computed_status === 'visitor':
  visitor: null | {
    guest_of_user_id: number | null
    guest_of_name: string | null             // denormalised for the pill
    visited_at: string | null                // ISO
    visit_count: number
    visitor_expires_at: string | null
    days_since_last_visit: number | null     // computed server-side
  }
}
```

`visitor: null` for non-visitors keeps JSON lean on a 500-row roster.

The roster list response adds `counts.prospect` and `counts.visitor` alongside the existing status buckets.

---

## 4. Prospect — convert an enquiry

### 4a. New enquiry terminal state: `converted`

Extend `EnquiryStatus` from `'new' | 'read' | 'replied' | 'archived'` to:

```
'new' | 'read' | 'replied' | 'converted' | 'archived'
```

- `converted` is terminal, like `archived`. GET-ting a converted enquiry does **not** auto-flip anything.
- Inbox counts: adds a `converted` bucket to `EnquiriesListResponse.counts`.
- Convert and archive are mutually exclusive — converting an archived enquiry returns `409 enquiry_archived`.

### 4b. Endpoint — `POST /clubs/{cid}/enquiries/{eid}/convert`

**Auth:** admin+ on `club_members`.

```ts
interface ConvertEnquiryInput {
  /** Optional tier — omit for a plain prospect (common case). Setting a
   *  tier promotes directly to `active` with that tier assigned. */
  membership_type_id?: number | null

  /** If true, email the person a club-join invite link. Resolution flips
   *  to `invited` and the row lands in `pending` instead of `prospect`. */
  send_invite?: boolean

  /** Optional name split — admins may tidy the enquiry's single
   *  `full_name` before converting. Omit → server splits by whitespace. */
  first_name?: string
  last_name?: string

  /** Optional internal note — attached to the new member row AND copied
   *  into the enquiry's internal notes thread so the inbox trail stays
   *  readable. */
  note?: string
}

interface ConvertEnquiryResult {
  resolution: 'linked' | 'relinked' | 'stub_created' | 'invited'
  user_id: number
  member_number?: number
  role: 'player'
  membership_type_id: number | null
  accept_url?: string         // only when resolution === 'invited'
  expires_in_days?: number    // same
  enquiry: {
    id: number
    status: 'converted'
    converted_user_id: number
    converted_at: string
  }
}
```

### 4c. Resolution rules

| Scenario | Resolution | Status |
|---|---|---|
| Email matches an existing user, not yet a club member | `linked` | `active` if tier given, else `prospect` |
| Email matches a user previously removed from the club | `relinked` | same as above |
| Email matches no user; `send_invite: true` | `invited` | `pending` |
| Email matches no user; `send_invite: false` (default) | `stub_created` | `prospect` |

**`already_member` is not a resolution here** — if the email already belongs to a current `club_members` row, return `409 already_member` with the existing `user_id` in the body so the client can jump to that member's detail page. (Different from applications, where approving an existing member is idempotent-success — enquiries are more ad-hoc, so a duplicate probably means a mistake.)

### 4d. Audit side-effects

- Member row gets `source = 'enquiry'`, `source_ref_id = enquiry_id`.
- Enquiry row gets `converted_user_id`, `converted_at`.
- A system-authored note is appended to the enquiry's internal notes thread: `"Converted to member #142 by Grace Whittaker on 22 Oct 2026."` Use `author_user_id = NULL, author_name = 'System'`.
- If brief 54 ships before this one: record `kind='enquiry_converted'` on the member's communications timeline with `source_ref_id = enquiry_id`.

### 4e. Error codes

```
400 invalid_input
404 enquiry_not_found
409 enquiry_archived
409 enquiry_already_converted
409 already_member            — body includes { user_id, member_number }
400 invalid_tier
403 forbidden
```

---

## 5. Visitor — add path, sign-in, auto-archive

### 5a. Extend `AddMemberInput` with `status`

Rather than a separate `POST /visitors` endpoint, extend `members.add` so one endpoint creates members in any state.

```ts
interface AddMemberInput {
  // …existing
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

  // NEW
  /** Target status. Default stays `active` to preserve the existing
   *  add-member behaviour. */
  status?: 'active' | 'prospect' | 'visitor' | 'pending'

  /** Only read when status === 'visitor'. */
  visitor?: {
    guest_of_user_id?: number | null
    visitor_expires_at?: string | null
    note?: string
  }
}
```

### 5b. Interaction rules

| `status` | Required | Forbidden | Behaviour |
|---|---|---|---|
| `active` (default) | `membership_type_id` or `membership_type` | — | existing |
| `prospect` | — | tier fields | existing resolution set |
| `visitor` | — | tier fields, `send_invite` | existing resolution set, `send_invite` always false |
| `pending` | — | — | sets `send_invite: true` server-side |

**Email is optional on visitors.** If missing, server generates a placeholder (`visitor-{nanoid}@placeholder.local`) that we never actually send to and that the roster-render path knows to hide. Prefer this to making `users.email` nullable since the uniqueness constraint would need rework. (Open question §9.)

### 5c. New error codes

```
400 invalid_status                   — unknown status enum
400 visitor_tier_not_allowed
400 visitor_invite_not_allowed
400 invalid_guest_of                 — guest_of_user_id doesn't belong to this club
```

### 5d. Sign in a visitor — `POST /clubs/{cid}/members/{uid}/visit`

Quick-action from the Member Detail page, visible only when `status === 'visitor'`. Bumps `visit_count`, sets `visited_at = now()`.

**Auth:** admin+ on the club.

```ts
interface SignInVisitorInput {
  /** Defaults to now(). Set to backdate from a paper roll-up sheet. */
  visited_at?: string
  /** Optional note — lands in internal notes thread for now; brief 58 may
   *  promote it to per-visit history. */
  note?: string
}

interface SignInVisitorResult {
  user_id: number
  visited_at: string
  visit_count: number
}
```

Errors:
```
404 member_not_found
409 not_a_visitor
400 invalid_visited_at         — in the future or unparseable
```

**Not storing per-visit history yet.** `visit_count` + `visited_at` only. If per-visit detail becomes a real ask, that's brief 58.

### 5e. Auto-archive scheduled job

Nightly cron archives visitors with no visit in N days. **Opt-in per club.**

New club setting:

```sql
ALTER TABLE clubs
  ADD COLUMN visitor_auto_archive_days INT NULL;  -- NULL = never
```

Default `NULL` on all existing clubs — no surprise purges.

Job logic:
- Flip `status = 'lapsed'`, set `revoked_at = NOW()` where:
  - `status = 'visitor'`
  - AND `visited_at < NOW() - visitor_auto_archive_days` for that club
  - OR `visitor_expires_at IS NOT NULL AND visitor_expires_at < NOW()` (per-row expiry overrides club default)

**Non-destructive** — rows flip to `lapsed`, data preserved. Un-lapsing is a normal `PATCH /members/{uid}` with `status: 'visitor'`.

If brief 54 ships: `kind='visitor_auto_archived'` entry on the member's communications timeline.

---

## 6. Promotion path (shared)

Both prospects and visitors are promoted via the existing `PATCH /clubs/{cid}/members/{uid}` — no new endpoint. The existing update handles the status + tier combination:

- `{ status: 'prospect' }` — null out visitor fields server-side
- `{ status: 'active', membership_type_id: 5, joined_date: '2026-10-22' }` — creates the `club_memberships` row, clears visitor data

**Server-side cleanup when status transitions OUT of `visitor`:**

```sql
UPDATE club_members
SET guest_of_user_id = NULL,
    visited_at = NULL,
    visit_count = 0,
    visitor_expires_at = NULL
WHERE id = ? AND status != 'visitor'
```

**Preserve `source` + `source_ref_id`** so provenance survives the promotion ("This paying member first visited us as a guest of Grace on 03 Mar 2026" / "Entered via enquiry on 18 Oct 2026").

---

## 7. Email defaults — protect non-paying contacts

Visitors and prospects should **not** be in default broadcast recipient lists — they didn't opt into marketing.

Extend `BulkEmailRecipientsFilter.filter.status`:

```ts
status?: 'all' | 'active' | 'pending' | 'lapsed' | 'visitor' | 'prospect'
```

- `'all'` continues to mean **all paying + pending**, explicitly excluding `visitor` and `prospect`.
- `'visitor'` and `'prospect'` are explicit opt-ins — admin chooses the audience knowingly.
- If demand emerges, add an `'everyone'` preset later.

**Enquiry reply + direct send still work** — brief 56's `/convert` and the enquiry reply endpoint target single addresses, so this filter change doesn't touch them.

---

## 8. CRM / UX contract

### 8a. Enquiry Detail page

Adds a **Convert to member** button to the title row, next to the existing **Send email** button. Hidden when:
- `detail.status === 'archived'`
- `detail.status === 'converted'` → replaced by a chip: `Converted to Member #142 — view →`

Button opens a small modal:
```
Convert to member
About · Frances Roydon-Miller · frances.rm@xtra.co.nz

[ ] Tier (optional dropdown — same tiers list as Add Member)
[ ] Send invite email now (checkbox)

Internal note (optional, markdown)
┌───────────────────────────────────────────────┐
│                                               │
└───────────────────────────────────────────────┘

[ Cancel ]  [ Convert → ]
```

On success:
- Toast: `Added as prospect member — #142`
- Push to `/crm/members/142`
- Returning to the enquiry shows the "Converted to …" chip

### 8b. Members list page

- Two new status filter chips: **Prospects** (count from `counts.prospect`) and **Visitors** (count from `counts.visitor`).
- Prospect rows: `Prospect` chip + muted sub-line `from enquiry` on hover.
- Visitor rows: `Visitor` chip + `Guest of Grace Whittaker` sub-line when `guest_of_name` is set.
- Hero stats on the Members page: paying-member counts ignore prospects + visitors but gain a `Visitors` tile and a `Prospects` tile.

### 8c. Add member modal

New **Type** segmented control at the top — `Member · Prospect · Visitor` — drives which fields render:
- **Member** (default) → existing form.
- **Prospect** → tier dropdown hidden, invite checkbox hidden, helper: `This person won't receive subs invoices or broadcast emails`.
- **Visitor** → tier/invite hidden; adds `Guest of (optional)` member picker + `Auto-archive after (days)` field pre-filled from the club default.

### 8d. Member detail page

For **prospect** members:
- Hero shows the Prospect pill in place of the tier chip.
- Billing section replaced with a muted "No tier assigned — prospect from enquiry #11" block.
- Overflow quick-action: **Promote to member** (opens edit modal with tier + joined_date pre-focused).

For **visitor** members:
- Hero shows the Visitor pill with sponsor name when present.
- Billing section replaced with a Visit stats block: `Visited 23 times · last visit 4 days ago · guest of Grace Whittaker`.
- New primary quick-action: **Sign in visit** (black pill). Fires `/visit`, bumps counter, toasts.
- Overflow quick-action: **Promote to prospect/member** (opens edit modal).

### 8e. Dashboard

New tile: `12 visitors signed in last 30 days`. Prospect leads could join the funnel on brief 54.

---

## 9. Open questions for the backend reviewer

1. **Member number allocation for prospects + visitors** — do we burn a `member_number` on these statuses, or defer until they go `active`? *Preference: defer. Allocate on first `active` transition.*
2. **Email reuse across prospect records** — current `email_in_use` on `members.add` rejects any duplicate. For prospect conversion, should we silently return the existing user_id if the match is a prospect from a different enquiry, or 409? *Preference: 409 — admin probably didn't realise there's already a record.*
3. **Reversibility of convert** — do we need an "Unconvert" or does archiving the resulting member row suffice? *Preference: no unconvert. If the member record is wrong, admin removes it, which should null `converted_user_id` on the enquiry and flip it back to `read`.*
4. **Phone copy on convert** — enquiry has a phone, member row has a phone. On convert, copy `enquiry.phone` → `members.phone` only when the member row is being newly created (not when linking to an existing user, where the stored phone wins).
5. **Placeholder emails for anonymous walk-in visitors** — acceptable to generate `visitor-{nanoid}@placeholder.local`, or should we make `users.email` nullable + rework the uniqueness constraint? *Preference: nullable email. Forcing fake addresses is a data-quality smell.*
6. **Multiple-club visitors** — same person visits two clubs. Does the existing `users` + `club_members` model handle this? Should — but worth a sanity check since the add path differs from a normal invite.
7. **Visit history vs count** — ship with `visit_count` + `visited_at`, or go straight to a `club_member_visits` table? *Preference: start with count. Add table in brief 58 when roll-up / attendance reporting becomes a real ask.*
8. **Guest-of accountability** — some clubs legally require every visitor to be signed in by a member. Should we gate `status: 'visitor'` creation behind a required `guest_of_user_id` when a club setting demands it? *Preference: yes. Add `visitor_requires_sponsor BOOL` to club settings, default false.*
9. **Expiry notification on auto-archive** — email the visitor, or just mark internally? *Preference: internal only — they didn't opt into email contact.*

---

## 10. Scope not included

- Bulk convert on the enquiry inbox (multi-select). Single-row path covers the 95% case.
- Automatic conversion rules (`convert all enquiries matching …`). Explicit action only.
- Automatic promotion rules (`visitors with 5+ visits → suggest promote`). Too easy to misfire.
- Per-visit history table (`club_member_visits`). Brief 58.
- Public visitor sign-in form (QR code on the clubhouse wall). Deferred.
- Visitor fees / per-visit charges. Deferred.
- Guest-of attribution reports (`Grace has brought in 8 visitors this season`). Deferred.
- Status mutations after convert — the existing `PATCH /members/{uid}` with `status` + `membership_type_id` already handles this.
