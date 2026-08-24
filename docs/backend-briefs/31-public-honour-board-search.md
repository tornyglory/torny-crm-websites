# Public Honour Board — searchable full-page endpoints

**Feature:** two public (no-auth) endpoints the club-sites `/honour-board` page needs to render the full "wall of names" design — a category rail on the left, a searchable / sortable table of every entry on the right, and pagination through however many decades a club has recorded.

**Related:** brief 28 (honour-board CRUD — authed CRM endpoints already shipped). The `/site` payload's `honour_board_recent[]` is capped at 60 entries; centuries-old clubs need the full list.

**Status:** requested. Frontend can build the page against `/site.honour_board_recent[]` as an MVP fallback, but the searchable / full-history view needs its own public surface.

---

## TL;DR

1. **`GET /public/clubs/:slug/honour-categories`** — list every visible category for the rail, with `entry_count` + `latest_year` so the rail can annotate each row (e.g. "42 champions · since 1953").
2. **`GET /public/clubs/:slug/honour-entries?category_slug=…&search=…&limit=50&offset=0`** — the full paginated + searchable list of entries with nested `players[]`. Same shape as `/site.honour_board_recent[]` entries, plus `runner_up` and `awarded_at` for the columns the design shows.

Both public, no auth. Cached the same way `/site` is (5 min shared + 30 min SWR).

---

## Base URL

Same public base as `/site`:

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

---

## 1. `GET /public/clubs/:slug/honour-categories`  (public, no auth)

Returns every category the club has marked visible, ordered by `sort_order ASC, id ASC`.

**200:**

```json
{
  "status": "success",
  "data": {
    "categories": [
      {
        "category_id": 1,
        "slug": "champion-of-champions",
        "name": "Champion of Champions",
        "format_slug": "singles",
        "gender": "open",
        "description": null,
        "entry_count": 42,
        "latest_year": 2026,
        "earliest_year": 1953
      }
    ]
  }
}
```

- `slug` — the same slug used in `/site.honour_board_recent[i].category_slug` so the client can round-trip.
- `format_slug` — `singles` / `pairs` / `triples` / `fours` / `other`. Comes from the format lookup; safe to omit if we prefer to keep this endpoint slim.
- `entry_count` / `latest_year` / `earliest_year` — aggregate hints for the rail. Cheap to compute from a single grouped query.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Club exists but hasn't onboarded | 404 | `not_onboarded` |

---

## 2. `GET /public/clubs/:slug/honour-entries`  (public, no auth)

Returns paginated entries with nested `players[]`.

**Query params:**

- `category_slug` (optional) — filter to one category. Omit for "all categories" search.
- `search` (optional) — case-insensitive substring match on `player.display_name`, `notes`, or `year` (as a string). Server-side to keep the table honest for owners with 300+ entries.
- `limit` — 1..100, default **50**.
- `offset` — pagination.
- `sort` — `year_desc` (default) / `year_asc`.

**200:**

```json
{
  "status": "success",
  "data": {
    "entries": [
      {
        "entry_id": 501,
        "category_slug": "mens-fours",
        "category_name": "Men's Fours",
        "year": 2026,
        "note": "Down 12–8 at end 15",
        "awarded_at": "2026-03-14",
        "runner_up": "Naenae Blue",
        "score": "21–14",
        "players": [
          { "user_id": 1111, "display_name": "Marcus Tuilagi", "position": "Skip" },
          { "user_id": 1115, "display_name": "Bob Third",     "position": "Third" },
          { "user_id": null, "display_name": "C. Guest",      "position": "Second" },
          { "user_id": 1120, "display_name": "D. Lead",       "position": "Lead" }
        ]
      }
    ],
    "total": 42,
    "has_more": false
  }
}
```

