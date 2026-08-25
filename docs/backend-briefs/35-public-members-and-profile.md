# Public Members Directory + Player Profile Page

**Feature:** two public (no-auth) endpoints for a "meet the club" experience on the public site — a searchable / filterable member directory, plus a single-player profile page that surfaces the trophies we already return from the honour-board reverse index. Plus schema additions the CRM needs to categorise positions (Board / Staff / Committee / Member) and to let owners hide individual members from the public directory.

**Related:** `packages/api-client/src/resources/members.ts` (existing authed roster + typeahead endpoints — CRM stack), brief 28 §6 (public `/players/:userId/honour-board` reverse index — already shipped on CRM_BASE and re-used here to compute trophy counts).

**Status:** requested. CRM currently has a mocked committee page; we're building the real thing. Blocks task #109 (public player profile — currently unreachable link because the page doesn't exist).

---

## TL;DR

1. **Two schema additions on `club_members`:**
   - `position_group` enum — `board | staff | committee | member` (default `member`) — categorises the member for the public directory.
   - `public_visible` boolean (default `true`) — opt-out toggle so owners can hide any member from the directory.
   - `bio` text (nullable, ≤ 500 chars) — short editable blurb shown on the profile page.
2. **`GET /public/clubs/:slug/members?position=&search=&limit=&offset=`** — paginated directory. Filters honour `public_visible = true`. Response includes each member's trophy count for card display.
3. **`GET /public/clubs/:slug/players/:userId`** — single profile page data. Same shape as directory rows plus bio + trophies (via the existing reverse index).
4. **`PATCH /clubs/:id/members/:userId`** — accept the three new fields on top of the existing partial-update body.
5. **Existing `MemberRole`** (`owner | admin | committee | player`) is unchanged — that governs CRM permissions. `position_group` is a separate concern for public grouping.

---

## Base URLs

Two different bases — sorry, same convention as honour-board:

```ts
// Public reads — CRM stack
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';

// CRM writes (PATCH member) — primary CDK stack
export const CRUD_BASE = 'https://s3vagc0pma.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

Bearer JWT for CRUD; public endpoints are no-auth.

---

## 1. Schema additions

Migration to `club_members`:

```sql
ALTER TABLE club_members
  ADD COLUMN position_group VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (position_group IN ('board', 'staff', 'committee', 'member')),
  ADD COLUMN public_visible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN bio TEXT NULL;

-- Backfill: any existing row with club_role IN ('owner', 'admin', 'committee')
-- becomes position_group='committee'. Owners can promote individuals to
-- 'board' or 'staff' via the CRM once the toggle ships.
UPDATE club_members
  SET position_group = 'committee'
  WHERE club_role IN ('owner', 'admin', 'committee');
```

**Notes:**

- `position_group` is **separate from `club_role`**. Role controls CRM permissions; position_group controls public directory grouping. A Greenkeeper who doesn't manage the CRM has `club_role='player'` + `position_group='staff'`. A club president who owns the CRM has `club_role='owner'` + `position_group='board'`.
- `title` (existing freeform column) stays as the label — "President", "Secretary", "CEO", "General Manager", "Greenkeeper", "Bar Manager", "Match Committee Chair", "Life Member", or whatever the club wants.
- `public_visible` defaults to true — opt-out model, matches how clubs traditionally publish member lists in clubhouse programs. Owners flip individuals to false as members request.
- `bio` is null by default. Owners edit via the CRM; when player-editable profiles ship, members can edit their own.

---

## 2. `GET /public/clubs/:slug/members`  (public, no auth)

Paginated + filterable directory. Only members with `public_visible = true` are returned.

**Query params:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `position` | `board \| staff \| committee \| member` | — | Filter to one group. Omit for all. **`committee` semantically includes Board** (board members are still on the committee) — recommend filtering to `position_group IN ('board', 'committee')` when `position=committee`. |
| `search` | string | — | Case-insensitive substring on `title`, `full_name`. ≤ 200 chars. |
| `limit` | int | 50 | 1..100. |
| `offset` | int | 0 | ≥ 0. |
| `sort` | `default \| alpha` | `default` | `default` = Board → Staff → Committee → Members, alpha within each group. `alpha` = simple A–Z. |

**200:**

```json
{
  "status": "success",
  "data": {
    "members": [
      {
        "user_id": 1111,
        "full_name": "Nev Rodda",
        "avatar_url": "https://imagedelivery.net/…/public",
        "position_group": "board",
        "title": "President",
        "joined_year": 2015,
        "trophies_count": 3,
        "initials": "NR"
      },
      {
        "user_id": 1120,
        "full_name": "Kaupena Ngata",
        "avatar_url": null,
        "position_group": "staff",
        "title": "Greenkeeper",
        "joined_year": 2019,
        "trophies_count": 0,
        "initials": "KN"
      }
    ],
    "total": 42
  }
}
```

**Fields:**

- `user_id` — the same id used everywhere else (player profile URL, honour-board reverse index, calendar RSVP previews).
- `full_name` — from `users.first_name + last_name`, or `users.display_name` if that's what's stored. Frontend expects one string, no need to split.
- `avatar_url` — Cloudflare public URL, or `null` when the member hasn't uploaded one.
- `position_group` — matches the filter chip: `board | staff | committee | member`.
- `title` — freeform (e.g. "President", "Greenkeeper", "Match Committee Chair"). `null` for regular members with no title.
- `joined_year` — 4-digit year derived from the earliest `club_members.created_at`. `null` if unknown / imported without a date.
- `trophies_count` — total wins across all honour-board categories where this user appears in `honour_entry_players`. Computed via JOIN with `club_honour_entry_players` where `user_id = members.user_id` and the entry's category `is_visible = 1`. 0 when the member has no wins.
- `initials` — server-derived from `full_name` (up to 2 chars, uppercase) so the frontend doesn't re-compute per row.

**Sort default (`sort=default`):**

```sql
ORDER BY
  CASE position_group
    WHEN 'board' THEN 0
    WHEN 'staff' THEN 1
    WHEN 'committee' THEN 2
    ELSE 3
  END,
  full_name ASC
