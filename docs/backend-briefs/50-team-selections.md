# Team Selections — CRUD + Notify Endpoints for the CRM

**Feature:** the endpoints that back the CRM's Team Selections view (`/crm/teams`) — the workspace clubs use to pick teams for pennant / champ-of-champs / one-off fixtures. A selection has fixture metadata, one or more rinks, each rink's slots by position, and moves through draft → confirmed → sent (players notified) → played.

**Status:** frontend fully mocked. `apps/crm/src/views/teams/TeamsView.vue` renders a fake list; `apps/crm/src/views/teams/TeamEditorView.vue` renders a drag-and-drop editor against hardcoded rinks + a hardcoded pool of available members. No `packages/api-client` resource declared yet.

**Related briefs:**
- brief 12 (member add/edit) — this brief needs a small extension on the member record (see §2).
- brief 20 (event types) — `team_selection` is deliberately **not** an event type; selections are a separate concept with their own storage and lifecycle. But every selection references a fixture (competition + round + opponent + when), which could optionally be an existing event row (see §2.d).
- brief 29 (events CRUD) — same structural pattern (list/get/create/update/delete, soft-delete, `include_drafts` filter).
- brief 40 (notifications) — publishing a selection fans out player-facing notifications and (optionally) an email flavour.
- brief 45 / 46 (email templates + flavour overrides) — new `team_selection_published` flavour needed.

---

## TL;DR

1. **Six endpoints under `/clubs/:club_id/team-selections`** — list, get, create, update, delete, plus a dedicated `POST …/publish` that atomically transitions status + fans out notifications.
2. **Storage in three tables** — `team_selections`, `team_selection_rinks`, `team_selection_slots`. Rinks + slots normalised (not JSON) so we can query "who's played the last N fixtures?" for the pool ranking.
3. **Fixture reference is either free-text metadata or an optional FK to an `events` row** — clubs that already track pennant fixtures as events shouldn't have to duplicate them.
4. **Member enrichment for the pool** — add `preferred_position` and `playing_level` to the member record, plus a derived `last_played_at` computed from prior selections (no new column needed).
5. **Publish is idempotent** — once `sent`, further edits are blocked unless the owner explicitly reopens; a second publish is a no-op for players already notified.

---

## Base URL

`CRM_BASE`, Bearer JWT. Owner or admin on `club_members` (permission scope: `team_selections:manage` — mirror the `tournaments:manage` scope from brief 47 §12).

Player-facing read (a member seeing "you've been picked" on their own portal profile) is out of scope for v1 — the portal is deferred to phase 2. Notifications carry all the info a picked player needs for v1.

---

## 1. Data model

### `team_selections`
```
id                    bigserial pk
club_id               int not null references clubs(id) on delete cascade

-- Fixture metadata (denormalised so a selection reads standalone)
competition           text not null                       -- e.g. "Pennant Div 3"
round_label           text not null                       -- e.g. "Round 8" / "Semi-final" / "Final"
opponent              text not null                       -- freeform ("Petone A", "D. Peters (Naenae)")
venue                 text not null check (venue in ('home', 'away'))
starts_at             timestamptz not null                -- date + time of the fixture
format_label          text not null                       -- freeform ("Fours × 2", "Singles"). Not tied to tournaments.format.

-- Optional link to an existing event row
event_id              int null references events(id) on delete set null

-- Selection metadata
manager_note          text null                           -- freeform note surfaced on the list row and in notifications
green_closure_note    text null                           -- shown to picked players; usually blank

-- Lifecycle
status                text not null default 'draft' check (
                        status in ('draft', 'confirmed', 'sent', 'played', 'cancelled')
                      )
sent_at               timestamptz null                    -- set on transition to 'sent'
played_at             timestamptz null                    -- set when starts_at passes and someone (or a cron) flips it
cancelled_at          timestamptz null
cancelled_reason      text null

created_at            timestamptz not null default now()
created_by            int not null references users(id) on delete restrict
updated_at            timestamptz null
updated_by            int null references users(id) on delete set null
deleted_at            timestamptz null

index (club_id, starts_at desc) where deleted_at is null
index (club_id, status)          where deleted_at is null
```