**Fields (over and above brief 28's shape):**

- `runner_up` — free text, nullable. Displayed in the "Runner-up" column of the design. Not in the current schema — add `runner_up TEXT NULL` to `club_honour_entries`, or return `null` from day one and add later.
- `awarded_at` — ISO date (nullable). Already asked for in brief 28 as an optional column; the design needs it for the "Awarded" column.
- `score` — free text (already exists). Shown as a small chip.
- `note` — one-liner (already exists).

**Filter:** only `is_visible = 1` categories included.

**Sort:** default `year DESC, sort_order ASC` (matches the design's "Newest" default).

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Unknown slug | 404 | `unknown_club` |
| Unknown `category_slug` | 400 | `unknown_category` |
| Bad `limit` / `offset` | 400 | `bad_pagination` |
| `search` > 200 chars | 400 | `bad_search` |

---

## 3. Why not just bump `honour_board_recent[]` in `/site`?

Considered — but:

- The `/site` payload is fetched by every page render on the public site. Sending 300 honour-board rows just so `/honour-board` can render its table would bloat every home-page load.
- The design has server-side search / filter / sort. Server-side pagination is required for correctness even before we scale.
- Keeping the wall-of-names endpoint separate lets us cache it independently (30 min SWR is plenty — honour boards rarely change).

`honour_board_recent[]` stays as-is (60 cap) and remains what the `HonourBoardBlock` on the home page reads.

---

## 4. Caching

Match `/site` — 5 min shared + 30 min SWR. Purge with the same revalidate webhook backend already fires on honour entry create/update/delete (brief 28).

---

## 5. Verification

```bash
# Categories
curl -i 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/melbourne-bowling-club/honour-categories'
# → 200 with data.categories[] populated

# All entries, most recent first
curl -i 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/melbourne-bowling-club/honour-entries?limit=10'
# → 200 with 10 entries, sort year DESC

# Category filter
curl -i 'https://…/public/clubs/melbourne-bowling-club/honour-entries?category_slug=mens-fours'

# Search
curl -i 'https://…/public/clubs/melbourne-bowling-club/honour-entries?search=tuilagi'

# Pagination
curl -i 'https://…/public/clubs/melbourne-bowling-club/honour-entries?offset=50&limit=50'
```

---

## 6. Non-goals

- **No RSS / iCal / CSV export.** The design has no export button. If owners want a downloadable version, we ship a `?format=csv` variant later.
- **No per-entry public detail endpoint.** Clicking a row opens a client-side modal; no separate `/public/…/honour-entries/:id` needed yet.
- **No player-scoped reverse index here** — that already exists as authed `honourBoard.forPlayer(userId)` and there's a separate public `/players/:userId/honour-board` shipped in brief 28.

---

## 7. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/honour-board.ts`** — add `publicListCategories(slug)` + `publicListEntries(slug, params)` calling `publicFetch` (no bearer). Mirrors the shape brief 28 already exports for the authed CRM variants.
- **`apps/club-sites/pages/honour-board/index.vue`** — full rewrite to the Paper design:
  - Category rail (from `publicListCategories`)
  - Search input (debounced 250ms → refetch with `search=`)
  - Sort dropdown (`year_desc` / `year_asc`)
  - Sortable table with the year / champion / runner-up / score / awarded columns from the design
  - "Load older" button → paginated fetch with `offset += limit`
- **MVP fallback** — while backend picks this up, the page reads from `/site.honour_board_recent[]` (60-cap) and client-filters. Same UX minus true pagination, and the "Load older" button shows an empty state noting the limitation. Swap in the real endpoints in a follow-up commit.

---

## 8. Open questions

1. **Runner-up storage** — worth adding `runner_up TEXT NULL` now, or keep `note` as a catch-all for that context? Design shows it as a distinct column so a proper field feels right, but happy to defer.
2. **Search scope** — recommend player names + note. Should we also search categories from the "all categories" state (i.e. typing "singles" surfaces every Men's/Ladies Singles entry)? Small cost; nice-to-have.
3. **`format_slug` on categories** — cheap to include; enables the frontend to show a "Fours" badge next to entry titles. Include or skip?
4. **Rate-limit** — 60 req/min per IP feels safe for a public read endpoint; matches `/site`.

---

## 9. Contact

`#torny-eng`. Ping if `runner_up` and `awarded_at` need schema conversations, or if the pagination shape needs tweaks for future infinite-scroll UIs.
