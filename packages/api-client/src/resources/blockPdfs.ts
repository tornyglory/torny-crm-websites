// Block-scoped PDF uploads — brief 118 shipped 2026-11-25 (commit a289fea).
//
// URL shape deviates from the original brief: the server flattened the
// nested /clubs/:cid/pages/:slug/blocks/:bid/pdfs/* path to a flat
// /clubs/:cid/block-pdfs/* one hosted on VENUE_BASE. Same reason as
// /ai-generate, /block-images-copy, /footer-config — the CRM stack is
// at CloudFormation's 500-resource cap. Nested paths blow the budget;
// new endpoints flatten and migrate to the Venue stack.
//
// Practical consequences for callers:
//   - `page_slug` + `block_id` live on the request body (POST) or query
//     string (GET), not in the URL.
//   - PATCH + DELETE key only on the row id — the row remembers its
//     page/block ownership.
//   - R2 presigned PUTs are single-object (raw File, not FormData) and
//     REQUIRE `Content-Type: application/pdf` because that's what the
//     signature was minted against.

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'

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
  page_slug: string
  block_id: string
  pdf_key: string
  original_filename: string
  file_size_bytes: number
  title?: string | null
}

export interface PatchParams {
  title: string | null
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET /clubs/:cid/block-pdfs?page_slug=&block_id= — active PDFs for a block. */
export async function list(
  clubId: number,
  pageSlug: string,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf[]> {
  const qs = new URLSearchParams({ page_slug: pageSlug, block_id: blockId })
  const res = await authedFetch<Envelope<{ pdfs: BlockPdf[] }>>(
    `${VENUE_BASE}/clubs/${clubId}/block-pdfs?${qs.toString()}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data.pdfs
}

/** POST /clubs/:cid/block-pdfs/upload-url — mint R2 presigned PUT URL.
 *  Server rejects here with `too_many_pdfs` if the block is at cap, so
 *  we don't waste a presigned URL in the common over-20 case. */
export async function requestUploadUrl(
  clubId: number,
  pageSlug: string,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<UploadUrlResponse> {
  const res = await authedFetch<Envelope<UploadUrlResponse>>(
    `${VENUE_BASE}/clubs/${clubId}/block-pdfs/upload-url`,
    {
      method: 'POST',
      body: JSON.stringify({ page_slug: pageSlug, block_id: blockId }),
      signal: opts.signal,
    },
  )
  return res.data
}

/** POST /clubs/:cid/block-pdfs/confirm — persist the row after R2 PUT.
 *  Server does a headObject against R2 to catch MIME lies + size lies
 *  before writing the DB row. Returns the public URL the FE should
 *  store on the block's menu item. */
export async function confirmUpload(
  clubId: number,
  params: ConfirmParams,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf> {
  const res = await authedFetch<Envelope<BlockPdf>>(
    `${VENUE_BASE}/clubs/${clubId}/block-pdfs/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({
        page_slug: params.page_slug,
        block_id: params.block_id,
        pdf_key: params.pdf_key,
        original_filename: params.original_filename,
        file_size_bytes: params.file_size_bytes,
        title: params.title ?? null,
      }),
      signal: opts.signal,
    },
  )
  return res.data
}

/** PATCH /clubs/:cid/block-pdfs/:id — title only. Pass `null` to clear. */
export async function patch(
  clubId: number,
  pdfId: number,
  title: string | null,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockPdf> {
  const res = await authedFetch<Envelope<BlockPdf>>(
    `${VENUE_BASE}/clubs/${clubId}/block-pdfs/${pdfId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title } satisfies PatchParams),
      signal: opts.signal,
    },
  )
  return res.data
}

/** DELETE /clubs/:cid/block-pdfs/:id — soft-delete. Sweeper purges DB +
 *  R2 after 7 days. Idempotent on the server, but we do a best-effort
 *  catch at callsites so a stale id doesn't break Replace flows. */
export async function remove(
  clubId: number,
  pdfId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<null>(
    `${VENUE_BASE}/clubs/${clubId}/block-pdfs/${pdfId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

// ── Convenience: three-step upload dance ──────────────────────────

/**
 * End-to-end block PDF upload:
 *   request upload URL → PUT file to R2 → confirm.
 *
 * R2 signed the URL against `Content-Type: application/pdf` — sending
 * anything else kills the PUT with a signature mismatch. The body MUST
 * be the raw File, not FormData — R2 presigned PUTs are single-object
 * uploads and a multipart body gets stored as-is, then fails the
 * server-side headObject check at confirm time.
 *
 * Throws on any step failure. Callers should catch ApiError and surface
 * a message; a failed R2 PUT bubbles up as a plain Error.
 */
export async function upload(
  clubId: number,
  pageSlug: string,
  blockId: string,
  file: File,
  opts: {
    title?: string | null
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
    {
      page_slug: pageSlug,
      block_id: blockId,
      pdf_key: pdfKey,
      original_filename: file.name,
      file_size_bytes: file.size,
      title: opts.title ?? null,
    },
    { signal: opts.signal },
  )
}