### `team_selection_rinks`
```
id                    bigserial pk
selection_id          int not null references team_selections(id) on delete cascade
position              int not null                        -- 0-based ordering within the selection (Rink 1, Rink 2, …)
label                 text not null                       -- human label, defaults to "Rink N" on create
created_at            timestamptz not null default now()

unique (selection_id, position)
```

### `team_selection_slots`
```
id                    bigserial pk
rink_id               int not null references team_selection_rinks(id) on delete cascade
position              text not null check (position in ('Lead', 'Second', 'Third', 'Skip', 'Singles'))
slot_order            int not null                        -- order within the rink; server-set on create based on the position (Lead=0, Second=1, Third=2, Skip=3, Singles=0)
member_id             int null references users(id) on delete set null  -- null = unfilled

-- If a picked player has been notified but later dropped, we keep a
-- soft record so notify-on-change can send a "you've been swapped out"
-- message rather than the swap silently disappearing.
notified_member_id    int null references users(id) on delete set null
notified_at           timestamptz null

created_at            timestamptz not null default now()

unique (rink_id, position, slot_order)
```

**Migration on `members` (see §2):**

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_position TEXT
    CHECK (preferred_position IN ('Lead', 'Second', 'Third', 'Skip', 'Singles')),
  ADD COLUMN IF NOT EXISTS playing_level TEXT
    CHECK (playing_level IN ('A', 'B', 'C'));
```

Both nullable — legacy members without these values just render as "—" in the pool.

### Why normalised (not JSON on `team_selections`)

Two reasons:
- **Pool ranking.** The editor's pool sidebar wants to show `last_played` per member ("2d ago", "9d ago", "never"). Cheapest query: `SELECT MAX(ts.starts_at) FROM team_selection_slots s JOIN team_selection_rinks r … WHERE s.member_id = ? AND ts.status IN ('sent', 'played')`. With rinks/slots as JSON this becomes a table scan + JSON path expression on every pool render.
- **Notification fan-out on publish** needs a per-slot query anyway to know who's been picked and who was previously notified but dropped. Doing that against JSON is possible but ugly.

---

## 2. Extensions on other resources

### 2.a Member record — new fields

The pool needs `preferred_position` (Lead/Second/Third/Skip/Singles) and `playing_level` (A/B/C) on the member. Both editable in the CRM member edit modal.

- Add to the response of `GET /clubs/:club_id/members/roster` — the CRM already calls this to populate the pool.
- Add to `PATCH /clubs/:club_id/members/:user_id` request body.
- Both optional; `null` clears.

### 2.b `last_played_at` on the pool row

Not a stored column — a per-member derived value computed in the roster response.

```sql
SELECT u.id, …,
  (SELECT MAX(ts.starts_at)
     FROM team_selection_slots s
     JOIN team_selection_rinks r ON r.id = s.rink_id
     JOIN team_selections ts       ON ts.id = r.selection_id
    WHERE s.member_id = u.id
      AND ts.club_id  = :club_id
      AND ts.status IN ('sent', 'played')
      AND ts.deleted_at IS NULL) AS last_played_at