```

**Filter semantics:**

- `?position=board` → `WHERE position_group = 'board'`
- `?position=staff` → `WHERE position_group = 'staff'`
- `?position=committee` → `WHERE position_group IN ('board', 'committee')` (**Board is a subset of Committee** — matches how clubs describe their whole committee)
- `?position=member` → `WHERE position_group = 'member'`
- omit → all four

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Club not onboarded | 404 | `not_onboarded` |
| Unknown `position` value | 400 | `bad_position` |
| `search` > 200 chars | 400 | `bad_search` |
| Bad `limit` / `offset` | 400 | `bad_pagination` |

**Caching:** `Cache-Control: public, max-age=300, stale-while-revalidate=1800`. Purge via the same revalidate webhook that fires on member add / edit / remove.

---

## 3. `GET /public/clubs/:slug/players/:userId`  (public, no auth)

Single-player profile page data. Same club-visibility rules — 404 if the user isn't a `public_visible` member of the club.

**200:**

```json
{
  "status": "success",
  "data": {
    "user_id": 1111,
    "full_name": "Nev Rodda",
    "avatar_url": "https://imagedelivery.net/…/public",
    "initials": "NR",
    "position_group": "board",
    "title": "President",
    "joined_year": 2015,
    "bio": "Third-generation member — took over the pennant side in 2019.",
    "club": {
      "id": 5,
      "slug": "nae-nae-bowling-club",
      "name": "Nae Nae Bowling Club",
      "logo_url": "https://imagedelivery.net/…/public"
    },
    "trophies": {
      "total": 3,
      "recent": [
        {
          "entry_id": 42,
          "year": 2026,
          "category_slug": "champion-of-champions",
          "category_name": "Champion of Champions",
          "note": null
        }
      ]
    }
  }
}
```

**Fields (additions on top of directory row):**

- `bio` — free text ≤ 500 chars, or `null`. Owner-editable via CRM.
- `club` — small stub so the profile page can render "Member of Nae Nae Bowling Club" without a follow-up fetch.
- `trophies.total` — same integer as `trophies_count` on the directory row.
- `trophies.recent` — up to 5 most-recent entries (year DESC). Full trophies list still available via the existing `GET /players/:userId/honour-board` reverse index — this is just a highlight strip.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Slug found but userId isn't a member | 404 | `unknown_player` |
| Member exists but `public_visible = false` | 404 | `unknown_player` (same 404 — don't leak existence) |
| Non-integer `userId` | 400 | `bad_user_id` |

**Caching:** same as directory list.

---

## 4. `PATCH /clubs/:id/members/:userId`  (🔒 admin+)

Existing endpoint gains three optional fields — additive, existing callers keep working.

**New accepted body fields:**

```json
{
  "position_group": "board",
  "public_visible": true,
  "bio": "Third-generation member — took over the pennant side in 2019."
}
```

- `position_group` — must be one of `board | staff | committee | member`. Backend validates. 400 `bad_position` on unknown.
- `public_visible` — boolean.
- `bio` — string ≤ 500 chars, or `null` to clear. 400 `bio_too_long` when > 500.

Sent as a partial update alongside existing fields (`title`, `role`, etc). All previously supported fields keep working.

---

## 5. What we want verified in prod

Same lifecycle format as prior briefs — please run through and confirm:

| Step | Expected |
|------|----------|
| PATCH a member with `position_group='board'`, `title='President'`, `bio='…'` | ✅ 200 with updated fields |
| PATCH `position_group='bogus'` | ✅ 400 `bad_position` |
| PATCH `bio` > 500 chars | ✅ 400 `bio_too_long` |
| PATCH `public_visible: false` on a member | ✅ 200 |
| `GET /public/clubs/:slug/members` (default sort) | ✅ Board first, then Staff, Committee, Members; alpha within each |
| `?position=board` | ✅ Only board members |
| `?position=committee` | ✅ Board + Committee combined |
| `?position=staff` | ✅ Only staff (CEO / GM / Greenkeeper / etc.) |
| `?search=greenkeeper` | ✅ Matches title substring |
| Member with `public_visible=false` | ✅ Absent from list AND profile 404 |
| `GET /public/clubs/:slug/players/1111` | ✅ Returns full profile with trophies + club stub |
| `GET /public/clubs/:slug/players/notanumber` | ✅ 400 `bad_user_id` |
| `GET /public/clubs/:slug/players/999999` (unknown) | ✅ 404 `unknown_player` |
| `trophies_count` matches the length of the reverse-index array for the same user | ✅ |

---

## 6. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/members.ts`** — add `publicList(slug, params)` + `publicPlayer(slug, userId)` using `publicFetch`. Types: `PublicMember`, `PublicPlayerProfile`.
- **`apps/club-sites/pages/players/[userId].vue`** — new page rendering the profile with hero + trophies section. Fixes task #109 and stops the dead links from the calendar detail modal + honour-board recent-winners strip.
- **`packages/content-blocks/src/blocks/MembersSearchBlock.vue`** — new public block. Filter chips (All / Board / Staff / Committee / Members), search input, grid of member cards (avatar + name + title + trophies pill), clicking a card routes to `/players/:userId`. Same design language as HonourBoardSearchBlock + EventsCalendarBlock — palette-tinted avatars, skeleton on first load, empty state on filter miss.
- **CRM member edit modal** — add `position_group` dropdown (4 options), `public_visible` toggle, `bio` textarea. `title` field stays where it is. All new fields optional.

