# Block Video Uploads

**Feature:** let admins upload a short background video from the CRM Website Editor and have it play as the backdrop of a `fullBleedMedia` block. Today the admin has to paste a hosted MP4 URL — this brief wires up a first-party upload pipeline so they can drop a file in the ImagePicker-equivalent control and go.

**Status:** backend not started. Frontend block + settings panel already live (see `FullBleedMediaBlock.vue`, `WebsiteEditorView.vue` → "Full-bleed video / image"). The block already accepts a URL — this brief replaces "paste URL" with "pick file, upload, use."

**Related briefs:**
- brief 18 (block-scoped page images) — direct-model this closely. One-per-block instead of a gallery, otherwise same shape.
- brief 15 / 16 (site payload) — the resulting URL lives on `page.blocks[].props.videoUrl` and ships with the public `/site` payload like any other block prop.

**Why not just reuse the image pipeline with a bigger size limit?** Videos have different concerns: longer encode times, transcoding to mobile-friendly resolutions, Range request support, poster-frame extraction, duration limits. Trying to fold them into `page_block_images` would mean a second class of row that behaves differently from every other row in that table. A sibling resource is clearer.

---

## 1. Where videos live

Two credible options — recommending **Cloudflare Stream** for parity with the existing Cloudflare Images pipeline, with **R2 as a fallback** if ongoing delivery cost becomes an issue.

### Option A — Cloudflare Stream (recommended for v1)

Pros:
- Same provider as Cloudflare Images (one bill, one API surface).
- Automatic transcoding to multiple resolutions + adaptive HLS.
- Auto-generated thumbnail frames (free poster image).
- Direct-upload URL flow mirrors Cloudflare Images exactly — the FE already knows this dance.
- Range requests + CDN caching handled.
- Returns an MP4 URL per video so the current `<video src>` block works without changes.

Cons:
- Delivery is **not free** — ~$1 per 1,000 minutes watched (and $5 per 1,000 minutes stored). For 100 clubs × 60s hero × 1,000 page-views/month = 100,000 watched minutes = ~$100/month. Not trivial for marketing hero loops that autoplay on every visit.

### Option B — R2 + plain MP4

Pros:
- Storage: ~$0.015/GB/month. 100 clubs × 20MB each ≈ $0.03/mo.
- Delivery through Cloudflare CDN is free egress.
- No per-minute delivery costs regardless of traffic.

Cons:
- No transcoding — admin's upload is exactly what every viewer gets. Large / high-res uploads will hurt mobile.
- No auto-poster frames — admin must upload their own still (which we already support).
- No adaptive bitrate.
- Server-side validation (duration, dimensions) is harder.

**Recommendation:** ship **Stream** for v1 so the admin UX is clean (auto-posters, auto-transcoding, no "your video is 50MB please re-export"). If traffic + billing lines up badly after a month in production, migrate the delivery path to R2 while keeping Stream for ingest + transcoding.

---

## 2. Schema

```sql
CREATE TABLE page_block_videos (
  id                  BIGSERIAL PRIMARY KEY,
  club_id             INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  page_slug           TEXT NOT NULL,
  block_id            TEXT NOT NULL,
  -- Stream (option A) stores a stream_video_id; R2 (option B) stores an r2_key.
  -- Nullable so we can migrate between providers without a schema rewrite.
  stream_video_id     TEXT,
  r2_key              TEXT,
  -- Resolved playback + poster. Written on confirm. Public, cache-safe.
  mp4_url             TEXT NOT NULL,
  thumbnail_url       TEXT,
  -- Metadata echoed from Stream (null on R2 unless we probe server-side).
  duration_seconds    NUMERIC(6, 2),
  width_px            INT,
  height_px           INT,
  bytes               BIGINT,
  -- Lifecycle
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  tombstoned_at       TIMESTAMPTZ,
  UNIQUE (club_id, page_slug, block_id)
);

CREATE INDEX page_block_videos_tombstoned_idx ON page_block_videos (tombstoned_at)
  WHERE tombstoned_at IS NOT NULL;
```

- **UNIQUE constraint on `(club_id, page_slug, block_id)`** enforces 1 video per block (unlike images, which are a gallery).
- `tombstoned_at` tracks soft-deletes so the cleanup job can purge both the DB row and the upstream (Stream / R2) object.
- `uploaded_by_user_id` is nullable + ON DELETE SET NULL so audit survives user removals.

