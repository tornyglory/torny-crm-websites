# Website Page Builder — Block Images Brief

**Feature:** back-end support for uploading, storing, and reconciling images owned by individual blocks in the CRM page builder. Extends brief 16/17 (`/clubs/:clubId/pages/:pageSlug`) and the existing Cloudflare media pipeline (`/media/images/upload-url` + `/media/images/confirm`).

**Status:** requested — CRM already has an `ImagePicker` component wired to `media.uploadClubImage()`, but it treats every block image as a club-level asset. We need per-block ownership before Gallery + Hero images can ship for real.

---

## TL;DR

1. Add a `content_id` scoping model that's stable per-block: `content_id = hash(block.id)` derived on the client and echoed in every media call — OR (recommended) a new `page_block_images` join table indexed by `(club_id, page_slug, block_id, position)`.
2. Two new endpoints on the CRM base for the block-scoped upload lifecycle. The Cloudflare direct-upload dance stays exactly as it is today; only the "confirm + record" step changes shape.
3. Reconcile on publish: any image row not referenced by the newly-published `layout_published.blocks[]` is soft-deleted (kept 7 days for accidental-delete recovery, then hard-deleted + purged from CF).
4. `GET /clubs/:clubId/pages/:pageSlug` returns image URLs *inside* the block props (no separate fetch). Same for the public `/public/clubs/:slug/site` payload. Frontend never has to look images up out-of-band.

Scope: **Hero** (single image) and **Gallery** (multiple ordered images with alt + caption). Rich-text inline images and per-block backgrounds for CTA / membership blocks are out of scope for this brief but the schema below leaves room.

---

## Base URL

Same as the pages endpoints — `CRM_BASE`. Bearer JWT, owner or admin.

---

## 1. Data model

### Current state

The `images` table already exists (used by club avatar / banner / gallery uploads today):

```
images
  image_id            bigserial pk
  cloudflare_image_id text
  entity_type         enum('club','user','moment','event')
  entity_id           int
  content_type        enum('avatar','banner','gallery','media')
  content_id          int
  public_url          text
  thumbnail_url       text
  avatar_url          text
  created_at          timestamptz
```

`content_id` is currently `= entity_id` for club-level assets. For block images we need it to identify the *block*, not the club.

### Proposed change (recommended: separate table)

Rather than overloading `content_id`, add a purpose-built table so page-builder image ownership is queryable and reconcilable in isolation:

```sql
create table page_block_images (
  id             bigserial primary key,
  club_id        int         not null references clubs(id) on delete cascade,
  page_slug      text        not null,
  block_id       text        not null,               -- opaque client-generated id
  image_id       bigint      not null references images(image_id) on delete cascade,
  position       int         not null default 0,     -- ordinal for gallery
  alt            text        default '',
  caption        text        default '',
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,                        -- soft-delete on unpublish/remove
  unique (club_id, page_slug, block_id, image_id)
);

create index page_block_images_lookup
  on page_block_images (club_id, page_slug, block_id)
  where deleted_at is null;

create index page_block_images_gc
  on page_block_images (deleted_at)
  where deleted_at is not null;
```

`block_id` matches the string ID the CRM generates client-side (`crypto.randomUUID()`-style — currently just a nanoid-ish helper). Backend treats it as opaque.

**Why not just `content_id`?** Two reasons: (1) gallery needs `position + alt + caption`, which `images` doesn't have; (2) on publish we want to reconcile against the *set of block IDs* in `layout_published`, and doing that against a join table is a single `NOT IN` query rather than a scan of `images` with fragile derivation.

---

## 2. Endpoints

### 2a. `GET /clubs/:clubId/pages/:pageSlug/blocks/:blockId/images`  (🔒 owner or admin)

List images for a specific block, in `position` order, deleted excluded.

```json
{
  "status": "success",
  "data": {
    "images": [
      {
        "id": 42,
        "cloudflare_image_id": "abc123",
        "public_url": "https://imagedelivery.net/…/public",
        "thumbnail_url": "https://imagedelivery.net/…/thumb",
        "position": 0,
        "alt": "Green A on a Friday twilight",
        "caption": "Members roll up whenever the sun's out."
      }
    ]
  }
}
```

