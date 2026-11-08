# Brand Primary + Accent — finish the hydrate plumbing

**Feature:** admin-picked Primary + Accent hex values in the CRM Brand tab now reach the public club site. The two root CSS variables (`--color-accent` and `--color-accent-strong`) pick up the admin's hex instead of the colour scheme's default.

**Status:** backend shipped 2026-11-08 on TornyCrmStack. One new DB column, four handler touches (one PATCH + two GETs + one validator relaxation). The FE's existing `useTheme` composable already consumes `brand_primary` and `brand_accent` from both `/clubs/resolve` and `/public/clubs/{slug}/site` — nothing more needed FE-side once this deploy lands.

**This brief supersedes:** brief 81 (the original Primary + Accent spec). The implementation ended up slightly different from brief 81's assumptions — the historical column is `clubs_data.accent_colour`, not `brand_primary`, and we kept it that way (aliased at the handler layer) to avoid churning every other reader of the column.

**Related briefs:**
- Brief 79 — `image_style` on `/brand-assets`. ✅ Shipped.
- Brief 80 — `header_name` + `header_display` on `/navigation`. ✅ Shipped (migration 146).
- Brief 81 — original Primary + Accent spec. Superseded by this one.
- Brief 82 — Site Style owns radius / Image Style owns treatment. FE-only, no backend ship.

---

## 1. Diagnostic — what was broken

Debugged live on `nae-nae-bowling-club.torny.co` with the admin setting Primary = `#000000` and Accent = `#FFFFFF`. In the browser console on the public site:

```js
getComputedStyle(document.documentElement).getPropertyValue('--color-accent')
// → '#0A0A0B'   (should be '#000000' — admin's Primary pick)

getComputedStyle(document.documentElement).getPropertyValue('--color-accent-strong')
// → '#0A0A0B'   (should be '#FFFFFF' — admin's Accent pick)
```

Both root CSS variables resolved to the colour scheme's monochrome default, not the admin's overrides. The FE's `useTheme` composable was correctly ordered (scheme first, brand overrides last with `!important`) — the overrides just couldn't fire because the data wasn't there. The PATCH handler silently ignored `brand_primary` / `brand_accent` on the body, and the hydrate response didn't carry `brand_accent` at all. Both fixed below.

---

## 2. What shipped

Three items. All small, all in `clubs_data` territory.

### 2a. Schema — migration 147

```sql
ALTER TABLE clubs_data
  ADD COLUMN brand_accent VARCHAR(7) NULL;
```

Notes:
- `brand_primary` is **not** a new column. The historical storage column for the first colour is `clubs_data.accent_colour` (already existed). We keep writing + reading `accent_colour` server-side and alias it as `brand_primary` in the API payload. Zero churn to every other place that reads `accent_colour`.
- `brand_accent` is genuinely new. NULL on every existing row.
- Default NULL means "no override; FE falls back to the colour scheme preset."

### 2b. `PATCH /clubs/{cid}/brand-assets` — accepts + echoes both fields

Request shape (both new fields are optional):

```jsonc
{
  "logo_url":      "https://cdn.torny.co/clubs/5/logo.png",
  "favicon_url":   null,
  "image_style":   "soft",
  "brand_primary": "#2563EB",   // NEW — writes to clubs_data.accent_colour
  "brand_accent":  "#16A34A"    // NEW — writes to clubs_data.brand_accent
}
```

Rules:
- Present = set, missing = no-op, null = clear the override.
- Validated with `^#[0-9A-Fa-f]{6}$`. Rejections return 400 `bad_hex` with `data.field: 'brand_primary' | 'brand_accent'` so the FE can highlight the right input.
- Values are normalised to upper-case (`#2563eb` → `#2563EB`) before persisting.

### 2c. Response echo + hydrate inclusion

`PATCH /clubs/{cid}/brand-assets` response (`data` body) now echoes both:

