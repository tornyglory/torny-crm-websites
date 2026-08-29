# Tournaments — Create + Take Entries

**Feature:** clubs create tournaments through the CRM, publish them to their public site + the network-wide Torny web app, take entries from members (own club) and visitors (any club on Torny), manage payments + waitlists, and eventually run the draw + post results.

**Status:** frontend design shipped 2026-08-28 (CRM Tournaments list + entries drawer, `torny-web` Tournaments discovery page, tournament card patterns across dashboard + selections). Awaits backend model + endpoints.

**Related briefs:**
- brief 33 (public events by month) — tournaments extend events with a formal registration + payment + roster layer. Public events endpoint should co-list tournaments (or the tournament public discovery endpoint should be its own thing — see §11).
- brief 38 (membership applications) — reuses the payment provider integration for entry fees.
- brief 45 (email templates) — new `tournament_entry_received / _confirmed / _waitlisted / _refunded` flavours needed for notifications.
- brief 40 (notifications) — entry lifecycle events fire notifications to both the entrant and the tournament organiser.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT on `club_members` (permission scope: `tournaments:manage` — see §12).

Public discovery endpoints are un-authed.

---

## 1. Storage

Three new tables:

### `tournaments`
```
id                  INT       PK
club_id             INT       FK → clubs_data.id
slug                VARCHAR   UNIQUE within club — mints from title on create
title               VARCHAR   NOT NULL
subtitle            VARCHAR   NULL
description         TEXT      NULL   -- markdown/plain (renders on public page)

-- Format
format              VARCHAR   NOT NULL   -- 'singles' | 'pairs' | 'triples' | 'fours'
category            VARCHAR   NOT NULL   -- 'open' | 'restricted' | 'championship' | 'junior' | 'veterans' | 'social'
gender_scope        VARCHAR   NULL       -- 'mens' | 'womens' | 'mixed' — null = open to all

-- Timing
starts_at           TIMESTAMP NOT NULL
ends_at             TIMESTAMP NOT NULL
entries_open_at     TIMESTAMP NOT NULL
entries_close_at    TIMESTAMP NOT NULL
draw_published_at   TIMESTAMP NULL       -- when the draw goes live

-- Capacity
entry_unit          VARCHAR   NOT NULL   -- 'team' | 'player' — 'team' for pairs/triples/fours
entry_cap           INT       NOT NULL
waitlist_enabled    BOOLEAN   DEFAULT true
waitlist_cap        INT       NULL       -- null = unbounded

-- Money
entry_fee_cents     INT       NOT NULL   -- 0 = free
currency            VARCHAR   DEFAULT 'NZD'
prize_pool_cents    INT       NULL       -- optional free-text also stored below
prize_notes         TEXT      NULL       -- "1st $500 · 2nd $250 · 3rd $100"
payment_method      VARCHAR   NOT NULL   -- 'online' | 'on_the_day' | 'club_transfer' — controls the entry flow

-- Eligibility
open_to_visitors    BOOLEAN   DEFAULT true    -- if false, only own-club members can enter
requires_bcnz       BOOLEAN   DEFAULT false   -- must have Bowls NZ number
min_age             INT       NULL
max_age             INT       NULL

-- Publishing
status              VARCHAR   NOT NULL   -- 'draft' | 'published' | 'entries_closed' | 'in_progress' | 'complete' | 'cancelled'
is_public           BOOLEAN   DEFAULT true    -- if false, only visible via direct link (unlisted). Renamed from `public` (reserved word in some MySQL versions).
featured_until      TIMESTAMP NULL           -- if set + in the future, boosts in discovery
cover_image_url     VARCHAR   NULL       -- hero image shown on tournament card, poster, listing
gallery_urls        JSONB     DEFAULT '[]'  -- ordered array of up to 8 image URLs shown on the public tournament page

-- Metadata
sanctioned_by       VARCHAR   NULL       -- 'Bowls Wellington', 'Bowls NZ', 'Club', etc — free text
sanction_url        VARCHAR   NULL

created_at          TIMESTAMP DEFAULT now()
created_by          INT       FK → users.id
updated_at          TIMESTAMP
```

