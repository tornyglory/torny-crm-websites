import type { TornyClient } from '../client'
import { CRM_BASE, VENUE_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'
import type { Club, ID } from '../types'

export const listMine = (c: TornyClient) =>
  c.get<Club[]>('/clubs/mine').then(r => r.data)

export const get = (c: TornyClient, id: ID) =>
  c.get<Club>(`/clubs/${id}`).then(r => r.data)

export const update = (c: TornyClient, id: ID, body: Partial<Club>) =>
  c.patch<Club>(`/clubs/${id}`, body).then(r => r.data)

export const resolveByHost = (c: TornyClient, host: string) =>
  c.get<Club>('/clubs/resolve', { params: { host } }).then(r => r.data)

// ── Brand assets ─────────────────────────────────────────────────
// See brief 24. Send only the field that changed; missing keys are
// no-ops, `null` clears a URL, string sets. `image_style` (brief 79)
// doesn't accept null — it's always one of the three enum values.

export type ImageStyle = 'soft' | 'studio' | 'archive'

export interface BrandAssetsPatch {
  logo_url?: string | null
  favicon_url?: string | null
  image_style?: ImageStyle
  /** 6-digit hex (`#RRGGBB`). Null clears the override — public site
   *  falls back to the colour-scheme preset's token. Brief 81. */
  brand_primary?: string | null
  /** 6-digit hex (`#RRGGBB`). Null clears the override. Brief 81. */
  brand_accent?: string | null
}

export interface BrandAssetsResponse {
  clubId: number
  logo_url: string | null
  favicon_url: string | null
  /** Default `'soft'` on the server; present once brief 79 ships. */
  image_style?: ImageStyle
  /** Hex overrides — present once brief 81 ships. Null = no override. */
  brand_primary?: string | null
  brand_accent?: string | null
}

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

export async function updateBrandAssets(
  clubId: number,
  patch: BrandAssetsPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<BrandAssetsResponse> {
  const res = await authedFetch<Envelope<BrandAssetsResponse>>(
    `${CRM_BASE}/clubs/${clubId}/brand-assets`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
      signal: opts.signal,
    },
  )
  return res.data
}

// ── Change subdomain (brief 98) ──────────────────────────────────

export type ChangeSubdomainErrorCode =
  | 'subdomain_required'
  | 'subdomain_invalid'
  | 'subdomain_reserved'
  | 'subdomain_taken'
  | 'provision_failed'
  | 'forbidden'
  | 'not_found'

export interface ChangeSubdomainResult {
  club_id: number
  subdomain: string
  primary_host: string
  public_url: string
}

/** PATCH /clubs/{clubId}/subdomain — owner-only. Flips the Torny-hosted
 *  subdomain; backend writes the new KV entry before the DB cutover, then
 *  best-effort deletes the old one. Brief 98. */
export async function changeSubdomain(
  clubId: number,
  subdomain: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChangeSubdomainResult> {
  const res = await authedFetch<Envelope<ChangeSubdomainResult>>(
    `${CRM_BASE}/clubs/${clubId}/subdomain`,
    {
      method: 'PATCH',
      body: JSON.stringify({ subdomain }),
      signal: opts.signal,
    },
  )
  return res.data
}

// ── Club email handle (brief 100) ───────────────────────────────

export type ChangeEmailHandleErrorCode =
  | 'email_handle_required'
  | 'email_handle_invalid'
  | 'email_handle_reserved'
  | 'email_handle_taken'
  | 'forbidden'
  | 'not_found'

export interface ChangeEmailHandleResult {
  club_id: number
  email_handle: string
  /** Fully-qualified address — i.e. `<handle>@torny.pro`. */
  address: string
}

export type EmailHandleCheckResult =
  | { available: true; value: string }
  | { available: false; reason: 'taken' | 'reserved' | 'invalid' }

/** GET /email-handles/check?value=… — public availability check. Mirrors
 *  the subdomain availability shape used by the onboarding wizard + the
 *  brief 98 subdomain editor. */
export async function checkEmailHandle(
  value: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailHandleCheckResult> {
  const url = `${VENUE_BASE}/email-handles/check?value=${encodeURIComponent(value)}`
  const res = await publicFetch<Envelope<EmailHandleCheckResult>>(url, { signal: opts.signal })
  return res.data
}

/** PATCH /clubs/{clubId}/email-handle — owner-only. Flips the mailbox
 *  the club sends from AND receives at. Brief 100 §4.2 / §10.2.
 *  Routed through the Venue API because the CRM stack hit the CFN
 *  500-resource cap (noted in brief 99 §5). */
export async function changeEmailHandle(
  clubId: number,
  emailHandle: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ChangeEmailHandleResult> {
  const res = await authedFetch<Envelope<ChangeEmailHandleResult>>(
    `${VENUE_BASE}/clubs/${clubId}/email-handle`,
    {
      method: 'PATCH',
      body: JSON.stringify({ email_handle: emailHandle }),
      signal: opts.signal,
    },
  )
  return res.data
}
