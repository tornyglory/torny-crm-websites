# Tournament blocks — Whitelist + `club_slug` filter on public list

**Feature:** three new content blocks let clubs embed tournament content on their public site — a Tournament Search block (filter rail + featured card + list), an Upcoming Tournaments list block (three-row strip), and a Tournament Hero block (single featured event, full-bleed).

**Two backend changes are needed:**
1. **Whitelist** the three new block types (`tournamentSearch`, `upcomingTournamentsList`, `upcomingTournamentHero`) on the page-layout validator (`PATCH /clubs/:club_id/pages/:slug`). Right now saves come back with `unknown_block_type` so owners can't persist any of these blocks. **This is the immediate blocker** — currently visible as a red "Unknown block type…" toast in the CRM Website editor.
2. **Widen `GET /public/tournaments`** with an optional `club_slug` param so the blocks can filter server-side instead of client-side.

All three blocks are already built, registered in the CRM palette, and rendering placeholders in preview.

**Status:** Frontend shipped 2026-08-29:
- `packages/content-blocks/src/blocks/TournamentSearchBlock.vue`
- `packages/content-blocks/src/blocks/UpcomingTournamentsListBlock.vue`
- `packages/content-blocks/src/blocks/UpcomingTournamentHeroBlock.vue`
- Registered in `BlockRenderer.vue`, CRM palette (home + events pages), and editor sidebars.

Blocks currently fetch `/public/tournaments` with the existing params, then filter client-side by `t.club.slug === BlockContext.clubSlug`. This works but bleeds bandwidth (we fetch cross-network results and throw most away) and breaks pagination + count accuracy. The change below fixes both.

**Related briefs:**
- Brief 47 — tournaments Phase 1 parent brief. The `GET /public/tournaments` endpoint is spec'd in §10 there.
- Brief 48 — tournament cover + gallery. Already shipped; both new blocks depend on `cover_image_url` being present, which brief 48 delivers.
- Brief 44 — venue-hire blocks whitelist. Same structural pattern as §2 below — copy the row shape into `KNOWN_BLOCKS`.
- Brief 43 — peopleGrid + gallery whitelist. Prior art for the propTypes schema.

---

## Base URL

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

No auth. Existing cache policy from brief 47 §10 (`public, max-age=60, stale-while-revalidate=300`) stays.

---

## 1. Whitelist — three new block types

Add three rows to the `KNOWN_BLOCKS` map behind the page-layout validator. Same pattern as brief 43 § 1.1 and brief 44 § 1–3. Every prop is optional — the blocks fetch their own data at render time, so an owner can drop any of these onto a page without needing to configure anything.

### 1.1 `tournamentSearch`

Full searchable finder — left filter rail, featured card, list of tournament rows.

```js
tournamentSearch: {
  requiredProps: [],
  optionalProps: [
    'eyebrow', 'heading', 'description',
    'scope', 'pageSize',
    'showFilterChips', 'showSearch', 'openOnly',
    'ctaLabel', 'ctaHref',
  ],
  propTypes: {
    eyebrow: 'string',            // max 120
    heading: 'string',             // max 200
    description: 'string',         // max 800
    scope: 'string',               // 'club' | 'network' — anything else → 400 bad_scope
    pageSize: 'number',            // int, 6..50
    showFilterChips: 'boolean',
    showSearch: 'boolean',
    openOnly: 'boolean',
    ctaLabel: 'string',            // max 60
    ctaHref: 'string',             // same URL validator as hero.primaryCta.href — empty allowed
  },
}
```

### 1.2 `upcomingTournamentsList`

Compact three-row strip.

```js
upcomingTournamentsList: {
  requiredProps: [],
  optionalProps: [
    'eyebrow', 'heading', 'description',
    'limit', 'ctaLabel', 'ctaHref', 'scope',
  ],
  propTypes: {
    eyebrow: 'string',             // max 120
    heading: 'string',             // max 200
    description: 'string',         // max 400
    limit: 'number',               // int, 1..8
    ctaLabel: 'string',            // max 60
    ctaHref: 'string',             // URL validator; empty allowed
    scope: 'string',               // 'club' | 'network' — same enum as §1.1
  },
}
```

### 1.3 `upcomingTournamentHero`

Full-bleed hero for a single featured tournament.

```js
upcomingTournamentHero: {
  requiredProps: [],
  optionalProps: [
    'tournamentSlug', 'description',
    'primaryLabel', 'secondaryLabel',
  ],
  propTypes: {
    tournamentSlug: 'string',      // max 80 — matches `slug` on `tournaments` (brief 47)
    description: 'string',         // max 800
    primaryLabel: 'string',        // max 40
    secondaryLabel: 'string',      // max 40
  },
}
```

**Cross-block enum — `scope`:** `'club'` (default) or `'network'`. Unknown → 400 `bad_scope`. Consistent between §1.1 and §1.2 so the validator can share a single helper.

