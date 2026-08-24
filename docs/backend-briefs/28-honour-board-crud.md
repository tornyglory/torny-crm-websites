# Honour Board — CRUD Endpoints for the CRM

**Feature:** the four endpoints that back the CRM's Honour Board view (`/crm/honour-board`) + the enrichment the `HonourBoardBlock` needs. Clubs can list, create, update, and delete honour-board entries per category, and the public `/site` payload continues to surface the most recent entries.

**Related:** brief 16/17 (page builder — the block reads from `/site`), brief 20 (event types — same "categorised list" pattern), `packages/api-client/src/resources/honour-board.ts` (existing but not wired), `apps/crm/src/views/honour-board/HonourBoardView.vue` (currently mocked).

**Status:** requested — CRM ships a fully-mocked Honour Board view + a public block that reads from `site.honour_board_recent`. api-client declares the resource but the CRM never calls it.

---

## TL;DR

1. **Endpoints for categories** — clubs need to CRUD their own categories (Champion of Champions, Men's Singles, etc). Not just entries.
2. **Endpoints for entries** — list per category, create, update, delete. Optional `member_id` link + free-text `member_name` fallback (guest wins, historic entries).
3. **`/public/clubs/:slug/site`** — `honour_board_recent` gains a few optional fields the new `HonourBoardBlock` design uses: `initials`, `score`, `awarded_at`, `category_slug`, `category_name`. Backend already returns some; extend the rest.
4. **Auth:** owner or admin for mutations; anyone reads via `/site`.

---

## Base URL

`CRM_BASE`, Bearer JWT. `/public/clubs/:slug/site` stays public.

---

## 1. Data model

Existing tables (per `packages/api-client/src/types.ts`):

```
honour_board_categories
  id            bigserial pk
  club_id       int not null references clubs(id) on delete cascade
  name          text not null              -- "Champion of Champions"
  slug          text not null              -- "champion-of-champions" — kebab-case, unique per club
  position      int  not null default 0    -- sidebar order
  is_draft      boolean not null default false
  created_at    timestamptz
  updated_at    timestamptz
  deleted_at    timestamptz
  unique (club_id, slug) where deleted_at is null

honour_board_entries
  id            bigserial pk
  category_id   bigint not null references honour_board_categories(id) on delete cascade
  year          int    not null
  member_id     int    null references users(id) on delete set null
  member_name   text   not null            -- redundant when member_id set, canonical when not
  photo_url     text   null                -- Cloudflare public_url
  score         text   null                -- "21–14" free text
  notes         text   null                -- one-line context ("Skip since 2011")
  awarded_at    timestamptz null           -- when the trophy was actually presented
  created_at    timestamptz
  updated_at    timestamptz
  deleted_at    timestamptz
  index (category_id, year desc) where deleted_at is null
```

**Migration needed** — only if `awarded_at` isn't on the entries table yet:

```sql
ALTER TABLE honour_board_entries
  ADD COLUMN awarded_at TIMESTAMPTZ;
```

Everything else already exists per the current types.

---

## 2. Endpoints

### 2a. `GET /clubs/:club_id/honour-board/categories`  (🔒 owner or admin)

List every category for the sidebar. Excludes soft-deleted.

**200:**

```json
{
  "status": "success",
  "data": {
    "categories": [
      {
        "id": 1,
        "slug": "champion-of-champions",
        "name": "Champion of Champions",
        "position": 0,
        "is_draft": false,
        "entry_count": 42,
        "latest_year": 2026
      },
      { "id": 2, "slug": "mens-singles", "name": "Men's Singles", "position": 1, "is_draft": false, "entry_count": 38, "latest_year": 2025 }
    ]
  }
}
```

`entry_count` + `latest_year` are aggregate hints for the sidebar (matches the current mock UI). Ordered by `position ASC, id ASC`.

### 2b. `POST /clubs/:club_id/honour-board/categories`  (🔒 owner or admin)

Create a new category.

**Body:**

```json
{ "name": "Ladies' Singles", "slug": "ladies-singles", "is_draft": false }
```

- `name`: required, 1..80 chars.
- `slug`: optional. Backend defaults to `slugify(name)`. Must be kebab-case, unique per club, not one of the reserved system slugs (empty string, `all`).
- `is_draft`: optional, defaults `false`.
- `position`: not accepted; backend appends at `MAX(position) + 1`.

**201:** returns the created row (same shape as list, with `entry_count: 0`, `latest_year: null`).

**Errors:** `400 bad_slug` / `400 slug_conflict` / `400 bad_name` / `403 forbidden` / `401 unauthorized`.

### 2c. `PATCH /clubs/:club_id/honour-board/categories/:category_id`  (🔒 owner or admin)

Rename, reslug, reorder, toggle draft.

**Body:**

```json
{ "name": "Ladies Singles", "slug": "ladies-singles", "position": 2, "is_draft": false }
```

All fields optional. Same slug validation as create. Position re-numbers siblings dense.

### 2d. `DELETE /clubs/:club_id/honour-board/categories/:category_id`  (🔒 owner or admin)

Soft-delete. Cascade-hides all entries in the category (no `DELETE` on entries).

**204 No Content.** Sweeper hard-deletes after 30 days.

**Errors:** `400 category_has_entries` if the frontend wants a confirmation flow — recommend: allow delete regardless, entries come back on category restore.

### 2e. `GET /clubs/:club_id/honour-board/categories/:category_id/entries`  (🔒 owner or admin)

List every entry in a category, newest year first. No pagination — even century-old clubs have < 200 entries per category.

**200:**

```json
{
  "status": "success",
  "data": {
    "entries": [
      {
        "id": 501,
        "year": 2026,
        "member_id": 42,
        "member_name": "Marcus Tuilagi",
        "initials": "MT",
        "photo_url": "https://imagedelivery.net/…/public",
        "score": "21–14",
        "notes": "Skip since 2011",
        "awarded_at": "2026-03-14T00:00:00Z"
      }
    ]
  }
}
```

`initials` is server-derived (from `member_name`) so the frontend doesn't have to re-compute for every row. If the club provided one explicitly (custom stylised, non-Latin script), backend echoes that instead.

### 2f. `POST /clubs/:club_id/honour-board/categories/:category_id/entries`  (🔒 owner or admin)

Create a new entry.

**Body:**

```json
{
  "year": 2026,
  "member_id": 42,
  "member_name": "Marcus Tuilagi",
  "score": "21–14",
  "notes": "Skip since 2011",
  "awarded_at": "2026-03-14",
  "photo_url": null
}
```

- `year`: required, 1900..current+1.
- `member_id`: optional. If set, backend derives `member_name` from the members table on read (and echoes what was passed on write for the audit trail). If null, `member_name` is canonical.
- `member_name`: required if `member_id` is null; free text.
- `score`: optional, ≤ 24 chars.
- `notes`: optional, ≤ 240 chars.
- `awarded_at`: optional ISO date.
- `photo_url`: optional. Uses the standard club-image upload flow (`content_type=avatar`, per brief 18's pattern) and PATCHes the URL back onto the entry.

**201:** returns the created row (same shape as list).

**Errors:** `400 bad_year` / `400 member_name_required` / `400 bad_score` / `403` / `404 category_not_found`.

### 2g. `PATCH /clubs/:club_id/honour-board/entries/:entry_id`  (🔒 owner or admin)

Same body as POST, all fields optional. Backend confirms the entry still belongs to the caller's club before editing.

**200:** updated row.

### 2h. `DELETE /clubs/:club_id/honour-board/entries/:entry_id`  (🔒 owner or admin)

Soft-delete. **204 No Content.** Same 30-day sweeper as categories.

---

## 3. `/public/clubs/:slug/site` — the `honour_board_recent` shape

Extend the existing array with the fields the new `HonourBoardBlock` uses:

```json
"honour_board_recent": [
  {
    "category_slug": "champion-of-champions",
    "category_name": "Champion of Champions",
    "year": 2026,
    "member_name": "Marcus Tuilagi",
    "initials": "MT",
    "photo_url": null,
    "score": "21–14",
    "notes": "Skip since 2011",
    "awarded_at": "2026-03-14T00:00:00Z"
  }
]
```

**Bumped fields:** `initials`, `score`, `awarded_at`, `photo_url` (optional in the frontend type; add whichever the backend has).

**Sort:** by `year DESC, category.position ASC`. Cap at **60 entries** total so the payload stays lean.

**Category filter?** Not needed — the block filters client-side by `category_slug` prop.

---

## 4. Auth + tenancy

- Read (`GET /site`): public, no auth.
- Read (CRM lists): owner or admin only.
- Write: owner or admin only.
- All queries scope by `club_id` — no cross-tenant leakage even if a URL is guessed.

`403 forbidden` when the JWT is valid but not authorised for the club. `401 unauthorized` when missing/invalid.

---

## 5. Migration + rollout

1. **Migration 093** — add `awarded_at` column if absent (§1).
2. **Ship the six CRM endpoints in §2.**
3. **Extend `honour_board_recent` in the `/site` shaping code** with `initials` (server-computed) + `awarded_at`.
4. **Regression test:** the current `/site` payload keeps working for existing clubs with no entries (empty array).
5. **Fire the Nuxt revalidate webhook** on entry create / update / delete + on category updates (`purge: "all"`, `reason: "settings.honour_board_updated"`).

---

## 6. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/honour-board.ts`** — rewrite to match the current `authedFetch`-based pattern (like `pages`, `stylePresets`). Add `deleteEntry`, `deleteCategory`, `updateCategory`, `createCategory`. Retire the old `TornyClient` calls.
- **CRM Honour Board view** — replace the mock local state with a real store fetching categories on mount, entries per selected category. Wire the `+ Add entry` modal + row editor + delete confirmation.
- **HonourBoardBlock** already reads the new fields (`initials`, `score`, `awarded_at`) with `?` — no change needed once backend surfaces them.

---

## 7. Non-goals

- **No per-entry photo cropping / focal-point.** Cloudflare handles.
- **No "life member" toggle here.** Life members are handled by brief 27's custom pages + a separate roster — this is competition trophies only.
- **No import from CSV.** Owner types entries into the CRM (or migrates by SQL if they have a decade of history to backfill).
- **No public search / filter API.** The block filters client-side; a full "Honour board · search" page can rebuild the endpoint later with query params if we outgrow the 60-entry cap.
- **No public "member profile → their honour-board history" endpoint.** Separate future brief when we ship player profiles on the public site.
- **No public entry-detail page.** Blocks show summary rows; a click could open a modal client-side.

---

## 8. Open questions

1. **Should slug renames on categories emit `old_slug_broken` warnings** the way page renames do (brief 27)? Recommend yes — the category slug flows into the block's `categorySlug` prop. Renaming breaks any block that pinned to the old slug.
2. **`member_id` link semantics** — should backend enforce `member_id` belongs to the same club, or just accept any user id? Recommend enforce (403 if cross-club).
3. **Rate-limit** entry create? Suggest 60 per hour per club, high enough to bulk-import an entire decade in one sitting.
4. **Do we want a `POST /honour-board/entries/:id/restore` mirror** the way pages have (brief 27)? Recommend yes — same 30-day window, same platform-admin-only exposure until a "recently deleted" UI ships.

---

## 9. Contact

`#torny-eng`. Happy to align on the category rename story or the member-id vs member-name canonicality if it changes anything.
