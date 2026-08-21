// Website page builder — GET / PATCH / POST publish under /clubs/:clubId/pages/:pageSlug.
// See docs/backend-briefs/17-website-page-builder-live.md.
//
// Backend treats `props` as opaque JSON; TypeScript on this side is the
// source of truth. Block shapes live in `@torny/content-blocks`.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types ─────────────────────────────────────────────────

export type PageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'

/**
 * Minimal block shape — the CRM editor + Nuxt renderer both cast this
 * back to the discriminated union in `@torny/content-blocks`. We keep it
 * loose here so the api-client doesn't depend on the block schema.
 */
export interface Block {
  id: string
  type: string
  props: Record<string, unknown>
}

export interface PageLayout {
  blocks: Block[]
}

export interface PageState {
  clubId: number
  pageSlug: PageSlug
  is_published: boolean
  layout_draft: PageLayout | null
  layout_published: PageLayout | null
  draft_updated_at: string | null
  published_at: string | null
  has_unpublished_changes: boolean
}

export interface PatchResponse {
  clubId: number
  pageSlug: PageSlug
  draft_updated_at: string
}

export interface PublishResponse {
  clubId: number
  pageSlug: PageSlug
  published_at: string
  public_url: string
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ─────────────────────────────────────────────

/**
 * GET /clubs/:clubId/pages/:pageSlug — read editor state.
 *
 * Returns a seeded default layout when no row exists yet, so the owner
 * never sees a blank canvas. `has_unpublished_changes` is the source of
 * truth for the "Publish" vs "Publish changes" button state.
 */
export async function get(
  clubId: number,
  pageSlug: PageSlug,
  opts: { signal?: AbortSignal } = {},
): Promise<PageState> {
  const res = await authedFetch<Envelope<PageState>>(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/**
 * PATCH /clubs/:clubId/pages/:pageSlug — autosave the draft.
 *
 * Full replacement of `blocks[]` — server doesn't diff. Debounce ~500ms
 * on the caller side. Backend validates:
 * - `blocks.length ≤ 50` → 400 `too_many_blocks`
 * - request body ≤ 200KB → 400 `payload_too_large`
 * - every block has `{ id, type, props }` → 400 `invalid_block_shape`
 * - `type` is one of the 8 known → 400 `unknown_block_type` (with `type` echoed)
 */
export async function patch(
  clubId: number,
  pageSlug: PageSlug,
  layout: PageLayout,
  opts: { signal?: AbortSignal } = {},
): Promise<PatchResponse> {
  const res = await authedFetch<Envelope<PatchResponse>>(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ layout_draft: layout }),
      signal: opts.signal,
    },
  )
  return res.data
}

/**
 * POST /clubs/:clubId/pages/:pageSlug/publish — atomic draft → published.
 *
 * Fires the Nuxt revalidate webhook fire-and-forget; returns 200 whether
 * or not the webhook lands. `public_url` maps `home` → `/`, everything
 * else → `/{pageSlug}` — use it directly for the "View live site" button.
 */
export async function publish(
  clubId: number,
  pageSlug: PageSlug,
  opts: { signal?: AbortSignal } = {},
): Promise<PublishResponse> {
  const res = await authedFetch<Envelope<PublishResponse>>(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}/publish`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}
