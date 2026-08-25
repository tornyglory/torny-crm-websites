# Color Schemes — Curated Site-Wide Backgrounds

**Feature:** a `color_scheme` picker for the club's public site — similar to how `style_preset` (brief 23) sets radius / card / button treatments, but for the neutral colour palette (page background, surface, hairline, text). Owners pick from a curated list; the site's `--color-ground`, `--color-surface`, `--color-ink` (and their derivatives) all update.

**Related:** brief 22 (`font_pair`), brief 23 (`style_preset`), brief 24 (`brand-assets` — logo + favicon). Same "curated preset with stored slug + resolved fallback" pattern as the two before it.

**Status:** requested. `--color-ground` is currently hard-coded to `#FFFFFF` in the design tokens. Clubs can't warm the page up ("cream" / "sand" / "sage") without frontend forking.

---

## TL;DR

1. **New table `color_schemes`** — curated list, seeded with 5–6 platform themes (Clean white as default).
2. **New column `clubs.color_scheme`** — nullable slug FK to `color_schemes.slug`. `null` = platform default.
3. **`GET /color-schemes`** — public curated list (same as `/style-presets`, no auth). One-line JSON per row.
4. **`PATCH /clubs/:club_id/color-scheme`** — owner-only. Set / clear the club's scheme. Fires the same revalidate webhook.
5. **`/public/clubs/:slug/site`** — `club.color_scheme` payload gains a full resolved token map. Frontend applies as CSS variables.
6. **`/clubs/:club_id/settings`** — `brand.color_scheme` (stored slug, may be null) + `brand.color_scheme_resolved` (always populated) — same shape as `brand.font_pair` / `brand.style_preset`.

---

## Base URL

```ts
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
```

Owner JWT required for the PATCH. GET is public (no auth) — same as `/style-presets`.

---

## 1. Data model

### `color_schemes` (new table)

```sql
CREATE TABLE color_schemes (
  slug           VARCHAR(48)  PRIMARY KEY,
  name           VARCHAR(80)  NOT NULL,
  description    TEXT         NULL,
  tokens         JSON         NOT NULL,      -- resolved token map (see §2)
  is_default     BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order     INT          NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NULL,
  CONSTRAINT one_default_scheme CHECK (
    (is_default = FALSE) OR (is_default = TRUE)
  )
);

-- Seed rows — see §5 for the palettes.
INSERT INTO color_schemes (slug, name, description, tokens, is_default, sort_order) VALUES
  ('clean-white',    'Clean white',    'Bright and neutral. The Torny default.',
   '{"ground":"#FFFFFF","surface":"#F5F5F2","hairline":"#E7E7E1","ink":"#0A0A0B","graphite":"#2E2E33","fog":"#6B6B72","mute":"#A3A39B"}'::json, TRUE, 0),
  ('warm-cream',     'Warm cream',     'Off-white paper. Reads as editorial.',
   '{"ground":"#FDFAF3","surface":"#F5EFDB","hairline":"#E9E1C4","ink":"#2A1F13","graphite":"#4A3A24","fog":"#7A6A50","mute":"#B2A588"}'::json, FALSE, 1),
  ('muted-sage',     'Muted sage',     'Soft green-grey, calming.',
   '{"ground":"#F5F7F2","surface":"#E8ECDE","hairline":"#D5DBC5","ink":"#1E2818","graphite":"#3A4732","fog":"#6E7A62","mute":"#A3AC97"}'::json, FALSE, 2),
  ('sand-paper',     'Sand paper',     'Warm sand, oak, and brown ink.',
   '{"ground":"#F7F1E4","surface":"#E9DEC1","hairline":"#D6C7A2","ink":"#3B2F17","graphite":"#5A4A28","fog":"#8A7852","mute":"#B8A984"}'::json, FALSE, 3),
  ('ink-editorial',  'Ink editorial',  'High contrast on soft grey. Magazine-like.',
   '{"ground":"#FAFAFA","surface":"#E9E9E9","hairline":"#D0D0D0","ink":"#0A0A0B","graphite":"#2E2E33","fog":"#5F5F65","mute":"#8D8D95"}'::json, FALSE, 4),
  ('slate',          'Slate',          'Cool blue-grey. Modern.',
   '{"ground":"#F1F3F5","surface":"#DEE2E6","hairline":"#C5CDD5","ink":"#212529","graphite":"#343A40","fog":"#6C757D","mute":"#ADB5BD"}'::json, FALSE, 5);
```