```

Added as `last_played_at` (nullable ISO) on the roster row. Cheap on modest data (a season is <100 selections × 4 rinks × 4 slots per club). If it becomes a hotspot, denormalise into a `users.last_selected_at` column maintained by a trigger on `team_selection_slots`.

### 2.c Optional `fixture_ref` back-link on `events`

Not strictly needed. If a selection has `event_id` set, the events endpoint (§3a of brief 29) could include a `has_team_selection: true` flag so the CRM's events list can show a "team picked" tag. Consider — flag as **out of scope for v1** unless we hear demand.

### 2.d Email flavour

Add `team_selection_published` to the `email_flavours` whitelist (brief 45 §1). Template variables:

- Existing: `club_*`, `recipient_*`, `year`.
- New for this flavour: `fixture_competition`, `fixture_round`, `fixture_opponent`, `fixture_venue` (`home`/`away`), `fixture_when` (formatted date+time), `player_position` (Lead/Second/Third/Skip/Singles), `player_rink` (Rink 1, Rink 2, …), `manager_note` (may be empty), `withdraw_url` (see §6).

### 2.e Notification kind

Add `team_selection` to the `NotificationKind` union (brief 40). Fires on publish, one per notified player.

---

## 3. Endpoints

### 3.a `GET /clubs/:club_id/team-selections`  (🔒 owner or admin)

List. Excludes soft-deleted. Default order: `starts_at DESC` for past, `starts_at ASC` for upcoming (see `scope` param).

**Query params:**

- `scope` — one of `upcoming` (default) or `past`. `upcoming` includes `draft`/`confirmed`/`sent` with `starts_at >= now()`; `past` includes `played`/`cancelled` OR anything with `starts_at < now()`.
- `status` — comma-separated statuses. Overrides `scope` when provided.
- `since` / `until` — ISO date range on `starts_at`.
- `include_drafts` — defaults `true` (managers usually want their own drafts). `false` for `sent` + `played` only.
- `limit` — 1..100, default 50.
- `offset` — pagination.

**200:**

```json
{
  "status": "success",
  "data": {
    "selections": [
      {
        "id": 12,
        "competition": "Pennant Div 3",
        "round_label": "Round 8",
        "opponent": "Petone A",
        "venue": "home",
        "starts_at": "2026-08-23T00:30:00Z",
        "format_label": "Fours × 2",
        "event_id": null,
        "manager_note": null,
        "status": "draft",
        "sent_at": null,
        "played_at": null,
        "confirmed_count": 4,
        "total_slots": 8,
        "created_at": "2026-08-18T10:00:00Z",
        "updated_at": "2026-08-20T14:12:00Z"
      }
    ],
    "count": 1,
    "total": 5
  }
}
```

`confirmed_count` = slots with `member_id IS NOT NULL`. `total_slots` = total slot rows on the selection. Both computed server-side so the list row can render the fill bar without fetching the full selection.

### 3.b `GET /clubs/:club_id/team-selections/:id`  (🔒 owner or admin)

Single selection, expanded with rinks + slots + resolved member snapshots.

**200:**

```json
{
  "status": "success",
  "data": {
    "selection": {
      "id": 12,
      "competition": "Pennant Div 3",
      "round_label": "Round 8",
      "opponent": "Petone A",
      "venue": "home",
      "starts_at": "2026-08-23T00:30:00Z",
      "format_label": "Fours × 2",
      "event_id": null,
      "manager_note": null,
      "green_closure_note": null,
      "status": "draft",
      "sent_at": null,
      "played_at": null,
      "cancelled_at": null,
      "cancelled_reason": null,
      "confirmed_count": 4,
      "total_slots": 8,
      "rinks": [
        {
          "id": 34,
          "position": 0,
          "label": "Rink 1",
          "slots": [
            { "id": 101, "position": "Lead",   "slot_order": 0, "member": { "user_id": 2, "name": "Denise Peters",   "preferred_position": "Lead",   "playing_level": "A", "last_played_at": "2026-08-16T00:30:00Z" }, "notified_member_id": null, "notified_at": null },
            { "id": 102, "position": "Second", "slot_order": 1, "member": { "user_id": 5, "name": "Sione Vagana",    "preferred_position": "Second", "playing_level": "B", "last_played_at": "2026-08-16T00:30:00Z" }, "notified_member_id": null, "notified_at": null },
            { "id": 103, "position": "Third",  "slot_order": 2, "member": { "user_id": 3, "name": "Reggie Marcs",    "preferred_position": "Third",  "playing_level": "A", "last_played_at": "2026-08-09T00:30:00Z" }, "notified_member_id": null, "notified_at": null },
            { "id": 104, "position": "Skip",   "slot_order": 3, "member": { "user_id": 1, "name": "Marcus Tuilagi",  "preferred_position": "Skip",   "playing_level": "A", "last_played_at": "2026-08-16T00:30:00Z" }, "notified_member_id": null, "notified_at": null }
          ]
        },
        {
          "id": 35,
          "position": 1,
          "label": "Rink 2",
          "slots": [
            { "id": 105, "position": "Lead",   "slot_order": 0, "member": null, "notified_member_id": null, "notified_at": null },
            { "id": 106, "position": "Second", "slot_order": 1, "member": null, "notified_member_id": null, "notified_at": null },
            { "id": 107, "position": "Third",  "slot_order": 2, "member": null, "notified_member_id": null, "notified_at": null },
            { "id": 108, "position": "Skip",   "slot_order": 3, "member": null, "notified_member_id": null, "notified_at": null }
          ]
        }
      ],
      "created_at": "2026-08-18T10:00:00Z",
      "updated_at": "2026-08-20T14:12:00Z"
    }
  }
}
```

`member` on a slot is either `null` or a minimal member snapshot (`user_id`, `name`, `preferred_position`, `playing_level`, `last_played_at`, `avatar_url` if we ship avatars later). Frontend never needs to hit the members endpoint separately for the editor.

**Errors:** `404 not_found`, `403 forbidden`, `401 unauthorized`.

### 3.c `POST /clubs/:club_id/team-selections`  (🔒 owner or admin)

Create. Rinks + slots are seeded server-side from `format_shape` (see below) so the editor lands with the right slot structure ready to fill.

**Body:**

```json
{
  "competition": "Pennant Div 3",
  "round_label": "Round 8",
  "opponent": "Petone A",
  "venue": "home",
  "starts_at": "2026-08-23T00:30:00Z",
  "format_label": "Fours × 2",
  "format_shape": { "positions": ["Lead", "Second", "Third", "Skip"], "rink_count": 2 },
  "event_id": null,
  "manager_note": null,
  "green_closure_note": null
}
```

- `competition`, `round_label`, `opponent`: required, 1..80 chars each.
- `venue`: required, `home` | `away`.
- `starts_at`: required ISO. Must be in the future (400 `starts_in_past`). Admins can override via `?force=1`.
- `format_label`: required, 1..40 chars — display-only.
- `format_shape`: required. Drives initial rink/slot seeding.
  - `positions`: required, 1..4 items from `Lead|Second|Third|Skip|Singles`. Frontend passes `['Singles']` for singles, `['Skip','Lead']` for pairs, etc.
  - `rink_count`: required, 1..8.
  - Backend creates `rink_count` rinks, each with one slot per `position`, ordered by `slot_order` (Lead=0, Second=1, Third=2, Skip=3, Singles=0).
- `event_id`: optional. If set, backend enforces it's a `club_id` match (403 `cross_club_event`).
- `manager_note`, `green_closure_note`: optional, ≤ 500 chars.

**201:** created selection (same shape as `GET :id`, all slots unfilled).

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Missing / bad JSON | 400 | `bad_json` |
| Missing required field | 400 | `missing_<field>` |
| Bad `venue` value | 400 | `bad_venue` |
| Bad ISO in `starts_at` | 400 | `bad_starts_at` |
| `starts_at < now()` without `?force=1` | 400 | `starts_in_past` |
| `format_shape.positions` invalid | 400 | `bad_positions` |
| `format_shape.rink_count` out of range | 400 | `bad_rink_count` |
| `event_id` from another club | 403 | `cross_club_event` |
| Not owner/admin | 403 | `forbidden` |

### 3.d `PATCH /clubs/:club_id/team-selections/:id`  (🔒 owner or admin)

Update fixture metadata OR the roster. Split into two shapes on the same endpoint so the CRM can send only what changed — server discriminates on presence of `rinks` in the body.

**Fixture-only PATCH body:** any subset of

```json
{
  "competition": "…", "round_label": "…", "opponent": "…",
  "venue": "away", "starts_at": "…", "format_label": "…",
  "event_id": 42, "manager_note": "…", "green_closure_note": "…"
}
```

**Roster PATCH body:**

```json
{
  "rinks": [
    {
      "id": 34,
      "label": "Rink 1",
      "position": 0,
      "slots": [
        { "id": 101, "member_id": 2 },
        { "id": 102, "member_id": 5 },
        { "id": 103, "member_id": 3 },
        { "id": 104, "member_id": 1 }
      ]
    },
    {
      "id": 35,
      "label": "Rink 2",
      "position": 1,
      "slots": [
        { "id": 105, "member_id": null },
        { "id": 106, "member_id": null },
        { "id": 107, "member_id": null },
        { "id": 108, "member_id": null }
      ]
    }
  ]
}
```

Rules:
- Rinks + slots are addressed by `id` — no in-place slot swap; the client sends the full desired state for the rinks it's touching.
- Adding a rink: include an entry **without** `id`; backend inserts and returns the new id.
- Removing a rink: send the payload without the rink; backend deletes rinks not present in the incoming array (and their slots via cascade).
- `slots[].member_id: null` clears a slot.
- `slots[].member_id: N` enforces N is a member of this club (403 `cross_club_member`); duplicates within the same selection are allowed (a player *could* be double-booked across rinks) but return `409 duplicate_member` with `{ member_id, other_slot_ids }` unless `?allow_duplicate=1`.
- Once `status = 'sent'`, roster edits are refused (409 `selection_sent`). Owner must call `POST …/reopen` first (see 3.g).

**200:** updated selection (full expanded shape).

### 3.e `DELETE /clubs/:club_id/team-selections/:id`  (🔒 owner or admin)

Soft-delete. **204 No Content.** Cascades on rinks + slots. If `status = 'sent'`, backend also fires `team_selection` notifications with `kind: 'cancelled'` to picked players (piggyback on the same flavour with a different template subject line — see §5).

Sweeper hard-deletes after 30 days.

### 3.f `POST /clubs/:club_id/team-selections/:id/publish`  (🔒 owner or admin)

Atomic transition to `sent` + notification fan-out.

**Body:**

```json
{
  "message": "Weather looks perfect — first bowl at 12:30 sharp."
}
```

- `message`: optional, ≤ 500 chars. Prepended to the notification body as a manager note override (falls back to `manager_note` on the selection if omitted).

Server steps (in one transaction where possible):
1. Verify status is `draft` or `confirmed`; else 409 `bad_status`.
2. Verify every rink has at least one filled slot; else 409 `empty_rink` with `{ rink_ids: [...] }`.
3. For each filled slot where `notified_member_id != member_id` (or `notified_member_id IS NULL`):
   - Enqueue a `team_selection` notification for the new `member_id`.
   - If `notified_member_id IS NOT NULL AND notified_member_id != member_id`, enqueue a `team_selection` notification for the old member with `kind: 'dropped'`.
   - Set `notified_member_id = member_id`, `notified_at = now()`.
4. For each slot where `member_id IS NULL AND notified_member_id IS NOT NULL` (a previously-picked player dropped, no replacement):
   - Enqueue `team_selection` notification for the old member with `kind: 'dropped'`.
   - Set `notified_member_id = NULL`, `notified_at = now()`.
5. `UPDATE team_selections SET status='sent', sent_at=now()` (if not already `sent`).
6. Fire the `team_selection_published` email flavour for each newly-notified player (respects `email_flavour_overrides` per club).

**200:** the full updated selection with a summary block:

```json
{
  "status": "success",
  "data": {
    "selection": { … },
    "notify_summary": {
      "picked": 8,
      "dropped": 0,
      "already_notified": 0
    }
  }
}
```

Idempotent: calling `publish` twice with no roster changes → all zeros in `notify_summary`, status stays `sent`.

### 3.g `POST /clubs/:club_id/team-selections/:id/reopen`  (🔒 owner or admin)

Transition `sent` → `confirmed`. Does **not** un-notify anyone; the picked players still have their notification. The next `publish` will diff current roster against `notified_member_id` and fire "dropped" / "you're in" messages as appropriate (see 3.f step 3).

**Body:** empty.

**200:** updated selection.

**Errors:** `409 bad_status` if status isn't `sent`.

### 3.h `POST /clubs/:club_id/team-selections/:id/cancel`  (🔒 owner or admin)

Transition to `cancelled`. Fires cancellation notifications to every `notified_member_id`.

**Body:**

```json
{ "reason": "Green closed — waterlogged." }
```

- `reason`: required, 1..500 chars. Included in the notification and email body.

**200:** updated selection with `notify_summary`.

### 3.i Optional: `POST /clubs/:club_id/team-selections/:id/mark-played`  (🔒 owner or admin)

Manual transition to `played`. Only needed if we don't ship the cron in §7. Empty body, 200 with updated selection.

---

## 4. Response conventions

Standard envelope (`{ status, data }`) matching brief 29. Slot ids are numeric. Snake_case throughout.

---

## 5. Notifications payload

`team_selection` notification kind. Per brief 40's shape:

```json
{
  "id": 987,
  "kind": "team_selection",
  "created_at": "…",
  "read_at": null,
  "data": {
    "selection_id": 12,
    "sub_kind": "picked",  // or "dropped" or "cancelled" or "changed"
    "competition": "Pennant Div 3",
    "round_label": "Round 8",
    "opponent": "Petone A",
    "venue": "home",
    "starts_at": "2026-08-23T00:30:00Z",
    "player_position": "Skip",   // "picked" only
    "player_rink": "Rink 1",     // "picked" only
    "manager_note": "Weather looks perfect."
  }
}
```

Email flavour subject templates:

- `picked` → `You're in — {{club_name}} vs {{fixture_opponent}}`
- `dropped` → `Change of plans — {{club_name}} vs {{fixture_opponent}}`
- `cancelled` → `Fixture cancelled — {{club_name}} vs {{fixture_opponent}}`

