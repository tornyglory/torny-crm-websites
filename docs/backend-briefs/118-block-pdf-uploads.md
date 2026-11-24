# Block-scoped PDF uploads

**Feature:** admins drag a PDF into the Website editor instead of pasting a hosted URL. First target is the BistroMenu block (menu PDFs), but the pipeline is block-scoped so any future block that wants downloadable files (regulations, sanction documents, programs) can reuse it. Pairs with the FE `PdfPicker` component that mirrors the existing `ImagePicker` ergonomics.

**Status:** backend not started. BistroMenu ships today with a text input asking admins for an https URL — admins without a CDN have to use Dropbox / Google Drive public links, which are ugly and often wrapped with host chrome instead of serving `application/pdf` directly.

**Related briefs:**
- brief 18 — block-scoped image uploads. This is the PDF equivalent; mirror the URL shape, DB layout, and soft-delete reconciliation.
- brief 116 — adds `bistroMenu` to the block-type allowlist. This brief assumes that lands first.
- brief 73 §9 — venue package hero pipeline. Same three-step dance; useful reference for "which Cloudflare primitive do we use" (CF Images for raster; **R2 for PDFs** — see §1.1).

---

## 1. Base URL — CRM API (SAM stack)

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

If the CRM stack is still at the CloudFormation 500-resource cap (brief 115 noted this), host on `VENUE_BASE` instead — same pattern as `/ai-generate` and `/block-images-copy`. FE is indifferent: `api-client` just uses whichever base constant we hand it.

### 1.1 Why R2, not Cloudflare Images

CF Images is a raster-optimisation service — it rejects any non-image MIME at the direct-upload URL. PDFs need a **presigned PUT to an R2 bucket** (or S3 if we're routing through there). Shape is simpler because there's no "variants" step — one file, one public URL.

One new bucket is enough. Suggested layout:

```
r2://torny-block-pdfs/
  clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/{uuid}.pdf
```

Public read via a `*.r2.cloudflarestorage.com` custom domain or a worker route. Choose whichever matches current infra conventions.

---

## 2. Endpoints

Parallel to brief 18's image endpoints. Mounted at:

```
/clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/pdfs/…
```

All require owner or admin JWT.

### 2.1 `POST .../upload-url` — mint a presigned R2 URL

```jsonc
// request — body optional, server derives the key
{}

// 200
{
  "status": "success",
  "data": {
    "uploadUrl": "https://torny-block-pdfs.r2.cloudflarestorage.com/clubs/42/pages/bistro/blocks/bm-1/4c2…?x-amz-signature=…",
    "pdfKey": "clubs/42/pages/bistro/blocks/bm-1/4c2…"
  }
}
```

- `uploadUrl` is a single-use presigned PUT URL. 30-minute expiry matches brief 18.
- `pdfKey` is the server-chosen R2 object key. FE feeds it back on `confirm` — opaque to the FE.

### 2.2 FE → PUT the file directly to R2

The FE PUTs the file bytes (raw, not multipart form; R2 presigned PUTs expect `Content-Type: application/pdf` + raw body). No auth header needed — the presigned URL carries the signature.

### 2.3 `POST .../confirm` — persist the row

```jsonc
// request
{
  "pdf_key": "clubs/42/pages/bistro/blocks/bm-1/4c2…",
  "original_filename": "lunch-menu-nov-2026.pdf",
  "file_size_bytes": 328104,
  "title": "Lunch menu"
}

// 200
{
  "status": "success",
  "data": {
    "id": 88,
    "pdf_key": "clubs/42/pages/bistro/blocks/bm-1/4c2…",
    "public_url": "https://files.torny.pro/clubs/42/pages/bistro/blocks/bm-1/4c2….pdf",
    "original_filename": "lunch-menu-nov-2026.pdf",
    "file_size_bytes": 328104,
    "title": "Lunch menu",
    "created_at": "2026-11-25T02:12:33.000Z"
  }
}
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `original_filename` | string, max 200 chars | Server-trim. Shown in the picker's preview card ("lunch-menu-nov-2026.pdf"). |
| `file_size_bytes` | int | Server rejects > 10 MB (matches `PdfPicker`'s client cap). |
| `title` | string, optional, max 120 chars | Admin-authored label. Can be used later to seed the BistroMenu row's `title` field. |

### 2.4 `GET .../pdfs` — list active PDFs for a block

Standard envelope. Used for audit / debugging and by the FE to hydrate existing picker state on page load if the block carries a `pdfId` reference.

### 2.5 `PATCH .../pdfs/{id}` — update metadata

Only `title` is editable. Future-proofing in case admins want to rename post-upload.

### 2.6 `DELETE .../pdfs/{id}` — soft-delete

Same shape as brief 18: row flagged deleted, R2 object left in place, a sweeper hard-deletes + purges R2 after 7 days. Belt-and-braces for undo + publish reconciliation.

---

## 3. Validation + error codes

| HTTP | code | When |
|---|---|---|
| 400 | `pdf_mime_invalid` | The presigned PUT allows any content-type via the signature, but `confirm` validates that the stored R2 object's `Content-Type` is `application/pdf`. |
| 400 | `pdf_too_large` | `file_size_bytes` > 10 MB. |
| 400 | `pdf_title_too_long` | `title` > 120 chars after trim. |
| 400 | `pdf_filename_too_long` | `original_filename` > 200 chars after trim. |
| 400 | `too_many_pdfs` | The block already has 20 active PDFs. Matches `too_many_images` from brief 18. |
| 403 | role gate | Caller lacks CRM admin role on the club. |
| 404 | `pdf_not_found` | PATCH/DELETE on an unknown id. |

---

## 4. Database

Suggested table `page_block_pdfs` — parallel to `page_block_images` from brief 18:

```
id              BIGINT PK
club_id         BIGINT NOT NULL
page_slug       VARCHAR(80) NOT NULL
block_id        VARCHAR(80) NOT NULL
r2_key          VARCHAR(500) NOT NULL
public_url      VARCHAR(600) NOT NULL
original_filename VARCHAR(200) NOT NULL
file_size_bytes INT NOT NULL
title           VARCHAR(120) NULL
created_at      TIMESTAMP
deleted_at      TIMESTAMP NULL

INDEX (club_id, page_slug, block_id, deleted_at)
```

Reconciliation sweeper on publish: any row with `deleted_at` older than 7 days → DELETE object from R2, DELETE row.

---

## 5. Frontend contract

- `packages/api-client/src/resources/blockPdfs.ts` — new resource with `requestUploadUrl`, `confirmUpload`, `upload` (end-to-end), `list`, `patch`, `remove`.
- `packages/api-client/src/index.ts` — namespace export `blockPdfs` + type exports (`BlockPdf`, `UploadUrlResponse`, etc.).
- `apps/crm/src/components/PdfPicker.vue` — mirrors `ImagePicker.vue` UX. Drag target + file-picker, size + MIME client check, preview card showing filename + file-size pill + Replace / Remove.
- `apps/crm/src/views/website/WebsiteEditorView.vue` — swap the `pdfUrl` text input in the BistroMenu inspector for `<PdfPicker v-model="menu.pdfUrl" v-model:pdfId="menu.pdfId" :page-slug="…" :block-id="…" />`. Also populate `menu.fileSizeLabel` + `menu.pageCountLabel` on upload when the server returns them (file size is known; page count is not — admins still type it or we add server-side PDF introspection later).

The block layout JSON gains an optional `pdfId?: number` per `BistroMenuItem` so DELETE on replace can reach the right row. Backwards-compatible — existing menu items with just `pdfUrl` keep rendering.

---

## 6. Verification

```bash
# 1. Mint URL
curl -X POST "$API/clubs/42/pages/bistro/blocks/bm-1/pdfs/upload-url" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{}'
# → 200 { uploadUrl, pdfKey }

# 2. Upload
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/pdf" \
  --data-binary @lunch-menu.pdf
# → 200 from R2

# 3. Confirm
curl -X POST "$API/clubs/42/pages/bistro/blocks/bm-1/pdfs/confirm" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"pdf_key":"…","original_filename":"lunch-menu.pdf","file_size_bytes":328104}'
# → 200 { id, public_url, … }

