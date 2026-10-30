# Member record completeness — notes feed, communications, payment-season on history, committee-flag parity, prev/next pagination

**Feature:** finish wiring the Member Detail page to real backend data. Five cuts of the same underlying gap — "the detail page knows less than it should" — bundled so a single sprint closes them out:

1. The **Notes** tab is an empty state. `LogNoteModal` is quietly persisting (via `PATCH /members/{user_id}` → `notes` free-text), but the Notes tab never reads `member.notes` back. Appending every entry into one text column is also the wrong long-term shape — no delete, no author, no proper timestamp. Need a real notes resource.
2. The **Communications** tab is an empty state waiting on brief 54. Pointer, not new work.
3. **Payment history** on the Payments tab is synthesised from the roster row's single `last_payment_date` + `last_payment_amount`. No per-row list, no season label, no multi-season history. The row we show today reads *"Playing member fee · $260 · Paid"* with no season attribution — brief 55 fixed the *write* path but the detail page has no *read* path to pull it from.
4. **Committee flag parity.** The Members search list shows a `COMMITTEE` badge for Nev Rodda (owner); the Member Detail page shows `ROLE: Admin` + `POSITION GROUP: (empty)` and no committee marker. Two different fields disagreeing — the search is reading `club_role` (owner / admin / committee → "Committee" badge), the detail page is reading `position_group` which was never populated for existing admins/owners. Need one authoritative signal.
5. **Prev / Next member navigation** on the detail page's sub-header walks a client-side list of the first 200 roster rows (`listRoster({ limit: 200 })`). Clubs with 200+ members can't page past the first slice via the arrows — they land on member 201 via search or deep link and get `prev: null, next: null` even though more members exist. Needs a server-side neighbor lookup so the arrows always resolve.

**Status:** backend not started on §1, §3, §4, §5. §2 is tracking in brief 54. The frontend changes are small follow-ups once each endpoint is live.

**Related briefs:**
- brief 12 — the base member resource (`PATCH /members`, add/remove, payment write).
- brief 13 — the roster response shape (`GET /members`, `GET /members/summary`).
- brief 35 — defined `position_group` ('board' | 'staff' | 'committee' | 'member') for the public directory. This brief leans on it for §4.
- brief 39 — scoped CRM roles. Clarifies that `club_role` is a *permission* field, not a committee-seat marker — same distinction §4 enforces.
- brief 54 — communications history (persist bulk + transactional email sends + per-member feed). The Communications tab empty state waits on this. §10 of brief 54 explicitly deferred notes to a follow-up brief → that follow-up is §1 here.
- brief 55 — payments `season_id` write path. §3 here is the matching read path.

---

## TL;DR

1. **Notes** — new tables `member_notes`. New endpoints: `GET /clubs/{club_id}/members/{user_id}/notes`, `POST .../notes`, `PATCH .../notes/{note_id}`, `DELETE .../notes/{note_id}`. One-shot backfill splits existing `members.notes` free text onto rows by the modal's `"YYYY-MM-DD · Type · body"` separator; unparseable blobs land as a single `general` row with the original text and a null date.
2. **Communications** — brief 54 pointer. The detail-page empty state copy already reads *"…once the Communications brief lands"* — flipping it is one `communications.listForMember(clubId, userId)` call once brief 54 §4 is live.
3. **Payment history** — new endpoint `GET /clubs/{club_id}/members/{user_id}/payments` returning per-row `season_id` + `season_name` (plus `method`, `reference`, `notes`, `recorded_by`). Deprecates the client-side synthesis from `last_payment_*`.
4. **Committee flag** — add a derived `is_committee` boolean on roster rows that already surface `club_role` + `position_group`. The badge in both views reads this flag, so the two surfaces agree. Backfill `position_group` for any member whose `title` matches a known committee/board pattern (`'president'`, `'secretary'`, `'treasurer'`, `'board member'`, `'club captain'`, …) so historical rows stop showing empty.
5. **Prev / Next neighbors** — new endpoint `GET /clubs/{club_id}/members/{user_id}/neighbors` returning `{ prev_user_id, next_user_id, index, total }` under the current roster ordering + filter. The detail page swaps its 200-row client slice for this call and the arrows become O(1), regardless of club size.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner / admin JWT on `club_members` for all writes. Committee+ for reads. Same auth matrix as brief 12.