Body defaults live in `email_templates` seed data and clubs can override per brief 46.

---

## 6. Withdraw link (`{{withdraw_url}}`)

Emailed players get a one-click "I can't make it" URL that hits an un-authed endpoint:

- `GET /public/team-selections/withdraw?token=…` — decodes a signed token containing `{ selection_id, user_id, exp }`, sets `slots.member_id = NULL` for that user on that selection, enqueues a `team_selection` notification (`sub_kind: 'withdrawn'`) to the club owner + manager, returns a simple confirmation page.

Sign with the same HMAC secret used for unsubscribe links (brief 45 §6). Token expires 7 days after `starts_at`.

Withdraw does **not** flip the selection back to `confirmed` — it just empties one slot. The manager sees the change in the CRM and re-publishes when they've filled it.

---

## 7. Auto-transition to `played`

Optional but recommended: nightly cron flips `status = 'sent'` selections where `starts_at < now() - INTERVAL '4 hours'` to `status = 'played'` and stamps `played_at`. Prevents the CRM's "upcoming" list from carrying yesterday's fixtures.

If we skip the cron for v1, ship 3.i (`mark-played`) instead.

---

## 8. Auth / scopes

Mirror the tournaments brief (47 §12). New scope: `team_selections:manage`. Owner + admin get it by default; committee gets it as a config toggle later.