### `tournament_entries`
```
id                    INT       PK
tournament_id         INT       FK → tournaments.id
entry_number          INT       NOT NULL   -- sequential within tournament (1, 2, 3…)
team_name             VARCHAR   NULL       -- null for singles entries
captain_user_id       INT       FK → users.id  -- the entrant of record (owns comms + payment)
captain_email         VARCHAR   NOT NULL       -- denormalised for un-registered guest entrants
captain_phone         VARCHAR   NULL
captain_club_id       INT       NULL           -- captain's home club, for pathway rules

-- Payment
paid_cents            INT       DEFAULT 0
paid_at               TIMESTAMP NULL
payment_reference     VARCHAR   NULL   -- Stripe payment intent id / bank ref / etc
refunded_cents        INT       DEFAULT 0
refunded_at           TIMESTAMP NULL

-- Status
status                VARCHAR   NOT NULL   -- 'pending' | 'confirmed' | 'waitlisted' | 'withdrawn' | 'refunded'
waitlist_position     INT       NULL       -- 1-indexed. null when not waitlisted
withdrew_at           TIMESTAMP NULL
withdrew_reason       VARCHAR   NULL

-- Roster (for team formats)
roster                JSONB     NULL   -- see §3.2 for shape
roster_locked_at      TIMESTAMP NULL

-- Admin
notes                 TEXT      NULL   -- private admin-only notes
created_at            TIMESTAMP DEFAULT now()
updated_at            TIMESTAMP

UNIQUE (tournament_id, entry_number)
```

### `tournament_notifications` (optional — brief 40 fan-out could handle this instead)
Only needed if per-tournament email digests are wanted. Skip for v1 if brief-40 notifications suffice.

---

## 2. The endpoints

### CRM (organiser side)
| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/clubs/{id}/tournaments` | List this club's tournaments (all statuses, paginated) |
| `POST`   | `/clubs/{id}/tournaments` | Create draft tournament |
| `GET`    | `/clubs/{id}/tournaments/{tid}` | Full detail incl. entries + stats |
| `PATCH`  | `/clubs/{id}/tournaments/{tid}` | Edit any field except entries-related state (§4) |
| `POST`   | `/clubs/{id}/tournaments/{tid}/publish` | Draft → published |
| `POST`   | `/clubs/{id}/tournaments/{tid}/close-entries` | Force-close early |
| `POST`   | `/clubs/{id}/tournaments/{tid}/cancel` | Cancel + trigger refunds |
| `DELETE` | `/clubs/{id}/tournaments/{tid}` | Only allowed while status=draft |
| `GET`    | `/clubs/{id}/tournaments/{tid}/entries` | List entries with filter/sort |
| `PATCH`  | `/clubs/{id}/tournaments/{tid}/entries/{eid}` | Update status, mark paid, edit roster, add notes |
| `POST`   | `/clubs/{id}/tournaments/{tid}/entries/{eid}/promote` | Waitlist → confirmed |
| `POST`   | `/clubs/{id}/tournaments/{tid}/entries/{eid}/refund` | Manual refund trigger |
| `GET`    | `/clubs/{id}/tournaments/{tid}/export.csv` | Roster export for scorers |

### Public (discovery)
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/public/tournaments` | Cross-club discovery — filter by format/category/region/date/distance |
| `GET` | `/public/tournaments/{clubslug}/{tournamentslug}` | Public tournament page |
| `GET` | `/public/clubs/{clubslug}/tournaments` | This club's public tournament listing |

