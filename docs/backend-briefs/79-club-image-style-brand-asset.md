# `image_style` on the brand-assets patch

**Feature:** let admins pick an image treatment (Soft / Studio / Archive) for their club's public site. Drives a `<body data-image-style="...">` attribute on the Nuxt layout that the `TornyImage` wrapper + design-tokens presets key off. One-line add to the existing brand-assets endpoint.

**Status:** FE wired through to the CRM Brand tab. Backend owes the column + the two-field addition to `/clubs/{cid}/brand-assets`. The FE defaults to `'soft'` when the field is absent, so this is backward-compatible — nothing breaks if the backend ships behind the FE.

**Related:**
- Brief 24 — original brand-assets endpoint (`PATCH /clubs/{cid}/brand-assets`).
- Brief 61 — sticky header toggle (same pattern: a single field on the brand-assets payload).
- Brief 62 (logo in header) — same pattern.

---

## TL;DR

1. Add `image_style ENUM('soft','studio','archive') NOT NULL DEFAULT 'soft'` to `clubs_data`.
2. Extend `PATCH /clubs/{cid}/brand-assets` to accept + echo `image_style`.
3. Include `image_style` in the public club hydrate (`GET /public/clubs/{slug}/site` or whatever endpoint feeds the Nuxt layout).

That's it. No new endpoints, no new migrations beyond the one column.

---

## 1. Schema

```sql
ALTER TABLE clubs_data
  ADD COLUMN image_style ENUM('soft','studio','archive') NOT NULL DEFAULT 'soft';
```

Backfill: `UPDATE clubs_data SET image_style = 'soft' WHERE image_style IS NULL` (safety belt — the DEFAULT handles new rows).

---

## 2. `PATCH /clubs/{cid}/brand-assets`

### Request — add `image_style` as an optional field

```jsonc
{
  "logo_url":    "https://cdn.torny.co/clubs/5/logo.png",   // optional
  "favicon_url": null,                                       // optional
  "image_style": "studio"                                    // optional — one of 'soft'|'studio'|'archive'
}
```

Same rules as the other fields: present = set, missing = no-op, `null` is **not** valid here (unlike the URL fields — there's no "clear" state for image style, only the three enum values).

### 400 on invalid value

```jsonc
{ "status": "error", "code": "bad_image_style", "message": "image_style must be one of: soft, studio, archive" }
```

### 200 response — add `image_style` to the echo

```jsonc
{
  "status": "success",
  "data": {
    "clubId":      5,
    "logo_url":    "https://cdn.torny.co/clubs/5/logo.png",
    "favicon_url": null,
    "image_style": "studio"
  }
}
```

---

## 3. Public club hydrate

Add `image_style` to whatever endpoint feeds the Nuxt layout (the one that already returns `brand_primary`, `logo_url`, `fonts`, `color_scheme`, etc.). The Nuxt side writes `<body data-image-style="{image_style}">` so the three CSS preset blocks can take effect.

If the field is absent from the response (backend behind FE), the Nuxt layout defaults to `'soft'`. So this is a soft rollout — ship the column + the PATCH acceptance first, add it to the hydrate payload second, no FE coordination needed.

---

## 4. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Set.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"image_style":"studio"}'
# → 200 { data: { image_style: 'studio', ... } }

# 2. Invalid value.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"image_style":"funky"}'
# → 400 { code: 'bad_image_style' }

# 3. Public hydrate includes it.
curl "$API/public/clubs/naenae-bowls/site"
# → 200 { ..., image_style: 'studio' }

# 4. Existing fields untouched — set logo without image_style still works.
curl -X PATCH -H "Authorization: Bearer $JWT" "$API/clubs/5/brand-assets" \
  -d '{"logo_url":"https://cdn.torny.co/clubs/5/new-logo.png"}'
# → 200, logo_url updated, image_style unchanged.
```

Pass criteria:
- ✓ Column added with DEFAULT 'soft'; existing rows backfill cleanly.
- ✓ PATCH accepts `image_style` and echoes it in the response.
- ✓ Invalid values 400 with `bad_image_style`.
- ✓ Omitting the field doesn't clobber the stored value.
- ✓ Public hydrate carries the field (once step 3 ships).

---

## 5. Non-goals

- **No per-page / per-image override.** One style per club, applied site-wide. If a club wants a mixed look later, that's a product decision for v2.
- **No admin preview endpoint.** The CRM renders a thumbnail preview client-side using the same CSS presets.
- **No migration for existing club customisations.** Everyone defaults to Soft on day one; clubs opt into Studio / Archive via the settings picker.

---

## 6. Contact

Ping Felicity once the column + PATCH acceptance are deployed. The FE picker will start saving `image_style` immediately — the hydrate field can follow in a second PR without any FE coordination.