Cross-cutting scopes:

| Operation | Owner | Admin | Committee | Player |
|-----------|:-----:|:-----:|:---------:|:------:|
| List / get | ✅ | ✅ | ✅ (own club, `include_drafts=false`) | ❌ v1 |
| Create / update / delete | ✅ | ✅ | ❌ v1 | ❌ |
| Publish / cancel / reopen | ✅ | ✅ | ❌ v1 | ❌ |
| Withdraw self via signed link | — | — | — | ✅ |

Committee read access is optional — flag if the frontend needs it.

---

## 9. What the CRM will do once this ships

- `TeamsView.vue` swaps its mocked list for `GET /clubs/:id/team-selections?scope=upcoming` and `?scope=past`.
- `TeamEditorView.vue` fetches `GET /clubs/:id/team-selections/:id`, renders rinks + slots from the response, and the pool sidebar from the enriched roster (§2).
- Drag-drop sends a debounced roster `PATCH` (~800ms after the last change) so drafts autosave; explicit "Publish + notify" hits `POST …/publish` with an optional manager note; "Save draft" is just a manual save that mirrors the debounced PATCH.
- Cancel is a menu item on the header when `status in ('confirmed','sent')`; reopen on the same menu when `status = 'sent'`.

---

## 10. Out of scope for this brief

