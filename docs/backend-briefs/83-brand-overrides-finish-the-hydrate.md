# Brand Primary + Accent — finish the hydrate plumbing

**Feature:** admin-picked Primary + Accent hex values in the CRM Brand tab aren't reaching the public club site. The CRM UI saves successfully, but the values never make it into the colour cascade on the public site — every CTA button stays at the colour scheme's default instead of the admin's pick. This brief captures what's left for the backend to unblock it.

**Status:** CRM wiring is live. Debugging confirmed the backend is the bottleneck — see §1. This brief supersedes brief 81 as the single source of truth for what's still needed (briefs 79, 80 shipped cleanly; brief 82 is FE-only).

**Related briefs:**
- Brief 79 — `image_style` on `/brand-assets`. ✅ Shipped.
- Brief 80 — `header_name` + `header_display` on `/navigation`. ✅ Shipped (migration 146).
- Brief 81 — original Primary + Accent spec. Supersedes this one.
- Brief 82 — Site Style owns radius / Image Style owns treatment. FE-only, no backend ship.

---

## 1. Diagnostic — how we know this is the bottleneck

Debugged live on `nae-nae-bowling-club.torny.co` with the admin setting Primary = `#000000` and Accent = `#FFFFFF`. In the browser console on the public site:

```js
getComputedStyle(document.documentElement).getPropertyValue('--color-accent')
// → '#0A0A0B'   (should be '#000000' — admin's Primary pick)

getComputedStyle(document.documentElement).getPropertyValue('--color-accent-strong')
// → '#0A0A0B'   (should be '#FFFFFF' — admin's Accent pick)
```

Both root CSS variables resolve to the colour scheme's monochrome default (`#0A0A0B` ink), not the admin's overrides. The FE's `useTheme` composable is correctly ordered (scheme first, brand overrides last with `!important`) — the overrides just can't fire because the data isn't there:

```ts
const primary = club.value?.brand_primary     // undefined — not in /clubs/resolve
const accent  = site.value?.club?.brand_accent // undefined — not in /site hydrate
if (primary) declarations.push(`--color-accent: ${primary} !important;`)
if (accent)  declarations.push(`--color-accent-strong: ${accent} !important;`)
```

If `brand_primary` and `brand_accent` were in the hydrate payload, both overrides would apply immediately — zero further FE work required.

---

## 2. What's still owed on the backend

Three items. All small, all in `clubs_data` territory.

### 2a. Schema

```sql
ALTER TABLE clubs_data
  ADD COLUMN brand_accent VARCHAR(7) NULL;
```

`clubs_data.brand_primary` already exists. `brand_accent` is new. No backfill — both default to NULL = "no override; use the colour scheme preset".

### 2b. `PATCH /clubs/{cid}/brand-assets` — accept + echo both fields

The FE already posts them:

```jsonc
{
  "logo_url":      "https://cdn.torny.co/clubs/5/logo.png",
  "favicon_url":   null,
  "image_style":   "soft",
  "brand_primary": "#2563EB",   // NEW — accept + persist to clubs_data
  "brand_accent":  "#16A34A"    // NEW — accept + persist to clubs_data
}
```

Rules:
- `brand_primary` / `brand_accent` — present = set, missing = no-op. `null` = clear.
- Validate as `^#[0-9A-Fa-f]{6}$`. Reject with 400 `bad_hex` + `data.field` hint.

### 2c. Response echo + hydrate inclusion

**PATCH response** (`data` body):

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

**Public hydrate** — `GET /public/clubs/{slug}/site` → `data.club` must now carry both:

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

**Tenant-resolve** — `GET /clubs/resolve?host=...` also already returns `brand_primary` on `data.club`. It needs `brand_accent` too, since the FE reads both from this endpoint during SSR before the full hydrate lands.

### 2d. Validator relaxation

Same pattern as briefs 79 + 80. The "at least one of logo_url / favicon_url" check on `/brand-assets` currently accepts:

> `logo_url`, `favicon_url`, `image_style`

Add `brand_primary` and `brand_accent`:

> `logo_url`, `favicon_url`, `image_style`, **`brand_primary`**, **`brand_accent`**

Without this, a colour-only PATCH 400s. The FE workaround (echo logo/favicon URLs) can be removed once this ships.

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
curl "$API/clubs/resolve?host=nae-nae-bowling-club.torny.co" | jq '.data.club | {brand_primary, brand_accent}'
# → { "brand_primary": "#1F3A5F", "brand_accent": null }
```

### Pass criteria

- ✓ `brand_accent` column exists on `clubs_data`.
- ✓ PATCH `/brand-assets` accepts both fields; invalid hex 400s with `bad_hex` + field name.
- ✓ PATCH response echoes the persisted values.
- ✓ `null` on either field clears the override cleanly.
- ✓ Colour-only PATCH (no `logo_url` / `favicon_url`) succeeds.
- ✓ Both `GET /public/clubs/{slug}/site` **and** `GET /clubs/resolve` carry both fields under `data.club`.
- ✓ Smoke test from the browser:

```js
// After admin sets Primary = #000000, Accent = #FFFFFF, refresh the public site:
getComputedStyle(document.documentElement).getPropertyValue('--color-accent')         // → '#000000'
getComputedStyle(document.documentElement).getPropertyValue('--color-accent-strong')  // → '#FFFFFF'
```

That smoke test is the single gate. If both root CSS vars resolve to the admin's picks, the Primary + Accent pickers are fully alive on the public site.

---

## 4. Non-goals

- **No new endpoints.** This is purely two columns + two JSON fields on existing routes.
- **No short-form hex (`#ABC`).** Six digits only; simpler validation, no legacy.
- **No alpha channel.** Full opacity only.
- **No HSL conversion server-side.** FE handles any colour-space maths.
- **No sweep of which CSS tokens the overrides map to.** That's a FE decision (currently `brand_primary` → `--color-accent`, `brand_accent` → `--color-accent-strong`), subject to re-mapping without a backend change.
- **No deprecation of other brand fields.** `logo_url`, `favicon_url`, `image_style` stay as they are.

---

## 5. Contact

Ping Felicity once the column + PATCH + both hydrate endpoints are deployed. The FE wiring is already complete — the moment the backend echoes these two fields, every primary CTA + brand surface on every public club site picks up the admin's picks without any further FE work.
