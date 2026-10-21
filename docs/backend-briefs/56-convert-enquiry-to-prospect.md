# Convert Enquiry → Prospect Member

**Feature:** turn a received enquiry into a tracked prospect in the member roster, without forcing the admin to copy-paste or lose the audit trail. One click on the Enquiry Detail page creates a member row sourced from the enquiry, closes the enquiry with a `converted` status, and (optionally) sends the usual welcome invite.

**Status:** backend not started. Frontend design + modal pattern already exists (reuses the "Add member" modal shape).

**Related briefs:**
- brief 38 (applications) — same approve-into-membership pattern we're mirroring.
- brief 41 (enquiries) — this extends the enquiry resource with one new endpoint + one new terminal state.
- brief 12 (member management) — `AddMemberInput` / `AddMemberResolution` shapes we're reusing on the response.
- brief 54 (communications history) — on convert we may want a `kind='enquiry_converted'` row so the member's communications tab shows "Entered via enquiry on 22 Oct 2026".

**Why not just open the Add Member modal pre-filled?** We lose the link back to the originating enquiry (so "where did this member come from?" can never be answered), and the admin has to archive the enquiry manually. Making it a single server-side transaction keeps the two records linked and avoids inconsistent states (member added, enquiry forgotten in `read`).

---

## 1. New member status: `prospect`

Extend `MemberStatus` from `'active' | 'pending' | 'lapsed'` to:

```
'active' | 'prospect' | 'pending' | 'lapsed'
```

Semantics:

| Status | Means |
|---|---|
| `prospect` | Enquiry-sourced lead. No tier required, no payment expected, no fees owed. Shows in the roster behind a dedicated filter chip. |
| `pending`  | Invited (via "Add member" with `send_invite: true`), not yet accepted. |
| `active`   | Has an active `club_memberships` row. |
| `lapsed`   | Was active, membership expired/revoked. |

**Roster filter** gets a new preset: **Prospects** — counts rows where `computed_status === 'prospect'`.

**Standing pill tone** (CRM): neutral/mute colour, same visual slot as the current "Lapsed" chip. Copy: `Prospect · from enquiry`.

**No billing side-effects.** A prospect member has `membership` set to `null` on the roster row — same shape as a member with no tier assigned today. The payment columns stay empty. The hero "Owing" value on Member Detail reads `—`.

---

## 2. New enquiry status: `converted`

Extend `EnquiryStatus` from `'new' | 'read' | 'replied' | 'archived'` to:

```
'new' | 'read' | 'replied' | 'converted' | 'archived'
```

- `converted` is terminal, like `archived`. GET-ting a converted enquiry does **not** auto-flip anything (unlike `new` → `read`).
- Inbox counts: adds a `converted` bucket to `EnquiriesListResponse.counts`.
- Convert and archive are mutually exclusive — converting an archived enquiry returns `409 enquiry_archived` (admin must unarchive first).

**Audit link:** on the enquiry row, store `converted_user_id` and `converted_at`. Both nullable; populated by `/convert`.

```ts
interface EnquiryDetail {
  // …existing fields
  converted_user_id: number | null
  converted_at: string | null
}
```

---

## 3. Endpoint — `POST /clubs/{club_id}/enquiries/{enquiry_id}/convert`

**Auth:** admin+ on `club_members` (matches reply/archive).

### Request

```ts
interface ConvertEnquiryInput {
  /** Optional membership tier — leave null to create a prospect with no
   *  tier (the common case). Setting a tier bumps the resolution path
   *  to behave like `members.add` with that tier assigned. */
  membership_type_id?: number | null

  /** If true, email the person a club-join invite link (same as
   *  `send_invite` on members.add). Resolution flips to `invited` and
   *  the row lands in `pending` status instead of `prospect`. */
  send_invite?: boolean

  /** Optional preferred/first name split — if the enquiry came in with a
   *  single `full_name`, admin may want to tidy it before converting.
   *  Omitted → server parses `full_name` by whitespace, first token as
   *  first name, rest as last. */
  first_name?: string
  last_name?: string

  /** Optional internal note — if the admin wrote one in the convert
   *  modal, attach it to the resulting member row AND copy a stub into
   *  the enquiry's internal notes thread so the inbox trail stays
   *  readable. */
  note?: string
}
```

### Response

```ts
interface ConvertEnquiryResult {
  resolution: 'linked' | 'relinked' | 'stub_created' | 'invited'
  user_id: number
  member_number?: number
  role: 'player'  // always — admins promote later via Member Detail
  membership_type_id: number | null
  /** Only present when `resolution === 'invited'`. */
  accept_url?: string
  expires_in_days?: number
  /** Mirrors the applications approve pattern — the enquiry row's new
   *  terminal state, so the client doesn't have to re-GET it. */
  enquiry: {
    id: number
    status: 'converted'
    converted_user_id: number
    converted_at: string  // ISO
  }
}
```

