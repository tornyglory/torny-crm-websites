# Add `sponsors` to the pages PATCH block-type allowlist

**Feature:** add `'sponsors'` to the known-block-types tuple used by `PATCH /clubs/{club_id}/pages/{page_slug}`. One-line follow-up to briefs 116 / 113 / 63 / 59 — the Sponsors block ships today in the FE, but admins who drop it on a page see every autosave 400 with `unknown_block_type` and a toast reading *"Unknown block type 'sponsors' — refresh to reset"*.

**Status:** backend not started. Blocks admins from building a sponsor wall via the CRM editor — they can't persist the block at all.

**Related briefs:**
- brief 17 §137 — the owning block-type allowlist (`unknown_block_type` error shape).
- brief 59 — the broader allowlist sync. If a sweep is in flight, roll this into that PR.
- brief 116 — previous allowlist admit (`bistroMenu`). Same mechanic; mirror the PR.

---

## 1. What's happening

Same shape as briefs 116 / 113 / 63 / 59:

```
PATCH → /clubs/42/pages/sponsors  (layout_draft includes { type: "sponsors", ... })
← 400  { code: "unknown_block_type", type: "sponsors" }
```

The CRM catches the 400 and surfaces the "refresh to reset" toast. The draft never persists, so admins can't configure the logo wall from the CMS page editor.

---

## 2. The fix

Add this one string to the allowlist:

```
'sponsors'
```

No DB migration, no shape validation beyond what the generic block validator already does. The block carries a straightforward props object:

```jsonc
{
  "id": "sp-1",
  "type": "sponsors",
  "props": {
    "eyebrow": "SUPPORTERS · 2026",
    "heading": "Thanks to our sponsors.",
    "headingSize": "md",
    "description": "Local businesses who keep the greens open…",
    "ctaLabel": "Become a sponsor",
    "ctaHref": "/contact",
    "sponsors": [
      {
        "name": "Hutt Brewing",
        "logoUrl": "https://imagedelivery.net/.../hutt-brewing/public",
        "caption": "Est. 2011",
        "tier": "Gold",
        "href": "https://huttbrewing.co.nz"
      }
    ]
  }
}
```

`logoUrl` lands via the existing `block-images` pipeline (same path the Gallery block uses). `tier` / `caption` / `href` are all optional.

---

## 3. Verification

```bash
curl -X PATCH "$API/clubs/$CID/pages/sponsors" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{
    "layout_draft": [
      {
        "id": "sp-1",
        "type": "sponsors",
        "props": {
          "heading": "Thanks to our sponsors.",
          "sponsors": []
        }
      }
    ]
  }'
```

Pass criteria:

- ✓ Returns 200, not 400 `unknown_block_type`.
- ✓ `GET /clubs/$CID/pages/sponsors` reads back the block in `layout_draft`.
- ✓ Publishing it serves the block from `/public/clubs/$SLUG/site` in `pages["sponsors"].blocks`.

---

## 4. Contact

Zero-risk one-liner — safe to roll into whichever allowlist-sync PR is next. Ping Felicity once the deploy is in; the existing `SponsorsBlock` lights up on CMS-authored pages instantly.
