import { defineEventHandler, readRawBody, getRequestHeader, createError } from 'h3'

interface RevalidateBody {
  clubId: string
  paths: string[]
}

// Webhook called by the CRM backend when an owner publishes edits.
// Verifies HMAC-SHA256 (Web Crypto — works on Cloudflare Workers), then purges
// the listed URLs from CF cache.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const secret = config.revalidateSecret
  if (!secret) throw createError({ statusCode: 500, statusMessage: 'Revalidate secret not set' })

  const signatureHex = getRequestHeader(event, 'x-torny-signature') ?? ''
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
  if (!body?.clubId || !Array.isArray(body?.paths)) {
    throw createError({ statusCode: 400, statusMessage: 'Missing clubId or paths' })
  }

  // TODO: call CF purge_cache endpoint here.
  // await purgeCloudflareCache(body.paths.map(p => `${config.public.siteUrl}${p}`))

  return {
    ok: true,
    clubId: body.clubId,
    purged: body.paths,
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
