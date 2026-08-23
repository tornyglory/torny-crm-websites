# Events — Support Non-Tournament Event Types

**Feature:** extend the `events` table + `/events` endpoints + public site payload so clubs can post events that aren't tournaments — socials, meetings, coaching sessions, working bees, presentation nights, fundraisers, function hires. Today the schema treats every event as a competitive tournament with a bowls format; that's forcing the CRM to hack "social" into the `format` enum, which conflates two orthogonal concepts.

**Status:** requested — CRM has mocked the shape locally with a `type` field on the frontend and hidden the format picker for non-tournament events, but the API-client `Event` type + backend schema still only know about `format`.

**Related:** `apps/crm/src/views/events/EventsView.vue`, `packages/api-client/src/resources/events.ts`, `packages/content-blocks/src/blocks/EventListBlock.vue`, `packages/api-client/src/types.ts`.

---

## TL;DR

1. Add an `event_type` column to `events` with a fixed whitelist of 9 values (default `'tournament'` for backwards compat).
2. Make `format` (`singles | pairs | triples | fours | other`) **optional** — only meaningful when `event_type = 'tournament'`. Backend accepts `null` for non-tournament events.
3. Update the four CRUD endpoints (`GET /events`, `GET /events/:id`, `POST /events`, `PATCH /events/:id`) to read + write `event_type`.
4. Update the public site payload (`GET /public/clubs/:slug/site`, `events_upcoming`) to include `event_type` on every event object.
5. Add a `?type=` query param to `GET /events` for filtering (multi-value comma-separated, e.g. `?type=tournament,social`).
6. Migration backfills all existing rows with `event_type = 'tournament'`.

---

## Base URL

`CRM_BASE` — same as all other CRM endpoints. Bearer JWT, owner or admin for mutations. `/public/clubs/:slug/site` remains public.

---

## 1. Event type whitelist

Nine values. Frontend picks these because they cover every event a bowls club actually runs — anything else can go under `other`.

| Type | Frontend label | Example |
|------|----------------|---------|
| `tournament` | Tournament | Champion of Champions, Ladies Open Fours, pennant |
| `social` | Social | Sunday roll-up, twilight social, BYO bowls |
| `meeting` | Meeting | AGM, committee, selection meeting |
| `coaching` | Coaching | Junior coaching, learn-to-bowl clinics |
| `working-bee` | Working bee | Green maintenance, clubhouse working bees |
| `presentation` | Presentation | Prize giving, championship dinners, awards nights |
| `fundraiser` | Fundraiser | Quiz nights, raffles, sponsor evenings |
| `function` | Function | Private hire, weddings, external corporate |
| `other` | Other | Anything that doesn't fit above |

Store as `TEXT` with a `CHECK` constraint. Enum type is fine if you prefer; we've been leaning towards text + check to avoid the migration cost of adding future values.

---

## 2. Schema change

### Migration

Number: whatever follows the current head (roughly 090 based on brief 18 landing as 089).

```sql
-- 1. Add event_type column with tournament as the default so existing rows
--    continue to behave exactly as they do today.
ALTER TABLE events
  ADD COLUMN event_type TEXT NOT NULL DEFAULT 'tournament';

-- 2. Constrain to the whitelist.
ALTER TABLE events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN (
    'tournament', 'social', 'meeting', 'coaching', 'working-bee',
    'presentation', 'fundraiser', 'function', 'other'
  ));

-- 3. Make format nullable — non-tournament events don't have a bowls format.
ALTER TABLE events
  ALTER COLUMN format DROP NOT NULL;

-- 4. Enforce that tournaments still have a format.
ALTER TABLE events
  ADD CONSTRAINT events_format_required_for_tournaments
  CHECK (event_type <> 'tournament' OR format IS NOT NULL);

-- 5. Index for the /events?type= filter.
CREATE INDEX events_club_type_starts_at
  ON events (club_id, event_type, starts_at);
```

**No data backfill needed** beyond the `DEFAULT 'tournament'` — every existing row was a tournament in intent.

**Rollback:** drop the constraints + column + index; no data loss because all existing formats are preserved.

---

## 3. API contract changes

### 3a. `GET /clubs/:clubId/events`

**New:** `type` query param — comma-separated list of valid event types. `?type=tournament,social` returns only tournaments and socials. Omitted = all types.

**Response shape** — every `data.events[i]` now includes `event_type`. `format` is either the bowls format string or `null` for non-tournaments.

