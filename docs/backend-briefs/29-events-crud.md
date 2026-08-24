# Events — CRUD Endpoints for the CRM

**Feature:** the five endpoints that back the CRM's Events view (`/crm/events`) + the enrichment the new `WhatsOnBlock` needs on `/public/clubs/:slug/site.events_upcoming`. Clubs can list, create, update, and delete events; the public site surfaces the highlights.

**Related:** brief 20 (event types — already shipped, adds `event_type` + nullable `format`), `packages/api-client/src/resources/events.ts` (declared on the old `TornyClient` pattern, not wired), `apps/crm/src/views/events/EventsView.vue` (currently mocked), brief 28 (honour-board CRUD — same structural pattern).

**Status:** requested — CRM ships a fully-mocked Events view + a public block that reads from `site.events_upcoming`. api-client declares the resource but the CRM never calls it.

---

## TL;DR

1. **Five endpoints under `/clubs/:club_id/events`** — list, get, create, update, delete. Slug is server-generated from title on create.
2. **`event_type` filter + `since` / `until` range** on the list endpoint so the CRM can build "Upcoming" / "Past" / "This month" tabs cheaply.
3. **`/public/clubs/:slug/site.events_upcoming`** gains optional aggregate fields the new `WhatsOnBlock` uses: `rsvp_going_count`, `rsvp_maybe_count`, `capacity`, `host_name`, plus a small `rsvp_going_preview` array of up-to-3 members for the avatar stack.
4. **Auth:** owner or admin for mutations; anyone reads via `/site`.
5. **RSVP submission is out of scope** — this brief covers events themselves. A separate brief handles member RSVPs (create/update/list) once we ship member-facing UX.

---

## Base URL

`CRM_BASE`, Bearer JWT. `/public/clubs/:slug/site` stays public.

---

## 1. Data model

