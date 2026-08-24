// Website page builder — GET / PATCH / POST publish under /clubs/:clubId/pages/:pageSlug.
// See docs/backend-briefs/17-website-page-builder-live.md.
//
// Backend treats `props` as opaque JSON; TypeScript on this side is the
// source of truth. Block shapes live in `@torny/content-blocks`.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Types ─────────────────────────────────────────────────

/**
 * `PageSlug` is now any kebab-case slug the club has minted — we keep the
 * old seed union around as a hint of what to expect, but the type widens
 * to `string` because clubs can create arbitrary custom pages.
 */
export type SystemPageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
export type PageSlug = SystemPageSlug | (string & { readonly brand?: 'PageSlug' })

/**
 * Sidebar row shape returned by `GET /clubs/:clubId/pages`. Layout data
 * lives on the single-page `PageState` (fetched only when you open one).
 */
export interface Page {
  id: number
  slug: string
  title: string
  is_system: boolean
  is_published: boolean
  position: number
  draft_updated_at: string | null
  published_at: string | null
  has_unpublished_changes: boolean
}

/** Create-page + rename-page validation error codes surfaced by the API. */
export type PageErrorCode =
  | 'bad_slug'
  | 'bad_title'
  | 'reserved_slug'
  | 'slug_conflict'
  | 'system_slug_locked'
  | 'too_many_pages'
  | 'not_found'

/** Server-hosted list of reserved slugs — mirrored here so we can catch
 *  the obvious ones before firing the POST. */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  'api', 'admin', 'auth', 'assets', '_nuxt', '_ipx',
  'sitemap.xml', 'robots.txt', 'favicon.ico',
  'sign-in', 'signin', 'sign-out', 'signout',
]

/** True if the value looks like a valid custom-page slug (kebab-case, 1..48). */
export function isValidPageSlug(v: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length >= 1 && v.length <= 48
}

/** Lowercase + hyphenate a free-form title into a kebab slug. Server
 *  rejects anything not already kebab-case, so run this before POST. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

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

/** Per-page SEO metadata. See brief 26. */
export interface PageMeta {
  title?: string
  description?: string
}

export interface PageLayout {
  blocks: Block[]
  /** Optional SEO overrides for this page. See brief 26. */
  meta?: PageMeta | null
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

/** Rename / reslug / reorder — the PATCH endpoint is now overloaded. */
export interface UpdatePageInput {
  title?: string
  slug?: string
  position?: number
}

export interface UpdatePageResponse {
  clubId: number
  pageId: number
  pageSlug: string
  title: string
  is_system: boolean
  is_published: boolean
  position: number
  draft_updated_at: string | null
  published_at: string | null
  /** Only present on slug renames — e.g. `["old_slug_broken"]`. */
  warnings?: string[]
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
 * GET /clubs/:clubId/pages — sidebar list of every active page.
 *
 * Layouts are excluded to keep the payload small; fetch a specific page
 * with `get(clubId, slug)` when you open one in the editor.
 */
export async function list(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Page[]> {
  const res = await authedFetch<Envelope<{ pages: Page[] }>>(
    `${CRM_BASE}/clubs/${clubId}/pages`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data.pages
}

/**
 * POST /clubs/:clubId/pages — mint a new custom page.
 *
 * Backend appends at `MAX(position) + 1`. Slug must be kebab-case and
 * not in the reserved list — validate on the client with `isValidPageSlug`
 * before firing so common typos don't need a round-trip.
 */
export async function create(
  clubId: number,
  input: { slug: string; title: string },
  opts: { signal?: AbortSignal } = {},
): Promise<Page> {
  const res = await authedFetch<Envelope<Page>>(
    `${CRM_BASE}/clubs/${clubId}/pages`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/**
 * PATCH /clubs/:clubId/pages/:pageSlug — rename / reslug / reorder.
 *
 * The same endpoint takes layout autosaves via `patch()`; this variant
 * is for the sidebar mutations. Slug renames on system pages return
 * `400 system_slug_locked`. Successful slug renames come back with
 * `warnings: ["old_slug_broken"]` so callers can flag inbound-link risk.
 */
export async function updatePage(
  clubId: number,
  pageSlug: string,
  patchInput: UpdatePageInput,
  opts: { signal?: AbortSignal } = {},
): Promise<UpdatePageResponse> {
  const res = await authedFetch<Envelope<UpdatePageResponse>>(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patchInput),
      signal: opts.signal,
    },
  )
  return res.data
}

/**
 * DELETE /clubs/:clubId/pages/:pageSlug — soft-delete.
 *
 * Backend mangles the slug (`__deleted_{id}__{slug}`) so the original
 * is immediately available for a new page. Confirmation guardrails live
 * on the client — the API just does what it's asked.
 */
export async function remove(
  clubId: number,
  pageSlug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/**
 * POST /clubs/:clubId/pages/:pageSlug/restore — undelete inside the
 * 30-day window. Pass the *original* slug (not the mangled one).
 * Not exposed on the sidebar in the first release — flag when you want
 * a "recently deleted" UI.
 */
export async function restore(
  clubId: number,
  pageSlug: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Page> {
  const res = await authedFetch<Envelope<Page>>(
    `${CRM_BASE}/clubs/${clubId}/pages/${pageSlug}/restore`,
    { method: 'POST', body: '{}', signal: opts.signal },
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
