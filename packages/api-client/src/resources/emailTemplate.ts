// Email templates — backend brief 45.
//
// Owners edit a shared header + footer that wraps every outgoing club
// email. Variables use {{curly-brace}} tokens whitelisted by the backend
// per flavour.

import { CRM_BASE } from '../config'
import { authedFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export type EmailFlavor =
  | 'application_received'
  | 'application_approved'
  | 'application_rejected'
  | 'enquiry_received'
  | 'enquiry_reply'
  | 'member_welcome'
  | 'broadcast'

export type EmailVariableCategory = 'club' | 'recipient' | 'context' | 'auto'

export interface EmailVariable {
  key: string                 // e.g. "recipient_name"
  token: string               // e.g. "{{recipient_name}}"
  label: string               // human label — "Recipient's full name"
  category: EmailVariableCategory
  /** Sample value the preview substitutes for this token. */
  sample: string
  /** When populated, this variable only makes sense for these flavours. */
  flavors?: EmailFlavor[]
}

export interface EmailTemplate {
  /** HTML for the top of every email — logo, club name, tagline. */
  header_html: string
  /** HTML for the bottom of every email — contact info + unsubscribe. */
  footer_html: string
  /** Optional accent colour override; falls back to clubs_data.accent_colour. */
  accent_colour: string | null
  /** Font family override; empty = platform default (Inter). */
  font_family: string | null
  /** Whether to display the club logo above the header HTML. */
  show_logo: boolean
  /** Owner-editable sample data used by the preview — overrides defaults. */
  sample_overrides: Record<string, string>
  /** Server-known available variables. Read-only. */
  variables: EmailVariable[]
  /** Last saved timestamp. */
  updated_at: string | null
}

export type EmailTemplatePatch = Partial<{
  header_html: string
  footer_html: string
  accent_colour: string | null
  font_family: string | null
  show_logo: boolean
  sample_overrides: Record<string, string>
}>

export interface EmailPreviewResult {
  /** Fully-rendered HTML (header + sample body + footer, variables substituted). */
  html: string
  /** Plain-text fallback rendered the same way. */
  text: string
  /** Subject line for the chosen flavour. */
  subject: string
}

export interface EmailTestSendInput {
  flavor: EmailFlavor
  /** Optional override — defaults to the owner's email. */
  to?: string
}

export interface EmailTestSendResult {
  sent: boolean
  to: string
  provider_message_id: string | null
}

export type EmailTemplateErrorCode =
  | 'bad_html'
  | 'unknown_variable'
  | 'header_too_long'
  | 'footer_too_long'
  | 'bad_flavor'
  | 'bad_email'
  | 'rate_limited'
  | 'send_failed'

// ── Per-flavour body overrides — backend brief 46 ─────────────────

/** One row per (club, flavor) — combines the platform default copy
 *  (read-only) with the owner's override (nullable). */
export interface EmailFlavorRow {
  flavor: EmailFlavor
  /** Human label the CRM shows in the flavour picker. */
  label: string
  /** One-line description of when this flavour fires. */
  hint: string
  /** Platform default subject line. Read-only. */
  subject_default: string
  /** Owner's saved override, or null when using the default. */
  subject_override: string | null
  /** Platform default body HTML. Read-only. */
  body_html_default: string
  /** Owner's saved override, or null when using the default. */
  body_html_override: string | null
  /** Token keys (not full {{tokens}} form) valid inside this flavour's
   *  subject + body. Strictly enforced on PATCH. */
  supported_tokens: string[]
  /** Last saved timestamp for the override, or null if never saved. */
  updated_at: string | null
  /** user_id of whoever last saved the override, or null. */
  updated_by: number | null
}

export type EmailFlavorPatch = Partial<{
  /** New subject, or explicit null to clear the override. */
  subject_override: string | null
  /** New body HTML, or explicit null to clear the override. */
  body_html_override: string | null
}>

export interface EmailFlavorsResponse {
  flavors: EmailFlavorRow[]
}

export type EmailFlavorErrorCode =
  | 'bad_flavor'
  | 'empty_patch'
  | 'subject_too_long'
  | 'body_too_long'
  | 'empty_subject'
  | 'empty_body'
  | 'bad_html'
  | 'unknown_variable'

interface Envelope<T> {
  status: 'success'
  message?: string
  data: T
}

// ── Endpoints ───────────────────────────────────────────────────

export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailTemplate> {
  const res = await authedFetch<Envelope<EmailTemplate>>(
    `${CRM_BASE}/clubs/${clubId}/email-template`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function update(
  clubId: number,
  patch: EmailTemplatePatch,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailTemplate> {
  const res = await authedFetch<Envelope<EmailTemplate>>(
    `${CRM_BASE}/clubs/${clubId}/email-template`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

/** Server-side preview with real substitution. Used before sending a test
 *  or by the CRM when the owner wants a "trust but verify" render. */
export async function preview(
  clubId: number,
  flavor: EmailFlavor,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailPreviewResult> {
  const res = await authedFetch<Envelope<EmailPreviewResult>>(
    `${CRM_BASE}/clubs/${clubId}/email-template/preview?flavor=${encodeURIComponent(flavor)}`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

export async function testSend(
  clubId: number,
  input: EmailTestSendInput,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailTestSendResult> {
  const res = await authedFetch<Envelope<EmailTestSendResult>>(
    `${CRM_BASE}/clubs/${clubId}/email-template/test-send`,
    { method: 'POST', body: JSON.stringify(input), signal: opts.signal },
  )
  return res.data
}

// ── Per-flavour body overrides — brief 46 ─────────────────────────

/** GET /clubs/{club_id}/email-template/flavors — all 7 flavours with
 *  defaults + overrides in one call. */
export async function listFlavors(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailFlavorsResponse> {
  const res = await authedFetch<Envelope<EmailFlavorsResponse>>(
    `${CRM_BASE}/clubs/${clubId}/email-template/flavors`,
    { method: 'GET', signal: opts.signal },
  )
  return res.data
}

/** PATCH /clubs/{club_id}/email-template/flavors/{flavor} — send only
 *  the fields you want to change. Explicit null clears a field. */
export async function updateFlavor(
  clubId: number,
  flavor: EmailFlavor,
  patch: EmailFlavorPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<EmailFlavorRow> {
  const res = await authedFetch<Envelope<EmailFlavorRow>>(
    `${CRM_BASE}/clubs/${clubId}/email-template/flavors/${encodeURIComponent(flavor)}`,
    { method: 'PATCH', body: JSON.stringify(patch), signal: opts.signal },
  )
  return res.data
}

/** DELETE /clubs/{club_id}/email-template/flavors/{flavor} — clears
 *  both subject + body overrides in one call. Idempotent. */
export async function resetFlavor(
  clubId: number,
  flavor: EmailFlavor,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  await authedFetch<unknown>(
    `${CRM_BASE}/clubs/${clubId}/email-template/flavors/${encodeURIComponent(flavor)}`,
    { method: 'DELETE', signal: opts.signal },
  )
}