---

## 3. Endpoints

Mirrors brief 18 (block images) one-for-one, minus the gallery concepts (no `position`, no reorder, singular not plural in the path).

### Base path

```
POST   /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/video/upload-url
POST   /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/video/confirm
GET    /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/video
DELETE /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/video
```

Auth: **admin+** on `club_members`. Same gate as block images.

### 3a. `POST /upload-url`

Mint a Cloudflare Stream direct-upload URL. Request body is empty — the server picks the duration cap + max file size.

**Response**

```jsonc
{
  "uploadUrl": "https://upload.cloudflarestream.com/…?tus=1",
  "streamVideoId": "a1b2c3…",
  // Max accepted at the Stream side — mirrors our server limits so the
  // browser can refuse too-large files before starting the upload.
  "maxBytes": 52428800,       // 50 MiB
  "maxDurationSeconds": 60    // 60s loops
}
```

### 3b. `POST /confirm`

The client POSTs the file to Cloudflare, then calls this to persist the row.

**Request**

```jsonc
{
  "streamVideoId": "a1b2c3…"
}
```

**Response**

```jsonc
{
  "id": 42,
  "mp4Url": "https://videodelivery.net/a1b2c3…/mp4/high.mp4",
  "thumbnailUrl": "https://videodelivery.net/a1b2c3…/thumbnails/thumbnail.jpg",
  "durationSeconds": 24.5,
  "widthPx": 1920,
  "heightPx": 1080,
  "bytes": 18_432_000
}
```

Side effects:
- Polls the Stream API for `ready === true` before responding — the direct upload returns immediately but Stream transcodes asynchronously. If still processing after 20s, respond `202 processing` with the row id so the client can poll (§3c).
- Replaces any existing row for `(club_id, page_slug, block_id)` — the old `stream_video_id` gets tombstoned.

### 3c. `GET /video`

Returns the current video for the block, or `404 not_found` when there isn't one.

**Response**

```jsonc
{
  "id": 42,
  "mp4Url": "https://videodelivery.net/a1b2c3…/mp4/high.mp4",
  "thumbnailUrl": "https://videodelivery.net/a1b2c3…/thumbnails/thumbnail.jpg",
  "durationSeconds": 24.5,
  "widthPx": 1920,
  "heightPx": 1080,
  "state": "ready"   // "processing" | "ready" | "error"
}
```

If `state === "processing"`, mp4Url is still populated (Stream serves it as it completes transcoding) but the client should show a "processing" chip in the editor instead of the live preview.

### 3d. `DELETE /video`

Soft-deletes the row + enqueues deletion of the Stream video. Returns `204`.

### 3e. Error codes

```
400  invalid_input
400  file_too_large           — Stream rejected because > maxBytes
400  duration_too_long        — Stream reports duration > maxDurationSeconds
400  unsupported_media_type   — not a video container Stream could decode
404  not_found                — on GET/DELETE when no video exists
404  block_not_found          — page+block pair doesn't exist in page_blocks
403  forbidden                — caller isn't admin+ on this club
409  processing_timeout       — Stream still transcoding after 60s; retry /confirm
```

---

## 4. Validation + limits

| Limit | Value | Why |
|---|---|---|
| Max file size | **50 MiB** | Background hero loops shouldn't need more; forces admins to pre-compress. |
| Max duration | **60 seconds** | These loop silently in the background — anything longer is a different product. |
| Allowed container | `video/mp4`, `video/webm`, `video/quicktime` | iPhone exports .mov; accept + Stream transcodes. |
| Dimensions | None hard-coded | Stream handles arbitrary sizes; the block uses `object-fit: cover`. |

Enforced server-side on `/confirm` by inspecting the Stream API's reported metadata. Client sends the limits down from `/upload-url` as a convenience but the authoritative check is server-side (a sneaky client could ignore).

---

## 5. Poster frames

Cloudflare Stream auto-generates a thumbnail at the halfway point. Returned on `/confirm` as `thumbnailUrl`.

