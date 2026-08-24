# Custom Pages — Turn Pages Into First-Class Resources

**Feature:** let clubs create arbitrary pages beyond the fixed six from brief 16 (`home / about / membership / events / honour-board / contact`). Each custom page gets a slug, title, block layout, meta, and independent publish state. Public site serves them at `/{slug}`. CRM sidebar lists all pages with a "+ New page" button.

**Related:** brief 16 (page builder), brief 17 (page-builder live), brief 25 (navigation — custom page slugs become linkable), brief 26 (per-page SEO — meta already lives on the layout).

**Status:** requested — CRM ships a sidebar today with a placeholder "+ New page" button. The 6 fixed slugs are hardcoded; this brief upgrades pages to a real resource.

---

## TL;DR

1. **New table `club_pages`** — each row is one page. Fields: `id`, `club_id`, `slug`, `title`, `layout_draft`, `layout_published`, timestamps, position. Replaces the implicit "6 slugs per club" model.
2. **Migration seeds the 6 default pages** for every existing club so the shift is invisible on the site. Their slugs stay as-is (`home`, `about`, etc.) and become non-deletable but renamable.
3. **New endpoints:**
   - `GET /clubs/:club_id/pages` — list all pages for the CRM sidebar.
   - `POST /clubs/:club_id/pages` — create a new page.
   - `PATCH /clubs/:club_id/pages/:page_id` — rename, resluglify, reorder.
   - `DELETE /clubs/:club_id/pages/:page_id` — delete (soft-delete for undo).
4. **Existing endpoints migrate from slug-keyed to ID-keyed** at the page-builder layer (`/pages/:page_id`) or **stay slug-keyed for backwards-compat** (`/pages/:slug`) — see §8 open questions. Recommend: slug-keyed with client-driven slug uniqueness.
5. **`/public/clubs/:slug/site`** — `pages` map keeps the slug as the key. Now includes every page the owner has published, not just the 6.
6. **Public Nuxt:** the existing `pages/[...slug].vue` catch-all already handles arbitrary slugs; just needs the site payload to include them.

**Non-deletable pages (`home` etc.) are a whitelist**, not a schema constraint — keeps things flexible if we ever want to allow deletion later.

---

## Base URL

`CRM_BASE`, Bearer JWT for mutations. `/public/clubs/:slug/site` stays public.

---

## 1. Data model

### New table `club_pages`

```sql
CREATE TABLE club_pages (
  id                    BIGSERIAL PRIMARY KEY,
  club_id               INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  layout_draft          JSONB,
  layout_published      JSONB,
  is_published          BOOLEAN NOT NULL DEFAULT FALSE,
  is_system             BOOLEAN NOT NULL DEFAULT FALSE,
  position              INT NOT NULL DEFAULT 0,
  draft_updated_at      TIMESTAMPTZ,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  UNIQUE (club_id, slug) WHERE deleted_at IS NULL
);

CREATE INDEX club_pages_by_club ON club_pages (club_id) WHERE deleted_at IS NULL;
CREATE INDEX club_pages_by_slug ON club_pages (club_id, slug) WHERE deleted_at IS NULL;
```

- **`slug`** — URL-safe kebab-case, 1..48 chars. See §2 for reserved slugs + validation.
- **`title`** — display label in the CRM sidebar + `<title>` fallback. 1..80 chars.
- **`is_system`** — set to `true` on the 6 seed pages so the CRM can hide "delete" on them. Renamable + reslug-able (with caveats — see §8).
- **`position`** — the sidebar order. New pages append (`max(position) + 1`).
- **`layout_draft.meta` / `layout_published.meta`** — same shape as brief 26. Nothing changes there.

### Migration seeds

For every existing club, insert 6 rows:

