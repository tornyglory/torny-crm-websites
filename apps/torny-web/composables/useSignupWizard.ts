/**
 * Shared state for the 4-step signup wizard (brief 88).
 *
 * Lives in `useState` so each step component reads/writes the same
 * object across `?step=` navigations. The idempotency key is minted
 * once per wizard session so a user who refreshes between steps 3 and
 * 4 doesn't accidentally trigger two signup round-trips.
 */
import type { OrgType, PlanKey } from '@torny/api-client'

export interface WizardForm {
  // Step 1
  name: string
  email: string
  password: string

  // Step 2
  orgName: string
  slug: string
  slugDirty: boolean                 // true once the user has typed into the slug field — turns off auto-slug derivation
  orgType: OrgType | null
  country: string
  timezone: string

  // Step 3
  plan: PlanKey

  // Session identity
  idempotencyKey: string
}

/** Map org type → recommended default plan (brief 89 §3). The admin can
 *  override on step 3; this just drives the "Recommended for you" pre-pick. */
export function defaultPlanFor(orgType: OrgType | null): PlanKey {
  switch (orgType) {
    case 'sports_and_recreation':
    case 'community_and_civic':
    case 'holiday_accommodation':
    case 'events_venue':
      return 'pro'
    default:
      return 'starter'
  }
}

function uuid(): string {
  // crypto.randomUUID is safe in Nuxt SSR + modern browsers.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Last-ditch fallback for ancient envs.
  return 'x-' + Math.random().toString(36).slice(2) + '-' + Date.now()
}

/** Derive a lowercase slug from an org name. Trims punctuation, swaps
 *  spaces for hyphens, enforces the subdomain format rules in brief 88. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    // Replace any run of non-alphanumeric chars with a single hyphen.
    .replace(/[^a-z0-9]+/g, '-')
    // Collapse multiple hyphens.
    .replace(/-+/g, '-')
    // Strip leading / trailing hyphens.
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

export function useSignupWizard() {
  return useState<WizardForm>('signup-wizard', () => ({
    name: '',
    email: '',
    password: '',

    orgName: '',
    slug: '',
    slugDirty: false,
    orgType: null,
    country: 'NZ',
    timezone: 'Pacific/Auckland',

    plan: 'pro',

    idempotencyKey: uuid(),
  }))
}