```json
{
  "id": 42,
  "clubId": 3,
  "slug": "champion-of-champions-r1",
  "title": "Champion of Champions — Round 1",
  "description": "…",
  "event_type": "tournament",
  "format": "singles",
  "starts_at": "2026-08-22T09:00:00Z",
  "ends_at":   "2026-08-22T13:00:00Z",
  "location": "Green 1",
  "rsvp_open": true
}
```

vs a social:

```json
{
  "id": 43,
  "clubId": 3,
  "slug": "sunday-roll-up",
  "title": "Sunday Social Roll-up",
  "description": "…",
  "event_type": "social",
  "format": null,
  "starts_at": "2026-09-13T13:00:00Z",
  "ends_at":   "2026-09-13T16:00:00Z",
  "location": "Green 1",
  "rsvp_open": true
}
```

### 3b. `POST /clubs/:clubId/events`

**Body additions:**

- `event_type` — required, one of the whitelist.
- `format` — required when `event_type = 'tournament'`, optional/null otherwise.

**Validation errors:**

| Case | HTTP | `code` |
|------|------|--------|
| `event_type` missing | 400 | `event_type_required` |
| `event_type` not in whitelist | 400 | `invalid_event_type` (echo the bad value) |
| `event_type = 'tournament'` with no `format` | 400 | `format_required_for_tournament` |
| `format` present but `event_type ≠ 'tournament'` | 200 | ignore silently (or 400 with `format_not_allowed`; owner-team pref) |

### 3c. `PATCH /clubs/:clubId/events/:id`

- Both `event_type` and `format` can be patched independently.
- If patching `event_type` from `tournament` → anything else, backend should set `format` to `null` automatically (or require the client to send `format: null` in the same request — again, owner-team pref; the CRM will send both to be safe).
- If patching `event_type` to `tournament` from anything else, `format` must now be present in the same request or already stored — otherwise 400 `format_required_for_tournament`.

### 3d. `GET /clubs/:clubId/events/:id`

Response includes `event_type` + nullable `format`. No behaviour change beyond that.

### 3e. `GET /public/clubs/:slug/site`

Every entry in `events_upcoming` now includes `event_type` and nullable `format`. Same shape as the CRM `GET /events` response.

**Rationale:** the public Nuxt site uses `event_type` to render different iconography and badges per event (dumbbell for tournaments, glass for socials, calendar for meetings, etc.). Currently everything renders identically.

---

## 4. Frontend implications (already lined up)

Once this ships:

- `Event` type in `packages/api-client/src/types.ts` gains `event_type: EventType`, and `format` becomes `BowlsFormat | null`.
- `EventsView.vue`: type-first chip filter, format chip only visible when the type filter is `tournament` or `all`. Create modal picks type first, format field appears conditionally.
- `EventListBlock.vue`: colour + icon dispatched off `event_type` rather than `format`.
- `BlockPreview` for eventList in `BlockPaletteDialog`: same.

---

## 5. Migration + rollout checklist

1. Ship migration.
2. Deploy backend with the new column + validation on `POST`/`PATCH`.
3. Update `GET /events` + `GET /events/:id` + `GET /public/clubs/:slug/site` to include `event_type` in responses.
4. Add the `?type=` filter to `GET /events`.
5. Regression test: existing tournament fixtures should still create/read/patch identically to today (default is `tournament`, format still required).
6. Ping frontend — CRM ships the new `event_type` UI and public site starts rendering per-type badges. Both are safe to deploy before backend if the frontend defaults `event_type` to `'tournament'` when missing (which it already does).

---

## 6. Non-goals

- No RSVP model changes. RSVPs still live where they live.
- No calendar recurrence (`recurs_weekly`, etc.). Every event is still a single-instance row.
- No per-type default durations, capacities, or descriptions (frontend can pre-fill locally if useful).
- No public `?type=` filter on `/public/clubs/:slug/site`. Site payload always includes every upcoming event; the frontend filters client-side.

---

## 7. Open questions for backend

1. Prefer `TEXT + CHECK` (my recommendation for flexibility) or a native Postgres enum? If enum, note that adding new types later needs `ALTER TYPE`.
2. Should `event_type` be immutable after creation (must delete + recreate to change) or freely patchable? CRM assumes freely patchable — it's editorial data, not a state machine.
3. `format_not_allowed` on non-tournament events — reject or silently drop the field? CRM will only send `format` when the type is `tournament`, so either is fine.
4. Any admin/reporting queries that assume `format IS NOT NULL`? Those will need `WHERE event_type = 'tournament'` added.
