# Brand Assets — Logo + Favicon Persistence

**Feature:** persist a club's logo URL and favicon URL against the club record, and expose both on the public site payload. Small follow-up to the font/style brand work.

**Related:** brief 22 (font pairs), brief 23 (style presets). Also lives in the same **Website → Brand** CRM surface. Image upload itself already works — the CRM uploads to the existing `/media/images/upload-url` + `/media/images/confirm` flow and gets back a Cloudflare `public_url`. Nothing wires that URL to the club today.

**Status:** requested.

---

## TL;DR

1. **Add `favicon_url TEXT NULL`** to the `clubs` table (`logo_url` already exists).
2. **`PATCH /clubs/:club_id/brand-assets`** accepting `{ logo_url?, favicon_url? }` — either field is optional, `null` clears, missing key = no-op. Owner or admin.
3. **`/public/clubs/:slug/site`** gains `club.favicon_url` (sibling to the existing `club.logo_url`). Both nullable.
4. Fires the existing Nuxt revalidate webhook so the site rerenders.

Upload itself doesn't change — the CRM's `ImagePicker` uploads a file through the club-image flow, receives `public_url`, then `PATCH`es that URL onto the club. Same two-step separation-of-concerns as brief 18 (blocks) but simpler because we don't need per-block tracking.

---

## Base URL

`CRM_BASE`, Bearer JWT for the PATCH. `/public/clubs/:slug/site` stays public.

---

## 1. `PATCH /clubs/:club_id/brand-assets`  (🔒 owner or admin)

**Request:**

```json
{
  "logo_url":    "https://imagedelivery.net/…/abc/public",
  "favicon_url": "https://imagedelivery.net/…/def/public"
}
```

- Both fields **optional**.
- **Missing key** — leave the current value alone.
- **`null`** — clear the field.
- **String** — set to that URL. Validate as URL (any https:// origin is fine; we're trusting the caller since only owner/admin can hit this).

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId":      3,
    "logo_url":    "https://imagedelivery.net/…/abc/public",
    "favicon_url": "https://imagedelivery.net/…/def/public"
  }
}
```

Returns the resolved current state after the patch so the CRM can update its store without a follow-up read.

**Errors:**

| Case | HTTP | `code` |
|------|------|--------|
| Bad JSON body | 400 | `bad_json` |
| `logo_url` / `favicon_url` present but not a string or `null` | 400 | `bad_json` |
| URL exceeds 2048 chars | 400 | `url_too_long` |
| Not owner/admin on this club | 403 | `forbidden` |
| Unknown `club_id` | 404 | `not_found` |
| Missing / invalid JWT | 401 | `unauthorized` |

**Side effects:**
- Fire the Nuxt revalidate webhook with `purge: "all"`, `reason: "settings.brand_assets_updated"`. Logo appears in the site header and footer on every page, so a partial purge doesn't help.

---

## 2. `/public/clubs/:slug/site` — add `favicon_url`

Sibling to the existing `logo_url` on `data.club`. Never `undefined`; either a URL or `null`.

```json
"club": {
  "id": 3,
  "slug": "melbourne-bowling-club",
  "name": "Melbourne Bowling Club",
  "brand_primary": "#DC2626",
  "logo_url":    "https://imagedelivery.net/…/abc/public",
  "favicon_url": "https://imagedelivery.net/…/def/public",
  "fonts": { /* … */ },
  "style": { /* … */ }
  /* … */
}
```

---

## 3. Schema change

```sql
ALTER TABLE clubs
  ADD COLUMN favicon_url TEXT;
```

No index. No backfill. Existing rows get `NULL`.

---

## 4. How the upload flow lands on the frontend

For reference — no backend change needed here, just so you know what the CRM will do:

1. User picks a file in the **Website → Brand** logo picker.
2. CRM calls `GET /media/images/upload-url?entity_type=club&entity_id=:clubId&content_type=avatar&content_id=:clubId` (existing endpoint).
3. CRM `POST`s the file to the Cloudflare `uploadUrl` returned above.
4. CRM calls `POST /media/images/confirm` (existing endpoint). Receives `public_url`.
5. **New:** CRM calls `PATCH /clubs/:club_id/brand-assets` with `{ logo_url: public_url }`.

Favicon is identical except `content_type=media` in step 2 (we don't want it grouped with avatars in any future admin listing) and `{ favicon_url }` in step 5.

The intermediate `images` row from step 4 stays as-is — it's the durable record of the upload. We don't need to delete old rows when the club replaces its logo; publish reconciliation isn't relevant here (there's no `blocks[]` involved), and orphaned club-level images are cheap to leave around.

---

## 5. Frontend implications

Once this ships, on the CRM side:

- `packages/api-client/src/resources/clubs.ts` gets a new `updateBrandAssets(clubId, { logo_url?, favicon_url? })`.
- `apps/crm/src/stores/club.ts` gets a `setBrandAssets({ logo_url?, favicon_url? })` action alongside `setFonts` / `setStyle`.
- `Club` type in `packages/api-client/src/types.ts` gains `faviconUrl?: string | null`.
- `WebsiteSettingsPanel.vue` Brand tab: after the `ImagePicker` fires `update:modelValue`, call the new PATCH + `setBrandAssets` so refresh keeps the state.

On the Nuxt side:

- `SiteClub` gains `favicon_url` in `apps/club-sites/server/utils/tornyApi.ts`.
- Add a `<link rel="icon" href="{favicon_url}">` in the head via `useHead` (probably in `useTheme` alongside the fonts stylesheet). Falls back silently to nothing when null — browsers show a default icon.

---

## 6. Non-goals

- **No brand_primary here.** Handled by a separate onboarding endpoint already (and colour is a follow-up brief when we're ready to make it CRM-editable).
- **No image variant selection.** Cloudflare Images already returns responsive variants; we store the `public_url` and let CF resolve.
- **No image cropping / aspect enforcement.** The CRM UI hints "square works best" but doesn't force it. Backend takes any valid URL.
- **No favicon-specific size validation.** We hint 32×32 PNG on the CRM but if a user uploads a 512×512 it still works — Cloudflare resizes.
- **No image deletion on unset.** `PATCH { logo_url: null }` clears the club field but leaves the `images` row alone. Sweeping orphaned uploads is a separate cleanup story.

---

## 7. Open questions

1. **Combine with a general `PATCH /clubs/:id`?** Would be cleaner but wider scope — this brief keeps it tight. If you'd rather ship one endpoint that handles logo + favicon + brand_primary + name + slug, happy to redraft.
2. **Do we validate that the URL points at *our* Cloudflare Images host?** Would prevent owners pasting arbitrary URLs. Recommend: no, trust the caller (owner/admin) — but easy to add a `imagedelivery.net` allowlist if you'd prefer.
3. **Should this fold into brand-primary?** Right now the club's colour is set at onboarding and can't be changed. If you're planning a `PATCH /clubs/:id/brand-primary` endpoint soon, would make sense to name this `PATCH /clubs/:id/brand` and take all three.