Backend enforces only-one-default via the seed data — no live editing needed for MVP.

### `clubs` (existing table)

```sql
ALTER TABLE clubs
  ADD COLUMN color_scheme VARCHAR(48) NULL REFERENCES color_schemes(slug) ON DELETE SET NULL;
```

`NULL` means the club uses the platform default (`is_default = TRUE` row in `color_schemes`).

---

## 2. Token map shape

Every scheme's `tokens` JSON has the same seven keys (matching what the design-tokens CSS var names strip to):

```json
{
  "ground":   "#FDFAF3",
  "surface":  "#F5EFDB",
  "hairline": "#E9E1C4",
  "ink":      "#2A1F13",
  "graphite": "#4A3A24",
  "fog":      "#7A6A50",
  "mute":     "#B2A588"
}
```

Any of these keys may be omitted — the frontend falls back to the design-token default when a key is missing. Recommend seeding **all seven** for every curated scheme so the sites feel intentional.

**Do not include** brand accent (`--color-accent`), feature colours (`--color-feature-mint` etc), or design-token layout values (`--radius-*`, `--track-*`). Those are outside the scope of colour schemes.

---

## 3. `GET /color-schemes`  (public, no auth)

**200:**

```json
{
  "status": "success",
  "data": {
    "default_slug": "clean-white",
    "schemes": [
      {
        "slug": "clean-white",
        "name": "Clean white",
        "description": "Bright and neutral. The Torny default.",
        "tokens": { "ground":"#FFFFFF", "surface":"#F5F5F2", "hairline":"#E7E7E1", "ink":"#0A0A0B", "graphite":"#2E2E33", "fog":"#6B6B72", "mute":"#A3A39B" }
      }
    ]
  }
}
```

Sorted by `sort_order ASC`. `default_slug` is which one wins when a club's `color_scheme` is NULL.

**Caching:** `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. Curated list changes rarely.

---

## 4. `PATCH /clubs/:club_id/color-scheme`  (🔒 owner or admin)

**Body:**

```json
{ "color_scheme": "warm-cream" }
```

Or to reset to the platform default:

```json
{ "color_scheme": null }
```

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 5,
    "color_scheme": "warm-cream",
    "effective_slug": "warm-cream",
    "tokens": { "ground":"#FDFAF3", "surface":"#F5EFDB", "hairline":"#E9E1C4", "ink":"#2A1F13", "graphite":"#4A3A24", "fog":"#7A6A50", "mute":"#B2A588" }
  }
}
```

`effective_slug` mirrors the "stored + resolved" pattern from `font_pair` / `style_preset` — falls back to `default_slug` when `color_scheme` is null. `tokens` is the fully-resolved map so the CRM's preview surface can render immediately without a follow-up fetch.

**Errors:**

| Case | HTTP | code |
|---|---|---|
| Unknown slug | 400 | `bad_scheme` |
| Not owner/admin | 403 | — |
| Missing JWT | 401 | — |

**Revalidate:** same webhook as brief 23 (style preset). Public site rebuilds within seconds.

---

## 5. `/public/clubs/:slug/site` — add `club.color_scheme`

Extend the existing `SiteClub` payload with:

```json
{
  "club": {
    "…": "existing fields",
    "fonts": { "…" },
    "style": { "…" },
    "color_scheme": {
      "slug": "warm-cream",
      "tokens": { "ground": "#FDFAF3", "surface": "#F5EFDB", ... }
    }
  }
}
```

Always populated — falls back to the default scheme's tokens when the club hasn't picked one. Same pattern as `fonts` and `style` on the payload today.

---

## 6. `/clubs/:club_id/settings` — extend `brand`

