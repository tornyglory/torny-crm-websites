# Brief 118 — Block-scoped PDF uploads (SHIPPED)

**STATUS — SHIPPED 2026-11-25 (commit a289fea).**

> URL + base URL deviation from the brief spec. The original brief scoped `POST /clubs/{cid}/pages/{slug}/blocks/{bid}/pdfs/…` on the CRM base. Ship landed as flat `POST /clubs/{cid}/block-pdfs/…` on the **Venue** base. Same reason as `/ai-generate`, `/block-images-copy`, `/footer-config` — TornyCrmStack is at CloudFormation's 500-resource cap. New nested paths blow the budget; new endpoints flatten + migrate to the Venue API.

FE change on ship: swap `CRM_BASE` → `VENUE_BASE` in the resource file, and move `page_slug` + `block_id` out of the URL into body/query. Landed in `packages/api-client/src/resources/blockPdfs.ts` + the existing `PdfPicker` which continues to work with the updated call signatures.

**Scope shipped:**
- API (Venue stack): 5 endpoints for upload-url / confirm / list / patch / delete.
- API (Venue stack): daily sweeper — soft-deleted rows purge R2 + DB after 7 days.
- DB: migration 168 adds `page_block_pdfs` (parallel shape to brief-18 `page_block_images`).
- R2: reuses the bucket + credentials the video pipeline (brief 73 §9) has been using for months.
- Prereq: brief 18 (block-images pipeline — this is the PDF twin), brief 116 (`bistroMenu` allowlist), brief 73 §9 (R2 presign pattern reference).

---

## 1. The endpoints — URL table

**Base:** `https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod` (the Venue API, not the CRM API).

**Auth:** owner / admin JWT on every route.

| Method | URL | Where `page_slug` + `block_id` go |
|---|---|---|
| POST | `/clubs/{cid}/block-pdfs/upload-url` | body |
| POST | `/clubs/{cid}/block-pdfs/confirm` | body |
| GET | `/clubs/{cid}/block-pdfs?page_slug=&block_id=` | query string |
| PATCH | `/clubs/{cid}/block-pdfs/{id}` | `{id}` in path (page/block implicit — the row remembers) |
| DELETE | `/clubs/{cid}/block-pdfs/{id}` | `{id}` in path |

OPTIONS on every route returns 204 with `Access-Control-Allow-Origin: *` — same CORS wiring as every other Venue endpoint.

---

## 2. The three-step upload dance

### 2.1 Mint presigned URL

```http
POST /clubs/{cid}/block-pdfs/upload-url
Authorization: Bearer <admin JWT>
Content-Type: application/json

{ "page_slug": "bistro", "block_id": "blk_mwtwykn02cppno" }
```

```jsonc
// 200
{
  "status": "success",
  "data": {
    "uploadUrl": "https://torny-videos-aus.r2.cloudflarestorage.com/block-pdfs/5/bistro/blk_mwtwykn02cppno/4c2…?x-amz-signature=…",
    "pdfKey":    "block-pdfs/5/bistro/blk_mwtwykn02cppno/4c2…"
  }
}
```

- `uploadUrl` expires in 30 minutes.
- `pdfKey` is the server-chosen R2 key — opaque to the FE, hand it back verbatim on confirm.
- Cap check (20/block) is enforced here too, so a block already at cap gets `400 too_many_pdfs` without wasting a presigned URL.

### 2.2 PUT the file directly to R2

```ts
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/pdf' }, // REQUIRED — R2 signed with it
  body: file,                                     // raw File, NOT FormData
})
```

Three gotchas worth calling out explicitly (and encoded as comments in the FE resource):

1. **`Content-Type: application/pdf` is mandatory.** R2 rejects the PUT with a signature mismatch otherwise. No `Authorization` header — the presigned URL carries the signature.
2. **Raw `File`, not `FormData`.** R2 presigned PUTs are single-object uploads. Multipart form bodies get stored as-is and then fail the headObject MIME check at confirm time.
3. **CORS on the R2 bucket is already configured** (the video pipeline has been using the same bucket since brief 73). If a live PUT hits a preflight failure from `*.r2.cloudflarestorage.com`, flag it and we'll check the bucket config.

### 2.3 Confirm

```http
POST /clubs/{cid}/block-pdfs/confirm
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "page_slug":         "bistro",
  "block_id":          "blk_mwtwykn02cppno",
  "pdf_key":           "block-pdfs/5/bistro/blk_mwtwykn02cppno/4c2…",
  "original_filename": "lunch-menu-nov-2026.pdf",
  "file_size_bytes":   328104,
  "title":             "Lunch menu"
}
```

Confirm does a server-side `headObject` against R2 — catches a mis-uploaded non-PDF AND a client that lies about `file_size_bytes` (e.g. a 50 MB upload with a body claim of 1 MB). The DB row only lands when the R2 object is a verified PDF under 10 MB.