Existing `events` table (per brief 20's migration + the pre-existing shape):

```
events
  id                bigserial pk
  club_id           int not null references clubs(id) on delete cascade
  slug              text not null                       -- kebab-case, unique per club
  title             text not null
  description       text null
  event_type        text not null default 'tournament'  -- brief 20 whitelist
  format            text null                           -- required when event_type = 'tournament'
  starts_at         timestamptz not null
  ends_at           timestamptz not null
  location          text null
  host_id           int null references users(id) on delete set null
  host_name         text null                           -- redundant when host_id set; freeform otherwise
  capacity          int null                            -- soft cap; RSVPs beyond fall into "waitlist" state
  is_published      boolean not null default true       -- draft/published toggle
  rsvp_open         boolean not null default true
  created_at        timestamptz not null default now()
  updated_at        timestamptz
  deleted_at        timestamptz
  unique (club_id, slug) where deleted_at is null
  index (club_id, starts_at) where deleted_at is null
  index (club_id, event_type, starts_at) where deleted_at is null
```

**Migration needed** — only if any of `host_id`, `host_name`, `capacity`, `is_published` aren't present:

```sql
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS host_id      INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS host_name    TEXT,
  ADD COLUMN IF NOT EXISTS capacity     INT,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;
```

**Aggregate columns / joins for the response** — see §3a. Backend can either compute `rsvp_going_count` on read (JOIN with the RSVPs table) or maintain a counter column (`rsvp_going_count`, `rsvp_maybe_count`) updated by RSVP mutation triggers. Recommend joining on read for MVP — 12 events × one aggregate is cheap.

---

## 2. Slug rules

- Kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..64 chars.
- Backend generates from title on create (like brief 27's page slugs). Collision → append `-2`, `-3`, etc.
- Slug is stable across renames — clients don't get to change it. If they need a different URL, they delete + recreate.
- Reserved: none — events live under `/events/:slug` on the public site, which doesn't collide with anything.

---

## 3. Endpoints

### 3a. `GET /clubs/:club_id/events`  (🔒 owner or admin)

List events. Excludes soft-deleted. Default order: `starts_at ASC` for upcoming, `starts_at DESC` for past.

**Query params:**

- `type` — comma-separated `EventType` values (brief 20). E.g. `?type=tournament,social`. Omit for all.
- `since` — ISO date. Only include events with `starts_at >= since`. Omit = all past.
- `until` — ISO date. Only include events with `starts_at < until`. Omit = all future.
- `include_drafts` — `true` shows both published + drafts (owner default). Omit or `false` = published only.
- `limit` — 1..100, default 50.
- `offset` — pagination.

**200:**

```json
{
  "status": "success",
  "data": {
    "events": [
      {
        "id": 42,
        "slug": "twilight-roll-up-2026-09-18",
        "title": "Twilight roll-up",
        "description": "Bring anyone — members, non-members, kids…",
        "event_type": "social",
        "format": null,
        "starts_at": "2026-09-18T17:30:00Z",
        "ends_at":   "2026-09-18T20:30:00Z",
        "location": "Green A",
        "host_id": 42,
        "host_name": "Sione Vagana",
        "capacity": 20,
        "is_published": true,
        "rsvp_open": true,
        "rsvp_going_count": 9,
        "rsvp_maybe_count": 3,
        "rsvp_going_preview": [
          { "initials": "GW", "avatar_url": null },
          { "initials": "NU", "avatar_url": null },
          { "initials": "SV", "avatar_url": "https://…" }
        ],
        "created_at": "2026-08-20T10:00:00Z",
        "updated_at": null
      }
    ],
    "count": 1,
    "total": 12
  }
}
```

`count` is the number of rows in this response, `total` is the pre-limit filtered total (so the CRM can render "12 events" without a second call).

### 3b. `GET /clubs/:club_id/events/:event_slug`  (🔒 owner or admin)

Single event. Same shape as list rows, wrapped in `data.event`. Useful when the CRM opens an event edit modal deep-linked from a URL.

**Errors:** `404 not_found`, `403 forbidden`, `401 unauthorized`.

### 3c. `POST /clubs/:club_id/events`  (🔒 owner or admin)

Create.

**Body:**

```json
{
  "title": "Twilight roll-up",
  "description": "Bring anyone.",
  "event_type": "social",
  "format": null,
  "starts_at": "2026-09-18T17:30:00Z",
  "ends_at":   "2026-09-18T20:30:00Z",
  "location": "Green A",
  "host_id": 42,
  "host_name": "Sione Vagana",
  "capacity": 20,
  "is_published": true,
  "rsvp_open": true
}
```

- `title`: required, 1..120 chars. Slug generated server-side.
- `event_type`: required, one of brief 20's whitelist.
- `format`: required when `event_type = 'tournament'`, otherwise ignored/null. Brief 20 enforces this via a CHECK constraint.
- `starts_at` / `ends_at`: required ISO. `ends_at >= starts_at` (400 `bad_range` otherwise).
- `location`: optional, ≤ 200 chars.
- `host_id`: optional. If set, backend enforces it's a member of the same club (403 `cross_club_host`).
- `host_name`: optional. Free text; required if `host_id` is null AND you want a host displayed.
- `capacity`: optional non-negative integer. `null` means uncapped.
- `is_published`: optional, defaults `true` (owner intent is usually to publish immediately).
- `rsvp_open`: optional, defaults `true`.

**201:** created row (same shape as list, with `rsvp_going_count: 0`).

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Missing / bad JSON | 400 | `bad_json` |
| Title empty / > 120 | 400 | `bad_title` |
| Unknown `event_type` | 400 | `invalid_event_type` |
| Tournament without `format` | 400 | `format_required` |
| `ends_at < starts_at` | 400 | `bad_range` |
| `host_id` not in club | 403 | `cross_club_host` |
| Not owner/admin | 403 | `forbidden` |

### 3d. `PATCH /clubs/:club_id/events/:event_slug`  (🔒 owner or admin)

Same body as POST, all fields optional. Fields omitted are left alone; `null` clears (where nullable). Slug is not editable via this endpoint — see §2.

**200:** updated row.

### 3e. `DELETE /clubs/:club_id/events/:event_slug`  (🔒 owner or admin)

Soft-delete. **204 No Content.** Sweeper hard-deletes after 30 days. Cascades to associated RSVPs (also soft-deleted or kept for audit — backend's call).

---

## 4. `/public/clubs/:slug/site` — the `events_upcoming` shape

Extend the existing array with the fields the `WhatsOnBlock` renders:

```json
"events_upcoming": [
  {
    "id": 42,
    "slug": "twilight-roll-up-2026-09-18",
    "title": "Twilight roll-up",
    "excerpt": "5:30 PM · Green A · Social",
    "event_type": "social",
    "format": null,
    "starts_at": "2026-09-18T17:30:00Z",
    "ends_at":   "2026-09-18T20:30:00Z",
    "location": "Green A",
    "host_name": "Sione Vagana",
    "capacity": 20,
    "rsvp_going_count": 9,
    "rsvp_maybe_count": 3,
    "rsvp_going_preview": [
      { "initials": "GW", "avatar_url": null },
      { "initials": "NU", "avatar_url": null },
      { "initials": "SV", "avatar_url": "https://…" }
    ]
  }
]
```

**Additions vs today:**
- `event_type` (per brief 20 — already there in principle, confirm it's actually emitted).
- `host_name` — nullable string.
- `capacity` — nullable int.
- `rsvp_going_count`, `rsvp_maybe_count` — non-negative ints, default `0`.
- `rsvp_going_preview` — array of up to 3 preview members `{ initials, avatar_url }`.

**Filter:** `is_published = true`, `starts_at >= now()`, `rsvp_open` = anything. Capped at **20 entries** total — the block only shows 4 anyway; extras give the public `/events` page enough for a first paint.

**Sort:** `starts_at ASC`.

**No `?type=` on the public payload** — the block filters client-side. Same rationale as brief 28 on honour-board.

---

## 5. Auth + tenancy

- Read (`GET /site`): public, no auth.
- Read (CRM list + get): owner or admin.
- Write: owner or admin.
- All queries scope by `club_id` — even if a URL is guessed cross-tenant, backend returns 404.

`403 forbidden` when the JWT is valid but not authorised. `401 unauthorized` when missing/invalid.

---

## 6. Migration + rollout

1. **Migration 094** — add missing columns per §1 (`host_id`, `host_name`, `capacity`, `is_published`, `deleted_at`).
2. **Ship the five CRM endpoints in §3.**
3. **Extend `/site.events_upcoming` shape** with the new fields (§4). `rsvp_going_preview` derived from a JOIN with the RSVPs table + a LIMIT 3.
4. **Fire the Nuxt revalidate webhook** on event create / update / delete + on RSVP mutation (`purge: "all"` or `path: "/events"` — event-level path purge is fine because the block appears on `/` and `/events`).
5. **Regression test:** the current `/site` payload keeps working for clubs with no events (empty array).

---

## 7. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/events.ts`** — rewrite to match the `authedFetch` pattern (like `pages`, `stylePresets`, `blockImages`). Add `list(clubId, params?)`, `get(clubId, slug)`, `create(clubId, input)`, `update(clubId, slug, patch)`, `remove(clubId, slug)`. Retire the old `TornyClient` calls.
- **CRM `EventsView.vue`** — replace mock local state with a real Pinia store fetching events on mount. Wire the `+ New event` modal + row edit + delete + publish/unpublish toggle. Filter tabs (`Upcoming` / `Past`) use `since` / `until`. Type-chip filter uses `?type=` server-side.
- **`WhatsOnBlock` on the public site** already renders `event_type` tag colors + RSVP avatar stacks; it just needs the shape to be populated by the backend.
- **BlockContext.events** in `@torny/content-blocks/src/types.ts` grows optional `event_type`, `host_name`, `capacity`, `rsvp_going_count`, `rsvp_maybe_count`, `rsvp_going_preview` fields. All optional so existing consumers don't break.

---

## 8. Non-goals

- **No RSVP submission endpoints in this brief.** Members RSVPing to events is a separate concern with its own auth model (public users may need to RSVP without a full club account). Ship this brief first; RSVP submission gets its own brief when the member-facing UX lands.
- **No recurring events.** Every event is a single row. Owners duplicate for weekly twilights.
- **No calendar-feed / iCal export.** The `Add to my calendar` button in the design is a client-side .ics generation for MVP.
- **No ticketing.** `Ticketed` badge in the design is a display hint owners set via `notes` (out of scope — could be a formal field later).
- **No per-event photo/hero image.** The block renders a colored date chip + type tag; no image slot. Add later if needed.
- **No draft-mode preview URLs.** `is_published: false` events are only visible in the CRM.

---

## 9. Open questions

1. **`rsvp_going_preview` — who gets picked** for the 3 avatars? Recommend: most recent RSVPs (ORDER BY `rsvp_at DESC LIMIT 3`). Alternative: club owners / officers first. Owner-team call.
2. **Do we surface `waitlist_count`** when RSVPs exceed capacity? Not needed for MVP display but cheap to include — recommend yes, `rsvp_waitlist_count` next to going/maybe.
3. **Should `POST` accept an explicit `slug`?** Brief 27 lets pages have client-chosen slugs. Events are similar — clubs might want `champions-night-2026` verbatim. Recommend: optional `slug` in POST body, backend validates + falls back to auto-generated. Cheap and useful for known-recurring events.
4. **Cache TTL for `/site.events_upcoming`** — right now `nuxt.config.ts` sets `swr: 60` on `/events/**`. Event mutation should purge that in addition to `/`. Confirm the revalidate webhook already covers this.
5. **Timezone canonicalisation** — all timestamps stored as UTC + displayed in the club's timezone. `starts_at` / `ends_at` are ISO with `Z` suffix on the wire. Confirm no clubs need per-event override.

---

## 10. Contact

`#torny-eng`. Ping if the RSVP counter approach needs discussion (JOIN on read vs counter columns) or if you want to bundle the RSVP submission endpoint into this brief.