**UX contract:**
- When the admin uploads a video, the block's `imageUrl` field is **pre-filled** with the auto-thumbnail so there's always a poster.
- The admin can override via the existing ImagePicker (same as if they'd uploaded an image).
- On DELETE of the video, the auto-thumbnail is removed only if `imageUrl` still points at it; a user-uploaded poster is preserved.

Open question: do we want to expose a "pick a different frame as the poster" affordance (Stream lets you specify a timestamp)? Nice-to-have — deferred to a follow-up.

---

## 6. Orphan cleanup

Same pattern as block images (brief 18):

- When a `fullBleedMedia` block is removed from a page (saved page no longer contains the `block_id`), the backend tombstones the matching `page_block_videos` row.
- A nightly job scans tombstoned rows older than **7 days** and:
  1. Issues a DELETE to Cloudflare Stream for the `stream_video_id`.
  2. Hard-deletes the DB row.

The 7-day window is the admin's safety net — if they accidentally remove a block and immediately restore it, the video still works. After a week we assume removal was intentional.

Explicit `DELETE /video` tombstones immediately; the cleanup job still handles the Stream-side purge on its next run.

---

## 7. Delivery + caching

Cloudflare Stream MP4 URLs are already behind the Cloudflare CDN with Range request support built in — nothing extra required. The `/site` payload will embed the `mp4Url` directly; the public club site's `<video>` tag streams it progressively.

**Cache-Control headers:** honour Stream's defaults (`public, max-age=31536000, immutable`). Video URLs are content-addressed (keyed on `streamVideoId`) so they can be cached forever; when the admin uploads a new one the URL changes.

---

## 8. CRM / UX contract

### 8a. Replace the URL input with an upload picker

Currently in `WebsiteEditorView.vue` the "Video URL" field is a plain text input. Replace with a `VideoPicker` component that mirrors `ImagePicker`:

```
┌─────────────────────────────────────────────┐
│  ▶  hero-video.mp4 · 18 MB · 24s · 1080p    │
│     [ Change ] [ Remove ]                   │
└─────────────────────────────────────────────┘
```

Empty state:

```
┌─────────────────────────────────────────────┐
│     +  Upload background video               │
│        .mp4 · .webm · up to 50 MB · 60s     │
└─────────────────────────────────────────────┘
```

While Stream is transcoding, show a non-blocking "Processing — ready in ~20s" chip and poll `/video` every 3s.

### 8b. Auto-poster handoff

When upload completes, the editor auto-sets `block.props.imageUrl` to the returned `thumbnailUrl`. If the admin had already picked a poster image, keep theirs.

### 8c. Preview inside the editor

The existing live preview already renders `<video>` — no change needed, it just needs the URL. Processing state can show the poster + a muted "video processing" overlay until `state === 'ready'`.

---

## 9. Open questions for the backend reviewer

1. **Stream vs R2 for v1** — my recommendation is Stream (auto-posters + transcoding), but if the finance side is worried about per-minute delivery costs for large clubs, R2 wins. Would like a call on this before we start.
2. **Which Stream API tier** — are we on Stream Standard or Business? Direct-upload URLs work on both; just needs confirming so we know the per-video upload cap (10 GiB on Standard).
3. **Transcoding wait** — is 20s of synchronous polling in `/confirm` acceptable, or should we go fully async (confirm returns `202 processing`, client polls)? The async path is cleaner but adds a second round-trip. **Preference: 20s synchronous + fall back to async on timeout.**
4. **Max duration** — is 60s the right cap, or do we want to allow longer (e.g. a 2-minute club-tour video on an About page)? Longer = more delivery minutes = more cost. **Preference: 60s for v1, raise once we see real usage patterns.**
5. **Mobile transcoding profile** — Stream can serve multiple resolutions. Do we care, or is a single 1080p MP4 fine? **Preference: let Stream serve its default adaptive HLS when the FE moves to hls.js; serve single-rendition MP4 in the meantime.**
6. **Per-block vs per-page limit** — one block = one video enforced by the UNIQUE constraint. Any reason to allow N videos per block (e.g. an admin wants two layered loops)? **Preference: 1-per-block hard. If someone wants more, they add more blocks.**

---

## 10. Scope not included

- **Picking a custom poster frame timestamp** — Stream supports it, defer to v2.
- **Live video / RTMP ingest** — this is file upload only; livestreams are a different product.
- **Video in gallery blocks** — the gallery is still image-only. If we want mixed media galleries later, that's a separate brief.
- **Mux / Vimeo / YouTube embeds as an alternative source** — admins can still paste a direct MP4 URL into the current `videoUrl` field; this brief adds upload *on top* of that, doesn't remove it.
- **Analytics** (play counts, drop-off) — Stream exposes this via its API; wire up later if someone asks.
- **AI auto-generated b-roll** — out of scope.
