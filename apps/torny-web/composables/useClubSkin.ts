/**
 * Fetch a club's public-site brand payload by slug so the sign-in page can
 * re-skin its left rail. Called with the `?club=` query param on
 * `/sign-in`. Silent 404 → returns null → page falls back to generic
 * Torny branding.
 */

export interface ClubSkin {
  slug: string
  name: string
  logoUrl: string | null
  accentColour: string | null
  tagline: string | null
  foundedYear: number | null
  region: string | null
  country: string | null
  fontDisplay: string | null
  fontBody: string | null
  publicSiteUrl: string
}

interface Envelope<T> { status: string; data: T }
interface SiteResponse {
  club: {
    slug: string
    name: string
    logo_url: string | null
    brand_primary: string | null
    tagline: string | null
    founded_year: number | null
    region: string | null
    country: string | null
    fonts?: { display?: { family?: string }; body?: { family?: string } }
  }
  primary_host?: string | null
}

export async function fetchClubSkin(slug: string): Promise<ClubSkin | null> {
  const trimmed = slug.trim().toLowerCase()
  if (!trimmed) return null

  const config = useRuntimeConfig()
  try {
    const res = await $fetch<Envelope<SiteResponse>>(
      `/public/clubs/${encodeURIComponent(trimmed)}/site`,
      { baseURL: config.tornyApiBaseUrl },
    )
    const c = res.data.club
    const host = res.data.primary_host ?? `${trimmed}.torny.co`
    return {
      slug: c.slug,
      name: c.name,
      logoUrl: c.logo_url,
      accentColour: c.brand_primary,
      tagline: c.tagline,
      foundedYear: c.founded_year,
      region: c.region,
      country: c.country,
      fontDisplay: c.fonts?.display?.family ?? null,
      fontBody: c.fonts?.body?.family ?? null,
      publicSiteUrl: `https://${host}`,
    }
  } catch {
    return null
  }
}