Used by Gallery editor + as a re-hydration step if we ever need to detach URLs from `props` (we don't today — see §4).

### 2b. `POST /clubs/:clubId/pages/:pageSlug/blocks/:blockId/images`  (🔒 owner or admin)

Two-step, mirrors the existing club-image flow but scoped to a block.

**Step 1 — `POST .../images/upload-url`**

```json
// request: {} (empty)
// 200:
{
  "status": "success",
  "data": {
    "uploadUrl": "https://upload.imagedelivery.net/…",
    "imageId":   "cf-uuid"
  }
}
```

**Step 2 — `POST .../images/confirm`**

```json
// request:
{
  "cloudflare_image_id": "cf-uuid",
  "position": 0,
  "alt": "",
  "caption": ""
}

// 200:
{
  "status": "success",
  "data": {
    "id": 43,
    "cloudflare_image_id": "cf-uuid",
    "public_url": "…",
    "thumbnail_url": "…",
    "position": 0,
    "alt": "",
    "caption": ""
  }
}
```

Backend inserts into `images` + `page_block_images` in one transaction. `position` defaults to `max(position) + 1` for the block when omitted, so Gallery uploads can be "append".

Validation:
- Block count of images ≤ 20 per block → `400 too_many_images`
- File size enforced by Cloudflare (existing behavior) — no server-side change needed.

### 2c. `PATCH /clubs/:clubId/pages/:pageSlug/blocks/:blockId/images/:imageId`  (🔒)

Update metadata + position:

```json
// request (all fields optional):
{ "position": 2, "alt": "…", "caption": "…" }
```

Position reorder: if `position` moves, backend re-numbers other images in the same block to keep them dense (0..N-1). Same-block only — moving between blocks isn't supported (delete + re-upload instead).

### 2d. `DELETE /clubs/:clubId/pages/:pageSlug/blocks/:blockId/images/:imageId`  (🔒)

Soft-delete: sets `deleted_at = now()`. The row is retained for 7 days; the sweeper (§3) hard-deletes + purges from Cloudflare after that.

Returns `204 No Content`.

### 2e. Bulk reorder shortcut (nice-to-have)

`PUT /clubs/:clubId/pages/:pageSlug/blocks/:blockId/images/order`

```json
{ "order": [43, 41, 42] }
```

Reorders the block's images in one round-trip. Cheaper than N `PATCH` calls when the user drags a gallery around. If backend team prefers to skip this and use N `PATCH`es, that's fine — the CRM debounces reorder edits by 500 ms anyway.

---

## 3. Publish-time reconciliation

`POST .../pages/:pageSlug/publish` already atomically copies `layout_draft → layout_published`. Extend it to also:

1. Collect `blockIds = { block.id : block in layout_published.blocks }`.
2. For each `page_block_images` row with `(club_id, page_slug)` matching but `block_id NOT IN blockIds` → soft-delete (set `deleted_at`).
3. Fire-and-forget: no need to await CF deletes; the daily sweeper handles that.

**Sweeper job** (existing cron or new — daily is fine):
- `SELECT ... FROM page_block_images WHERE deleted_at < now() - interval '7 days'`
- For each: `DELETE FROM images` (cascades), then `DELETE` from Cloudflare via their API.
- Log CF failures but don't block the DB delete.

**Why 7 days?** Owner accidentally deletes a hero image → publishes → notices the next morning → we can restore by resurrecting the `page_block_images` row and un-deleting the underlying `images` row. Past 7 days it's on them.

---

## 4. How image URLs flow into block props

**Frontend contract (unchanged from today's block schema):**

- **Hero:** `props.imageUrl: string | null` — set to `public_url` after upload, cleared on remove.
- **Gallery:** `props.images: Array<{ id: number; url: string; alt: string; caption: string }>` — extend the existing shape to include `id` so PATCH/DELETE calls know the row. `url` is `public_url`.

The CRM's autosave already `PATCH`es the whole `blocks[]` on every edit; those URLs land in `layout_draft` as opaque JSON, so **the backend does not need to parse block props to keep image references in sync**. The `page_block_images` table is the source of truth for cleanup, and the CRM keeps `props` in step by calling the endpoints in §2 before the autosave fires.

**Alternative considered:** having the backend read block props on publish to derive image references. Rejected — too tightly coupled to block schema, and any props edit outside the ImagePicker (e.g. someone hand-editing JSON in the future) would silently orphan images.

**`GET /public/clubs/:slug/site`:** no shape change needed. Published blocks are returned exactly as stored; URLs are already inside `props`. If we ever want to serve responsive `srcset`, we can add a `variants` field to gallery images later without breaking anything.

---

## 5. Auth + tenancy

Same guards as the pages editor:
- 401 unauthenticated.
- 403 if the JWT's user isn't an owner or admin of `:clubId`.
- All queries filter by `club_id` — no cross-tenant leakage possible.

`entity_type` on the underlying `images` row stays `'club'` (the images belong to the club). Only the join-table row scopes them to a specific block within a page.

---

## 6. Migration

1. Migration 089: `create table page_block_images` (SQL in §1) + indexes.
2. **Backfill?** Not needed — no block images exist in prod yet. The `banner` / `gallery` `content_type` on the existing `images` table stays as-is for club-level uploads.
3. Ship endpoints in §2. CRM can start hitting them behind a feature flag or immediately.
4. Extend the publish endpoint's transaction with the reconcile step (§3).
5. Add the sweeper job (§3).

---

## 7. Edge cases + gotchas

- **Duplicate uploads at the same position:** last-write-wins; the `unique(club_id, page_slug, block_id, image_id)` constraint protects against actual dupes but two different files at the same position is normal (they push each other along the ordinal).
- **Block deleted before autosave lands:** the image ends up orphaned in `page_block_images` until publish reconciliation runs. That's acceptable — sweeper cleans it up eventually. Alternative: `DELETE .../images/:imageId` when the CRM removes a block, but that adds a race with autosave.
- **Same image reused across two blocks:** not supported. Users copy-paste; each block gets its own upload. Simpler contract, no ref-counting on `images`.
- **Cloudflare direct-upload failure:** identical to today. Client retries with a fresh `upload-url`.
- **Owner tries to upload to a page slug that doesn't exist yet:** allowed. `page_block_images` row references a `block_id` that isn't yet in any layout. Publish reconciliation soft-deletes it if it never lands in a published layout.

---

## 8. Non-goals for this brief

- Rich-text inline images (would need a different `content_type` and per-paragraph anchoring — separate brief when we get there).
- Video / gif upload.
- Focal-point / crop metadata (Cloudflare handles automatic focal point today).
- Cross-tenant image library / stock photos.
- Undo history on gallery reorder.

---

## 9. Open questions for backend

1. Do we want to expose `variants` (`thumbnail_url` etc.) on the block-image response, or is `public_url` enough for the frontend today? Vote: return all three, cheap to include.
2. Sweeper cadence — daily is fine, or hourly? Depends on CF cost of orphan retention. Recommend daily.
3. Do you want `block_id` typed as `uuid` for a DB-level guarantee, or is `text` (matches the CRM's `nanoid()` output) fine? Vote: `text`, matches what the client produces without forcing a format on all callers.
