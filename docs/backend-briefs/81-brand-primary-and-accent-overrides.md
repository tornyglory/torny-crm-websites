# `brand_primary` + `brand_accent` on the brand-assets patch

**Feature:** let admins set exact hex values for their club's primary + accent colours on the Brand tab. Overrides the colour-scheme preset's defaults on the public site. Two fields on the existing `/brand-assets` endpoint — same pattern as `image_style` in brief 79.

**Status:** FE wired through to the CRM Brand tab. The inline "Primary" + "Accent" colour inputs on `WebsiteSettingsPanel.vue` currently don't save anywhere — they've been a UI mockup. This brief ships the storage + endpoint wiring to make them real.

**Related:**
- Brief 24 — original brand-assets endpoint (`PATCH /clubs/{cid}/brand-assets`).
- Brief 79 — `image_style` on the same endpoint. Identical shape; this brief follows it.
- Colour schemes (`color_schemes` table) — preset palettes the admin can pick from. These overrides take precedence.

---

## TL;DR

1. Confirm `clubs_data.brand_primary VARCHAR(7)` already exists (surfaced on `club.brand_primary` across the public hydrate). Add `clubs_data.brand_accent VARCHAR(7) NULL`.
2. Extend `PATCH /clubs/{cid}/brand-assets` to accept + echo both fields. Validate as `^#[0-9A-Fa-f]{6}$` (reject anything else with 400 `bad_hex`).
3. `null` on either field = clear the override, fall back to the colour-scheme preset's default.
4. Include `brand_primary` + `brand_accent` in the public hydrate (`GET /public/clubs/{slug}/site → data.club`).

The "at least one of" validator on `/brand-assets` already needs to accept `image_style` (brief 79). After this brief it also needs to accept `brand_primary` and `brand_accent`.

---

## 1. Schema

```sql
ALTER TABLE clubs_data
  ADD COLUMN brand_accent VARCHAR(7) NULL;
```

`brand_primary` is assumed to already exist. If it doesn't, add it with the same shape (`VARCHAR(7) NULL`). No backfill — all existing rows get `brand_accent = NULL` (= "use the colour scheme's accent"), which matches current behaviour.

---

## 2. `PATCH /clubs/{cid}/brand-assets`

### Request — two new optional fields

```jsonc
{
  "logo_url":      "https://cdn.torny.co/clubs/5/logo.png",   // optional
  "favicon_url":   null,                                        // optional
  "image_style":   "soft",                                      // optional — brief 79
  "brand_primary": "#2563EB",                                   // NEW — hex or null
  "brand_accent":  "#16A34A"                                    // NEW — hex or null
}
```

Rules:
- `brand_primary` / `brand_accent` — present = set, missing = no-op. `null` = clear the override; public site falls back to the colour scheme's token.
- Validate hex format: `^#[0-9A-Fa-f]{6}$`. Reject with 400 `bad_hex` + a `field` detail so the FE knows which input to flag.

### 400 on invalid value

```jsonc
{
  "status": "error",
  "code": "bad_hex",
  "message": "brand_primary must be a 6-digit hex like #2563EB, or null to clear",
  "data": { "field": "brand_primary" }
}
```

### 200 response — echo both

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

### Validator relaxation

The "at least one of" check needs to accept these fields too. Current accepted keys after brief 79:

> At least one of `logo_url`, `favicon_url`, `image_style`, **`brand_primary`**, or **`brand_accent`** must be present.

---

## 3. Public club hydrate

Both fields already fit under `data.club` (where `brand_primary` lives today). Add `brand_accent` to the echo:

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

If either is `null`, the FE falls back to the colour scheme's token.

---

## 4. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set both.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#1F3A5F","brand_accent":"#C04A2B"}'
# → 200 { data: { brand_primary: '#1F3A5F', brand_accent: '#C04A2B', ... } }

# 2. Clear the accent, keep primary.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_accent":null}'
# → 200 { data: { brand_accent: null, brand_primary: '#1F3A5F', ... } }

# 3. Invalid hex.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"notacolor"}'
# → 400 { code: 'bad_hex', data: { field: 'brand_primary' } }

# 4. Short hex also rejected (3-digit form not accepted).
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#F00"}'
# → 400 { code: 'bad_hex', data: { field: 'brand_primary' } }

# 5. Public hydrate carries both.
curl "$API/public/clubs/nae-nae-bowling-club/site"
# → 200 { data: { club: { brand_primary, brand_accent, ... } } }

# 6. Save colour-only patch — validator relaxation.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"brand_primary":"#000000"}'
# → 200 (no "at least one of" 400).
```

Pass criteria:
- ✓ `brand_accent` column added; existing rows carry NULL.
- ✓ PATCH accepts both new fields and echoes them.
- ✓ Invalid hex 400s with `bad_hex` + a `field` hint.
- ✓ `null` clears the override cleanly.
- ✓ Public hydrate carries `brand_primary` + `brand_accent` under `data.club`.
- ✓ Brand-only PATCH (no `logo_url` / `favicon_url` / `image_style`) succeeds — "at least one of" validator accepts the new keys.

---

## 5. Non-goals

- **No preset "accent palette" offering.** Admins pick colour schemes (existing) OR override with hex (this brief). No in-between — too much UI for v1.
- **No short-form hex (`#ABC`) acceptance.** Six digits only; simpler validation and no legacy to deal with.
- **No alpha channel support.** Full opacity only.
- **No hex → HSL conversion in the response.** FE handles any colour-space transforms client-side.
- **No mapping to specific CSS tokens in this brief.** The FE decides where `brand_primary` and `brand_accent` plug into the public site's token tree. Currently `brand_primary` drives `--color-accent`; `brand_accent` will plug into a secondary slot (likely `--color-accent-strong`), subject to change without breaking the API contract.

---

## 6. Contact

Ping Felicity when the column + PATCH acceptance are deployed. The FE wiring is live behind the picker — admins will start saving `brand_accent` the moment the endpoint accepts it. Public hydrate can follow in a second PR with zero FE coordination; the Nuxt layout falls back to the colour scheme's defaults when the fields are absent.
