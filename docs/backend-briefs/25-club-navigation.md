# Site Navigation — Persist Header + Footer Links

**Feature:** persist a club's site navigation (header nav + footer nav) against the club record, with one level of nested sub-links (dropdowns) baked into the shape from day one. Surface both nav trees on the public `/site` payload so the Nuxt renderer can drop the hardcoded fallback.

**Related:** brief 22 (fonts), brief 23 (style presets), brief 24 (brand assets) — same **Website → Brand/Navigation** CRM surface, same `/site` payload extension pattern.

**Status:** requested.

---

## TL;DR

1. **`clubs`** gets two nullable columns: `nav_header JSONB` and `nav_footer JSONB`. Both store an array of `NavItem` objects; `NULL` means "use the platform default set" (whatever the Nuxt fallback ships with).
2. **`PATCH /clubs/:club_id/navigation`** — owner/admin. Body `{ header?, footer? }`. Missing keys are no-ops, `null` clears, array replaces the whole tree.
3. **`/public/clubs/:slug/site`** gets `club.navigation = { header, footer }`. Both arrays; never `null` on the payload — falls back to the platform defaults when nothing is stored.
4. Nested `children` supported at ONE level only. The frontend will never render deeper than that; the backend rejects anything with grandchildren.

Fires the Nuxt revalidate webhook — nav change re-flows every page.

---

## Base URL

`CRM_BASE`, Bearer JWT for the PATCH. `/public/clubs/:slug/site` stays public.

---

## 1. Data shape

```ts
interface NavItem {
  label: string             // 1..80 chars
  href?: string             // path or full URL. Required for leaf items.
  external?: boolean        // renders with target="_blank" + rel="noopener". Optional.
  children?: NavItem[]      // 1..8 items. When present, `href` is optional
                            // (parent becomes a dropdown label rather than a link).
}
```

### Header nav sample

```json
[
  { "label": "Home",     "href": "/" },
  { "label": "About",    "href": "/about" },
  {
    "label": "Play",
    "children": [
      { "label": "Membership", "href": "/membership" },
      { "label": "Coaching",   "href": "/coaching" },
      { "label": "Events",     "href": "/events" }
    ]
  },
  { "label": "Honour board", "href": "/honour-board" },
  { "label": "Contact",      "href": "/contact" }
]
```

### Footer nav sample

Same shape; typically no children.

```json
[
  { "label": "Privacy",   "href": "/privacy" },
  { "label": "Terms",     "href": "/terms" },
  { "label": "Cookies",   "href": "/cookies" }
]
```

### Validation

- Both arrays: 0..12 top-level items.
- `label` required, 1..80 chars.
- `href` optional at parent level (parent-with-children may be label-only); required on leaves. Any string; frontend handles path vs URL logic. Reject empty string.
- `external` optional boolean.
- `children` optional array, 1..8 items. **No grandchildren** — reject with `400 nested_too_deep` if any `children[i].children` is present.
- Unknown fields on `NavItem` are ignored (forward-compat).

---

## 2. Endpoint

### `PATCH /clubs/:club_id/navigation`  (🔒 owner or admin)

**Request:**

```json
{
  "header": [ /* NavItem[] */ ],
  "footer": [ /* NavItem[] */ ]
}
```

- Missing key → leave stored value alone.
- `null` → clear the field (frontend will fall back to platform defaults).
- Array → replace the entire tree for that slot.

