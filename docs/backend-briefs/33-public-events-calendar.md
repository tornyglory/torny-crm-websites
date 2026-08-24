# Public Events — Calendar-View Endpoints

**Feature:** two public (no-auth) endpoints the club-sites `/events` calendar block needs. One returns events in an arbitrary month range for calendar navigation; the other returns an iCal feed so members can drop the club's events into their own calendar app.

**Related:** brief 29 (events CRUD — CRM endpoints + `/site.events_upcoming` extensions, already requested), brief 31 (public honour-board endpoints — same "public-read + auth-write" split).

**Status:** requested. The Paper design's Month/List/Team calendar can't render past months (or the far future) with only `/site.events_upcoming` — that array is capped at ~20 upcoming for the home-page block.

---

## TL;DR

1. **`GET /public/clubs/:slug/events?since=&until=&type=&format=`** — paginated public list. Same event shape as `/site.events_upcoming[]` (post brief 29). No auth. Cached 5 min shared + 30 min SWR.
2. **`GET /public/clubs/:slug/events.ics`** — iCal export. Feed of every published, future-and-recent-past event. Members subscribe once and see the club's schedule inside Apple Calendar / Google Calendar / Outlook. No auth.
3. **`/site.events_upcoming[]` stays capped at 20** — that's the home-page block. Full calendar reads from these new endpoints.

---

## Base URL

Same public base as `/site`, `/honour-*` etc:

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

No auth header.

---

## 1. `GET /public/clubs/:slug/events`  (public, no auth)

Returns published events in a date range with optional type / format filters.

**Query params:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `since` | ISO date | 7 days ago | Only events where `starts_at >= since`. |
| `until` | ISO date | +90 days | Only events where `starts_at < until`. |
| `type` | comma-separated `EventType` | — | Filter by `event_type` (brief 20 whitelist). |
| `format` | comma-separated `BowlsFormat` | — | Filter by `format` (singles / pairs / triples / fours / other). |
| `limit` | int | 200 | 1..500. Calendar month = ≤ ~40 events for a busy club. |

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
        "excerpt": "5:30 PM · Green A · Social",
        "event_type": "social",
        "format": null,
        "starts_at": "2026-09-18T17:30:00Z",
        "ends_at":   "2026-09-18T20:30:00Z",
        "location": "Green A",
        "host_name": "Sione Vagana",
        "capacity": 20,
        "is_ticketed": false,
        "rsvp_going_count": 9,
        "rsvp_maybe_count": 3,
        "rsvp_going_preview": [
          { "initials": "GW", "avatar_url": null },
          { "initials": "NU", "avatar_url": null },
          { "initials": "SV", "avatar_url": "https://…" }
        ]
      }
    ],
    "total": 42
  }
}
```

**Shape identical to `/site.events_upcoming[]`** — same fields, same types, same nullability. Frontend can share a single type. Only difference: this endpoint is unbounded by the 20-cap and range-scoped instead of "next 20".

**Sort:** `starts_at ASC`.

**Filter:** `is_published = true` only.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Club exists but not onboarded | 404 | `not_onboarded` |
| `since` after `until` | 400 | `bad_range` |
| Unknown `type` / `format` | 400 | `bad_filter` |

**Caching:** `Cache-Control: public, max-age=300, stale-while-revalidate=1800`. Purge on event mutation via the same revalidate webhook backend already fires for `/site`.

---

## 2. `GET /public/clubs/:slug/events.ics`  (public, no auth)

iCalendar feed — one `VEVENT` per published event in the last 30 days + next 12 months.

**Response:**

```
Content-Type: text/calendar; charset=utf-8
Content-Disposition: inline; filename="melbourne-bowling-club.ics"

BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Torny//club-sites//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Melbourne Bowling Club
X-WR-CALDESC:Every roll-up, pennant, tournament and social.
REFRESH-INTERVAL;VALUE=DURATION:PT12H
X-PUBLISHED-TTL:PT12H

