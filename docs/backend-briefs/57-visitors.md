# Visitors

**Feature:** track casual guest players — walk-ins, friends-of-members, out-of-town visitors — as a distinct non-paying status on the roster. They sit alongside prospects (brief 56), paying members, and lapsed members, but have their own data (`guest_of_user_id`, `visited_at`, `visit_count`) and their own operational workflows (sign them in each visit, auto-archive after a quiet period, optionally promote to prospect/member).

**Status:** backend not started. UX pattern copies the Add Member flow; auto-archive runs as a scheduled job.

**Related briefs:**
- brief 12 (member management) — `members.add` is the base endpoint we're extending.
- brief 56 (convert enquiry → prospect) — adds the first non-paying status; this brief adds the second.
- brief 54 (communications history) — visitor sign-ins are good candidates for the activity timeline on member detail.

**Why not fold visitors into `prospect`?** Different motivation to track. A prospect is a lead we expect to convert (CRM / sales mindset — pipeline, follow-up). A visitor is an operational fact — they're playing on our greens tonight; we need them for insurance, roll-up assembly, and in some clubs legally for licensing. Collapsing them makes filters, counts, and workflows ambiguous.

---

## 1. New member status: `visitor`

Extending brief 56's `MemberStatus`:

```
'active' | 'prospect' | 'visitor' | 'pending' | 'lapsed'
```

Semantics:

| Status | Means |
|---|---|
| `visitor` | Casual guest. No tier, no fees, no annual commitment. Often a one-off or infrequent player. Tracked for insurance / attendance / roll-up / future promotion to member. |

