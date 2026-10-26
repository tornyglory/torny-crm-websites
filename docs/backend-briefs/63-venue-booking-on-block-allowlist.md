# Add `venueBooking` to the pages PATCH block-type allowlist

**Feature:** add `'venueBooking'` to the known-block-types tuple used by `PATCH /clubs/{club_id}/pages/{page_slug}`. One-line follow-up to brief 59 — the venue-hire booking wizard block ships today in the FE (brief 62 §FE), but admins who drop it on a page see every autosave 400 with `unknown_block_type` and a toast reading *"Unknown block type 'venueBooking' — refresh to reset"*.

**Status:** backend not started. Blocks all admins from building the `/venue-hire/book` page via the CRM editor — they can only use the hardcoded fallback that `apps/club-sites/pages/venue-hire/book.vue` renders when `site.pages["venue-hire/book"]` is empty.

**Related briefs:**
- brief 59 — the broader block-type allowlist sync. If 59 ships before 63, roll this one into that PR.
- brief 62 — venue bookings resource. The frontend half of the booking flow depends on this allowlist admit.

---

## 1. What's happening

Same shape as brief 59 and brief 58:

```
PATCH → /clubs/42/pages/venue-hire-book  (layout_draft includes { type: "venueBooking", ... })
← 400  { code: "unknown_block_type", type: "venueBooking" }
```

The CRM catches the 400 and surfaces the "refresh to reset" toast (see second screenshot the user attached on 2026-10-27). The draft never persists, so admins can't tune packages / slots / add-ons / host details inline on the CMS page — they're stuck with the hardcoded Naenae fallback in `apps/club-sites/pages/venue-hire/book.vue`.

---

## 2. The fix

Add this one string to the allowlist:

```
'venueBooking'
```

If brief 59's audit happens in the same PR, no new work on top — just make sure `venueBooking` lands with the other missing types.

---

## 3. Verification

```bash
curl -X PATCH "$API/clubs/$CID/pages/venue-hire-book" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{
    "layout_draft": [
      { "id": "vb-1", "type": "venueBooking", "props": { "heading": "Book the venue", "packages": [] } }
    ]
  }'
```

Pass criteria:

- ✓ Returns 200, not 400 `unknown_block_type`.
- ✓ `GET /clubs/$CID/pages/venue-hire-book` reads back the block in `layout_draft`.
- ✓ Publishing it serves the block from `/public/clubs/$SLUG/site` in `pages["venue-hire/book"].blocks`.

---

## 4. Contact

Zero-risk one-liner — safe to roll into whichever allowlist-sync PR is next. Ping Felicity once the deploy is in; the existing `VenueBookingBlock` lights up on CMS-authored pages instantly.
