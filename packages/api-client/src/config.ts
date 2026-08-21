// Two base URLs — see docs/backend-briefs/08-backend-response-m1-m3-m4-live.md.
// SAM = auth + mobile-shared endpoints. CRM = /me, claims, admin queue.
// Both accept the same JWT (Authorization: Bearer <torny.token>).
//
// Vite reads VITE_SAM_BASE_URL / VITE_CRM_BASE_URL from the app's .env at
// build time. The fallbacks point at prod so a fresh clone works without
// env-var setup.

const SAM_FALLBACK = 'https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CRM_FALLBACK = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod'
// Media / image uploader — lives on the primary CDK stack, distinct from
// SAM (auth) and CRM. Same JWT is accepted across all three.
const MEDIA_FALLBACK = 'https://s3vagc0pma.execute-api.ap-southeast-2.amazonaws.com/Prod'

function readEnv(key: string): string | undefined {
  // Vite exposes env via import.meta.env; use a defensive lookup so this
  // module works in non-Vite environments (tests, SSR) too.
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  return env?.[key]
}

export const SAM_BASE: string = readEnv('VITE_SAM_BASE_URL') ?? SAM_FALLBACK
export const CRM_BASE: string = readEnv('VITE_CRM_BASE_URL') ?? CRM_FALLBACK
export const MEDIA_BASE: string = readEnv('VITE_MEDIA_BASE_URL') ?? MEDIA_FALLBACK