### Entry (authed as the entrant)
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/tournaments/{tid}/enter` | Submit a new entry. Handles team creation, waitlist decision, payment intent creation |
| `PATCH` | `/tournaments/{tid}/entries/{eid}` | Update own roster before roster_locked_at |
| `POST` | `/tournaments/{tid}/entries/{eid}/withdraw` | Withdraw own entry (auto-promotes waitlist) |
| `POST` | `/tournaments/{tid}/entries/{eid}/pay` | Kick off payment (Stripe intent) if not paid at entry time |

Every write returns the updated entity so the frontend can reconcile in one round-trip.

---

## 3. Payload shapes

### 3.1 `Tournament` (CRM detail response)

```jsonc
{
  "id": 42,
  "club_id": 1,
  "slug": "twilight-triples-round-4",
  "title": "Twilight Triples · Round 4",
  "subtitle": null,
  "description": "Rolling since 1962. Cash prize for the top team.",
  "format": "triples",
  "category": "open",
  "gender_scope": "mixed",
  "starts_at": "2025-10-17T17:30:00+13:00",
  "ends_at": "2025-10-17T22:00:00+13:00",
  "entries_open_at": "2025-10-01T00:00:00+13:00",
  "entries_close_at": "2025-10-15T18:00:00+13:00",
  "draw_published_at": null,
  "entry_unit": "team",
  "entry_cap": 16,
  "waitlist_enabled": true,
  "waitlist_cap": null,
  "entry_fee_cents": 3000,
  "currency": "NZD",
  "prize_pool_cents": 42000,
  "prize_notes": "1st $200 · 2nd $120 · 3rd $80",
  "payment_method": "online",
  "open_to_visitors": true,
  "requires_bcnz": false,
  "min_age": null,
  "max_age": null,
  "status": "published",
  "is_public": true,
  "featured_until": null,
  "cover_image_url": "https://cdn.torny.co/…/cover.jpg",
  "gallery_urls": [
    "https://cdn.torny.co/…/gallery-01.jpg",
    "https://cdn.torny.co/…/gallery-02.jpg"
  ],
  "sanctioned_by": "Bowls Wellington",
  "sanction_url": null,

  // Aggregated (server-computed, never in PATCH)
  "stats": {
    "confirmed_count": 14,
    "pending_count": 2,
    "waitlist_count": 3,
    "revenue_paid_cents": 42000,
    "revenue_pending_cents": 6000,
    "spots_remaining": 2
  },

  // Recent entries — top 4, for the drawer. Full list via /entries.
  "recent_entries": [ /* EntryRow[] — see 3.2 */ ]
}
```

### 3.2 `Entry`

```jsonc
{
  "id": 812,
  "entry_number": 14,
  "team_name": "Team Grace",
  "captain": {
    "user_id": 42,
    "name": "Grace Tuilagi",
    "email": "grace@naenaebowling.org.nz",
    "phone": "+64211234567",
    "handle": "grace",
    "club_id": 1,
    "club_name": "Naenae Bowling Club",
    "avatar_url": null
  },
  "paid_cents": 3000,
  "paid_at": "2025-10-10T14:32:00Z",
  "payment_reference": "pi_1PxYZ…",
  "refunded_cents": 0,
  "refunded_at": null,
  "status": "confirmed",
  "waitlist_position": null,
  "roster": [
    { "position": "lead", "user_id": 42, "name": "Grace Tuilagi", "bcnz_number": null },
    { "position": "second", "user_id": 88, "name": "Sione Aleki", "bcnz_number": null },
    { "position": "skip", "user_id": 21, "name": "Frances Roydon-Miller", "bcnz_number": null }
  ],
  "roster_locked_at": null,
  "notes": null,
  "created_at": "2025-10-10T14:29:00Z",
  "updated_at": "2025-10-10T14:32:00Z"
}
```

Roster item positions match the format:
- `singles` → 1 item, position `player`
- `pairs` → 2 items, positions `lead`, `skip`
- `triples` → 3 items, positions `lead`, `second`, `skip`
- `fours` → 4 items, positions `lead`, `second`, `third`, `skip`

`user_id` is optional — guest players who aren't on Torny come through as `{ name: "Guest name", user_id: null, bcnz_number: null }`. Backend does not create a stub user for guests.

---

## 4. Status state machine

```
Tournament:
  draft ──publish──► published ──entries_close_at OR force-close──► entries_closed
    │                                                      │
    ▼                                                      ▼
 (deletable)                             ──draw_published──► in_progress ──complete──► complete
                                                              │
                                                              ▼
                                              ──cancel──► cancelled (any state)

