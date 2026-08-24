// Honour board — categories + multi-player entries.
// See docs/backend-briefs/28-honour-board-crud.md (shipped 2026-08-24).
//
// Two base URLs are in play:
//   MEDIA_BASE — primary CDK stack, hosts the CRUD endpoints (categories,
//                entries, formats). Reused here rather than adding a fourth
//                constant; the "media" name is legacy — see config.ts.
//   CRM_BASE   — reverse index at `/players/:userId/honour-board` and the
//                club `/site` payload live here.
//
// Backend returns envelopes as `{ status: 'success', data: T }`.

import { CRM_BASE, MEDIA_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Types ─────────────────────────────────────────────────────────

export interface HonourCategory {
  category_id: number
  name: string
  format_id: number | null
  /** 'mens' | 'womens' | 'mixed' | 'open' | 'na' | custom string */
  gender: string | null
  description: string | null
  sort_order: number
  /** Backend returns 0/1 — coerce on the caller side if you need a real bool. */
  is_visible: number | boolean
}

export interface HonourCategoryCreateInput {
  name: string
  format_id?: number | null
  gender?: string | null
  description?: string | null
  sort_order?: number
  is_visible?: boolean | number
}

export type HonourCategoryUpdateInput = Partial<HonourCategoryCreateInput>

export interface EntryPlayer {
  entry_player_id: number
  entry_id: number
  /** null for guests / historic wins */
  user_id: number | null
  /** Canonical when `user_id` is null; otherwise a display override. */
  display_name: string
  /** 'Skip' | 'Third' | 'Second' | 'Lead' | custom */
  position: string | null
  sort_order: number
}

export interface HonourEntry {
  entry_id: number
  category_id: number
  /** null for undated entries (e.g. Life Members). */
  year: number | null
  note: string | null
  sort_order: number
  players: EntryPlayer[]
  created_at?: string
  updated_at?: string | null
}

/** Player row shape accepted by POST/PUT — omit `user_id` for a guest. */
export interface EntryPlayerInput {
  user_id?: number | null
  display_name: string
  position?: string | null
  sort_order?: number
}

export interface HonourEntryCreateInput {
  category_id: number
  year?: number | null
  note?: string | null
  sort_order?: number
  players: EntryPlayerInput[]
}

export type HonourEntryUpdateInput = Partial<Omit<HonourEntryCreateInput, 'category_id'>> & {
  category_id?: number
}

export interface HonourFormat {
  format_id: number
  sport_id: number | null
  code: string
  label: string
  player_count: number | null
  sort_order: number
  is_active: boolean | number
}

/** Shape of the /players/:userId/honour-board reverse index. */
export interface PlayerHonourEntry {
  entry_id: number
  year: number | null
  category_slug: string
  category_name: string
  note: string | null
  players: Array<{
    user_id: number | null
    display_name: string
    position: string | null
  }>
}

export interface PlayerHonourClub {
  id: number
  slug: string
  name: string
  logo_url: string | null
  entries: PlayerHonourEntry[]
}

export interface PlayerHonourResponse {
  user_id: number
  clubs: PlayerHonourClub[]
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Categories ────────────────────────────────────────────────────

export async function listCategories(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourCategory[]> {
  const res = await authedFetch<Envelope<HonourCategory[]>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function getCategory(
  clubId: number,
  categoryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourCategory> {
  const res = await authedFetch<Envelope<HonourCategory>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories/${categoryId}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function createCategory(
  clubId: number,
  input: HonourCategoryCreateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourCategory> {
  const res = await authedFetch<Envelope<HonourCategory>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

export async function updateCategory(
  clubId: number,
  categoryId: number,
  patch: HonourCategoryUpdateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourCategory> {
  const res = await authedFetch<Envelope<HonourCategory>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories/${categoryId}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}

export async function deleteCategory(
  clubId: number,
  categoryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories/${categoryId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

/** Seeds the standard bowls categories. Safe to re-run (skips duplicates). */
export async function seedDefaults(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourCategory[]> {
  const res = await authedFetch<Envelope<HonourCategory[]>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-categories/seed-defaults`,
    { method: 'POST', body: '{}', signal: opts.signal },
  )
  return res.data
}

// ── Entries ───────────────────────────────────────────────────────

export async function listEntries(
  clubId: number,
  params: { categoryId?: number } = {},
  opts: { signal?: AbortSignal } = {},
): Promise<HonourEntry[]> {
  const qs = params.categoryId !== undefined ? `?category_id=${params.categoryId}` : ''
  const res = await authedFetch<Envelope<HonourEntry[]>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-entries${qs}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function createEntry(
  clubId: number,
  input: HonourEntryCreateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourEntry> {
  const res = await authedFetch<Envelope<HonourEntry>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-entries`,
    {
      method: 'POST',
      body: JSON.stringify(input),
      signal: opts.signal,
    },
  )
  return res.data
}

/**
 * PUT /clubs/:clubId/honour-entries/:entryId — partial update.
 *
 * If `players` is present the whole player list is replaced atomically.
 * Any linked `user_id` must be an active member of the club — else
 * backend returns 400 `member_not_in_club` with the offending id in the body.
 */
export async function updateEntry(
  clubId: number,
  entryId: number,
  patch: HonourEntryUpdateInput,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourEntry> {
  const res = await authedFetch<Envelope<HonourEntry>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-entries/${entryId}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}

export async function deleteEntry(
  clubId: number,
  entryId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${MEDIA_BASE}/clubs/${clubId}/honour-entries/${entryId}`,
    { method: 'DELETE', signal: opts.signal },
  )
}

// ── Formats (lookup) ──────────────────────────────────────────────

export async function listFormats(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<HonourFormat[]> {
  const res = await authedFetch<Envelope<HonourFormat[]>>(
    `${MEDIA_BASE}/clubs/${clubId}/honour-board-formats`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

// ── Reverse index (public) ────────────────────────────────────────

/**
 * GET /players/:userId/honour-board — every trophy a user has won across
 * every club they've competed at. Public, no auth. Lives on CRM_BASE (not
 * MEDIA_BASE) — see the note at the top of this file.
 */
export async function forPlayer(
  userId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<PlayerHonourResponse> {
  const res = await publicFetch<Envelope<PlayerHonourResponse>>(
    `${CRM_BASE}/players/${userId}/honour-board`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}