```jsonc
{
  "status": "success",
  "data": {
    "clubId":        5,
    "logo_url":      "https://cdn.torny.co/clubs/5/logo.png",
    "favicon_url":   null,
    "image_style":   "soft",
    "brand_primary": "#2563EB",
    "brand_accent":  "#16A34A"
  }
}
```

`GET /public/clubs/{slug}/site` → `data.club` now carries both:

```jsonc
{
  "data": {
    "club": {
      "brand_primary": "#2563EB",
      "brand_accent":  "#16A34A",
      "logo_url":      "...",
      ...
    }
  }
}
```

`GET /clubs/resolve?host=...` now carries both at `data` level (this endpoint has a flat response, no `club` wrapper):

```jsonc
{
  "data": {
    "id":            5,
    "slug":          "nae-nae-bowling-club",
    "brand_primary": "#2563EB",
    "brand_accent":  "#16A34A",
    ...
  }
}
```

### 2d. Validator relaxation

The "at least one of" check on `/brand-assets` now accepts any of:

`logo_url`, `favicon_url`, `image_style`, `brand_primary`, `brand_accent`.

A colour-only PATCH no longer 400s. The FE workaround (echo `logo_url` / `favicon_url` alongside colour changes) can be removed.

---

## 3. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set both overrides.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#1F3A5F","brand_accent":"#C04A2B"}'
# → 200 { data: { brand_primary: '#1F3A5F', brand_accent: '#C04A2B', ... } }

# 2. Clear the accent only.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_accent":null}'
# → 200 { data: { brand_accent: null, brand_primary: '#1F3A5F', ... } }

# 3. Invalid hex (missing hash).
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"112233"}'
# → 400 { code: 'bad_hex', data: { field: 'brand_primary' } }

# 4. Short-form hex rejected.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#F00"}'
# → 400 { code: 'bad_hex' }

# 5. Colour-only PATCH (validator relaxation).
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#000000"}'
# → 200 (no "at least one of logo_url / favicon_url" 400)

# 6. Public hydrate carries both.
curl "$API/public/clubs/nae-nae-bowling-club/site" | jq '.data.club | {brand_primary, brand_accent}'
# → { "brand_primary": "#1F3A5F", "brand_accent": null }

# 7. Tenant-resolve carries both.
curl "$API/clubs/resolve?host=nae-nae-bowling-club.torny.co" | jq '.data | {brand_primary, brand_accent}'
# → { "brand_primary": "#1F3A5F", "brand_accent": null }
```

### Pass criteria

- ✓ `brand_accent` column exists on `clubs_data`.
- ✓ PATCH `/brand-assets` accepts both fields; invalid hex 400s with `bad_hex` + `data.field`.
- ✓ PATCH response echoes the persisted values.
- ✓ `null` on either field clears the override cleanly.
- ✓ Colour-only PATCH (no `logo_url` / `favicon_url`) succeeds.
- ✓ Both `GET /public/clubs/{slug}/site` and `GET /clubs/resolve` carry both fields.
- ✓ Smoke test from the browser:

```js
// After admin sets Primary = #000000, Accent = #FFFFFF, refresh the public site:
getComputedStyle(document.documentElement).getPropertyValue('--color-accent')         // → '#000000'
getComputedStyle(document.documentElement).getPropertyValue('--color-accent-strong')  // → '#FFFFFF'
```

That smoke test is the single gate. If both root CSS vars resolve to the admin's picks, the Primary + Accent pickers are fully alive on the public site.

---

## 4. Non-goals

- **No new endpoints.** Purely two columns + two JSON fields on existing routes.
- **No short-form hex (`#ABC`).** Six digits only; simpler validation, no legacy.
- **No alpha channel.** Full opacity only.
- **No HSL conversion server-side.** FE handles any colour-space maths.
- **No sweep of which CSS tokens the overrides map to.** That's a FE decision (currently `brand_primary` → `--color-accent`, `brand_accent` → `--color-accent-strong`), subject to re-mapping without a backend change.
- **No rename of `accent_colour` to `brand_primary` at the DB level.** The alias happens at the handler layer. If churn later feels worth it, that's a separate cleanup.
