# Per-Page SEO — Title + Meta Description

**Feature:** persist a title + meta description on every published page (home, about, membership, events, honour-board, contact — the six brief-16 slugs), plus site-wide fallbacks on the club record. Surface both on the public `/site` payload so Nuxt can emit the right meta tags.

**Related:** brief 16/17 (page builder — this is a small extension), brief 22–25 (site-wide brand). Same **Website** CRM surface.

**Status:** requested.

---

## TL;DR

1. **Add `meta` to the page layout shape.** `layout_draft.meta` and `layout_published.meta` are new sibling objects to `blocks[]` — either `null` or `{ title?, description? }`. Backend stores as `jsonb` alongside the existing blocks JSON.
2. **`GET /clubs/:club_id/pages/:page_slug`** already returns `layout_draft` and `layout_published` — just add `meta` inside each.
3. **`PATCH /clubs/:club_id/pages/:page_slug`** takes the whole layout on the wire today. Extend the accepted body so `layout_draft.meta` round-trips.
4. **`POST /clubs/:club_id/pages/:page_slug/publish`** — nothing changes on the endpoint contract, but the atomic draft → published copy now includes `meta` too.
5. **`/public/clubs/:slug/site`** — `data.pages[slug]` already carries `{ blocks }`. Add a `meta` sibling: `{ blocks, meta }`. `meta` is always populated (falls back to site default when nothing stored).
6. **Site-level defaults on the club record** — new columns `default_meta_title TEXT` and `default_meta_description TEXT` on `clubs`. Editable via `PATCH /clubs/:id/seo` (see §3).

**No new endpoint for the page-level meta** — piggybacks on the existing page-builder PATCH. Two-write coordination and cache invalidation are already solved for that shape.

---

## Base URL

`CRM_BASE`, Bearer JWT. `/public/clubs/:slug/site` stays public.

---

## 1. Page-level `meta` shape

```ts
interface PageMeta {
  title?: string        // 1..70 chars. Optional.
  description?: string  // 1..180 chars. Optional.
}
```

- Both fields optional; if the whole `meta` object is absent (or `null`), the frontend uses the fallback chain (§4).
- 70 chars keeps Google's title cutoff safe; 180 gives room without truncation on most SERPs.

### Adds to `layout_draft` / `layout_published`

Today (brief 17):
```json
"layout_draft": {
  "blocks": [ /* … */ ]
}
```

Tomorrow:
```json
"layout_draft": {
  "blocks": [ /* … */ ],
  "meta": { "title": "About the club", "description": "How we started, who we are." }
}
```

`meta` is optional in the request body and the stored JSON — omit / `null` == "use site default". Backend validates when present:

| Case | HTTP | `code` |
|------|------|--------|
| `meta` not an object / not null | 400 | `bad_json` |
| `meta.title` or `meta.description` not a string | 400 | `bad_json` |
| `meta.title` > 70 chars | 400 | `title_too_long` |
| `meta.description` > 180 chars | 400 | `description_too_long` |

Unknown fields on `meta` are dropped (forward-compat).

---

## 2. `/public/clubs/:slug/site` — the `pages[slug].meta` addition

Extend `data.pages[slug]`:

```json
"pages": {
  "home":         { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } },
  "about":        { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } },
  "membership":   { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } },
  "events":       { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } },
  "honour-board": { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } },
  "contact":      { "blocks": [ /* … */ ], "meta": { "title": "…", "description": "…" } }
}
```

**Resolution rules for `meta` (server-side, so Nuxt gets a fully resolved object):**

1. If the published page has stored `meta.title` → use it.
2. Otherwise, use `club.default_meta_title` if present.
3. Otherwise, use a derived default (see §4).

Same order for `description`. Always emit a populated `meta` — never `null` — so the frontend can just use it.

---

## 3. Site-level defaults + `PATCH /clubs/:club_id/seo`  (🔒 owner or admin)

Two new nullable columns:

```sql
ALTER TABLE clubs
  ADD COLUMN default_meta_title TEXT,
  ADD COLUMN default_meta_description TEXT;
```

New endpoint:

**`PATCH /clubs/:club_id/seo`** — body `{ default_meta_title?, default_meta_description? }`. Same partial-update semantics as brand-assets (brief 24):

