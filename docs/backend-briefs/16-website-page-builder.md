# Backend brief — Website page builder

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` — new `/crm/website` editor + `apps/club-sites` renderer
**Depends on:** brief 10 (onboarding writes `public_site_pages` toggles), brief 14/15 (public site + revalidate)
**Status:** Frontend has `packages/content-blocks` (8 block types, typed schema, `<BlockRenderer>` component). No layout persistence yet — this brief covers the CRUD + publish for that.
**Owner:** Neville Rodda (`nev@torny.co`)

---

## TL;DR

- Each club page (`home`, `about`, `membership`, `events`, `honour-board`, `contact`) has a **layout JSON** owned by the club. Blocks are ordered top-to-bottom.
- **Draft + Published** — owner edits `layout_draft` (autosaved as they type); public site renders `layout_published`. Publish button copies draft → published + fires the revalidate webhook from brief 14 §4.
- **Two endpoints**: `GET/PATCH /clubs/:id/pages/:pageSlug` for the editor; `POST .../publish` to flip it live.
- The **public site payload** (§brief 15 `GET /public/clubs/:slug/site`) gains a `pages` object keyed by slug so the Nuxt renderer gets published layouts in the same request it already makes.
- Block schema is authoritative in `packages/content-blocks/src/types.ts` — same discriminated union used by CRM editor + Nuxt renderer. Backend stores it as opaque JSONB.

---

## 1. The block schema — same on both sides

Frontend already has this in `packages/content-blocks/src/types.ts`:

```ts
export type BlockType =
  | 'hero'
  | 'richText'
  | 'eventList'
  | 'honourBoard'
  | 'gallery'
  | 'contactForm'
  | 'membershipCta'
  | 'ctaBanner'

export interface BlockBase<T extends BlockType, P> {
  id: string          // client-generated ULID
  type: T
  props: P
}

// Discriminated union: Block = Hero | RichText | EventList | Honour | Gallery | Contact | MembershipCta | CtaBanner
```

Each block type has its own `props` shape (see the file for the full list). Backend does not need to validate props against those shapes — it stores the whole layout as opaque JSONB. Frontend guarantees the shape via TypeScript before sending.

**A page's layout:**

```jsonc
{
  "blocks": [
    { "id": "blk_01H...", "type": "hero", "props": { "heading": "Melbourne Bowling Club", "subheading": "Est. 1864" } },
    { "id": "blk_01H...", "type": "eventList", "props": { "heading": "What's on", "limit": 4, "upcomingOnly": true } },
    { "id": "blk_01H...", "type": "membershipCta", "props": { "heading": "Play with us", "body": "…", "ctaLabel": "Join", "ctaHref": "/membership" } }
  ]
}
```

`id` values are client-generated. Backend doesn't own or mint them; they're just for React/Vue key stability.

**Size cap:** enforce max 50 blocks per page and max 200KB serialised JSON. Anything larger is almost certainly a bug.

---

## 2. Endpoints

### 2.1 `GET /clubs/:clubId/pages/:pageSlug`  (🔒 owner or admin)

Read the editor state for a page. Returns both draft and published so the editor can show "you have unpublished changes" hints.

**Path params:**
- `pageSlug` — one of `home | about | membership | events | honour-board | contact`.

**200 Success:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "is_published": true,
    "layout_draft": {
      "blocks": [ /* ... */ ]
    },
    "layout_published": {
      "blocks": [ /* ... */ ]
    },
    "draft_updated_at": "2026-08-21T10:14:22.000Z",
    "published_at":     "2026-08-20T09:00:00.000Z",
    "has_unpublished_changes": true
  }
}
```

`has_unpublished_changes` = `draft_updated_at > published_at` OR `layout_published === null`. Cheap to compute at query time.

**First-load behaviour:** if the club has no `public_site_pages` row for this slug, return a **seeded default** layout appropriate to the page (see §5) rather than a 404. The owner is then editing a virtual draft that gets persisted on first PATCH.

**Errors:**
- `403 forbidden` — not owner/admin on this club
- `404 not_found` — invalid `pageSlug`
- `500 internal`

### 2.2 `PATCH /clubs/:clubId/pages/:pageSlug`  (🔒 owner or admin)

Autosave. Called on every meaningful edit (debounced ~500ms on the frontend).