```jsonc
// 200
{
  "status": "success",
  "data": {
    "id": 88,
    "pdf_key":           "block-pdfs/5/bistro/blk_mwtwykn02cppno/4c2…",
    "public_url":        "https://files.torny.pro/block-pdfs/5/bistro/blk_mwtwykn02cppno/4c2…",
    "original_filename": "lunch-menu-nov-2026.pdf",
    "file_size_bytes":   328104,
    "title":             "Lunch menu",
    "created_at":        "2026-11-25T02:12:33.000Z"
  }
}
```

Store `public_url` on the block's menu item (`bistroMenu.menus[i].pdfUrl`). The FE can also seed `fileSizeLabel` from `file_size_bytes` client-side (e.g. `"320 KB"`) — this is what the shipped `PdfPicker` does via its `update:fileSize` emit.

---

## 3. List / patch / delete

### 3.1 `GET /clubs/{cid}/block-pdfs?page_slug=&block_id=`

Owner/admin. Returns active (`deleted_at IS NULL`) rows for a block, newest first.

### 3.2 `PATCH /clubs/{cid}/block-pdfs/{id}` — title only

```jsonc
{ "title": "Lunch menu (updated)" }
// Or null to clear:
{ "title": null }
```

Returns the full refreshed row. `title` is the only editable field.

### 3.3 `DELETE /clubs/{cid}/block-pdfs/{id}` — soft-delete

Sets `deleted_at = NOW()`. Next-day sweeper at 03:30 UTC checks for rows past 7 days and purges both DB + R2.

Idempotent — DELETE on an already-deleted (or non-existent) id → `404 pdf_not_found`.

---

## 4. Error codes

Shape: `{ status: "error", code, message }`.

| HTTP | code | When |
|---|---|---|
| 400 | `bad_json` | Body isn't valid JSON, or required field missing. |
| 400 | `bad_page_slug` | `page_slug` missing / > 80 chars. |
| 400 | `invalid_block_id` | `block_id` missing / > 80 chars. |
| 400 | `pdf_filename_too_long` | `original_filename` missing / > 200 chars. |
| 400 | `pdf_title_too_long` | `title` > 120 chars. |
| 400 | `pdf_too_large` | File exceeds 10 MB (checked from body + from R2 `ContentLength`). |
| 400 | `pdf_mime_invalid` | R2 object's `Content-Type` isn't `application/pdf`. Server deletes the orphaned R2 object. |
| 400 | `pdf_not_found_in_r2` | Confirm fired against a `pdf_key` that doesn't exist (expired URL, aborted PUT, etc.). |
| 400 | `too_many_pdfs` | Block already has 20 active PDFs. Checked on both upload-url + confirm to catch races. |
| 401 | `unauthenticated` | Bearer missing / malformed. |
| 403 | role gate | Caller lacks CRM admin role on the club. |
| 404 | `page_not_found` | `page_slug` doesn't belong to the club. |
| 404 | `pdf_not_found` | PATCH/DELETE on unknown or already-soft-deleted id. |
| 405 | `method_not_allowed` | Should never fire. |

---

## 5. FE wiring (as shipped)

`packages/api-client/src/resources/blockPdfs.ts` rewritten against the flat Venue URLs:

- `requestUploadUrl(clubId, pageSlug, blockId)` — POST body carries slugs.
- `confirmUpload(clubId, { page_slug, block_id, pdf_key, original_filename, file_size_bytes, title? })` — flat body.
- `list(clubId, pageSlug, blockId)` — query string.
- `patch(clubId, pdfId, title)` — id-only path.
- `remove(clubId, pdfId)` — id-only path.
- `upload(clubId, pageSlug, blockId, file, opts)` — end-to-end convenience.

`apps/crm/src/components/PdfPicker.vue` kept its props shape (`pageSlug` + `blockId` + `pdfId`) so the inspector didn't need to change — just the inner `remove()` calls dropped their now-redundant slug args.

`BistroMenuItem.pdfId` on the block layout remains, so Replace / Remove can target the right DB row without server-side block-id lookup.

---

## 6. Non-goals (as shipped)

- **Server-side PDF introspection** (page count / sanitising / preview thumbnail). The FE still asks for `pageCountLabel` as admin text. File size is in the confirm response.
- **Format conversion** (.docx → PDF). Scope creep.
- **Version history**. Replace just soft-deletes the prior row.
- **Hotlink prevention**. Admins want other sites to link directly to menus.
- **Allow-listing by MIME at the presigned PUT level.** R2 signs with the requested `Content-Type`; the FE sends `application/pdf`. Anything else is caught by the headObject check at confirm.

---

## 7. Related briefs

- Brief 18 — block images (the PDF twin).
- Brief 73 §9 — the R2 presign pattern this handler inherits.
- Brief 116 — `bistroMenu` allowlist (prereq).
- Briefs 110 / 113 / 114 / 115 — recent CRM-stack-cap moves to Venue stack.
