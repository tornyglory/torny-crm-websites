// Club onboarding wizard endpoints. See docs/backend-briefs/11-onboarding-live.md.
//
// The response envelope for GET is doubly-nested:
//   body.data.step  ← wizard bookmark
//   body.data.data.clubName  ← actual wizard fields
// This module unwraps that so consumers get flat, well-typed objects.

import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

// ── Types ──────────────────────────────────────────────────────

export type WizardStepValue = 'welcome' | '1' | '2' | '3' | '4' | '5' | '6' | 'complete'

export interface WizardDayHours {
  open: boolean
  from: string
  to: string
}

export interface WizardTier {
  id?: string
  name: string
  description: string
  price: number
  tone?: 'accent' | 'mint' | 'tangerine' | 'violet'
  isDefault?: boolean
}

export interface WizardData {
  clubName: string
  yearFounded: string
  clubType: 'community' | 'private' | 'district'
  shortDescription: string
  address: string
  suburb: string
  region: string
  country: string
  greens: number
  rinks: number
  greenSurface: 'tifdwarf' | 'cotula' | 'synthetic' | 'mixed'
  email: string
  phone: string
  hours: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', WizardDayHours>
  cadence: 'annual' | 'monthly' | 'season'
  firstYearDiscount: boolean
  tiers: WizardTier[]
  logoName: string | null
  logoUrl: string | null
  accentColour: string
  tagline: string
  subdomain: string
  pages: Record<'home' | 'about' | 'membership' | 'events' | 'shop', boolean>
}

export interface OnboardingState {
  clubId: number
  step: WizardStepValue
  completed: boolean
  completedAt: string | null
  data: WizardData
}

export interface OnboardingPatchPayload {
  step?: WizardStepValue | number
  data?: Partial<WizardData>
}

export interface OnboardingPatchResponse {
  clubId: number
  step: WizardStepValue
  updatedAt: string
}

export interface OnboardingCompleteResponse {
  clubId: number
  onboardedAt: string
  publicUrl: string
  membershipTierIds: number[]
}

export interface OnboardingValidationError {
  field: string
  code: string
  message: string
}

export type SubdomainCheckResult =
  | { available: true; value: string }
  | { available: false; reason: 'taken' | 'reserved' | 'invalid' }

// ── Envelope helpers ───────────────────────────────────────────

interface Envelope<T> {
  status: 'success'
  data: T
}

// ── Endpoints ──────────────────────────────────────────────────

/** GET /clubs/:clubId/onboarding — hydrate wizard state. */
export async function get(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<OnboardingState> {
  const res = await authedFetch<Envelope<OnboardingState>>(
    `${CRM_BASE}/clubs/${clubId}/onboarding`,
    { signal: opts.signal },
  )
  return res.data
}

/** PATCH /clubs/:clubId/onboarding — autosave partial data + step bookmark. */
export async function patch(
  clubId: number,
  payload: OnboardingPatchPayload,
  opts: { signal?: AbortSignal } = {},
): Promise<OnboardingPatchResponse> {
  const res = await authedFetch<Envelope<OnboardingPatchResponse>>(
    `${CRM_BASE}/clubs/${clubId}/onboarding`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal: opts.signal,
    },
  )
  return res.data
}

/** POST /clubs/:clubId/onboarding/complete — atomic finalize. */
export async function complete(
  clubId: number,
  opts: { signal?: AbortSignal } = {},
): Promise<OnboardingCompleteResponse> {
  const res = await authedFetch<Envelope<OnboardingCompleteResponse>>(
    `${CRM_BASE}/clubs/${clubId}/onboarding/complete`,
    {
      method: 'POST',
      body: '{}',
      signal: opts.signal,
    },
  )
  return res.data
}

/** GET /subdomains/check?value=… — public availability check. */
export async function checkSubdomain(
  value: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SubdomainCheckResult> {
  const url = `${CRM_BASE}/subdomains/check?value=${encodeURIComponent(value)}`
  const res = await publicFetch<Envelope<SubdomainCheckResult>>(url, { signal: opts.signal })
  return res.data
}