# 4. Fetch the public URL
curl -I "$PUBLIC_URL"
# → 200 Content-Type: application/pdf
```

Pass criteria:

- ✓ Full three-step dance completes for an in-cap PDF.
- ✓ Confirm with an oversized `file_size_bytes` → 400 `pdf_too_large`.
- ✓ Confirm with a title > 120 chars → 400 `pdf_title_too_long`.
- ✓ Upload a 21st PDF to one block → 400 `too_many_pdfs`.
- ✓ Non-admin confirm → 403.
- ✓ DELETE marks `deleted_at`; a later PATCH on the same id returns 404 `pdf_not_found`.
- ✓ Public URL returns `Content-Type: application/pdf` and the file bytes match what was uploaded.

---

## 7. Non-goals

- **Server-side PDF introspection** (page count / sanitising / preview thumbnail). Admins still type "2 pages · 320 KB" into the BistroMenu's text fields for v1. File size is included in the confirm response — the FE can seed `fileSizeLabel` from that, but we keep page-count admin-authored. If we want introspection later, it's a follow-up brief.
- **Format conversion** (e.g. accept .docx and convert to PDF). Scope creep.
- **Version history**. The current "replace soft-deletes the prior row" pattern from brief 18 is enough.
- **Public PDF URL hotlink prevention**. Admins want other sites to link directly to their menus. No `Referer` check.

---

## 8. Contact

FE is ready to pattern-swap as soon as the endpoint lands. Ping Felicity for a sanity-check on the picker UX before the backend goes live — want to make sure the error-code names match what the inspector's inline messages will render.