---

## 7. Non-goals

- **No RSVP-style directory permissions.** Members either appear (default) or don't (owner toggled off). No per-visitor gating.
- **No email / phone / address on public endpoints.** Ever. Directory + profile are name / role / trophies only.
- **No player-editable profiles yet.** Owners edit via CRM. Once a player app / self-service flow lands, we'll extend PATCH to accept a member-scoped write path.
- **No club-scoped honour-board categories on the profile.** `trophies.recent` is chronological across all categories the user has won at this club. Full list stays behind the existing reverse-index endpoint.
- **No CSV export.** Later brief if owners ask.
- **No `?format=` filter overlays** (e.g. "singles winners only") — the profile page can filter client-side if that becomes a thing.

---

## 8. Open questions

1. **Onboarding backfill for existing clubs** — Melbourne + Nae Nae already have members. What defaults should `position_group` take? Recommend:
   - Members with `club_role IN ('owner', 'admin')` → `position_group = 'committee'`
   - Members with `club_role = 'committee'` → `position_group = 'committee'`
   - Everyone else → `position_group = 'member'` (default)
   - Owners then promote individuals to `board` / `staff` via the CRM.
2. **`trophies_count` performance** — computing per-member on every list read means a JOIN + GROUP BY. For clubs with 500 members this is 500 subqueries. Cheap indexed lookup as-is (small tables), but flag if we need to precompute + cache.
3. **`joined_year` fallback** — for members imported via CSV without a `created_at`, backend returns `null`. Frontend shows "Member" instead of "Member since XXXX" when null. OK, or would you rather backend synthesise a fallback year?
4. **Rate limit** — 60 req/min per IP for both endpoints. Same as `/site` and `/events`.

---

## 9. Contact

`#torny-eng`. Ping if `position_group` clashes with something already in the schema or if the profile-page shape needs adjusting for a specific consumer.