**Role stays `player`.** Status answers "what's their membership state", role answers "what can they do in the club". Visitors have the lowest permission set (same as any player — can see the public site, can't touch the CRM).

**No `club_memberships` row.** Same as prospect. Billing / payment columns stay empty. Hero "Owing" on Member Detail reads `—`.

**Standing pill tone** (CRM): soft neutral with a subtle accent — distinct from prospect so an admin skimming the roster can tell them apart at a glance. Copy: `Visitor` (or `Visitor · guest of Grace` when a guest-of link exists).

---

## 2. New data on `club_members` for visitors

```sql
ALTER TABLE club_members
  ADD COLUMN guest_of_user_id INT NULL,       -- the member they came in with
  ADD COLUMN visited_at TIMESTAMP NULL,       -- last recorded visit
  ADD COLUMN visit_count INT NOT NULL DEFAULT 0,
  ADD COLUMN visitor_expires_at TIMESTAMP NULL;  -- nullable; see §6
```

- `guest_of_user_id` — FK to `users.id`. Nullable (walk-ins have no sponsor). On the sponsor's deletion, `SET NULL`.
- `visited_at` — set/updated by the sign-in action (§5). The last visit timestamp drives the auto-archive job.
- `visit_count` — simple integer; incremented by sign-in. Useful for the member profile ("23 visits since first signed in"). No history detail — if we want per-visit records, that's brief 58.
- `visitor_expires_at` — if a club configures auto-archive at N days, this is the explicit soft-expiry. Nullable so clubs that want "once a visitor, always a visitor until manually archived" aren't forced into a lifecycle.

**These columns live on `club_members` because a user can be a visitor at one club and a paying member at another.** Keeping them off the `users` table preserves that.

**Backfill:** all existing rows get NULL / 0 / NULL. No migration concern — the fields only matter for `status === 'visitor'`.

---

## 3. Extend `AddMemberInput` with `status`

Rather than a separate `POST /clubs/{cid}/visitors` endpoint, extend `members.add` so one endpoint creates members in any state. This keeps the client surface small and matches how the brief 56 `convert` endpoint resolves into the same shape.

```ts
interface AddMemberInput {
  // …existing fields
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
  /** Target status. Default stays `active` (link / invite with a tier) to
   *  preserve the current add-member behaviour. */
  status?: 'active' | 'prospect' | 'visitor' | 'pending'

  /** Only read when `status === 'visitor'`. */
  visitor?: {
    guest_of_user_id?: number | null
    visitor_expires_at?: string | null   // ISO; omit for no auto-expiry
    note?: string                        // internal note on first sign-in
  }
}
```

### Interaction rules

| `status` input | Required | Forbidden | Resolution |
|---|---|---|---|
| `active`  (default) | `membership_type_id` or `membership_type` | — | existing behaviour |
| `prospect` | — | `membership_type_id` and `membership_type` must both be absent (prospects have no tier) | existing resolution set |
| `visitor` | — | `membership_type_id`, `membership_type`, and `send_invite` must all be absent | existing resolution set, `send_invite` always false |
| `pending` | — | `membership_type_id` optional | sets `send_invite: true` server-side |

**Email on visitors is optional.** If the client sends `status: 'visitor'` with no email, the server generates a placeholder (`visitor-{random}@placeholder.local`) that we never actually send to and that the roster-render path knows to hide. If email is present, the usual uniqueness rules apply.

### Error codes added

```
400  invalid_status                    — unknown status enum
400  visitor_tier_not_allowed          — tier fields on a visitor create
400  visitor_invite_not_allowed        — send_invite:true on a visitor create
400  invalid_guest_of                  — guest_of_user_id doesn't belong to this club
```

Existing codes (`email_in_use`, `invalid_email`, etc.) apply as normal.

---

## 4. Roster shape additions

```ts
interface RosterMember {
  // …existing
  computed_status: 'active' | 'prospect' | 'visitor' | 'pending' | 'lapsed'
  // NEW — only populated when computed_status === 'visitor'
  visitor: null | {
    guest_of_user_id: number | null
    guest_of_name: string | null    // denormalised for the pill display
    visited_at: string | null       // ISO
    visit_count: number
    visitor_expires_at: string | null
    days_since_last_visit: number | null  // computed server-side
  }
}
```

`visitor: null` for everyone except visitors — keeps JSON lean for a 500-row roster.

### Roster filter preset

Add **Visitors** to the status filter chips (alongside the existing All / Active / Pending / Lapsed, plus Prospects from brief 56). Count comes from `counts.visitor` in the response.

### Roster list column

Keep the existing columns. Visitors inherit the generic treatment — same name/email/phone layout. The standing-pill slot shows the visitor chip.

---

## 5. Sign in a visitor — `POST /clubs/{cid}/members/{uid}/visit`

A quick action from the Member Detail page (visible only when `status === 'visitor'`). Increments `visit_count` and sets `visited_at = now()`.

**Auth:** admin+ on the club.

### Request

```ts
interface SignInVisitorInput {
  /** Defaults to now() server-side. Set this to backdate a visit from a
   *  paper roll-up sheet. */
  visited_at?: string

  /** Optional note — stored on the visit record. If we later add brief 58
   *  (visit history), this becomes queryable. For now it just lands in
   *  the member's internal notes thread. */
  note?: string
}
```

### Response

```ts
interface SignInVisitorResult {
  user_id: number
  visited_at: string      // echoed
  visit_count: number     // new total
}
```

### Errors

```
404 member_not_found
409 not_a_visitor          — status is not 'visitor'
400 invalid_visited_at     — in the future or unparseable
```

**Not storing per-visit history yet.** `visit_count` is a running integer; `visited_at` is the latest. If roll-up / attendance history becomes a thing, brief 58 can add a `club_member_visits` table and backfill from here forward.

---

## 6. Auto-archive quiet visitors (scheduled job)

A nightly job archives visitors who haven't signed in for N days. Clubs set N in settings (or opt out entirely).

### Club setting

Add to `club_settings` (or wherever visitor-settings live):

```sql
visitor_auto_archive_days INT NULL  -- NULL = never auto-archive
```

Default `NULL` on existing clubs — opt-in, not opt-out, so no club gets a surprise purge.

### Job

Nightly cron (same cadence as any other maintenance job):

```sql
UPDATE club_members
SET status = 'lapsed', revoked_at = NOW()
WHERE status = 'visitor'
  AND visited_at IS NOT NULL
  AND visited_at < NOW() - INTERVAL (SELECT visitor_auto_archive_days FROM clubs WHERE id = club_members.club_id) DAY
  AND (SELECT visitor_auto_archive_days FROM clubs WHERE id = club_members.club_id) IS NOT NULL
```

Also honour the per-row `visitor_expires_at` — if set and in the past, archive regardless of the club default.

**Non-destructive.** Rows flip to `lapsed`, not deleted. The data remains for reporting and the admin can un-lapse if they're wrong.

**Communications log entry** (brief 54 if shipped): `kind='visitor_auto_archived'`, so the member's communications tab shows "Auto-archived on 22 Oct 2026 — 90 days without a visit."

---

## 7. Convert visitor → prospect or active member

Visitors are often the top of the funnel. A visitor who's come in 4 times is a conversion candidate. The admin should be able to promote them without recreating the record.

**No new endpoint — reuse `PATCH /clubs/{cid}/members/{uid}`.** The existing update endpoint already handles the status + tier combination:

- `{ status: 'prospect' }` — null out visitor fields server-side
- `{ status: 'active', membership_type_id: 5, joined_date: '2026-10-22' }` — creates the `club_memberships` row, clears visitor data

**Server-side cleanup on status transition OUT of `visitor`:**

```sql
UPDATE club_members
SET guest_of_user_id = NULL,
    visited_at = NULL,
    visit_count = 0,
    visitor_expires_at = NULL
WHERE id = ? AND status != 'visitor'  -- transitional guard
```

Preserve `source` and `source_ref_id` from brief 56 so provenance survives the promotion ("This paying member first visited us as a guest of Grace on 03 Mar 2026").

---

## 8. Email defaults

Visitors should **not** be in default broadcast recipient lists. They didn't sign up for marketing — they came to play a game.

### bulkEmail filter preset changes

In `BulkEmailRecipientsFilter.filter.status`:

```ts
status?: 'all' | 'active' | 'pending' | 'lapsed' | 'visitor' | 'prospect'
```

- `'all'` continues to mean **all paying + pending** — explicitly excludes `visitor` and `prospect` so clicking "Email all members" doesn't accidentally spam a tourist.
- `'visitor'` and `'prospect'` are explicit opt-ins — admin chooses the audience knowing what they're doing.
- A new preset `'everyone'` (or `'including_visitors'`) can be added later if clubs ask; defer until requested.

**Enquiry reply + direct send still work** — brief 56's `/convert` and the enquiry reply endpoint both target single addresses, so this filter change doesn't touch them.

---

## 9. CRM / UX contract

### 9a. Members list page

- New **Visitors** preset chip (with count) in the status filter row.
- Visitor rows show the status pill as `Visitor` with a soft tint; a muted sub-line `Guest of Grace Whittaker` renders when `guest_of_name` is set.
- The hero stats on the Members page (Total members, Active, Overdue, etc.) ignore visitors in the paying-member counts but add a `Visitors` tile.

### 9b. Add member modal

Add a **Type** segmented control at the top of the modal — `Member · Prospect · Visitor` — that drives which fields show:

- **Member** (default) → existing form.
- **Prospect** → tier dropdown hidden, invite checkbox hidden, "This person won't receive subs invoices or broadcast emails" helper line.
- **Visitor** → tier/invite hidden; adds `Guest of (optional)` member picker + `Auto-archive after (days)` field pre-filled from the club default.

### 9c. Member detail page

For visitor members:
- Hero shows the Visitor pill in place of the tier chip.
- Billing section replaced with a Visit stats block: "Visited 23 times · last visit 4 days ago · guest of Grace Whittaker".
- New quick-action: **Sign in visit** button (black pill). Fires `/visit`, bumps the counter, toasts "Signed in — Frances · 24 visits".
- New quick-action in the overflow menu: **Promote to prospect/member** (opens an edit modal pre-filled from the visitor record).

### 9d. Dashboard

Dashboard numbers tile for visitors: `12 visitors signed in last 30 days`.

---

## 10. Open questions for the backend reviewer

1. **Placeholder emails for anonymous visitors** — is `visitor-{nanoid}@placeholder.local` acceptable, or do we want a `nullable email` on `users` and strip the uniqueness constraint when null? (Preference: nullable — forcing fake emails is a data-quality smell.)
2. **Multiple-club visitors** — same person visits two clubs. Does our existing `users` + `club_members` model handle that? (Should — but worth a sanity check since the add path differs from a normal invite.)
3. **Visit history vs count** — do we want to launch with just `visit_count` and `visited_at`, or go straight to a `club_member_visits` table? (Preference: start with count. Add table in brief 58 when roll-up / attendance reporting becomes a real ask.)
4. **Guest-of accountability** — some clubs legally require every visitor to be signed in by a member. Should we gate `status: 'visitor'` creation behind a required `guest_of_user_id` when a club setting demands it? (Preference: yes — add `visitor_requires_sponsor` to club settings, default `false`.)
5. **Expiry notification** — when a visitor is auto-archived, do we email them, or just mark it internally? (Preference: internal only — they didn't opt into email contact.)

---

## 11. Scope not included

- Per-visit history table (`club_member_visits`). Deferred to brief 58.
- Public visitor sign-in form (QR code on the clubhouse wall). Deferred.
- Visitor fees / per-visit charges. Deferred.
- Guest-of attribution reports ("Grace has brought in 8 visitors this season"). Deferred.
- Automatic conversion rules ("if a visitor has 5+ visits, suggest promoting them"). Deferred — too easy to misfire.
