// Cloudflare-backed image uploader. Three endpoints on the primary CDK
// stack (MEDIA_BASE, not CRM_BASE):
//
//   GET  /media/images/upload-url  → one-time direct-upload URL + imageId
//   POST /media/images/confirm     → record the confirmed upload in `images`
//
// The middle step — POST'ing the file to Cloudflare's upload URL — is
// pure fetch, no bearer token. Any authed caller can request an
// upload-url; the PATCH that actually attaches the returned URL to the
// club record enforces owner-only.

import { MEDIA_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

export type MediaEntityType = 'club' | 'user' | 'moment' | 'event'
/**
 * Backend-accepted `content_type` slugs for the `/media/images/*` endpoints.
 * Matches the server-side whitelist — passing anything else returns a 400.
 */
export type MediaContentType =
  | 'avatar'
  | 'banner'
  | 'gallery'
  | 'profile'
  | 'cover'
  | 'hero'
  | 'page'
  | 'event'
  | 'moment'
  | 'story'
  | 'post'
  | 'rink_profile'

export interface UploadUrlResponse {
  /** Cloudflare direct-upload URL — single-use, cross-origin POST. */
  uploadUrl: string
  /** Cloudflare image id; feed back into `confirm` to bind it to a DB row. */
  imageId: string
}

export interface ConfirmedImage {
  image_id: number
  cloudflare_image_id: string
  entity_id: number
  entity_type: MediaEntityType
  content_id: number
  content_type: MediaContentType
  public_url: string
  thumbnail_url: string
  avatar_url: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────────────

export interface RequestUploadParams {
  entity_type: MediaEntityType
  entity_id: number
  content_type: MediaContentType
  content_id: number
}

/** GET /media/images/upload-url — mint a Cloudflare direct-upload URL. */
export async function requestUploadUrl(
  params: RequestUploadParams,
  opts: { signal?: AbortSignal } = {},
): Promise<UploadUrlResponse> {
  const qs = new URLSearchParams({
    entity_type: params.entity_type,
    entity_id: String(params.entity_id),
    content_type: params.content_type,
    content_id: String(params.content_id),
  })
  const res = await authedFetch<Envelope<UploadUrlResponse>>(
    `${MEDIA_BASE}/media/images/upload-url?${qs.toString()}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export interface ConfirmParams {
  imageId: string
  entity_type: MediaEntityType
  entity_id: number
  content_type: MediaContentType
  content_id: number
}

/** POST /media/images/confirm — record the upload, get delivery URLs back. */
export async function confirmUpload(
  params: ConfirmParams,
  opts: { signal?: AbortSignal } = {},
): Promise<ConfirmedImage> {
  const res = await authedFetch<Envelope<ConfirmedImage>>(
    `${MEDIA_BASE}/media/images/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(params),
      signal: opts.signal,
    },
  )
  return res.data
}

// ── Convenience: full club-logo upload dance ──────────────────────

/**
 * End-to-end: request upload URL → POST file to Cloudflare → confirm.
 * Throws on any step failure. Callers should catch and surface a
 * user-facing message; a failed Cloudflare POST bubbles up as a plain
 * Error with the response status text.
 */
export async function uploadClubLogo(
  clubId: number,
  file: File,
): Promise<ConfirmedImage> {
  const { uploadUrl, imageId } = await requestUploadUrl({
    entity_type: 'club',
    entity_id: clubId,
    content_type: 'avatar',
    content_id: clubId,
  })

  const form = new FormData()
  form.append('file', file)
  const cf = await fetch(uploadUrl, { method: 'POST', body: form })
  if (!cf.ok) {
    // Cloudflare returns 4xx for oversize / wrong-mime uploads.
    throw new Error(`Cloudflare upload failed (${cf.status} ${cf.statusText})`)
  }

  return confirmUpload({
    imageId,
    entity_type: 'club',
    entity_id: clubId,
    content_type: 'avatar',
    content_id: clubId,
  })
}

/**
 * Generic club image upload — request URL, PUT to Cloudflare, confirm.
 * `contentType` picks which slot on the club record the image lives in.
 * Common choices for club-level assets:
 *   - 'avatar'  → club logo / favicon
 *   - 'banner'  → hero / cover image
 *   - 'gallery' → gallery photo (multiple allowed per club)
 *
 * `contentId` defaults to `clubId` for club-level images. For block-level
 * images that need a per-block identifier, pass a numeric id (e.g. a
 * hashed block id) — backend treats it as opaque.
 */
export async function uploadClubImage(
  clubId: number,
  file: File,
  opts: { contentType?: MediaContentType; contentId?: number; signal?: AbortSignal } = {},
): Promise<ConfirmedImage> {
  const contentType = opts.contentType ?? 'gallery'
  const contentId = opts.contentId ?? clubId

  const { uploadUrl, imageId } = await requestUploadUrl(
    { entity_type: 'club', entity_id: clubId, content_type: contentType, content_id: contentId },
    { signal: opts.signal },
  )

  const form = new FormData()
  form.append('file', file)
  const cf = await fetch(uploadUrl, { method: 'POST', body: form, signal: opts.signal })
  if (!cf.ok) {
    throw new Error(`Cloudflare upload failed (${cf.status} ${cf.statusText})`)
  }

  return confirmUpload(
    { imageId, entity_type: 'club', entity_id: clubId, content_type: contentType, content_id: contentId },
    { signal: opts.signal },
  )
}