---

## 1. Notes — real resource

### 1a. The problem

`LogNoteModal` (`apps/crm/src/components/modals/LogNoteModal.vue`) saves a note by appending to the member's `notes` text column:

```js
const prior = (member.notes ?? '').trim()
const next = prior ? `${prior}\n\n${entry}` : entry
await membersApi.patchMember(cid, member.user_id, { notes: next })
```

…where `entry` is `"{{todayLabel}} · {{typeLabel}} · {{body}}"` (e.g. `"30 Oct 2026 · Call · Followed up on sub"`). Entries are joined with `\n\n`.

Problems:
- The Notes tab (`MemberDetailView.vue:883`) is a hard-coded `CrmEmptyState` — the saved text is never rendered back. Admins log notes and watch them disappear.
- Last-write-wins: two admins open the modal, Admin A saves, Admin B saves on top → Admin A's note is overwritten (B's PATCH sent the old `prior`).
- No per-row delete, no author tracking, no canonical timestamp (the modal fills the date client-side).
- `members.notes` is a VARCHAR / TEXT single column — it will keep growing without bound.

### 1b. Storage

```sql
CREATE TABLE member_notes (
  id             BIGSERIAL   PRIMARY KEY,
  club_id        INTEGER     NOT NULL REFERENCES clubs(id),
  user_id        INTEGER     NOT NULL REFERENCES users(id),            -- the member the note is about
  author_user_id INTEGER     NULL     REFERENCES users(id),            -- the admin who wrote it (null for backfilled rows)
  kind           VARCHAR     NOT NULL DEFAULT 'general',               -- 'call' | 'meeting' | 'visit' | 'text' | 'general'
  body           TEXT        NOT NULL,
  pinned         BOOLEAN     NOT NULL DEFAULT false,                   -- v1 ignores; schema admits for future "sticky at top"
  occurred_at    TIMESTAMP   NULL,                                     -- when the thing being logged happened (admin can backdate — today's date is the default on write)
  created_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMP   NULL                                      -- soft delete so audit is intact
);

CREATE INDEX idx_member_notes_feed
  ON member_notes (club_id, user_id, created_at DESC)
  WHERE deleted_at IS NULL;
```

`kind` mirrors the modal's chip set — new values can be added without a schema change. Reject unknown kinds at the endpoint (see §1h).

### 1c. Backfill

Run once as part of the migration. For every `club_members` row with `notes IS NOT NULL AND notes <> ''`:

1. Split by `\n\n`.
2. For each chunk, try to parse `^(?<date>[^·]+?) · (?<type>Call|Meeting|Visit|Text / WhatsApp|General) · (?<body>.*)$` (the modal's exact format). Strip trailing / leading whitespace.
3. On match → insert one `member_notes` row with:
   - `kind` = mapped from label (`Call` → `call`, `Text / WhatsApp` → `text`, etc.)
   - `body` = the captured body (keep newlines inside the body as-is)
   - `occurred_at` = parsed date at midnight UTC
   - `author_user_id` = NULL (we don't know)
   - `created_at` = the parsed date at midnight UTC (so the feed order matches admin memory)
4. On parse failure → insert one row with `kind='general'`, the raw chunk as `body`, `occurred_at = NULL`, `created_at = club_members.updated_at` or NOW().
5. Keep the original `members.notes` string for the length of the migration. After one deploy cycle with the new endpoints live and the FE migrated, drop the column in a follow-up migration.

**Don't** touch `members.notes` on write going forward (deprecate it; the `PATCH /members` handler should treat an incoming `notes` field as a 400 `notes_moved` so stale FE clients fail loudly instead of writing drift back in).

### 1d. `GET /clubs/{club_id}/members/{user_id}/notes`

Paginated feed, newest first.

**Query params:**
- `limit` — int, default 25, max 100.
- `cursor` — opaque `created_at+id` encoding.
- `kind` — comma-separated filter: `call,meeting,visit,text,general`.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "notes": [
      {
        "note_id":     8842,
        "kind":        "call",
        "body":        "Followed up on sub. Confirmed Nev will pay by Friday.",
        "pinned":      false,
        "occurred_at": "2026-10-30T00:00:00.000Z",
        "created_at":  "2026-10-30T04:12:08.000Z",
        "updated_at":  "2026-10-30T04:12:08.000Z",
        "author": {
          "user_id": 12,
          "name":    "Felicity Hall",            // null for backfilled rows
          "avatar_url": "https://imagedelivery.net/…/thumbnail"
        }
      }
    ],
    "next_cursor": null,
    "counts": {
      "total":   14,
      "call":    6,
      "meeting": 3,
      "visit":   1,
      "text":    2,
      "general": 2
    }
  }
}
```

404 if the caller isn't on the club or `user_id` isn't a member. 403 if the caller is a non-admin reading another member's notes (notes are internal — committee+ can read, but a plain member reading their own notes is out of scope for v1).

### 1e. `POST /clubs/{club_id}/members/{user_id}/notes`

**Request:**

```jsonc
{
  "kind":        "call",                       // required
  "body":        "Followed up on sub.",        // required, max 4000 chars
  "occurred_at": "2026-10-30"                  // optional; default = today in the club's timezone
}
```

**201 response:**

```jsonc
{
  "status": "success",
  "data": {
    "note_id":     8842,
    "kind":        "call",
    "body":        "Followed up on sub.",
    "pinned":      false,
    "occurred_at": "2026-10-30T00:00:00.000Z",
    "created_at":  "2026-10-30T04:12:08.000Z",
    "updated_at":  "2026-10-30T04:12:08.000Z",
    "author": { "user_id": 12, "name": "Felicity Hall", "avatar_url": "…" }
  }
}
```

### 1f. `PATCH /clubs/{club_id}/members/{user_id}/notes/{note_id}`

Admin + the original author can edit. Request accepts any subset of `kind`, `body`, `occurred_at`, `pinned`. 200 echoes the full note shape above with the new `updated_at`. 403 if the caller is neither admin nor the author.

### 1g. `DELETE /clubs/{club_id}/members/{user_id}/notes/{note_id}`

Soft delete — set `deleted_at = NOW()`. 204. Same auth as PATCH.

### 1h. Error table (notes)

| Status | code | When |
|---|---|---|
| `400` | `missing_body` | POST / PATCH with empty `body` |
| `400` | `body_too_long` | POST / PATCH with `body` > 4000 chars |
| `400` | `invalid_kind` | `kind` not in the whitelist |
| `400` | `invalid_occurred_at` | `occurred_at` doesn't parse as `YYYY-MM-DD` or ISO |
| `400` | `notes_moved` | `PATCH /members` sends a `notes` field (temporary — remove once FE flip is done) |
| `403` | `forbidden` | Caller is a non-admin editing someone else's note |
| `404` | `note_not_found` | `note_id` doesn't exist / belongs to another member |

### 1i. Frontend contract summary (notes)

New resource `packages/api-client/src/resources/memberNotes.ts`:

```ts
export type MemberNoteKind = 'call' | 'meeting' | 'visit' | 'text' | 'general'

export interface MemberNote {
  note_id: number
  kind: MemberNoteKind
  body: string
  pinned: boolean
  occurred_at: string | null
  created_at: string
  updated_at: string
  author: { user_id: number; name: string | null; avatar_url: string | null }
}

