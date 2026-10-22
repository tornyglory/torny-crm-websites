// Block-scoped video uploads for the CRM page builder — brief 58.
// Mirrors blockImages (brief 18) one-for-one, minus gallery concepts
// (singular `video`, not plural `images`, no position/reorder).
//
// Endpoints:
//   POST   /clubs/{cid}/pages/{slug}/blocks/{bid}/video/upload-url
//   POST   /clubs/{cid}/pages/{slug}/blocks/{bid}/video/confirm
//   GET    /clubs/{cid}/pages/{slug}/blocks/{bid}/video
//   DELETE /clubs/{cid}/pages/{slug}/blocks/{bid}/video
//
// The middle step — POSTing the file to Cloudflare Stream — is a
// cross-origin direct upload. API Gateway isn't in the data path so the
// 10 MB request cap doesn't apply (Stream accepts up to 50 MiB).

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'
import type { PageSlug } from './pages'

// ── Types ─────────────────────────────────────────────────────────

export interface BlockVideoUploadUrl {
  /** Cloudflare Stream direct-upload URL — single-use. */
  uploadUrl: string
  /** Cloudflare Stream video id. Feed into `confirmUpload`. */
  streamVideoId: string
  /** Max accepted at Stream — mirrors the server limit so the browser can
   *  refuse too-large files before starting the upload. */
  maxBytes: number
  maxDurationSeconds: number
}

export type BlockVideoState = 'processing' | 'ready' | 'error'

export interface BlockVideo {
  /** page_block_videos row id. */
  id: number
  /** Underlying videos.id (shared with the Moments pipeline). */
  videoId: number
  cloudflareVideoId: string
  state: BlockVideoState
  /** HLS manifest. Available immediately once `state === 'ready'`.
   *  Needs hls.js for cross-browser playback (native in Safari). */
  hlsUrl: string
  /** Plain MP4. Null while Stream is still rendering the download track;
   *  prefer this for the <video> tag once available. */
  mp4Url: string | null
  /** Auto-generated poster frame. */
  thumbnailUrl: string | null
  durationSeconds: number | null
  widthPx: number | null
  heightPx: number | null
  bytes: number | null
}

export type BlockVideoErrorCode =
  | 'bad_json'
  | 'stream_not_found'
  | 'file_too_large'
  | 'duration_too_long'
  | 'unknown_page_slug'
  | 'not_found'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Path helper ───────────────────────────────────────────────────

function base(clubId: number, pageSlug: PageSlug, blockId: string): string {
  return `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}/blocks/${encodeURIComponent(blockId)}/video`
}

// ── Endpoints ─────────────────────────────────────────────────────

/** POST /upload-url — mint a Cloudflare Stream direct-upload URL. */
export async function requestUploadUrl(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockVideoUploadUrl> {
  const res = await authedFetch<Envelope<BlockVideoUploadUrl>>(
    `${base(clubId, pageSlug, blockId)}/upload-url`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

/** POST /confirm — record a completed Cloudflare upload. Returns
 *  immediately — if Stream is still transcoding the response carries
 *  `state === 'processing'` and the caller should poll `get()` until the
 *  state flips. */
export async function confirmUpload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  input: { streamVideoId: string },
  opts: { signal?: AbortSignal } = {},
): Promise<BlockVideo> {
  const res = await authedFetch<Envelope<BlockVideo>>(
    `${base(clubId, pageSlug, blockId)}/confirm`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

/** GET /video — read the current video for a block. Side-effect: when
 *  `state !== 'ready'`, this call also progresses Stream's state machine
 *  (first call that observes ready kicks off the MP4 download rendition). */
export async function get(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockVideo> {
  const res = await authedFetch<Envelope<BlockVideo>>(
    base(clubId, pageSlug, blockId),
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** DELETE /video — soft-delete. The daily sweeper purges Stream + the
 *  row 7 days later; within the week re-upload is instant. */
export async function remove(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<void>(
    base(clubId, pageSlug, blockId),
    { method: 'DELETE', signal: opts.signal },
  )
}

// ── Convenience: three-step upload dance ──────────────────────────

/**
 * End-to-end block video upload:
 *   request upload URL → POST file to Cloudflare Stream → confirm.
 *
 * Returns the row with `state === 'processing'` or `'ready'` depending on
 * Stream's transcode speed. Caller should check `state` and poll `get()`
 * if still processing.
 *
 * Throws:
 *  - ApiError on upload-url / confirm failures (incl. file_too_large,
 *    duration_too_long after Stream inspects the file).
 *  - plain Error on the Cloudflare POST step (network / CF outage).
 */
export async function upload(
  clubId: number,
  pageSlug: PageSlug,
  blockId: string,
  file: File,
  opts: { signal?: AbortSignal } = {},
): Promise<BlockVideo> {
  const { uploadUrl, streamVideoId } = await requestUploadUrl(
    clubId,
    pageSlug,
    blockId,
    { signal: opts.signal },
  )

  const form = new FormData()
  form.append('file', file)
  const cf = await fetch(uploadUrl, { method: 'POST', body: form, signal: opts.signal })
  if (!cf.ok) {
    // Stream enforces duration + decodability at upload time; forward its
    // message so the UI can show "video too long" vs "unsupported format".
    const text = await cf.text().catch(() => '')
    throw new Error(
      `Cloudflare Stream rejected the upload (${cf.status} ${cf.statusText})${text ? `: ${text.slice(0, 200)}` : ''}`,
    )
  }

  return confirmUpload(
    clubId,
    pageSlug,
    blockId,
    { streamVideoId },
    { signal: opts.signal },
  )
}