```sql
INSERT INTO club_pages (club_id, slug, title, is_system, position, layout_draft, layout_published, is_published, draft_updated_at, published_at)
SELECT
  c.id,
  s.slug,
  s.title,
  TRUE,
  s.position,
  -- Pull the existing per-club layout from wherever brief 16 stores it today
  (SELECT layout_draft     FROM legacy_pages WHERE club_id = c.id AND page_slug = s.slug),
  (SELECT layout_published FROM legacy_pages WHERE club_id = c.id AND page_slug = s.slug),
  ...
FROM clubs c
CROSS JOIN (VALUES
  ('home', 'Home', 0),
  ('about', 'About', 1),
  ('membership', 'Membership', 2),
  ('events', 'Events', 3),
  ('honour-board', 'Honour board', 4),
  ('contact', 'Contact', 5)
) AS s(slug, title, position);
```

Legacy `pages` table (wherever brief 16 stores it today) can be dropped once the migration is verified. Recommend: keep it read-only for 2 weeks post-migration in case rollback is needed.

---

## 2. Slug rules

- Kebab-case: `^[a-z0-9]+(-[a-z0-9]+)*$`
- 1..48 chars
- Cannot start/end with a hyphen
- **Reserved slugs (400 `reserved_slug` on POST/PATCH):**
  - `api`, `admin`, `auth`, `assets`, `_nuxt`, `_ipx` — Nuxt internals
  - `sitemap.xml`, `robots.txt`, `favicon.ico` — well-known files
  - `sign-in`, `signin`, `sign-out`, `signout` — future auth routes
- **Unique per club** (`UNIQUE (club_id, slug)` on active rows). Duplicate → 409 `slug_conflict`.
- **Renaming a slug is allowed** but returns a `warnings: ['old_slug_broken']` field — the CRM shows a confirm dialog because inbound links break. Consider a permanent-redirect story in a future brief.

---

## 3. Endpoints

### 3a. `GET /clubs/:club_id/pages`  (🔒 owner or admin)

List every page for the CRM sidebar. Includes soft-deleted-recently rows if `?include_deleted=1` — for a future "recently deleted" recovery UI.

**200:**

```json
{
  "status": "success",
  "data": {
    "pages": [
      {
        "id": 12,
        "slug": "home",
        "title": "Home",
        "is_system": true,
        "is_published": true,
        "position": 0,
        "draft_updated_at": "2026-08-24T22:15:00Z",
        "published_at": "2026-08-24T21:00:00Z",
        "has_unpublished_changes": true
      },
      /* … */
      {
        "id": 42,
        "slug": "coaching",
        "title": "Coaching",
        "is_system": false,
        "is_published": false,
        "position": 6,
        "draft_updated_at": "2026-08-24T22:20:00Z",
        "published_at": null,
        "has_unpublished_changes": true
      }
    ]
  }
}
```

Ordered by `position ASC, id ASC`. Excludes `layout_draft` / `layout_published` for size — the CRM fetches those per-page as before (§4).

### 3b. `POST /clubs/:club_id/pages`  (🔒 owner or admin)

Create a new page.

**Body:**
```json
{
  "slug": "coaching",
  "title": "Coaching"
}
```

Both required. Backend:
- Validates slug per §2.
- Sets `position = MAX(position) + 1` for the club.
- Seeds `layout_draft.blocks = []`, `layout_draft.meta = null`, `layout_published = NULL`.
- Sets `is_system = false`.

**201:**
```json
{
  "status": "success",
  "data": {
    "id": 43,
    "slug": "coaching",
    "title": "Coaching",
    "is_system": false,
    "is_published": false,
    "position": 6,
    "draft_updated_at": null,
    "published_at": null,
    "has_unpublished_changes": false
  }
}
```

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Slug not kebab / bad chars / too long | 400 | `bad_slug` |
| Reserved slug | 400 | `reserved_slug` |
| Duplicate for this club | 409 | `slug_conflict` |
| Title empty / > 80 chars | 400 | `bad_title` |

### 3c. `PATCH /clubs/:club_id/pages/:page_id`  (🔒 owner or admin)

Rename, resluglify, or reorder.

**Body (any combination):**
```json
{
  "title": "Coaching Sessions",
  "slug":  "coaching-sessions",
  "position": 3
}
```

