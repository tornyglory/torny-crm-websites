# Add `bistroMenu` to the pages PATCH block-type allowlist

**Feature:** add `'bistroMenu'` to the known-block-types tuple used by `PATCH /clubs/{club_id}/pages/{page_slug}`. One-line follow-up to briefs 59 / 63 / 113 — the Bistro Menu block ships today in the FE (commit `fae1f4e`), but admins who drop it on a page see every autosave 400 with `unknown_block_type` and a toast reading *"Unknown block type 'bistroMenu' — refresh to reset"*.

**Status:** backend not started. Blocks admins from building a bistro / cafe menu page via the CRM editor — they can't persist the block at all.

**Related briefs:**
- brief 17 §137 — the owning block-type allowlist (`unknown_block_type` error shape).
- brief 59 — the broader allowlist sync. If a sweep is in flight, roll this into that PR.
- brief 113 — most recent allowlist admit (`customAi`). Same mechanic; mirror the PR.

---

## 1. What's happening

Same shape as briefs 113 / 63 / 59:

```
PATCH → /clubs/42/pages/bistro  (layout_draft includes { type: "bistroMenu", ... })
← 400  { code: "unknown_block_type", type: "bistroMenu" }
```

The CRM catches the 400 and surfaces the "refresh to reset" toast. The draft never persists, so admins can't configure menu links / hours / booking CTA from the CMS page editor.

---

## 2. The fix

Add this one string to the allowlist:

```
'bistroMenu'
```

No DB migration, no shape validation beyond what the generic block validator already does. The block carries a straightforward props object (strings + two arrays of objects):

```jsonc
{
  "id": "bm-1",
  "type": "bistroMenu",
  "props": {
    "eyebrow": "BISTRO · OPEN WED–SUN",
    "heading": "From the kitchen.",
    "headingSize": "md",
    "description": "Share platters, pub classics…",
    "hours": [
      { "label": "Lunch",  "value": "12 – 2:30" },
      { "label": "Dinner", "value": "5:30 – 9" },
      { "label": "Closed", "value": "Mon · Tue" }
    ],
    "bookingLabel": "Book a table",
    "bookingHref": "/contact",
    "menus": [
      {
        "title": "Lunch menu",
        "description": "Sandwiches, salads, sides. Served 12 – 2:30, Wed through Sun.",
        "pdfUrl": "https://naenaebowls.co.nz/menus/lunch.pdf",
        "pageCountLabel": "2 pages",
        "fileSizeLabel": "320 KB",
        "updatedLabel": "Updated Nov 24"
      }
    ]
  }
}
```

Nothing in this shape needs server-side introspection — `pdfUrl` is a free-text URL (admins host the PDF anywhere that accepts a direct link), and `pageCountLabel` / `fileSizeLabel` / `updatedLabel` are admin-authored plain-text copy. The block never fetches the PDF server-side.

---

## 3. Verification

```bash
curl -X PATCH "$API/clubs/$CID/pages/bistro" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{
    "layout_draft": [
      {
        "id": "bm-1",
        "type": "bistroMenu",
        "props": {
          "heading": "From the kitchen.",
          "menus": []
        }
      }
    ]
  }'
```

Pass criteria:

- ✓ Returns 200, not 400 `unknown_block_type`.
- ✓ `GET /clubs/$CID/pages/bistro` reads back the block in `layout_draft`.
- ✓ Publishing it serves the block from `/public/clubs/$SLUG/site` in `pages["bistro"].blocks`.

---

## 4. Optional follow-up (not blocking)

**PDF uploads inline from the editor.** Right now admins have to host the PDF themselves (own CDN, Dropbox, Google Drive — anywhere that returns an `application/pdf` from a direct URL). A nicer UX would be drag-and-drop in the inspector, same ergonomics as `ImagePicker` for images.

Simplest shape if we want to pursue this later: extend the existing block-images / media-upload endpoint to accept `application/pdf` (new allowed MIME + size cap, e.g. 10 MB), return the same stable URL shape. Can land as its own brief once a club asks for it — the current admin-URL path works for everyone we've onboarded so far.

---

## 5. Contact

Zero-risk one-liner — safe to roll into whichever allowlist-sync PR is next. Ping Felicity once the deploy is in; the existing `BistroMenuBlock` lights up on CMS-authored pages instantly.
