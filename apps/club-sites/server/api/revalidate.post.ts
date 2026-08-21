import { defineEventHandler, readRawBody, getRequestHeader, createError } from 'h3'
import { invalidateHost } from '~/server/utils/tornyApi'

interface RevalidateBody {
  clubId: number
  slug?: string
  paths?: string[]
  purge?: 'all'
  reason?: string
  hosts?: string[]
}

/**
 * Webhook the CRM POSTs to after any save that changes public content.
 * Verifies HMAC-SHA256 (`X-Torny-Signature: sha256=<hex>`), then:
 *   1. Drops the in-Worker tenant-resolve cache for every known host on the club.
 *   2. TODO: purges Cloudflare Cache API for each `${primary_host}${path}` +
 *      each `${custom_host}${path}`. Requires CF_API_TOKEN + CF_ZONE_ID.
 *
 * See docs/backend-briefs/15-public-site-endpoints-live.md.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const secret = config.revalidateSecret
  if (!secret || secret === 'dev-secret-change-me') {
    throw createError({ statusCode: 500, statusMessage: 'Revalidate secret not set' })
  }

  const rawHeader = getRequestHeader(event, 'x-torny-signature') ?? ''
  const signatureHex = rawHeader.startsWith('sha256=') ? rawHeader.slice('sha256='.length) : rawHeader
  const raw = (await readRawBody(event, 'utf-8')) ?? ''

  if (!(await verifySignature(secret, raw, signatureHex))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let body: RevalidateBody
  try {
    body = JSON.parse(raw) as RevalidateBody
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Body is not valid JSON' })
  }
  if (typeof body?.clubId !== 'number' && typeof body?.clubId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing clubId' })
  }

  // Drop the tenant lookup cache for every host on the club so the next hit
  // to /clubs/resolve fetches fresh (picks up e.g. an onboarding-complete
  // that flipped `onboarded_at` from null to a timestamp).
  const hosts = body.hosts ?? []
  for (const h of hosts) invalidateHost(h)

  // TODO: call CF purge_cache here for each host × path. Placeholder response
  // for now — the SWR windows in nuxt.config.ts self-heal within 1-5 min.
  return {
    ok: true,
    clubId: body.clubId,
    slug: body.slug,
    reason: body.reason,
    invalidated_hosts: hosts,
    purged_paths: body.paths ?? [],
  }
})

async function verifySignature(secret: string, payload: string, signatureHex: string): Promise<boolean> {
  if (!signatureHex) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
  const provided = hexToBytes(signatureHex)
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (provided[i] ?? 0)
  return diff === 0
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) return new Uint8Array()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}
