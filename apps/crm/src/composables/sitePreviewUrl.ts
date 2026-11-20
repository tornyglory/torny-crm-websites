/**
 * Builds a link to a club's public site.
 *
 * In dev (`VITE_SITES_ORIGIN` set), the tenant middleware in
 * apps/club-sites can't resolve a real subdomain, so we hit the local Nuxt
 * origin and pass `?host=<subdomain>.<suffix>` for the override cookie to
 * bite. In prod (`VITE_SITES_ORIGIN` empty), each club lives at its own
 * subdomain, so the URL is `https://<subdomain>.<suffix><path>`.
 *
 * Takes the **subdomain** (tenant-routing key), not the slug (venue-lookup
 * key). Brief 110 (2026-11-21) fixed a resolve-handler mislabel so the
 * two values can now differ — for ~2 clubs the slug ≠ subdomain, and
 * passing slug here would 404 the preview. Callers usually pass
 * `clubStore.current.subdomain ?? clubStore.current.slug` so older
 * payloads that predate brief 110 still resolve.
 */
export function sitePreviewUrl(subdomain: string, path = '/'): string {
  const origin = (import.meta.env.VITE_SITES_ORIGIN as string | undefined)?.trim() ?? ''
  const suffix = (import.meta.env.VITE_SITES_HOST_SUFFIX as string | undefined)?.trim() ?? ''
  const safePath = path.startsWith('/') ? path : `/${path}`
  if (origin) {
    return `${origin}${safePath}?host=${subdomain}.${suffix}`
  }
  return `https://${subdomain}.${suffix}${safePath}`
}