- Missing key → leave stored value alone.
- `null` → clear.
- String (1..70 for title, 1..180 for description) → set.

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "default_meta_title": "Melbourne Bowling Club",
    "default_meta_description": "A friendly bowls club in Windsor."
  }
}
```

**Errors:** same shape as brief 24 + `title_too_long` / `description_too_long`.

**Side effects:** fires the Nuxt revalidate webhook (`purge: "all"`, `reason: "settings.seo_defaults_updated"`).

---

## 4. Fallback chain (server-side resolution on `/site`)

For each page's `meta.title`, in order:

1. Published `layout_published.meta.title` (if set)
2. `clubs.default_meta_title` (if set)
3. Derived default: `"{page label} — {club.name}"` (e.g. `"About the club — Melbourne Bowling Club"`)

For `meta.description`:

1. Published `layout_published.meta.description` (if set)
2. `clubs.default_meta_description` (if set)
3. Derived default: **short_description** from onboarding, else `null` (frontend emits nothing)

**Why server-side resolution?** Clients don't have to know the derivation rules; the payload is always ready-to-emit. Also keeps SEO stable when a frontend deploy lags a copy change.

**Page-label mapping for the derived title:**

| slug | label |
|------|-------|
| `home` | (uses club.name only, no prefix) |
| `about` | `"About"` |
| `membership` | `"Membership"` |
| `events` | `"Events"` |
| `honour-board` | `"Honour board"` |
| `contact` | `"Contact"` |

Home is special-cased so the site's landing page doesn't read `"Home — {club.name}"` (which looks amateur). Everything else prepends the page label.

---

## 5. Schema changes summary

```sql
-- Site-level defaults
ALTER TABLE clubs
  ADD COLUMN default_meta_title TEXT,
  ADD COLUMN default_meta_description TEXT;

-- Page-level meta is already storable — it just piggybacks on the existing
-- layout_draft / layout_published jsonb columns. No schema change needed
-- there; only the validation whitelist for the PATCH body has to accept
-- the new `meta` key.
```

---

## 6. Frontend implications

- **`packages/api-client`** — `PageLayout` type gains `meta?: PageMeta | null`. `Club` gains `defaultMetaTitle` / `defaultMetaDescription`. New `clubs.updateSeoDefaults(clubId, patch)` mirroring `updateBrandAssets`.
- **CRM Website editor** (`WebsiteEditorView.vue`) — SEO card above the block list on every page slug. Two inputs (title + description) with char counters (70 / 180). Autosave already sends the whole state on debounce — just include `meta` in the payload.
- **CRM Website → SEO settings tab** (`WebsiteSettingsPanel.vue`) — the existing SEO card gains real inputs for the site-wide defaults, wired through `clubs.updateSeoDefaults`.
- **Nuxt** — `useSeoMeta({ title, description, ogTitle, ogDescription, twitterTitle, twitterDescription })` in each page (`pages/index.vue`, `pages/[...slug].vue`, etc.) reads from `site.value.pages[slug].meta`. Since the backend resolves the fallback chain, Nuxt just uses what it's given. Adds `<meta property="og:image">` from `club.logo_url` or a future `og_image_url`.

---

## 7. Non-goals

- **No per-block SEO.** Each page has one title + one description. Blocks stay stylistic.
- **No slug editing.** The six page slugs are fixed (brief 16).
- **No canonical URL override.** Nuxt derives from route + club domain.
- **No robots.txt / sitemap.xml editing.** Separate future brief.
- **No `og:image` upload.** Falls back to `club.logo_url`. When we ship a proper share-card asset uploader, we'll fold it into brand-assets (brief 24).
- **No word-count / readability preview.** Char counters are enough.

---

## 8. Open questions

1. **Char limits — enforce hard, or advisory?** Recommend hard on the backend (400 on write) + soft counter in the CRM. Truncation surprises are worse than an error.
2. **Should `default_meta_title` include the club name automatically or not?** Recommend: don't auto-append. Owners set the exact string they want; the derivation logic in §4 step 3 only runs when the default itself is null.
3. **Do we want a separate `og_image_url` today or wait for the brand-assets follow-up?** Wait. Falling back to logo is fine for now.
4. **Should the `meta` object be flattened onto `layout_draft` (e.g. `layout_draft.meta_title`) rather than nested?** Nested keeps blocks + meta separate concerns and matches how we'll add more meta fields later (`og_image_url`, `canonical` overrides). Recommend nested.
