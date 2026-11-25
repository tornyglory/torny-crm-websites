/**
 * Dynamic Open Graph image for torny-web.
 *
 * Renders a 1200×630 SVG social card with the Torny brand on the
 * left and an optional title + subtitle. Pages override via query
 * params:
 *
 *   https://torny.pro/og.svg?title=Pricing&subtitle=Start+free
 *
 * We return SVG rather than PNG because:
 *   1. Nitro + Cloudflare Workers can render SVG directly with zero
 *      extra deps — a PNG path needs resvg-wasm bundled into the
 *      worker, which the current Nitro compatibility doesn't support
 *      without a Nuxt 4 upgrade (tried nuxt-og-image; requires v4).
 *   2. Facebook, LinkedIn, and Twitter / X all accept SVG `og:image`
 *      — they rasterize on their side. Slack and Discord are iffier
 *      but render fallback cards cleanly.
 *
 * Follow-up: when we upgrade to Nuxt 4, swap to nuxt-og-image for
 * proper PNG output. See docs/production-readiness/12c-dynamic-og.md.
 */
function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  }[c] ?? c))
}

function wrapText(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharsPerLine) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines - 1) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/\s+\S*$/, '')}…`
  }
  return lines
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const title = typeof query.title === 'string' && query.title.trim().length > 0
    ? query.title.trim()
    : 'The Bowls Club Network'
  const subtitle = typeof query.subtitle === 'string' && query.subtitle.trim().length > 0
    ? query.subtitle.trim()
    : 'Software to run your sports club. Membership, events, communications, website.'

  const titleLines = wrapText(title, 28, 2)
  const subtitleLines = wrapText(subtitle, 60, 3)

  const titleY = 310
  const titleLineHeight = 86
  const subtitleY = titleY + titleLines.length * titleLineHeight + 32
  const subtitleLineHeight = 42

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0B"/>
      <stop offset="100%" stop-color="#1C1C1F"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Accent block (brand blue) -->
  <rect x="80" y="80" width="96" height="96" rx="20" fill="#2563EB"/>
  <text x="128" y="148" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="56" font-weight="700" fill="#ffffff" text-anchor="middle">T</text>
  <text x="200" y="148" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="36" font-weight="700" fill="#ffffff" letter-spacing="-0.5">Torny</text>

  <!-- Title (up to 2 lines) -->
  ${titleLines.map((line, i) => `
  <text x="80" y="${titleY + i * titleLineHeight}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="80" font-weight="700" fill="#ffffff" letter-spacing="-2">${escapeXml(line)}</text>`).join('')}

  <!-- Subtitle (up to 3 lines) -->
  ${subtitleLines.map((line, i) => `
  <text x="80" y="${subtitleY + i * subtitleLineHeight}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="32" font-weight="400" fill="#A3A39B">${escapeXml(line)}</text>`).join('')}

  <!-- URL -->
  <text x="1120" y="590" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="20" font-weight="500" fill="#6B6B72" letter-spacing="2" text-anchor="end">TORNY.PRO</text>
</svg>`

  setHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return svg
})