BEGIN:VEVENT
UID:torny-event-42@melbourne-bowling-club.torny.club
DTSTAMP:20260901T093000Z
DTSTART:20260918T173000Z
DTEND:20260918T203000Z
SUMMARY:Twilight roll-up
DESCRIPTION:Bring anyone — members, non-members, kids.
LOCATION:Green A
URL:https://melbourne-bowling-club.torny.club/events/twilight-roll-up-2026-09-18
CATEGORIES:social
END:VEVENT

END:VCALENDAR
```

**Requirements:**

- Line endings are CRLF (`\r\n`).
- `UID` is stable per event across regenerations (use `torny-event-{id}@{slug}.torny.club`).
- All datetimes in UTC (`Z` suffix).
- Text values line-fold at 75 octets per RFC 5545.
- `SUMMARY`, `DESCRIPTION`, `LOCATION` escape newlines / commas / semicolons per RFC 5545.

**Cache:** same policy as `/site` — 12h shared / 12h stale-while-revalidate. iCal clients typically re-fetch every 12–24h.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Not onboarded | 404 | `not_onboarded` |

**Auth:** none — this is a public subscription URL that Apple/Google/Outlook can hit anonymously. If a member wants only the events they've RSVPd to, that's a per-user token flow (out of scope, later brief).

---

## 3. Why not just bump `/site.events_upcoming[]`?

Same reasoning as brief 31 §3 for honour-board search:

- `/site` gets fetched on every public page render — bloating it with 200 events just so `/events` can navigate is wasteful.
- Calendar UI needs range-scoped queries anyway (prev / next month). Range filters at read time are the right shape.
- Keeping the calendar endpoint separate lets us cache it independently and add heavier filters (`?type=`, `?format=`) without redesigning the `/site` payload.

`/site.events_upcoming[]` stays capped at 20 and remains what the compact `EventList` / `WhatsOn` block on the home page reads.

---

## 4. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/events.ts`** — add `publicList(slug, params)` returning the paginated shape. Plus `publicIcsUrl(slug)` — a `string` helper that just returns the ICS URL (used for the "Add to my calendar" button).
- **New `EventsCalendarBlock`** — month grid on the left, highlights list on the right, stats footer. Reads via `publicList` scoped to the visible month. "Add to my calendar" button links to `publicIcsUrl`. Add / edit / delete happens in the CRM (brief 29).

---

## 5. Non-goals

- **No RSVP submission endpoints here.** Members RSVPing to events has its own auth surface (public users can't RSVP without a Torny account tying it to a user). Ship this brief first for read-only calendar; RSVP endpoints get their own brief when the member-facing UX lands.
- **No per-event public detail endpoint.** Clicking an event on the calendar opens a client-side modal; the /events/:slug page has its own hand-rolled fallback. If we want a public "share this specific event" surface, add `GET /public/clubs/:slug/events/:slug` later.
- **No cross-club calendar aggregation.** Every club's events live under their own slug.
- **No time-zone-per-event overrides.** All events display in the club's timezone (UTC storage, client-side formatting).

---

## 6. Verification

```bash
# Range query
curl -i 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/melbourne-bowling-club/events?since=2026-09-01&until=2026-10-01'
# → 200 with data.events[] scoped to September 2026

# Type filter
curl -i '…/events?type=tournament,pennant&since=2026-09-01&until=2027-09-01'

# Bad range
curl -i '…/events?since=2026-12-01&until=2026-06-01'
# → 400 bad_range

# iCal
curl -i '…/events.ics'
# → 200 text/calendar with VCALENDAR body
```

---

## 7. Open questions

1. **iCal `TZID` support** — recommend keeping all datetimes in UTC (`Z`) for MVP. Adds robustness but skips the per-club-timezone dance. Flag when clubs across DST-sensitive regions start onboarding.
2. **Filter combinations** — should `type=` and `format=` combine as AND or OR? Recommend AND (both must match). Matches how the Paper design's filter chips work.
3. **`limit` cap** — 500 feels generous. Any push to allow larger for full-year exports? If so, prefer pagination + `?offset=` over uncapped limits.
4. **Rate limit** — 60 req/min per IP is fine for `/events`; iCal typically re-fetches every 12h so no meaningful load.

---

## 8. Contact

`#torny-eng`. Ping if the iCal shape needs adjusting for a specific client, or if RSVP submission should bundle into this brief.