**No dependency on `tournamentSlug` existing.** The `upcomingTournamentHero` block auto-picks the next-closing tournament at render time if `tournamentSlug` is empty. Even if a pinned slug points at a deleted tournament, the block just falls back to "No open tournaments right now." — no server-side referential integrity needed.

---

## 2. The endpoint change

Extend `GET /public/tournaments` with one new query param:

| Param       | Type    | Default | Behaviour |
|---|---|---|---|
| `club_slug` | string  | –       | If present, only return tournaments where `t.club.slug === club_slug`. Wraps the existing filters (they still apply). |

That's the whole ask. No new endpoints, no new columns, no response-shape change.

**Example:**

```
GET /public/tournaments?club_slug=mangere-bowls&open_only=true&sort=entries_close_asc&limit=3
```

Returns the same `PublicTournamentsListResponse` shape as today — just narrowed to Mangere's own tournaments.

**Validation:**

- Unknown `club_slug` → return `200 { tournaments: [], pagination: { limit, page: 1, total_items: 0, total_pages: 0 } }`. Do **not** 404 — the block is embedded on a live club site and 404 would surface as a broken block rather than "no upcoming tournaments yet."
- `club_slug` alongside `region` — both apply (AND). Region filter becomes redundant but harmless in that case.

---

## 3. Why the endpoint change matters

Without server-side filter each block does:

```ts
const res = await tournaments.publicList({ open_only: true, limit: 20 })
const own = res.tournaments.filter(t => t.club.slug === clubSlug)
```

Which is:

- **Wasteful** — the block fetches 20 tournaments network-wide to keep 1–3 belonging to the host club.
- **Broken pagination** — the `total_items` count reflects the network, not the club, so the "Load more" button lies and the "N upcoming" eyebrow is wrong.
- **Fragile** — a very active network could push the host club's tournaments past the fetch limit, and they'd never appear on their own site.

With `club_slug` all three problems disappear. The block can request `limit=props.limit`, the count is honest, and no data is thrown away.

---

## 4. Verification

Whitelist (§1):
- ✓ `PATCH /clubs/:id/pages/home` with a `tournamentSearch` block saves + persists
- ✓ Same for `upcomingTournamentsList` and `upcomingTournamentHero`
- ✓ Any of them with a bogus scope (e.g. `scope: 'planet'`) → `400 bad_scope`
- ✓ `limit: 999` on `upcomingTournamentsList` → `400 bad_prop` (range 1..8)
- ✓ `pageSize: 3` on `tournamentSearch` → `400 bad_prop` (range 6..50)
- ✓ Extra unknown prop on any of the three → stripped silently (existing behaviour)
- ✓ Round-trip `GET` returns the block with all props preserved

Endpoint (§2):
- ✓ `GET /public/tournaments?club_slug=mangere-bowls` returns only Mangere's tournaments
- ✓ Unknown `club_slug` returns `200 { tournaments: [], pagination.total_items: 0 }`
- ✓ `club_slug` composes with `open_only`, `format`, `category`, `gender`, `region`, `q`, `starts_after`, `starts_before`, `entry_fee_max` — the existing filters keep applying
- ✓ `sort=entries_close_asc` with `club_slug` returns the club's tournaments in closing-soonest order
- ✓ Pagination — `?club_slug=foo&limit=5&page=2` returns the correct slice of the club's tournaments (and accurate `total_pages` / `total_items`)
- ✓ Cache — the same `public, max-age=60, stale-while-revalidate=300` header on club_slug-filtered responses

---

## 5. TS types (deltas for `packages/api-client/src/resources/tournaments.ts`)

Trivial — one new optional field on the existing input type:

```ts
export interface PublicListTournamentsParams {
  format?: TournamentFormat
  category?: TournamentCategory
  gender?: 'mens' | 'womens' | 'mixed'
  region?: string
  club_slug?: string          // ← new
  starts_after?: string
  starts_before?: string
  entry_fee_max?: number
  open_only?: boolean
  q?: string
  sort?: PublicSort
  page?: number
  limit?: number
}
```

Once the backend ships, we drop the client-side `.filter(t => t.club.slug === clubSlug)` in each block and pass `club_slug` directly. Zero component changes required.

---

## 6. Non-goals (deferred)

- **`club_slug[]` / multi-club filter.** A federation view (Bowls Wellington filtering to member clubs) is future scope. Solve when a real ask lands.
- **Featured-tournament hint per club.** The Tournament Hero block currently uses `sort=entries_close_asc` + first result. If clubs later want to pin a specific tournament for the site hero, we already expose the `tournamentSlug` prop on `UpcomingTournamentHeroProps` which hits the existing `GET /public/tournaments/{club_slug}/{tournament_slug}` endpoint. No backend work needed there.
- **`saved`/`entered` personalized rails.** The Paper design shows "You're entered in" and "Come back to these" cards on the search block. Those need auth + a saved-tournaments feature that doesn't exist yet. Blocks intentionally omit the rails on this pass — they light up when a future BlockContext.userTournaments injection appears.

---

## 7. Contact

Same as brief 47.
