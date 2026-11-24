// Block-scoped PDF uploads. See brief 118 — parallel to brief 18's
// block-images pipeline, but stores to R2 instead of Cloudflare Images
// because CF Images rejects any non-image MIME.
//
// Endpoints live on the CRM base under
//   /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/pdfs/…
//
// If the backend ends up hosting these on VENUE_BASE (CFN 500-resource
// cap on the CRM stack), swap `CRM_BASE` → `VENUE_BASE` in `base()`
// below. FE is indifferent — callers just use `upload()` / `remove()`.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { PageSlug } from './pages'

// ── Types ─────────────────────────────────────────────────────────

export interface BlockPdf {
  id: number
  pdf_key: string
  public_url: string
  original_filename: string
  file_size_bytes: number
  title: string | null
  created_at: string
}

export interface UploadUrlResponse {
  /** R2 presigned PUT URL — single-use, expires in 30 min. */
  uploadUrl: string
  /** Server-chosen R2 object key. Feed back into `confirm` to persist the row. */
  pdfKey: string
}

export interface ConfirmParams {
  pdf_key: string
  original_filename: string
  file_size_bytes: number
  title?: string
}

export interface PatchParams {
  title?: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Path helper ───────────────────────────────────────────────────

function base(clubId: number, pageSlug: PageSlug, blockId: string): string {
  return `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}/blocks/${encodeURIComponent(blockId)}/pdfs`
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET — list active PDFs for a block. */
export async function list(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf[]> {
  const res = await authedFetch<Envelope<{ pdfs: BlockPdf[] }>>(
    base(clubId, pageSlug, blockId),
    { method: 'GET', signal: opts.signal },
  )
  return res.data.pdfs
}

/** POST /upload-url — mint an R2 presigned PUT URL. */
export async function requestUploadUrl(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<UploadUrlResponse> {
  const res = await authedFetch<Envelope<UploadUrlResponse>>(
    `${base(clubId, pageSlug, blockId)}/upload-url`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** POST /confirm — record a completed R2 upload against the block. */
export async function confirmUpload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  params: ConfirmParams,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf> {
  const res = await authedFetch<Envelope<BlockPdf>>(
    `${base(clubId, pageSlug, blockId)}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(params),
      signal: opts.signal,
    },
  )
  return res.data
}

/** PATCH — update metadata (currently just title). */
export async function patch(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  pdfId: number,
  params: PatchParams,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf> {
  const res = await authedFetch<Envelope<BlockPdf>>(
    `${base(clubId, pageSlug, blockId)}/${pdfId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
      signal: opts.signal,
    },
  )
  return res.data
}

/** DELETE — soft-delete. Sweeper hard-deletes + purges R2 after 7 days. */
export async function remove(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  pdfId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<null>(
    `${base(clubId, pageSlug, blockId)}/${pdfId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

// ── Convenience: three-step upload dance ──────────────────────────

/**
 * End-to-end block PDF upload:
 *   request upload URL → PUT file to R2 → confirm.
 *
 * R2 presigned PUTs expect the raw file bytes with the matching
 * `Content-Type` header — NOT multipart/form-data (which is what the
 * block-images Cloudflare flow uses). Don't be tempted to copy the
 * `FormData` dance from `blockImages.upload` here.
 *
 * Throws on any step failure. Callers should catch ApiError and surface
 * a message; a failed R2 PUT bubbles up as a plain Error.
 */
export async function upload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  file: File,
  opts: {
    title?: string
    signal?: AbortSignal
  } = {},
): Promise<BlockPdf> {
  const { uploadUrl, pdfKey } = await requestUploadUrl(
    clubId,
    pageSlug,
    blockId,
    { signal: opts.signal },
  )

  const r2 = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'application/pdf' },
    signal: opts.signal,
  })
  if (!r2.ok) {
    throw new Error(`R2 upload failed (${r2.status} ${r2.statusText})`)
  }

  return confirmUpload(
    clubId,
    pageSlug,
    blockId,
    {
      pdf_key: pdfKey,
      original_filename: file.name,
      file_size_bytes: file.size,
      ...(opts.title !== undefined ? { title: opts.title } : {}),
    },
    { signal: opts.signal },
  )
}