- Player-facing "my picks" surface (portal is phase 2).
- Rich "swap" workflow with reasons — swap is currently just "clear old slot, fill new slot".
- Cross-club fixture linking (both clubs' CRMs picking teams against the same event row). Discuss when we have two-club data.
- Any kind of stats aggregation (win/loss, points scored). Post-match card is a future brief.
- iCal / calendar export for picked players.

---

## 11. Open questions for backend

1. **`event_id` linking** — is it worth wiring even without the reverse `has_team_selection` flag on events? Or drop it for v1 and add later? *(recommendation: keep the column; skip the reverse flag.)*
2. **`played_at` cron vs manual endpoint** — do we already have a scheduler for the tournaments lifecycle transitions? If yes, piggyback. If no, ship the manual endpoint and add the cron in a follow-up.
3. **Duplicate members across rinks** — is `?allow_duplicate=1` overkill? Alternative: silent 409 with the frontend showing a "player already picked" toast and letting the manager decide. *(recommendation: strict-by-default with the override flag — matches the existing pattern on `cross_club_host`.)*
4. **`preferred_position` + `playing_level`** — do we want these free-text or enum? Enum is simpler for the pool filter UX; free-text is more flexible but doesn't give us grouped filtering. *(recommendation: enum as spec'd above.)*