export const memberNotes = {
  list(clubId: number, userId: number, params?: { limit?: number; cursor?: string; kind?: MemberNoteKind[] }): Promise<{ notes: MemberNote[]; next_cursor: string | null; counts: Record<string, number> }>,
  create(clubId: number, userId: number, input: { kind: MemberNoteKind; body: string; occurred_at?: string }): Promise<MemberNote>,
  update(clubId: number, userId: number, noteId: number, patch: Partial<{ kind: MemberNoteKind; body: string; occurred_at: string | null; pinned: boolean }>): Promise<MemberNote>,
  remove(clubId: number, userId: number, noteId: number): Promise<void>,
}
```

View updates:
- `MemberDetailView.vue:883` — replace the empty state with a feed rendered from `memberNotes.list(clubId, userId)`. Each row shows the author, timestamp, kind pill, body, and (for admin + author) edit / delete controls.
- `LogNoteModal.vue:85` — swap `membersApi.patchMember(cid, member.user_id, { notes: next })` for `memberNotes.create(cid, member.user_id, { kind, body, occurred_at })`. The modal keeps its chip set + textarea unchanged.

---

## 2. Communications — pointer to brief 54

`MemberDetailView.vue:874` is a `CrmEmptyState` reading *"Emails, calls, and notes to this member will appear here once the Communications brief lands."* The moment brief 54 §4 ships `GET /clubs/{club_id}/members/{user_id}/communications`, flip this card to `communications.listForMember(clubId, userId)` and render the feed described there.

Nothing new to ship on the backend here — this brief exists so the sprint's punch list is complete.

---

## 3. Payment history — per-row list with season label

### 3a. The problem

`MemberDetailView.vue:278` synthesises the Payment history table from two scalar fields on the roster row:

```ts
if (m.membership.last_payment_date && m.membership.last_payment_amount) {
  rows.push({ id: 'last', date: fmt(…), description: `${type_name} fee`, amount: …, status: 'paid' })
}
if (m.membership.payment_status === 'unpaid' | 'overdue' | 'partial') {
  rows.push({ id: 'current', date: due, description: `${type_name} fee`, amount: fee, status: … })
}
```

Two consequences:
- The table only ever shows **one paid row** (the last one). Multi-season history is invisible — if Nev paid $260 for 2025/26 and $260 for 2026/27, we only ever render the 2026/27 one.
- Rows have no season label, so the user asked for *"the payments need to show the payment for which season"*. Brief 55 added `season_id` to the write path, but there's no read path to pull it from.

### 3b. `GET /clubs/{club_id}/members/{user_id}/payments`

**Query params:**
- `limit` — int, default 50, max 200.
- `cursor` — opaque `payment_date+id` cursor.
- `season_id` — int. When set, only return payments attributed to that season (brief 55 §1 column). Omit for the full history.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "payments": [
      {
        "payment_id":        882,
        "amount":            260.00,
        "payment_date":      "2026-10-29",
        "payment_method":    "bank_transfer",
        "payment_reference": "ANZ-12345",
        "payment_status":    "paid",
        "notes":             "Cleared October invoice",
        "season_id":         17,
        "season_name":       "2026/27 Season",
        "membership": {
          "type_id":    4,
          "type_name":  "Playing member",            // snapshot — survives tier renames
          "fee":        260.00,
          "cadence":    "annual"
        },
        "recorded_by": {
          "user_id":    12,
          "name":       "Felicity Hall"
        },
        "created_at":  "2026-10-29T22:14:03.000Z"
      },
      {
        "payment_id":        701,
        "amount":            260.00,
        "payment_date":      "2025-11-04",
        "payment_method":    "cash",
        "payment_reference": null,
        "payment_status":    "paid",
        "notes":             null,
        "season_id":         16,
        "season_name":       "2025/26 Season",
        "membership":        { "type_id": 4, "type_name": "Playing member", "fee": 240.00, "cadence": "annual" },
        "recorded_by":       { "user_id": 12, "name": "Felicity Hall" },
        "created_at":        "2025-11-04T19:02:14.000Z"
      }
    ],
    "next_cursor": null,
    "totals": {
      "all_time":    520.00,
      "by_season": [
        { "season_id": 17, "season_name": "2026/27 Season", "collected": 260.00 },
        { "season_id": 16, "season_name": "2025/26 Season", "collected": 260.00 }
      ]
    },
    "outstanding": {
      "season_id":   17,
      "season_name": "2026/27 Season",
      "fee":         260.00,
      "collected":   260.00,
      "balance":     0.00,
      "status":      "paid"                           // mirrors roster.membership.payment_status for the current season
    }
  }
}
```