The settings endpoint (from the shipped settings brief) already returns `brand.font_pair` / `brand.style_preset` in a "stored + resolved" pair. Add the same for the colour scheme:

```json
{
  "brand": {
    "…": "existing",
    "color_scheme": null,
    "color_scheme_resolved": {
      "slug": "clean-white",
      "name": "Clean white",
      "tokens": { "ground": "#FFFFFF", "surface": "#F5F5F2", ... }
    }
  }
}
```

`color_scheme` = raw column (null = using platform default), `color_scheme_resolved` = what's actually in effect.

---

## 7. Verification

Same lifecycle format as prior briefs. Run against Nae Nae (id=5):

| Step | Expected |
|---|---|
| `GET /color-schemes` | 200, `schemes[]` includes the 6 seeded rows |
| `PATCH /clubs/5/color-scheme { color_scheme: 'warm-cream' }` | 200, `effective_slug: 'warm-cream'`, `tokens` returned |
| `PATCH /clubs/5/color-scheme { color_scheme: null }` | 200, `effective_slug: 'clean-white'` |
| `PATCH … { color_scheme: 'bogus' }` | 400 `bad_scheme` |
| `GET /public/clubs/nae-nae-bowling-club/site` after PATCH | `club.color_scheme.slug` matches, tokens present |
| `GET /clubs/5/settings` after PATCH | `brand.color_scheme` = stored value, `brand.color_scheme_resolved` = full row |
| Revalidate webhook fires on PATCH | ✓ |

---

## 8. Frontend implications

Once shipped:

- **`packages/api-client/src/resources/colorSchemes.ts`** (new) — `list()` + `updateForClub(clubId, slug \| null)`. Mirrors `resources/stylePresets.ts` exactly.
- **`ThemePicker.vue`** (new component in the CRM's Website settings panel) — renders a grid of preset cards (mini colour swatch + name), current selection highlighted, PATCH on select. Sits below the existing Style picker in the Brand section.
- **`useTheme()`** (composable in club-sites Nuxt) — extended to write `--color-ground` / `--color-surface` / `--color-hairline` / `--color-ink` / `--color-graphite` / `--color-fog` / `--color-mute` CSS variables from `site.club.color_scheme.tokens`, applied to `:root`. Missing keys fall back to the design-token defaults.
- **CRM sidebar / any CRM chrome** — stays on the CRM's own design tokens; no need to preview the club's colour scheme in the CRM chrome (only in the Preview / block editor surface).

---

## 9. Non-goals

- **No live editing of the curated list.** Adding / editing / removing color schemes is a seed-file / migration exercise. If clubs start asking for custom palettes we'll design a "custom colour" surface then, matching the eventual `PATCH /clubs/:id/accent-colour` from brief 30's follow-up list.
- **No dark mode toggle.** Every scheme is a single palette. Dark-mode toggle is a separate future arc.
- **No per-block colour overrides.** Every block reads the site-wide vars.
- **No accent / feature colour overrides.** Brand accent (`--color-accent`) stays on its own dimension via `clubs.brand_primary`.

---

## 10. Open questions

1. **Naming** — I've used `color_scheme` throughout. Alternatives: `theme`, `palette`, `neutral_palette`. Happy to rename if the term collides with something in the schema.
2. **Custom colour picker later** — if we ship this as curated-only, do you want a "Custom…" affordance in the CRM that unlocks a free-form colour picker (and stores it as a per-club JSON blob instead of a slug)? Recommend deferring — see how many clubs run into the "none of these fit my brand" wall first.
3. **`tokens` JSON validation on PATCH** — none needed here since the CRM only sends a curated slug. But if we add a custom-colour path later, the JSON body will need validation.
4. **Font pair, style preset, color scheme — three separate PATCH endpoints.** Fine for now but if the settings page starts to feel like it's making N round-trips, we can wrap them in a single `PATCH /clubs/:id/theme` later.

---

## 11. Contact

`#torny-eng`. Structural clone of brief 23. Same file backend touched for the style-preset endpoints — should be a quick lift.