Entry (per tournament):
  pending  ──payment received  OR  admin confirm──► confirmed
     │                                                 │
     │──withdraw──► withdrawn                          │──withdraw──► withdrawn ──→ auto-promotes 1st waitlisted
     │                                                 │
     ▼                                                 ▼
 waitlisted ──promote (by admin OR auto)──► pending / confirmed
     │                                     
     └──withdraw──► withdrawn
```

**Auto-promotion:** when a confirmed entry withdraws AND there's a waitlist, the top waitlisted entry auto-promotes to `pending` and receives an email invitation to pay within 24h. If they don't, they go back to the bottom of the waitlist and the next one is offered. This runs on a cron every 15 minutes.

**Cancellation:** setting a tournament to `cancelled` triggers refunds for every paid entry through Stripe within 24h. Un-paid pending entries are moved to `withdrawn` with reason `tournament_cancelled`. Fires the `tournament_cancelled` email to every entrant.

---

## 5. `POST /clubs/{id}/tournaments`

Create a draft. All required fields must be present; defaults documented above are applied to omitted optional fields.

**Body:**
```jsonc
{
  "title": "Twilight Triples · Round 4",
  "subtitle": null,
  "description": "…",
  "format": "triples",
  "category": "open",
  "gender_scope": "mixed",
  "starts_at": "2025-10-17T17:30:00+13:00",
  "ends_at": "2025-10-17T22:00:00+13:00",
  "entries_open_at": "2025-10-01T00:00:00+13:00",
  "entries_close_at": "2025-10-15T18:00:00+13:00",
  "entry_unit": "team",
  "entry_cap": 16,
  "waitlist_enabled": true,
  "waitlist_cap": null,
  "entry_fee_cents": 3000,
  "prize_pool_cents": 42000,
  "prize_notes": "1st $200 · 2nd $120 · 3rd $80",
  "payment_method": "online",
  "open_to_visitors": true,
  "requires_bcnz": false,
  "sanctioned_by": "Bowls Wellington"
}
```

**201 response:** the full tournament shape (status=draft).

**Slug minting** — the backend generates `slug` from `title` with a rolling counter suffix on collision within the club (`twilight-triples-round-4`, `twilight-triples-round-4-2`, etc). Frontend never sends it.

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `missing_field` | Any of the required fields is null/empty. Response `field: "title"` |
| 400 | `bad_format` | `format` not in the four values |
| 400 | `bad_dates` | `entries_close_at > starts_at`, or `ends_at < starts_at`, etc |
| 400 | `bad_capacity` | `entry_cap < 1` or `entry_cap > 256` |
| 400 | `bad_fee` | `entry_fee_cents < 0` |
| 403 | | Caller lacks `tournaments:manage` |

---

## 6. `POST /tournaments/{tid}/enter`

The entrant-side write. Admin-side entry creation (walk-in) uses `PATCH /entries` with the same shape.

**Body:**
```jsonc
{
  "team_name": "Team Grace",          // null for singles
  "roster": [
    { "position": "lead", "user_id": 42 },
    { "position": "second", "user_id": 88 },
    { "position": "skip", "name": "Frances Roydon-Miller", "user_id": null, "bcnz_number": null }
  ],
  "captain_contact": {                 // used when caller is a guest (no auth) OR guest-entering-on-behalf
    "email": "grace@naenaebowling.org.nz",
    "phone": "+64211234567"
  },
  "payment_intent": "immediate"        // 'immediate' | 'later' — 'later' is only allowed if tournament.payment_method != 'online'
}
```

**201 response:**
```jsonc
{
  "entry": { /* Entry */ },
  "next_step": "pay",                  // 'pay' | 'wait_confirmation' | 'done'
  "payment": {                         // only present when next_step='pay'
    "provider": "stripe",
    "client_secret": "pi_1PxYZ_secret_…",
    "amount_cents": 3000,
    "currency": "NZD"
  },
  "waitlist_position": null            // populated when tournament is full → entry auto-waitlists
}
```

**Auto-waitlist:** if `confirmed_count >= entry_cap` on submission, the entry lands as `waitlisted` with a position, and `next_step: "wait_confirmation"`. No payment is captured until promoted.

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `entries_closed` | Now is outside `entries_open_at → entries_close_at` |
| 400 | `bad_roster_size` | Roster count doesn't match the format |
| 400 | `bad_position` | Roster item's position doesn't match the format's allowed positions |
| 400 | `visitor_not_allowed` | Tournament `open_to_visitors=false` and caller isn't a member of the host club |
| 400 | `bcnz_required` | Tournament `requires_bcnz=true` and any roster item is missing `bcnz_number` |
| 400 | `age_restriction` | Any roster player is outside `min_age–max_age` |
| 400 | `duplicate_entry` | Any roster user_id is already on another entry for this tournament |
| 400 | `waitlist_full` | Waitlist is capped and full |
| 402 | `payment_required` | Only returned when `payment_intent=later` but tournament requires online payment |
| 403 | | Auth issue |

---

## 7. Payment integration

Reuses the Stripe integration from brief 38 (applications) where the club's Stripe account is connected via Stripe Connect. Tournament entry fees route to the club's account; Torny takes no cut in v1.

**Flow when `payment_method: online`:**

1. Frontend calls `POST /tournaments/{tid}/enter` — backend creates the entry row (`pending`), creates a Stripe PaymentIntent scoped to the club's connected account, returns the `client_secret`.
2. Frontend confirms the intent with Stripe.js.
3. Stripe fires a webhook → backend marks entry `paid_at`, `paid_cents`, `payment_reference` and moves status to `confirmed`.
4. If the intent fails or the user abandons the flow, a cron marks the entry `withdrawn` after 30 minutes with reason `payment_timeout` and frees the slot (auto-promotes waitlist).

**Flow when `payment_method: on_the_day` / `club_transfer`:** entry lands as `confirmed` immediately; `paid_cents` stays 0 until the club admin marks it paid manually via `PATCH /entries/{eid}` with `paid_cents` + `paid_at`.

**Refunds:** `POST /entries/{eid}/refund` triggers a full Stripe refund (or partial if `amount_cents` is provided in the body) and marks the entry `refunded`. Idempotent by Stripe.

---

## 8. Public discovery — `GET /public/tournaments`

Un-authed. Powers the `torny-web` Tournaments page (Grace's cross-club discovery surface).

**Query params:**
```
format             singles|pairs|triples|fours (repeatable)
category           open|restricted|championship|junior|veterans|social (repeatable)
gender             mens|womens|mixed
region             string (matches clubs_data.region)
lat, lon, radius   distance filter (km) — server does haversine on club coords
starts_after       ISO date
starts_before      ISO date
entry_fee_max      cents
open_only          true → only status=published AND entries_close_at > now
eligible_for       user_id — server filters out tournaments where the user doesn't meet requires_bcnz / age / visitors=false
q                  free-text search on title + club name
sort               entries_close_asc | starts_asc | prize_desc | featured_first (default)
page               1-indexed
limit              default 20, max 50
```

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "tournaments": [ /* PublicTournamentCard[] */ ],
    "pagination": { "page": 1, "limit": 20, "total_items": 42, "total_pages": 3 }
  }
}
```

