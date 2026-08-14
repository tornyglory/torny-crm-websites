import { useRuntimeConfig } from '#imports'

interface Club {
  id: string
  slug: string
  name: string
  domain: string | null
  brandPrimary: string | null
  logoUrl: string | null
}

// Naive in-memory cache; on Cloudflare Pages, use Workers KV instead so tenant
// resolution stays sub-ms at the edge.
const memo = new Map<string, { club: Club; expires: number }>()
const TTL_MS = 60_000

export async function resolveClubForHost(host: string): Promise<Club | null> {
  const cached = memo.get(host)
  if (cached && cached.expires > Date.now()) return cached.club

  const config = useRuntimeConfig()
  try {
    const club = await $fetch<Club>('/clubs/resolve', {
      baseURL: config.tornyApiBaseUrl,
      params: { host },
    })
    memo.set(host, { club, expires: Date.now() + TTL_MS })
    return club
  } catch {
    return null
  }
}

export function tornyFetch<T>(path: string, opts?: Parameters<typeof $fetch>[1]): Promise<T> {
  const config = useRuntimeConfig()
  return $fetch<T>(path, { baseURL: config.tornyApiBaseUrl, ...opts })
}