- Any field can be omitted or `null` (unlike blocks — position/title/slug are non-nullable).
- Passing `position` re-numbers siblings 0..N-1 dense (same convention as brief 18's image reorder).
- `is_system: true` pages allow title + position changes but reject slug changes on the first release (400 `system_slug_locked`). Loosen later once a redirect story exists.

**200:** returns the updated row (same shape as list §3a).

### 3d. `DELETE /clubs/:club_id/pages/:page_id`  (🔒 owner or admin)

Soft-delete. **Any** page can be deleted, including the six seed pages — a small club that doesn't run tournaments doesn't need an `events` page, and owners should be able to trim their sitemap.

**204 No Content.** Sets `deleted_at = now()`. Public site drops the page (returns 404 at `/{slug}`). CRM sidebar drops the entry. Sweeper hard-deletes after 30 days.

**Confirmation guardrails belong on the frontend** — the CRM will show a "type the page name to confirm" modal for any page that's currently published, matching how brief 21 handled destructive club-membership moves. Backend just does what it's asked.

**Undo window:** for 30 days after soft-delete, a page can be restored via `POST /clubs/:club_id/pages/:page_id/restore` (owner or admin). Returns 404 if `deleted_at IS NULL` or the sweeper's already hard-deleted the row. Not exposed on the CRM sidebar in the first release — support-facing only, hit directly with the id from the audit log.

### 3e. Existing page-builder endpoints — keep slug-keyed, look up by slug

Today: `GET /clubs/:id/pages/:page_slug` etc. Keep this URL shape — the CRM already stores slug, not id, so nothing changes on the wire. Backend resolves `(club_id, page_slug)` → row internally. Once resolved, all existing brief 17 behavior stays.

**Alternative considered:** move to `/pages/:page_id`. Cleaner (rename doesn't break URLs), but forces the CRM to track both id + slug. The current CRM is slug-native — recommend staying slug-keyed and letting the backend do the lookup.

---

## 4. `/public/clubs/:slug/site` — include every published page

`pages` becomes a full map of every published page, not just the 6:

```json
"pages": {
  "home":         { "blocks": [/* … */], "meta": { /* … */ } },
  "about":        { "blocks": [/* … */], "meta": { /* … */ } },
  "coaching":     { "blocks": [/* … */], "meta": { /* … */ } },
  "sponsors":     { "blocks": [/* … */], "meta": { /* … */ } },
  /* every currently-published non-deleted page for this club */
}
```

**Filter:** only include `is_published = TRUE` pages. Draft-only pages don't appear.

**Order:** the map is a JSON object — the frontend doesn't care about key order for lookups. Sidebar ordering is a CRM concern.

**Payload size:** unbounded — a club with 30 custom pages returns 30 layouts. For MVP that's fine; if it grows, we'll add per-page endpoints and lazy-load. Cap **50 total pages per club** as an initial guardrail (400 `too_many_pages` on `POST`).

---

## 5. Publish reconciliation

The existing `POST /clubs/:club_id/pages/:page_slug/publish` (brief 17) stays. Adds one thing: publishing a **custom** page for the first time flips `is_published` to `true` on the row. Publishing a system page just updates `layout_published` as before (`is_published` was already true).

Publishing fires the Nuxt revalidate webhook with `purge: "all"` — a new page needs the router config to pick it up.

---

## 6. Non-goals

- **No hierarchical pages** (page > sub-page). Every page is top-level. Nested URLs are handled by nav-item children (brief 25) — links in the nav can point at any slug; pages don't nest.
- **No page templates.** Every new page starts blank. Owners can copy blocks manually.
- **No page duplication endpoint.** Frontend can implement client-side (create + copy blocks). Not needed for MVP.
- **No draft-mode preview URLs.** Publish or nothing. Preview button in the CRM still opens the draft via the existing preview mechanism.
- **No permanent redirect for renamed slugs.** Warned to the owner client-side, but old URLs 404. Redirect table is a future brief.
- **No page-level password/visibility.** All published pages are public.
- **No sitemap/robots editing** — separate future brief.

---

## 7. Seed pages — conveniences, not constraints

Every new club gets 6 seed pages created for them so the CRM has something to open on day one:
- `home`, `about`, `membership`, `events`, `honour-board`, `contact`.

They get `is_system = TRUE` — but the only thing that flag does today is **lock the slug** on the first release (`400 system_slug_locked` on `PATCH { slug }`). This is because the Nuxt renderer has hardcoded `pages/*.vue` files that depend on those slugs (`pages/about.vue` etc). Once we consolidate onto a single catch-all Nuxt route, this restriction goes away.

Everything else is fully editable:
- **Title editable** — rename "Membership" to "Join us" without breaking anything.
- **Position editable** — reorder freely in the sidebar.
- **Deletable** — if a club doesn't want an events or honour-board page, they can remove it entirely (§3d). Public site 404s at `/events`.

There is **no restore-to-defaults** on a deleted seed page — if an owner deletes `about` and later wants it back, they create a new page with slug `about` and start from a blank layout. Simpler mental model than an implicit "reset" button.

**Nuxt implication:** the hardcoded `pages/index.vue`, `pages/about.vue`, etc. need to `throw createError({ statusCode: 404 })` when `site.pages[slug]` is missing from the payload. Same treatment as the catch-all already does for arbitrary slugs. See §9.

---

## 8. Open questions for backend

1. **Slug-keyed vs ID-keyed URLs?** Recommend slug-keyed (§3e). Cleaner rollout, but renames become disruptive. Alternative: switch to ID-keyed URLs and add slug lookup middleware for the public Nuxt.
2. **Legacy `pages` table (from brief 16)** — should the migration drop it, or keep it read-only for rollback? Recommend keep-read-only for 14 days.
3. **`position` conflict on concurrent inserts** — two CRM tabs create pages at the same time → both compute `MAX(position) + 1` → collide. Recommend `UNIQUE (club_id, position)` isn't enforced; siblings can share a position and the backend renumbers on next PATCH. Or use an advisory lock.
4. **Should we prevent duplicate slugs *across* clubs?** No — each club has its own namespace. `UNIQUE (club_id, slug)` is sufficient.
5. **Do custom pages get an `og_image` per page?** Not in this brief — SEO stays with `meta.title + meta.description` from brief 26. Per-page share images are a follow-up.
6. **Rate-limit page creation?** Owners could hammer POST. Suggest: 20 pages/hour per club is a soft ceiling; hard ceiling is the 50-page total from §4.

---

## 9. Frontend implications (already scoped)

Once this ships:

- **`packages/api-client`** — new `pages.list(clubId)`, `pages.create(clubId, { slug, title })`, `pages.rename(clubId, pageId, patch)`, `pages.remove(clubId, pageId)`. Existing `pages.get/patch/publish` stay slug-keyed.
- **CRM `stores/pages.ts`** — new store tracking `Page[]` for the current club. Backfilled on mount + refreshed after each mutation.
- **CRM `WebsiteEditorView.vue`** — the sidebar `PAGE_SLUGS` const becomes a computed from the store. `+ New page` opens a small modal (slug + title inputs); on save calls `pages.create` and switches to the new page. Per-item hover menu (rename, delete) on non-system pages. Drag-reorder writes back via `pages.rename` with new `position` values.
- **Nuxt catch-all `pages/[...slug].vue`** — already handles arbitrary slugs. Just needs `site.pages[slug]` to include the new ones.
- **Nuxt hardcoded pages `pages/index.vue`, `pages/about.vue`, `pages/membership.vue`, `pages/events/index.vue`, `pages/honour-board/index.vue`, `pages/contact.vue`** — each needs a top-of-setup guard: `if (!site.pages?.[slug]) throw createError({ statusCode: 404, statusMessage: 'Page not published' })`. This is how a deleted seed page becomes a 404. Today `pages_enabled.events` already gates the events index; we generalise that pattern to check the `pages` map for every slug.

---

## 10. Contact

`#torny-eng` on Slack. Ping if you want to talk through the slug vs id trade-off or the redirect table story.
