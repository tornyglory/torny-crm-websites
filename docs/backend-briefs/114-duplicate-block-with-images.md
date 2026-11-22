# Brief 114 — Duplicate block (with image rows)

**Scope:**
- API (CRM stack): one new endpoint that clones the brief-18 `page_block_images` rows from a source block to a target block under the same `(club, page)` tuple.
- API (CRM stack): sweeper that hard-deletes Cloudflare assets must reference-count `cloudflare_image_id` across active + soft-deleted rows before purging, so deleting an image from one block doesn't 404 another block that shares the same asset.
- FE (`tornyglory/torny-crm-websites`): "Duplicate block" button on each editor card calls the new endpoint right after the local props clone lands in the layout_draft.

**Prereq:** brief 17 (page builder persistence), brief 18 (block images), brief 113 (Custom · AI block) all shipped.

> **What triggered this brief:** admins asked for a way to duplicate a block in the page editor. The props clone is trivial on the FE — generate a new `block_id`, deep-copy the `props`, splice in. But block-scoped assets (brief-18 images) key on `block_id`, so the duplicate starts with an empty Images tab. Admins then either regenerate the Custom · AI block from scratch (loses the shared design) or re-upload every image (friction). Worse, if the admin later deletes an image from the original, the duplicate's HTML silently breaks because the Cloudflare URL purges.

---

## 1. The ask

A single POST that takes a source `block_id` and a target `block_id` on the same page and copies all active image rows across. Same `cloudflare_image_id` on each new row — the Cloudflare asset is shared by reference, not re-uploaded.

FE flow:

1. Admin clicks "Duplicate" on block `blk_A`.
2. FE deep-clones `props`, generates `blk_B`, inserts it into `layout_draft` right after `blk_A`, selects it. Autosave fires.
3. If the source block has any images (`blockImages.list(…, blk_A).length > 0`), FE calls the new duplicate endpoint with `{ source: 'blk_A', target: 'blk_B' }`.
4. New image rows now exist against `blk_B` with identical positions / alt / caption, same `cloudflare_image_id`s, so the cloned HTML's `<img src="https://imagedelivery.net/.../<cf_id>/public">` tags still render and the duplicate's Images tab shows the same assets.

Zero HTML rewrites, zero re-uploads to Cloudflare.

---

## 2. The endpoint

```
POST /clubs/{club_id}/pages/{page_slug}/blocks/{target_block_id}/images/copy-from
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "source_block_id": "blk_m1h2a3xy"
}
```

Target lives in the URL (keeps it consistent with the other brief-18 endpoints that key on `(club, page, block_id)` in the path). Source rides in the body.

### Success

```json
{
    "status": "success",
    "data": {
        "copied": 4,
        "images": [
            {
                "id": 2817,
                "cloudflare_image_id": "01HX…",
                "public_url": "https://imagedelivery.net/…/01HX…/public",
                "thumbnail_url": "https://imagedelivery.net/…/01HX…/thumbnail",
                "avatar_url": "https://imagedelivery.net/…/01HX…/avatar",
                "position": 0,
                "alt": "Club crest",
                "caption": "Our 1963 nationals trophy"
            }
        ]
    }
}
```

Same row shape as `GET .../images` so the FE can splice the response straight into the images list.

### Errors (shape: `{ status: "error", code, message }`)

| HTTP | code | When |
|---|---|---|
| 400 | `missing_source` | `source_block_id` missing or empty. |
| 400 | `same_block` | `source_block_id === target_block_id` on the same page. |
| 403 | `forbidden` | Caller lacks CRM role on the club. |
| 404 | `source_not_found` | No active image rows for `(club, page, source_block_id)`. (Also OK to return 200 with `copied: 0` — see §4.) |
| 409 | `target_not_empty` | Target block already has images. See §5 for the semantics call. |
| 422 | `over_cap` | Source has more images than the remaining capacity on the target would allow (unlikely since target is empty, but needed if we loosen §5). |

Source + target must belong to the same `(club_id, page_slug)` — path checks the target, body should be rejected if it doesn't belong to the same slice.

---

## 3. Sweeper + reference counting

The biggest piece. Today the brief-18 sweeper hard-deletes the Cloudflare asset `N` days after a row is soft-deleted (`deleted_at IS NOT NULL`). With this brief, two rows can legitimately share one `cloudflare_image_id` across different `block_id`s.

**New sweeper rule:** before calling the Cloudflare `DELETE /images/<id>`, check whether any *other* row (active OR soft-deleted-but-not-yet-expired) still references the same `cloudflare_image_id`. If so, skip the Cloudflare purge; just drop the row from the DB.

Sketch:

```sql
-- Per row scheduled for Cloudflare purge:
SELECT COUNT(*)
FROM page_block_images
WHERE cloudflare_image_id = :cf_id
  AND id != :row_id
  AND (deleted_at IS NULL OR deleted_at > NOW() - INTERVAL '7 days');
```

