/**
 * Builds a link to a club's public site.
 *
 * In dev (`VITE_SITES_ORIGIN` set), the tenant middleware in
 * apps/club-sites can't resolve a real subdomain, so we hit the local Nuxt
 * origin and pass `?host=<slug>.<suffix>` for the override cookie to bite.
 * In prod (`VITE_SITES_ORIGIN` empty), each club lives at its own subdomain,
 * so the URL is `https://<slug>.<suffix><path>`.
 */
export function sitePreviewUrl(slug: string, path = '/'): string {
  const origin = (import.meta.env.VITE_SITES_ORIGIN as string | undefined)?.trim() ?? ''
  const suffix = (import.meta.env.VITE_SITES_HOST_SUFFIX as string | undefined)?.trim() ?? ''
  const safePath = path.startsWith('/') ? path : `/${path}`
  if (origin) {
    return `${origin}${safePath}?host=${slug}.${suffix}`
  }
  return `https://${slug}.${suffix}${safePath}`
}
