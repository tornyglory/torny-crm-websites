// Footer config — brief 115.
//
// Admin endpoints land on VENUE_BASE because TornyCrmStack is at
// CloudFormation's 500-resource cap (same reason /ai-generate and
// /block-images-copy migrated). The public /site payload (which carries
// the resolved footer object alongside club / contact / hours / …) still
// comes from CRM_BASE — this module only covers the admin read / save /
// reset paths.

import { VENUE_BASE } from '../config'
import { ApiError, authedFetch } from '../http'
import type { FooterConfig, FooterSocialIcon } from '../types'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

/**
 * GET response — the saved config plus two editor-side extras:
 *  - `updated_at`: let the UI show "Saved just now" / "Saved 5m ago".
 *  - `social_icons`: the server's current icon whitelist, so new icons
 *    added server-side appear in the picker without a FE release.
 */
export interface FooterConfigRead extends FooterConfig {
  updated_at: string
  social_icons: FooterSocialIcon[]
}

/**
 * GET /clubs/:clubId/footer-config — returns the saved shape, or null
 * when the admin has never saved (API returns 404 `footer_not_configured`).
 *
 * The 404 case is modelled as `null` rather than a thrown error because
 * the editor treats "never configured" as the empty starting state of
 * the form, not an exceptional condition.
 */
export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<FooterConfigRead | null> {
  try {
    const res = await authedFetch<Envelope<FooterConfigRead>>(
      `${VENUE_BASE}/clubs/${clubId}/footer-config`,
      { method: 'GET', signal: opts.signal },
    )
    return res.data
  } catch (err) {
    if (err instanceof ApiError && err.code === 'footer_not_configured') return null
    throw err
  }
}

/**
 * PUT /clubs/:clubId/footer-config — full-replacement save. Empty arrays
 * and `contact_override: null` are all valid shapes; the only invalid
 * payload is one that trips a field-level error code (see brief 115 §3).
 */
export async function put(
  clubId: number,
  payload: FooterConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<FooterConfigRead> {
  const res = await authedFetch<Envelope<FooterConfigRead>>(
    `${VENUE_BASE}/clubs/${clubId}/footer-config`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
      signal: opts.signal,
    },
  )
  return res.data
}

/**
 * DELETE /clubs/:clubId/footer-config — resets the club back to the FE
 * hardcoded fallback (public /site returns `footer: null` again).
 * Idempotent server-side.
 */
export async function remove(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch(
    `${VENUE_BASE}/clubs/${clubId}/footer-config`,
    { method: 'DELETE', signal: opts.signal },
  )
}