Zero → safe to purge. Any count → leave Cloudflare alone; the DB row still gets dropped so storage stays clean.

Add an index on `(cloudflare_image_id)` if there isn't one.

---

## 4. Semantics: what counts as "active"

For the copy, source rows must satisfy `deleted_at IS NULL`. Soft-deleted rows on the source are not copied.

If a soft-deleted row is still within the 7-day Cloudflare grace window and the admin re-uploads the same file via a different path, that's a different `cloudflare_image_id` anyway, so no collision.

---

## 5. What if the target already has images?

Two defensible answers:

1. **409 `target_not_empty`** (recommended for v1). Keeps the endpoint idempotent and predictable — "I expect to copy into an empty slot." FE calls this immediately after creating the duplicate, so it's always empty.
2. **Append** — place the copied rows at `max(position) + 1` on the target. Flexible but has a cap-check: `COUNT(target) + COUNT(source) ≤ 20`.

Shipping option 1 covers the brief's stated use case. Option 2 is one extra `max()` query if someone later wants "copy images from one block to another" as a user-facing action.

---

## 6. Verification

Prereq: two blocks on the same page, one with 3 images, one empty.

```bash
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…admin JWT…"

# 1. Copy succeeds — rows now live against target
curl -s -X POST "$CRM/clubs/5/pages/home/blocks/blk_target/images/copy-from" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"source_block_id":"blk_source"}' | jq '.data.copied'
# → 3

# 2. Target now lists them
curl -s "$CRM/clubs/5/pages/home/blocks/blk_target/images" \
    -H "Authorization: Bearer $TOKEN" | jq '.data.images | length'
# → 3

# 3. Source still has its originals (not moved, copied)
curl -s "$CRM/clubs/5/pages/home/blocks/blk_source/images" \
    -H "Authorization: Bearer $TOKEN" | jq '.data.images | length'
# → 3

# 4. Both blocks' cloudflare_image_ids overlap exactly
# (same URLs — the asset itself is shared)

# 5. Delete an image from the source — target's copy still renders
curl -s -X DELETE "$CRM/clubs/5/pages/home/blocks/blk_source/images/{image_id}" \
    -H "Authorization: Bearer $TOKEN"
# Fetch https://imagedelivery.net/.../<cf_id>/public → still 200

# 6. After the sweeper runs for the source's soft-deleted row, target's URL
#    STILL renders (reference count > 0 blocks the Cloudflare purge).

# 7. Delete the image from the target too — reference count hits 0, sweeper
#    now purges Cloudflare at the next run.

# 8. Attempting to copy into a non-empty target → 409 target_not_empty.

# 9. source == target → 400 same_block.

# 10. Copying from a block in a different page → 400/404 (depends on
#     whether target's existence is checked before source).
```

---

## 7. FE wiring (for reference)

Minimal — one new api-client resource method + one button in the editor:

```ts
// packages/api-client/src/resources/blockImages.ts

export async function copyFrom(
  clubId: number,
  pageSlug: PageSlug,
  targetBlockId: string,
  sourceBlockId: string,
): Promise<{ copied: number; images: BlockImage[] }> {
  const res = await authedFetch<Envelope<{ copied: number; images: BlockImage[] }>>(
    `${base(clubId, pageSlug, targetBlockId)}/copy-from`,
    { method: 'POST', body: JSON.stringify({ source_block_id: sourceBlockId }) },
  )
  return res.data
}
```

Editor side:

```ts
async function duplicateBlock(id: string) {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx < 0) return
  const src = state.blocks[idx]
  const next: Block = { ...src, id: newBlockId(), props: structuredClone(src.props) }
  state.blocks.splice(idx + 1, 0, next)
  selectedId.value = next.id
  // Autosave fires on the layout_draft change.

  // If images exist on the source, copy them to the new block.
  const srcImgs = await blockImages.list(clubId, slug, src.id).catch(() => [])
  if (srcImgs.length > 0) {
    await blockImages.copyFrom(clubId, slug, next.id, src.id)
  }
}
```

Autosave handles persistence of the cloned props; the copy call handles the asset side.

---

## 8. Non-goals

- A bulk copy UI (move images from block A to block B as a user-facing action). The endpoint supports it per §5 option 2, but there's no UI need today.
- Cloning across pages or clubs. Same `(club, page)` only.
- Cloning across block types. Any block type with brief-18 image rows (customAi, hero, mediaSplit, venueHireHero, gallery, etc.) can be copied — the endpoint doesn't know or care about the block's `type`, just the `block_id` tuple.
- Rewriting the duplicated block's `props.html` to reference the new row ids. Not needed — the URLs are derived from `cloudflare_image_id`, which is shared.

---

## 9. Related briefs

- Brief 17 — page builder persistence (the `layout_draft` the duplicate lands in).
- Brief 18 — block images (the pipeline + sweeper being extended).
- Brief 113 + 113a — Custom · AI block that triggered the asset-coupling issue (duplicating a props-only clone orphans the image references).
