# Style Presets — Backend Brief

**Feature:** the two endpoints that back a style-preset picker in the CRM and surface the chosen preset on the public club site. Five curated presets covering border radius, card treatment, and button shape.

**Related:** `docs/backend-briefs/22-fonts.md` (structural twin — same GET/PATCH shape, same `/site` extension pattern). `frontend-club-sites-brief.md` (the `/site` payload gets a new `club.style` object).

**Status:** requested.

---

## TL;DR

- **`GET /style-presets`** — public, cacheable (mirror the fonts brief `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`). Returns the five curated presets + `default_slug`.
- **`PATCH /clubs/{club_id}/style-preset`** — owner/admin. Body `{ style_preset: "sharp" }` or `null` to reset to the default. Fires the Nuxt revalidate webhook so the public site rerenders.
- **`/public/clubs/{slug}/site`** gains `club.style = { slug, radius, cards, buttons }` — a fully resolved object; falls back to the default when nothing is stored.
- **Default slug:** `editorial` (mirrors the Paper design tokens exactly).

Every field on a preset is a plain CSS-safe value the frontend maps into custom properties. No branching logic on the backend beyond enum validation.

---

## Base URL

`CRM_BASE`, Bearer JWT. `GET /style-presets` is unauthenticated.

---

## 1. `GET /style-presets`

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "default_slug": "editorial",
    "presets": [
      {
        "slug": "editorial",
        "name": "Editorial",
        "description": "Clean bordered cards with pill buttons. The Paper default.",
        "radius": { "xs": 4,  "sm": 8,  "md": 12, "lg": 20, "pill": 999 },
        "cards":  { "background": "surface", "border": "hairline", "shadow": "none" },
        "buttons": { "radius": 999 },
        "is_default": true
      },
      {
        "slug": "sharp",
        "name": "Sharp",
        "description": "Zero radii, tight architectural feel. Great for magazine-style clubs.",
        "radius": { "xs": 0, "sm": 0, "md": 0, "lg": 0, "pill": 4 },
        "cards":  { "background": "ground", "border": "hairline", "shadow": "none" },
        "buttons": { "radius": 4 }
      },
      {
        "slug": "soft",
        "name": "Soft",
        "description": "Gently rounded surfaces, pill buttons — the friendly middle ground.",
        "radius": { "xs": 6, "sm": 12, "md": 16, "lg": 24, "pill": 999 },
        "cards":  { "background": "surface", "border": "none", "shadow": "none" },
        "buttons": { "radius": 999 }
      },
      {
        "slug": "rounded",
        "name": "Rounded",
        "description": "Round cards and pills all the way. Warm, community, playful.",
        "radius": { "xs": 12, "sm": 16, "md": 24, "lg": 32, "pill": 999 },
        "cards":  { "background": "surface", "border": "none", "shadow": "soft" },
        "buttons": { "radius": 999 }
      },
      {
        "slug": "classic",
        "name": "Classic",
        "description": "Subtle radii and a soft card shadow. Traditional print feel.",
        "radius": { "xs": 2, "sm": 4, "md": 6, "lg": 14, "pill": 999 },
        "cards":  { "background": "ground", "border": "none", "shadow": "soft" },
        "buttons": { "radius": 6 }
      }
    ]
  }
}
```

### Field vocab

- `radius.*` — plain integer pixel values. `pill` is the "as round as possible" bucket (typically 999 to render pills).
- `cards.background` — `surface | ground` (design-token slugs the frontend maps to `var(--color-surface)` / `var(--color-ground)`).
- `cards.border` — `hairline | none` (`hairline` maps to `1px solid var(--color-hairline)`).
- `cards.shadow` — `none | soft` (`soft` is a subtle drop-shadow; the frontend defines it once).
- `buttons.radius` — plain integer pixel value applied to CTA buttons.

Keeping these as strings/ints rather than raw CSS means the frontend can theme against them without server-side style generation.

**Caching:** same as fonts — 1 hour public cache + SWR. List changes only on deploy.

---

## 2. `PATCH /clubs/{club_id}/style-preset`  (🔒 owner or admin)

Same shape as `PATCH /clubs/{club_id}/font-pair` in brief 22.

**Request:**

```json
{ "style_preset": "rounded" }
```

Or reset to default:

```json
{ "style_preset": null }
```

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "style_preset": "rounded",
    "effective_slug": "rounded"
  }
}
```

**Side effects:** fires the Nuxt revalidate webhook with `purge: "all"`, `reason: "settings.style_preset_updated"` — a style change reflows every page.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Bad JSON body | 400 | `bad_json` |
| `style_preset` not a string / null | 400 | `bad_json` |
| Slug not in the curated list | 400 | `unknown_style_preset` |
| Not owner/admin on this club | 403 | `forbidden` |
| Unknown `club_id` | 404 | `not_found` |
| Missing / invalid JWT | 401 | `unauthorized` |

---

## 3. `/public/clubs/{slug}/site` — the `style` field

Add a `style` sibling to `fonts` inside `data.club`. Same fall-back rule: **always populated**, defaults to the preset flagged `is_default: true`.

```json
"style": {
  "slug": "rounded",
  "radius": { "xs": 12, "sm": 16, "md": 24, "lg": 32, "pill": 999 },
  "cards":  { "background": "surface", "border": "none", "shadow": "soft" },
  "buttons": { "radius": 999 }
}
```

---

## 4. Schema change

Two columns on `clubs`, both nullable so existing rows keep the default:

```sql
ALTER TABLE clubs
  ADD COLUMN style_preset TEXT;

ALTER TABLE clubs
  ADD CONSTRAINT clubs_style_preset_check
  CHECK (style_preset IS NULL OR style_preset IN (
    'editorial', 'sharp', 'soft', 'rounded', 'classic'
  ));
```

No index — this column is only read per-tenant at request time.

The presets themselves are code, not data. Follow the same pattern as `utils/font-pairs.js` — a `utils/style-presets.js` module holding the source of truth.

---

## 5. Frontend implications

- `packages/api-client` gets a new `stylePresets` resource + a `Club.style` field. Same shape as fontPairs.
- CRM's `WebsiteSettingsPanel` Brand tab gets a **Style** section next to Typography. Each preset renders as a card containing a mini button + card + image thumb, all drawn using the preset's own radii and treatment.
- Nuxt `useTheme()` composable extends its injected `<style>` block with `--radius-*` overrides, `--card-bg`, `--card-border`, `--card-shadow`, `--btn-radius`. Blocks already read `var(--radius-*)`, so most auto-adopt. Card blocks (Feature grid, FAQ, Event list card) will grow references to the new card CSS vars.

---

## 6. Non-goals

- **No per-block overrides.** One style for the whole site — same rationale as the font pair.
- **No custom preset upload.** Owners pick from the curated five. New presets require a code deploy (~5 lines).
- **No independent card-vs-button style knobs.** If clubs want that granularity, we ship a separate brief later.

---

## 7. Open questions

1. `radius.pill` — always `999` today. Keep it in the payload for flexibility (a preset could dial down to `12` for a slightly-rounded "pill"), or hardcode client-side? Vote: keep in payload.
2. Do we want a `preview_image_url` per preset so the CRM shows a real screenshot instead of a JS-drawn preview? Nice-to-have; frontend can do without.
3. Should presets be locked so `PATCH .../style-preset` with an unknown slug fails, or should we soft-accept and clamp to default? Fail hard — silent clamps hide bugs.