`PublicTournamentCard` is the tournament shape trimmed to display fields — no roster, no revenue, no admin notes.

---

## 9. Notifications (brief 40 + brief 45 wiring)

New email flavours to add to the flavour whitelist (brief 45 §4):

| Slug | Fires when | To |
|---|---|---|
| `tournament_entry_received` | POST /enter succeeds | Entrant + club admin |
| `tournament_entry_confirmed` | Payment webhook confirms payment OR admin manually confirms | Entrant |
| `tournament_entry_waitlisted` | Entry lands on waitlist | Entrant |
| `tournament_entry_promoted` | Waitlist auto-promotion | Entrant (with 24h payment link) |
| `tournament_entry_refunded` | Refund processed | Entrant |
| `tournament_cancelled` | Tournament cancelled | Every entrant |
| `tournament_draw_published` | draw_published_at set | Every confirmed entrant |
| `tournament_starts_tomorrow` | 24h cron fires | Every confirmed entrant |

New context variables for these flavours (extend brief 45 §4 whitelist):
- `{{tournament_name}}`
- `{{tournament_date}}`
- `{{tournament_venue}}`
- `{{team_name}}`
- `{{entry_number}}`
- `{{payment_url}}`
- `{{waitlist_position}}`

In-app notifications (brief 40) fire the same events with structured payloads so the CRM's bell + the `torny-web` notifications tab surface them.