At least one of `header` / `footer` must be present.

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "header": [ /* stored value; may be null */ ],
    "footer": [ /* stored value; may be null */ ]
  }
}
```

Echoes exactly what's stored so the CRM can update its local state without a follow-up read.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Bad JSON body | 400 | `bad_json` |
| Neither `header` nor `footer` present | 400 | `bad_json` ("at least one of…") |
| `header` / `footer` present but not an array or `null` | 400 | `bad_json` |
| More than 12 top-level items | 400 | `too_many_items` |
| Any `label` missing / not a string / > 80 chars / empty | 400 | `bad_json` |
| Leaf item with no `href` and no `children` | 400 | `bad_json` |
| Grandchildren present | 400 | `nested_too_deep` |
| Not owner/admin on this club | 403 | `forbidden` |
| Unknown `club_id` | 404 | `not_found` |
| Missing / invalid JWT | 401 | `unauthorized` |

**Side effects:** fires the Nuxt revalidate webhook with `purge: "all"`, `reason: "settings.navigation_updated"`.

---

## 3. `/public/clubs/:slug/site` — the `navigation` field

Sibling to `fonts` / `style` on `data.club`. Always populated — falls back to the platform default arrays when both stored fields are `NULL`.

```json
{
  "status": "success",
  "data": {
    "club": {
      "id": 3,
      "slug": "melbourne-bowling-club",
      "name": "Melbourne Bowling Club",
      "brand_primary": "#DC2626",
      "logo_url":    "…",
      "favicon_url": "…",
      "fonts":      { /* … */ },
      "style":      { /* … */ },
      "navigation": {
        "header": [ /* NavItem[] — never empty; falls back if not stored */ ],
        "footer": [ /* NavItem[] — never empty; falls back if not stored */ ]
      }
      /* … */
    }
    /* … */
  }
}
```

### Platform defaults

When a club hasn't stored anything, return this shape (mirrors what the Nuxt layout hardcodes today):

**Header default:**
```json
[
  { "label": "Home",         "href": "/" },
  { "label": "About",        "href": "/about" },
  { "label": "Events",       "href": "/events" },
  { "label": "Honour board", "href": "/honour-board" },
  { "label": "Membership",   "href": "/membership" },
  { "label": "Contact",      "href": "/contact" }
]
```

**Footer default:**
```json
[
  { "label": "Privacy", "href": "/privacy" },
  { "label": "Terms",   "href": "/terms" },
  { "label": "Cookies", "href": "/cookies" }
]
```

---

## 4. Schema change

```sql
ALTER TABLE clubs
  ADD COLUMN nav_header JSONB,
  ADD COLUMN nav_footer JSONB;
```

No indexes. No backfill. Existing rows get `NULL` and use the platform defaults at read time.

**Storage note:** validation runs on write (`PATCH`), so any row that has non-null JSON has already been shape-checked. Read path can trust the shape.

---

## 5. Frontend implications

Once this ships:

- **`packages/api-client`** — new `navigation` resource with `updateForClub(clubId, { header?, footer? })`. `Club` type gains `navigation?: { header: NavItem[]; footer: NavItem[] } | null`. New `NavItem` type exported.
- **`apps/crm/src/stores/club.ts`** — `setNavigation({ header?, footer? })` action.
- **CRM Website → Navigation panel** — grows an "add sub-link" button under each top-level header item (footer stays flat for MVP UI, but the shape supports it). Drag-reorder for both levels. PATCH → `setNavigation`.
- **`@torny/content-blocks`** — `NavLink` type extended with `children?: NavLink[]`. `SiteHeader` renders a click-triggered dropdown for parent items with children (chevron indicator, click-outside/Escape close, keyboard nav). `SiteMobileDrawer` renders an inline expand/collapse for children.
- **`apps/club-sites/layouts/default.vue`** — drops the hardcoded `navLinks` / `footerColumns` consts when `site.club.navigation` is present. Keeps a very short built-in fallback for the SSR-before-payload window.

---

## 6. Non-goals

- **No footer sub-columns / headings.** The existing SiteFooter renders columns with headings — that's a separate content model (heading + links) and out of scope for this brief. Footer nav here is a flat list only.
- **No per-item icons / images / descriptions.** Just `label + href` per item. Mega-menu style panels are a separate future feature.
- **No page-driven auto-nav.** The nav is manually curated — no "auto-include every published page."
- **No visibility toggles / draft state.** Every item in the array renders. Owners can just delete items they don't want.
- **No permalink slugs.** `href` is a plain string; the CRM can offer a "known pages" autocomplete but backend doesn't validate against actual pages.

---

## 7. Open questions

1. **Store as one JSONB column (`navigation`) or two (`nav_header`, `nav_footer`)?** Two is cleaner for partial updates and the `PATCH` semantics; one is fewer columns. Recommend two — matches how the brief is written.
2. **`external` field or auto-detect from `href` starting with `http`?** Auto-detect is nicer for authors but strict rendering (target=_blank always for external, never for internal) means the CRM has to explain the rule anyway. Recommend keep `external: boolean?` explicit; auto-detect on the frontend as a default.
3. **`href` normalization?** Do you want to normalize `href: "about"` → `"/about"`, or reject if it doesn't start with `/` or `http`? Recommend reject with `400 bad_json` — path shape lives on the client.
4. **Do we want `updated_at` per column** for cache invalidation debugging? Same call as any settings edit — falls out of the standard club-level `updated_at` if you have one.