**Request:**
```json
{
  "layout_draft": { "blocks": [ /* full array */ ] }
}
```

Full replace of `layout_draft`. Server does **not** diff — accept the whole `blocks[]` as authoritative. Simplifies both sides.

**200 Success:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "draft_updated_at": "2026-08-21T10:14:22.000Z"
  }
}
```

**Server-side validation:**
- `blocks` must be an array.
- `blocks.length` ≤ 50.
- Serialised body ≤ 200KB.
- Every block must have `id`, `type`, `props`. Reject with `400 invalid_block_shape` if any block is missing fields.
- `type` must be one of the 8 known values → `400 unknown_block_type`. Add new types via migrations so old clients can't inject garbage.

**Errors:**
- `400 bad_json`
- `400 too_many_blocks` — > 50
- `400 payload_too_large` — > 200KB
- `400 invalid_block_shape`
- `400 unknown_block_type` (body includes `{ type: "..." }`)
- `403 forbidden`
- `404 not_found`

### 2.3 `POST /clubs/:clubId/pages/:pageSlug/publish`  (🔒 owner or admin)

Copy `layout_draft` → `layout_published`, set `published_at`, fire the revalidate webhook.

**Empty body.**

**200 Success:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "published_at": "2026-08-21T10:14:30.000Z",
    "public_url": "https://melbourne-bowling-club.torny.club/"
  }
}
```

**Atomic transaction:**
1. Copy `layout_draft` → `layout_published` on the `public_site_pages` row.
2. Set `is_published = true` (already true after first publish).
3. Set `published_at = NOW()`.
4. Fire `POST sites.torny.club/api/revalidate` (per brief 14 §4) with `paths: ["/<pageSlug === 'home' ? '' : pageSlug>"]`, `reason: "page.published"`. Fire-and-forget.

**Errors:**
- `400 empty_draft` — `layout_draft.blocks` is empty on first publish (allow subsequent unpublish → later republish, but not first publish with nothing)
- `403 forbidden`
- `404 not_found`
- `500 internal`

### 2.4 (Optional) `POST /clubs/:clubId/pages/:pageSlug/unpublish`  (P2)

Sets `is_published = false`, purges the public route to a "coming soon" state. Not blocking for MVP — owners can toggle `pages_enabled` via the settings surface (once it exists).

---

## 3. Public site payload extension

The existing `GET /public/clubs/:slug/site` (brief 15 §2) already returns `pages_enabled`. Add a **`pages`** map alongside it with the published layouts:

```jsonc
{
  "status": "success",
  "data": {
    "club":              { /* … */ },
    "contact":           { /* … */ },
    "hours":             [ /* … */ ],
    "membership_tiers":  [ /* … */ ],
    "events_upcoming":   [ /* … */ ],
    "honour_board_recent": [ /* … */ ],
    "pages_enabled":     { /* … */ },

    "pages": {
      "home":   { "blocks": [ /* … */ ] },
      "about":  { "blocks": [ /* … */ ] },
      // Only include pages with a published layout. Skip un-published slugs.
      // Clients fall back to a hardcoded template when a page is missing.
    }
  }
}
```

- Payload size: 50 blocks × 6 pages × ~1KB average ≈ 300KB max, generally under 50KB. Fine to bundle.
- If it does grow, split to per-page endpoints later (`GET /public/clubs/:slug/pages/:pageSlug`). Same shape — one entry from the `pages` map.

---

## 4. Data model

Extends brief 10 §4's `public_site_pages` skeleton:

```sql
public_site_pages
  id, club_id FK,
  slug VARCHAR(30) NOT NULL,            -- 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
  is_published BOOL DEFAULT false,
  layout_draft JSONB NULL,               -- { blocks: [...] }
  layout_published JSONB NULL,           -- null until first publish
  draft_updated_at TIMESTAMPTZ NULL,
  published_at TIMESTAMPTZ NULL,
  created_at, updated_at,
  UNIQUE(club_id, slug)
```

Existing rows from onboarding just carry `is_published` (boolean toggle) — they need `layout_draft`/`layout_published` added as nullable columns. Migration is additive.

---

## 5. Seed layouts on first read

When `GET /clubs/:id/pages/:pageSlug` is called and no row exists (or `layout_draft` is null), return a starter layout appropriate to the slug so the owner doesn't stare at a blank canvas. Suggested seeds:

**home:**
```json
{
  "blocks": [
    { "id": "hero-1", "type": "hero", "props": { "heading": "{{club.name}}", "subheading": "{{club.tagline || 'A friendly club. New members always welcome.'}}", "primaryCta": { "label": "Join us", "href": "/membership" }, "secondaryCta": { "label": "See what's on", "href": "/events" } } },
    { "id": "events-1", "type": "eventList", "props": { "heading": "What's on", "limit": 4, "upcomingOnly": true } },
    { "id": "cta-1", "type": "membershipCta", "props": { "heading": "Play with us this season", "body": "Whether you're a first-time bowler or a seasoned skip, there's a spot for you.", "ctaLabel": "See tiers", "ctaHref": "/membership" } }
  ]
}
```

**about:** hero + richText (empty).
**membership:** hero + membershipCta.
**events:** hero + eventList (`limit: 20`).
**honour-board:** hero + honourBoard.
**contact:** hero + contactForm.

`{{club.name}}` etc. can either be resolved server-side at seed time or left as literal templating for the client to interpolate. Server-side is simpler — no client-side template engine.

---

## 6. Auth matrix

Same as brief 12 §Auth matrix — `owner` and `admin` can edit + publish; `committee` and `player` cannot.

---

## 7. Acceptance criteria

Frontend can un-mock the editor + Nuxt renderer when **all** of these are true:

- [ ] `GET /clubs/:id/pages/:pageSlug` returns the shape in §2.1, including seeded defaults for un-touched pages.
- [ ] `PATCH /clubs/:id/pages/:pageSlug` accepts a `layout_draft` full replacement, validates block shape + size caps, returns `draft_updated_at`.
- [ ] `POST /clubs/:id/pages/:pageSlug/publish` atomically copies draft → published, sets `published_at`, fires the revalidate webhook.
- [ ] `GET /public/clubs/:slug/site` gains a `pages` map with only published layouts.
- [ ] Only `owner` and `admin` can call the editor endpoints; anyone else gets 403.
- [ ] Error codes match §2's tables.

---

## 8. What frontend has ready

- `packages/content-blocks/src/types.ts` — the block schema. Backend stores this as opaque JSONB.
- `packages/content-blocks/src/BlockRenderer.vue` — switches on `block.type`, renders. Used by both the CRM preview and the Nuxt public site.
- `apps/club-sites/composables/useSite.ts` — will read `site.pages[pageSlug].blocks` and pass through `<BlockRenderer>`.
- `apps/crm/src/views/website/WebsiteEditorView.vue` — the editor we're building this milestone.

Estimated frontend wire-up once §§2.1–2.3 land: **~2 hours** for the Home page editor + Nuxt renderer swap. Additional ~1 hour per subsequent page (5 more pages).

---

## 9. Open questions

- **`richText` block sanitisation** — the frontend uses TipTap (planned) which emits sanitised HTML. Backend should still run a server-side allowlist (e.g. DOMPurify equivalent) on the `props.html` field before storing, defence-in-depth against XSS. Not blocking; flag when we ship rich text.
- **Version history.** Do owners want to see "the version I published last Tuesday" and roll back? Not in MVP. Would need `public_site_page_versions` table capturing every publish. Flag as P2.
- **Localisation.** Not in scope. If clubs need Māori/English toggle later, block props would carry `{ en: ..., mi: ... }` shapes — future migration.
- **Media uploads (for gallery + hero images).** Uses the existing media upload flow (per brief 15 §What's still coming — logo upload). Same endpoint, same CDN. `HeroProps.imageUrl` + `GalleryProps.images[].url` are just strings.
- **Should we compute `has_unpublished_changes` at read time or store it as a column?** Read-time is simpler and always accurate. Recommend read-time.

---

## 10. Suggested build order

1. `public_site_pages` migration — add JSONB columns + timestamps.
2. `GET /clubs/:id/pages/:pageSlug` with seed layouts.
3. `PATCH .../:pageSlug` with validation.
4. `POST .../:pageSlug/publish` with revalidate webhook wire-up.
5. Extend `/public/clubs/:slug/site` to include `pages` map.

Points 1-3 unblock the CRM editor. Point 4 unblocks the "publish" button. Point 5 unblocks the Nuxt renderer.

---

## 11. Contact

Same as previous briefs — `#torny-eng` on Slack.