### Resolution rules

Reuse the applications logic:

| Scenario | Resolution | Status |
|---|---|---|
| Email matches an existing user, not yet a club member | `linked` | `active` if tier given, else `prospect` |
| Email matches a user who was previously removed from the club | `relinked` | same as above |
| Email matches no user; `send_invite: true` | `invited` | `pending` |
| Email matches no user; `send_invite: false` (default) | `stub_created` | `prospect` |

`already_member` is **not** a resolution here — if the email already belongs to a current `club_members` row, return `409 already_member` with the existing `user_id` so the client can jump to that member's detail page. (Different from applications, where approving an already-member is treated as idempotent-success — enquiries are more ad-hoc, so an admin converting a duplicate probably means a mistake.)

### Error codes

```
400  invalid_input           — missing/invalid payload shape
404  enquiry_not_found       — id doesn't belong to this club
409  enquiry_archived        — enquiry is archived; unarchive first
409  enquiry_already_converted — enquiry already has converted_user_id set
409  already_member          — email already belongs to an active club member;
                              response body includes { user_id, member_number }
400  invalid_tier            — membership_type_id doesn't exist on this club
403  forbidden               — caller isn't admin+ on this club
```

---

## 4. Audit trail

### 4a. Member row carries the source

Add two nullable columns to `club_members` (or wherever member provenance lives):

```sql
source TEXT        -- 'enquiry' | 'application' | 'manual' | 'import'
source_ref_id INT  -- enquiry_id / application_id / nullable for manual
```

Backfill existing rows with `source = 'manual'`.

The GET /roster response surfaces this as:

```ts
interface RosterMember {
  // …existing fields
  source: 'enquiry' | 'application' | 'manual' | 'import'
  source_ref_id: number | null
}
```

### 4b. Enquiry notes thread gets a system entry

When convert succeeds, append a system-authored note to the enquiry (so the inbox trail stays complete):

```
Converted to member #142 by Grace Whittaker on 22 Oct 2026.
```

Use `author_user_id = NULL, author_name = 'System'` (or similar sentinel). The notes list already renders without an author chip when `author_name` is null.

### 4c. Communications tab (brief 54)

If brief 54 ships before this one, record a `kind='enquiry_converted'` event with `source_ref_id = enquiry_id` so the member's Communications tab shows "Entered via enquiry — 'Hey can I hire the venue?'" with a link back to the original enquiry.

---

## 5. CRM / UX contract

### 5a. Enquiry Detail page

Adds a **Convert to member** button to the title row, next to the existing **Send email** button. Hidden when:
- `detail.status === 'archived'`
- `detail.status === 'converted'` (replaced with a chip: "Converted to Member #142 — view →")

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
- Push to `/crm/members/142` (standard new-member landing)
- The enquiry (if admin navigates back) now shows the "Converted to …" chip

### 5b. Members list page

- New **Prospects** preset in the status filter.
- Prospect rows show the standing pill as `Prospect` with the muted/neutral treatment and the "from enquiry" subline on hover.
- The hero stats row ignores prospects in paying-member counts.

---

## 6. Open questions for the backend reviewer

1. **Member number allocation for prospects** — do we burn a `member_number` on conversion, or defer until they get a tier? (My preference: defer. Allocate when they move from `prospect` → `active`.)
2. **Email reuse** — current `email_in_use` logic on `members.add` rejects a duplicate even for stubs. For prospect conversion, should we silently return the existing user_id if the match is a prospect from a different enquiry, or still 409? (Preference: 409 — admin probably didn't realise there's already a record.)
3. **Reversibility** — do we want an "Unconvert" or does archiving the resulting member row suffice? (Preference: no unconvert. If the member record is wrong, admin removes the member, which should null out `converted_user_id` on the enquiry and flip it back to `read`.)
4. **Phone copy** — the enquiry has a phone number, the member row has one too. On convert, copy `enquiry.phone` → `members.phone` if the member row is being created (not when linking an existing user, where the existing phone wins).

---

## 7. Scope not included

- Bulk convert (multi-select on the inbox list). Can ship later; the single-row path covers the 95% case.
- Automatic conversion rules ("convert all enquiries with topic=membership and consent_reply=true"). Explicit action only for now.
- Changing `MemberStatus = prospect` back to `pending`/`active` via a dedicated endpoint — the existing `PATCH /members/{uid}` with `status` + `membership_type_id` already handles this.