---

## 10. CRM permission scope

New CRM role scope (extend brief 39):

`tournaments:manage` — required for POST/PATCH/DELETE on `/clubs/{id}/tournaments/*` and all entry-management endpoints. Owner + Admin roles get it by default. Committee role gets read-only. Player role has no CRM access to tournaments.

---

## 11. Deviations to flag

1. **Public discovery is a new endpoint, not a cross-listing on `/public/events`** — events are club-local; tournaments are cross-club, filterable by distance/eligibility, and card shape differs. Two endpoints is cleaner than trying to normalise.
2. **`open_to_visitors=false` is the club-only lock** — but even those tournaments still appear in `/public/tournaments` for members of the host club specifically. This is the "eligible_for" filter's job.
3. **Roster is a JSONB blob**, not a separate table. Rationale: it's ~4 items, always read/written atomically with the entry, and we don't run any per-player queries against it. If we ever need per-player attendance/stats across tournaments, we'll migrate to a table then. Not a v1 concern.
4. **No draw / bracket / schedule model in this brief.** Draws are a follow-up brief 48 — this brief gets clubs to "field of 16 confirmed teams." Draws build on top.
5. **No prize distribution logic.** Prize pool + notes are display strings. Actual prize handling stays manual for v1.

---

## 12. Non-goals (v1)

- No brackets / draw generation
- No score entry / results posting (brief 48)
- No live scoring
- No live scoreboard for spectators
- No shirt/uniform requirements as structured data
- No per-tournament sponsors
- No refund policy config (all-or-nothing manual refunds only)
- No multi-day formats with separate entry deadlines per day
- No round-robin vs knockout distinction — that's a draw-brief concern

---

## 13. Verification (please attach outputs)

- ✓ POST create → GET returns saved shape
- ✓ Publish → status transition + public endpoint starts returning it
- ✓ POST /enter creates entry + Stripe intent
- ✓ Stripe webhook flips entry to confirmed + revenue_paid_cents rolls up on tournament stats
- ✓ 15th entry to a 16-cap tournament: confirmed. 17th: auto-waitlisted with position=1
- ✓ Withdraw of a confirmed entry when waitlist non-empty: auto-promotes top waitlist entry to `pending`, sends promoted email
- ✓ Guest entry (no `user_id` on captain) → captain_user_id null, captain_email required, works fine
- ✓ Duplicate roster user_id in a second entry → 400 `duplicate_entry`
- ✓ visitor_not_allowed + open_to_visitors=false + caller outside club → 400
- ✓ Cancel tournament → all confirmed entries refund + email fires
- ✓ Public search with distance filter returns tournaments sorted correctly by haversine
- ✓ Auth: non-admin CRM caller → 403 on writes; permission `tournaments:manage` enforced

---

## 14. Contact

Same as prior briefs. If a new format or category slug becomes needed (e.g. `mixed_pairs`, `senior_open`), add to `utils/tournament-enums.js` and coordinate the frontend enum in `packages/api-client/src/resources/tournaments.ts`.