- `season_name` is derived from `seasons.name` at read time (not snapshotted on the payment row) so renaming a season flows through to history.
- `payments` with `season_id = NULL` (pre-brief-55 backfill misses) still render — the FE shows them under a *"Season — ?"* grouping. Backend returns them with `season_name: null`.
- `totals.by_season` is a GROUP BY on `season_id` with COALESCE for null rows into a single `"Unknown season"` bucket (`season_id: null`).
- `outstanding` mirrors the roster row's current-season state so the FE doesn't need a second call just to show the "Due $X" row underneath the paid history. Only populated when the club has a current season; omitted when none exists.

404 for `user_not_on_club`. 400 `unknown_season` if `season_id` filter is from another club (same error vocabulary as brief 55).

### 3c. Frontend contract summary (payments)

Extend `packages/api-client/src/resources/members.ts`:

```ts
export interface MemberPayment {
  payment_id: number
  amount: number
  payment_date: string
  payment_method: PaymentMethod
  payment_reference: string | null
  payment_status: PaymentStatus
  notes: string | null
  season_id: number | null
  season_name: string | null
  membership: { type_id: number | null; type_name: string | null; fee: number | null; cadence: MembershipCadence | null }
  recorded_by: { user_id: number | null; name: string | null }
  created_at: string
}

export async function listPayments(
  clubId: number,
  userId: number,
  params?: { limit?: number; cursor?: string; season_id?: number },
): Promise<{ payments: MemberPayment[]; next_cursor: string | null; totals: {…}; outstanding: {…} | null }>
```

View update:
- `MemberDetailView.vue:278` — drop the client-side synthesis; call `members.listPayments(clubId, userId)` on mount and group by `season_name` with a subheader row per season (`2026/27 Season — $260 collected`). Add a season filter dropdown above the table for clubs with 5+ seasons; keep "All seasons" as default. The row description becomes `{{ type_name }} fee — {{ season_name || 'Unknown season' }}`.

---

## 4. Committee-flag parity

### 4a. The problem

`MembersView.vue:165` collapses role to display:

```ts
const roleMap: Record<string, MemberRole> = {
  player: 'Player',
  committee: 'Committee',
  admin:     'Committee',
  owner:     'Committee',
}
```

…then renders a `COMMITTEE` badge whenever `m.role === 'Committee'`. Nev's `club_role` is `owner` so he shows the badge.

`MemberDetailView.vue:938` reads the raw `club_role` ("Admin" / "Owner" / "Committee" / "Player") in the Profile → Roster section, and `position_group` separately. For Nev those render as:
- `ROLE: Admin`     ← because the pipeline cap-cases `club_role`
- `POSITION GROUP: (empty)`    ← because `position_group` was never set on his row
- `TITLE: Playing Board Member`  ← set, but the FE has no logic that turns a string match into a committee signal

**Two independent sources of truth and they disagree** — the detail page has no "Committee" indicator for someone the search clearly brands as one. Worse, the search's signal (`club_role` ∈ owner/admin/committee) is semantically wrong: `club_role` is a *CRM permission tier* (brief 39), not a committee seat. An admin who is paid to run the CRM but isn't on the committee gets the committee badge; a committee member whose `club_role` is still `player` doesn't.

### 4b. Fix

Two parts:

**4b.i.** Add a derived `is_committee` boolean to every roster row (`GET /clubs/{club_id}/members` + `GET /clubs/{club_id}/members/{user_id}`):

```jsonc
{
  "user_id": 1,
  "name":    "Nev Rodda",
  "club_role": "owner",
  "position_group": "board",
  "title":   "Playing Board Member",
  "is_committee": true,            // NEW
  …
}
```

