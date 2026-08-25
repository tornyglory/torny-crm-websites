// Injects the current club's brand accent, font pair, and style preset
// as CSS custom properties, and loads the pair's Google Fonts stylesheet
// in <head>.
//
// Reads `brand_primary` from the tenant-resolve club (synchronous in SSR)
// and `fonts` + `style` from the richer `/site` payload. Awaits `useSite()`
// so the head is populated before Nuxt serializes the SSR document.

import type { SiteColorScheme, SiteFonts, SiteStyle } from '~/server/utils/tornyApi'

function googleFontsHref(fonts: SiteFonts): string {
  const seen = new Set<string>()
  const params: string[] = []
  for (const font of [fonts.heading, fonts.body, fonts.mono]) {
    if (seen.has(font.family)) continue
    seen.add(font.family)
    params.push(`family=${encodeURIComponent(font.family)}:wght@${font.weights.join(';')}`)
  }
  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`
}

function cardBgVar(bg: SiteStyle['cards']['background']): string {
  return bg === 'ground' ? 'var(--color-ground)' : 'var(--color-surface)'
}
function cardBorderVar(border: SiteStyle['cards']['border']): string {
  return border === 'hairline' ? '1px solid var(--color-hairline)' : '1px solid transparent'
}
function cardShadowVar(shadow: SiteStyle['cards']['shadow']): string {
  return shadow === 'soft' ? '0 6px 16px -6px rgba(15, 23, 42, 0.15)' : 'none'
}

function styleDeclarations(style: SiteStyle): string[] {
  return [
    `--radius-xs: ${style.radius.xs}px !important;`,
    `--radius-sm: ${style.radius.sm}px !important;`,
    `--radius-md: ${style.radius.md}px !important;`,
    `--radius-lg: ${style.radius.lg}px !important;`,
    `--radius-pill: ${style.radius.pill}px !important;`,
    `--card-bg: ${cardBgVar(style.cards.background)} !important;`,
    `--card-border: ${cardBorderVar(style.cards.border)} !important;`,
    `--card-shadow: ${cardShadowVar(style.cards.shadow)} !important;`,
    `--btn-radius: ${style.buttons.radius}px !important;`,
  ]
}

function colorSchemeDeclarations(scheme: SiteColorScheme): string[] {
  return Object.entries(scheme.tokens).map(
    ([key, value]) => `--color-${key}: ${value} !important;`,
  )
}

export async function useTheme() {
  const club = useClub()
  // Awaiting `useSite()` here guarantees `site.value` is populated by the
  // time useHead below reads the computed on the server. Nuxt's data cache
  // dedupes by key, so the page-level `await useSite()` reuses this call.
  const { data: site } = await useSite()

  const fonts = computed<SiteFonts | undefined>(() => site.value?.club?.fonts)
  const style = computed<SiteStyle | undefined>(() => site.value?.club?.style)
  const colorScheme = computed<SiteColorScheme | undefined>(() => site.value?.club?.color_scheme)

  const favicon = computed<string | null>(() => site.value?.club?.favicon_url ?? null)

  useHead({
    link: computed(() => {
      const links: Array<Record<string, string>> = []
      const f = fonts.value
      if (f) links.push({ rel: 'stylesheet', href: googleFontsHref(f) })
      if (favicon.value) links.push({ rel: 'icon', href: favicon.value })
      return links
    }),
    style: computed(() => {
      const declarations: string[] = []
      const primary = club.value?.brand_primary
      if (primary) declarations.push(`--color-accent: ${primary} !important;`)

      const f = fonts.value
      if (f) {
        declarations.push(`--font-display: '${f.heading.family}', system-ui, sans-serif !important;`)
        declarations.push(`--font-body: '${f.body.family}', system-ui, sans-serif !important;`)
        declarations.push(`--font-mono: '${f.mono.family}', ui-monospace, monospace !important;`)
      }

      const s = style.value
      if (s) declarations.push(...styleDeclarations(s))

      const cs = colorScheme.value
      if (cs) declarations.push(...colorSchemeDeclarations(cs))

      if (declarations.length === 0) return []
      return [{ innerHTML: `:root { ${declarations.join(' ')} }` }]
    }),
  })
}
