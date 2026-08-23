// Block-scoped image uploads for the CRM page builder. See brief 18 —
// backend `page_block_images` table indexes each row by
// (club_id, page_slug, block_id, position).
//
// Endpoints live on the CRM base under
//   /clubs/{club_id}/pages/{page_slug}/blocks/{block_id}/images/…
//
// The direct upload to Cloudflare is unauthenticated multipart form POST
// — everything else is bearer-authed via authedFetch.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { PageSlug } from './pages'

// ── Types ─────────────────────────────────────────────────────────

export interface BlockImage {
  id: number
  cloudflare_image_id: string
  public_url: string
  thumbnail_url: string
  avatar_url: string
  position: number
  alt: string
  caption: string
}

export interface UploadUrlResponse {
  /** Cloudflare direct-upload URL — single-use, expires in 30 min. */
  uploadUrl: string
  /** Cloudflare image id. Feed back into `confirm` to persist the row. */
  imageId: string
}

export interface ConfirmParams {
  cloudflare_image_id: string
  /** Omit to append at max(position)+1. */
  position?: number
  alt?: string
  caption?: string
}

export interface PatchParams {
  position?: number
  alt?: string
  caption?: string
}

export interface ReorderResponse {
  reordered: number
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Path helper ───────────────────────────────────────────────────

function base(clubId: number, pageSlug: PageSlug, blockId: string): string {
  return `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}/blocks/${encodeURIComponent(blockId)}/images`
}

// ── Endpoints ─────────────────────────────────────────────────────

/** GET — list active images for a block, ordered by position. */
export async function list(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockImage[]> {
  const res = await authedFetch<Envelope<{ images: BlockImage[] }>>(
    base(clubId, pageSlug, blockId),
    { method: 'GET', signal: opts.signal },
  )
  return res.data.images
}

/** POST /upload-url — mint a Cloudflare direct-upload URL. */
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

/** POST /confirm — record a completed Cloudflare upload against the block. */
export async function confirmUpload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  params: ConfirmParams,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockImage> {
  const res = await authedFetch<Envelope<BlockImage>>(
    `${base(clubId, pageSlug, blockId)}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(params),
      signal: opts.signal,
    },
  )
  return res.data
}

/** PATCH — update metadata or position. Server renumbers siblings dense. */
export async function patch(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  imageId: number,
  params: PatchParams,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockImage> {
  const res = await authedFetch<Envelope<BlockImage>>(
    `${base(clubId, pageSlug, blockId)}/${imageId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
      signal: opts.signal,
    },
  )
  return res.data
}

/** DELETE — soft-delete. Sweeper hard-deletes + purges CF after 7 days. */
export async function remove(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  imageId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<null>(
    `${base(clubId, pageSlug, blockId)}/${imageId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** PUT /order — bulk reorder. Pass the full desired final order of ids. */
export async function reorder(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  order: number[],
  opts: { signal?: AbortSignal } = {},
): Promise<ReorderResponse> {
  const res = await authedFetch<Envelope<ReorderResponse>>(
    `${base(clubId, pageSlug, blockId)}/order`,
    {
      method: 'PUT',
      body: JSON.stringify({ order }),
      signal: opts.signal,
    },
  )
  return res.data
}

// ── Convenience: three-step upload dance ──────────────────────────

/**
 * End-to-end block image upload:
 *   request upload URL → POST file to Cloudflare → confirm.
 * Throws on any step failure. Callers should catch ApiError and surface
 * a message; a failed Cloudflare POST bubbles up as a plain Error.
 */
export async function upload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  file: File,
  opts: {
    position?: number
    alt?: string
    caption?: string
    signal?: AbortSignal
  } = {},
): Promise<BlockImage> {
  const { uploadUrl, imageId } = await requestUploadUrl(
    clubId,
    pageSlug,
    blockId,
    { signal: opts.signal },
  )

  const form = new FormData()
  form.append('file', file)
  const cf = await fetch(uploadUrl, { method: 'POST', body: form, signal: opts.signal })
  if (!cf.ok) {
    throw new Error(`Cloudflare upload failed (${cf.status} ${cf.statusText})`)
  }

  return confirmUpload(
    clubId,
    pageSlug,
    blockId,
    {
      cloudflare_image_id: imageId,
      ...(opts.position !== undefined ? { position: opts.position } : {}),
      ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
      ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
    },
    { signal: opts.signal },
  )
}