Server rule — `is_committee = position_group IN ('board', 'committee')`. **Not** `club_role`-based. The permission tier is irrelevant: a volunteer committee member on the player tier is on the committee; a hired admin who runs the CRM but doesn't sit on the committee is not.

This gives the FE one field to key the badge off, and the two views agree by construction.

**4b.ii.** Backfill `position_group` for existing rows where the title clearly implies a seat:

```sql
UPDATE club_members
SET position_group = 'board'
WHERE position_group IS NULL
  AND (
    LOWER(title) LIKE '%president%'       OR
    LOWER(title) LIKE '%secretary%'       OR
    LOWER(title) LIKE '%treasurer%'       OR
    LOWER(title) LIKE '%board member%'    OR
    LOWER(title) LIKE '%club captain%'    OR
    LOWER(title) LIKE '%vice president%'
  );

UPDATE club_members
SET position_group = 'committee'
WHERE position_group IS NULL
  AND (
    LOWER(title) LIKE '%committee%'       OR
    LOWER(title) LIKE '%selector%'        OR
    LOWER(title) LIKE '%chair%'
  );

-- Everyone else defaults to 'member' (brief 35's default).
UPDATE club_members
SET position_group = 'member'
WHERE position_group IS NULL;
```

The specific pattern list is a starting point — ship the brief with it, flag any ambiguous rows in the migration log, and let the admin tune via the detail-page edit modal (`position_group` is already an editable field on `PATCH /members`).

For Nev specifically — his `title` is `"Playing Board Member"` → `position_group = 'board'` → `is_committee = true` → both the search badge and the Detail page's new `is_committee`-driven badge agree.

### 4c. Frontend contract summary (committee)

Extend `RosterMember` in `packages/api-client/src/resources/members.ts`:

```ts
export interface RosterMember {
  …
  /** Derived from position_group ∈ ('board','committee'). Lets the UI
   *  show a single "Committee" badge without re-implementing the rule
   *  per surface. */
  is_committee: boolean
  …
}
```

View updates:
- `MembersView.vue:165` — drop `roleMap` conflating `club_role` → `role: 'Committee'`. `roleBadge()` reads `r.is_committee` directly. The role picker in the add/edit modals still writes `club_role` (that's a different field with a different purpose).
- `MemberDetailView.vue:938` — under the Roster section, render a Committee row above `ROLE` when `member.is_committee` is true: *"Committee: Yes — Playing Board Member"*. Keep the raw `club_role` cap-styled below as today.
- Add a tiny badge next to the hero name block when `is_committee` so the detail page carries a visible marker (parity with the list).

### 4d. Error table (committee)

Nothing new — the field is additive. Existing `PATCH /members` codes for `position_group` are unchanged.

---

## 5. Prev / Next neighbors — server-side lookup

### 5a. The problem

`MemberDetailView.vue:80` fetches the first 200 roster rows on mount and derives prev/next from the local array:

```ts
const res = await membersApi.listRoster(cid, { limit: 200, include_invites: false })
roster.value = res.members
…
const memberIndex = computed(() => roster.value.findIndex((m) => m.user_id === currentId))
const prevMember  = computed(() => memberIndex.value <= 0 ? null : roster.value[memberIndex.value - 1])
const nextMember  = computed(() => memberIndex.value >= roster.value.length - 1 ? null : roster.value[memberIndex.value + 1])
```

Three failure modes:
- **Club with > 200 members** — rows 201+ aren't in `roster`. `findIndex` returns `-1`, both arrows disable, the position pill shows `-1 of 200` for a half-second then nothing. Admins land on a member via search and lose context about "where in the list am I".
- **Filtered views** — the admin filters to "Lapsed" in the Members page, taps into a row, then on the detail page the arrows walk the *unfiltered* 200 (we never pass the filter through). The next/prev order doesn't match the list the admin came from.
- **200-row fetch on every detail mount** is wasteful — we're pulling 200 members every time just to find two user ids.

### 5b. `GET /clubs/{club_id}/members/{user_id}/neighbors`

One tiny endpoint. Server computes the roster ordering (same `ORDER BY` as the roster list — brief 13 established `name ASC` as the default) with any filter params applied, then returns the ids on either side of `user_id`.

**Query params** — mirror the roster list so neighbor order matches whichever filter the admin was in when they tapped the row:

- `status` — same enum as `GET /members` (`all` | `active` | `prospect` | `visitor` | `pending` | `lapsed`). Default `all`.
- `role` — same as `GET /members` (null = any).
- `membership_type_id` — same comma-list / `'none'` sentinel as roster.
- `search` — same free-text match.
- `sort` — same enum (default `name_asc`).
- `include_invites` — same bool.

The server runs the same `WHERE` clause used by the roster list; no new ordering code.

**200 response:**

```jsonc
{
  "status": "success",
  "data": {
    "user_id":      88,
    "prev_user_id": 72,            // null when user_id is the first row under this filter
    "next_user_id": 142,           // null when user_id is the last row
    "index":        14,            // 0-based position in the filtered list; drives the "15 of 237" pill
    "total":        237            // total rows under the filter — the "237"
  }
}
```

**404** `user_not_on_club` when `user_id` isn't on this club. **404** `not_in_filter` when the user *is* on the club but falls outside the filter set (e.g. an `active` member when `status=lapsed` was passed) — the FE then re-queries without the filter so the arrows still work, trading filter-coherence for navigability.

### 5c. `GET /clubs/{club_id}/members/{user_id}` — single-member fetch

While we're here, the detail page's cold load should hit a dedicated endpoint, not the 200-row roster. Add:

```
GET /clubs/{club_id}/members/{user_id}
```

Response is the single `RosterMember` shape (brief 13), so no new DTO. 404 `user_not_on_club` on cross-club access.

Together with §5b, the detail page's mount drops from one 200-row list fetch to two tiny calls (`get` + `neighbors`), both <10 ms.

### 5d. Error table (neighbors)

| Status | code | When |
|---|---|---|
| `404` | `user_not_on_club` | `user_id` isn't on this club |
| `404` | `not_in_filter` | `user_id` is on the club but falls outside the current filter params. FE falls back to unfiltered. |
| `400` | `bad_sort` | `sort` isn't in the roster-list whitelist |

### 5e. Frontend contract summary (neighbors)

Extend `packages/api-client/src/resources/members.ts`:

```ts
export interface MemberNeighbors {
  user_id: number
  prev_user_id: number | null
  next_user_id: number | null
  index: number
  total: number
}

export async function get(
  clubId: number,
  userId: number,
): Promise<RosterMember>

export async function getNeighbors(
  clubId: number,
  userId: number,
  params?: { status?: MemberStatus | 'all'; role?: MemberRole | null; membership_type_id?: MembershipTypeFilter; search?: string; sort?: string; include_invites?: boolean },
): Promise<MemberNeighbors>
```

View updates:
- `MemberDetailView.vue:74` — replace `loadRoster()` with two calls: `members.get(clubId, memberId)` populates the hero + rail; `members.getNeighbors(clubId, memberId, filterSnapshot)` populates the arrows + "N of M" pill.
- `MembersView.vue` — stash the current filter params on `router.push({ name: 'member-detail', state: { filter } })` so the detail page passes the same filter into `getNeighbors`. Fall back to no filter when state is missing (direct link / refresh).

---

## 6. Verification (please attach outputs)

```bash
# ── 1. Notes
# Create a note
curl -X POST "$API/clubs/$CID/members/$UID/notes" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"kind":"call","body":"Followed up on sub."}'
# → 201, note_id returned, author.user_id = caller.

# List
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/notes?limit=5"
# → 200, notes[0] is the one above, counts.call >= 1.

# Edit
curl -X PATCH "$API/clubs/$CID/members/$UID/notes/$NID" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"body":"Followed up on sub — confirmed Fri."}'
# → 200, updated_at > created_at.

# Delete
curl -X DELETE -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/notes/$NID"
# → 204. The row is excluded from subsequent GET.

# Legacy PATCH-notes guardrail
curl -X PATCH "$API/clubs/$CID/members/$UID" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"notes":"a stale FE push"}'
# → 400 { code: "notes_moved" }

# ── 2. Payments
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/payments"
# → 200, every brief-55 payment surfaces with its season_name.

curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/payments?season_id=16"
# → 200, only 2025/26 Season rows.

# ── 3. Committee flag
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members?limit=5"
# → 200, every row has is_committee: true|false. Nev Rodda is true.

curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$NEV_UID"
# → 200, is_committee: true, position_group: 'board'.

# ── 4. Neighbors
# Unfiltered — walks the full roster
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/neighbors"
# → 200, prev_user_id + next_user_id resolved, index + total match the roster list.

# Filtered — walks only lapsed members
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID/neighbors?status=lapsed"
# → 404 { code: "not_in_filter" } when $UID is active, or 200 with lapsed-only neighbors when $UID is lapsed.

# Single member — cold-load endpoint
curl -H "Authorization: Bearer $T" "$API/clubs/$CID/members/$UID"
# → 200, single RosterMember shape (same as a roster-list row).
```

Pass criteria:
- ✓ Notes backfill runs cleanly — every pre-existing `members.notes` string shows up in the new feed, in original order.
- ✓ Two concurrent note writes don't overwrite each other — both end up as separate rows.
- ✓ Deleting a note soft-deletes it (row still in DB, not returned by GET).
- ✓ Author of a note can edit it even as a committee-tier (non-admin) user.
- ✓ `GET /members/{id}/payments` returns rows across every season Nev has paid in, not just the most recent.
- ✓ `totals.by_season` matches a hand-rolled `SUM(amount) GROUP BY season_id` for Nev.
- ✓ `is_committee` is `true` for every member whose `position_group` is `'board'` or `'committee'` and `false` otherwise. Immune to `club_role`.
- ✓ After backfill, Nev Rodda's detail page shows `POSITION GROUP: Board` (not empty) and the hero carries a Committee marker.
- ✓ `getNeighbors` on a 500-member club returns correct prev/next for members at rows 1, 200, 201, 350, and 500.
- ✓ `getNeighbors?status=lapsed` on a currently-active member returns 404 `not_in_filter` (FE falls back to unfiltered).
- ✓ `index` + `total` match a hand-rolled roster count under the same filter.

---

## 7. Non-goals (v1)

- **No notes activity feed on the Communications tab.** Brief 54 §10 flagged a future unified timeline (emails + calls + notes). This brief ships notes as its own tab; the merge is a follow-up once both resources are stable.
- **No note mentions / @-tags.** Plain-text body only. Markdown stays unparsed (modal already labels the field "Markdown supported" but server treats it as text).
- **No pin / unpin UI.** `pinned` is in the schema for future use; v1 ignores it.
- **No per-payment edit / delete endpoint.** Correcting a mis-attributed payment is still *delete + re-record* (brief 55 §5). The read endpoint added here doesn't change that.
- **No membership-type → payment reconciliation.** `membership.fee` on the payment row is a snapshot of what the tier charged at that moment. If the admin raised the fee in 2026/27, old 2025/26 payments still show their original fee — not retroactively bumped.
- **No committee-role workflow.** `position_group` stays editable via `PATCH /members` only. No "promote to committee" button, no term-end tracking, no elections. If a member leaves the committee the admin flips their `position_group` back to `'member'`.
- **No admin UI for notes bulk export.** NZ Privacy Act may require it eventually (member can request their file); not in scope here.
- **No cursor-based prev/next.** `getNeighbors` resolves ids each hop, not a persistent cursor through the roster. Simpler, and handles roster edits (someone added / removed between hops) gracefully.
- **No cross-page "go to row 237" jump.** `index` is read-only — admins still land on specific members via search / direct link, not row-number navigation.

---

## 8. Contact

Ping Felicity when §1 (notes) or §3 (payments) ships — each one is one FE PR (resource file + mount). §4 (committee flag) is a one-line add to the roster shape so can land in either sprint; §2 (communications) is strictly waiting on brief 54.
