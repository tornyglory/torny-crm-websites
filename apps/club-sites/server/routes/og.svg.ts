/**
 * Dynamic per-tenant Open Graph image for club-sites.
 *
 * Reads the request's Host header, resolves the club payload, and
 * renders a 1200×630 SVG social card with:
 *   - The club's brand color as the background
 *   - The club's name, big
 *   - An optional page label (?label=Events, ?label=About, etc.)
 *   - "Powered by Torny" tag
 *
 * Every club's subdomain (and custom domain) gets its own OG image
 * out of the same route — the Host header + resolveClubForHost gives
 * us the per-tenant payload.
 *
 * SVG rather than PNG: see the equivalent torny-web route for the
 * reasoning. Short version — PNG needs resvg-wasm which requires a
 * Nuxt 4 upgrade (via nuxt-og-image). SVG is accepted by every major
 * og:image crawler that matters. Follow-up to swap to PNG when we
 * upgrade Nuxt.
 */
import { resolveClubForHost } from '../utils/tornyApi'

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

/** Rough WCAG-style contrast check — if the brand color is too light,
 *  flip the text color to dark so it stays readable on social cards.
 *  Doesn't need to be perfect, just "don't put white text on yellow". */
function textColorFor(bg: string): { fg: string; muted: string } {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return { fg: '#ffffff', muted: 'rgba(255,255,255,0.7)' }
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  // Perceived luminance (sRGB coefficients)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum > 0.6) return { fg: '#0A0A0B', muted: 'rgba(10,10,11,0.6)' }
  return { fg: '#ffffff', muted: 'rgba(255,255,255,0.75)' }
}

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, 'host') ?? 'torny.pro'
  const query = getQuery(event)
  const labelParam = typeof query.label === 'string' ? query.label.trim() : ''

  const club = await resolveClubForHost(host)
  if (!club) {
    setResponseStatus(event, 404)
    return 'Not found'
  }

  const name = club.name
  const brandPrimary = (club.brand_primary && /^#[0-9a-fA-F]{6}$/.test(club.brand_primary))
    ? club.brand_primary
    : '#2563EB'
  const { fg, muted } = textColorFor(brandPrimary)

  const nameLines = wrapText(name, 20, 2)
  const nameBaseY = labelParam ? 400 : 370
  const nameLineHeight = 92

  const initial = name.slice(0, 1).toUpperCase() || 'C'

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">
  <rect width="1200" height="630" fill="${brandPrimary}"/>

  <!-- Logo tile (brand-contrast "monogram" when the club has no logo) -->
  <rect x="80" y="80" width="112" height="112" rx="24" fill="${fg === '#ffffff' ? 'rgba(255,255,255,0.18)' : 'rgba(10,10,11,0.12)'}"/>
  <text x="136" y="166" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="56" font-weight="700" fill="${fg}" text-anchor="middle">${escapeXml(initial)}</text>

  ${labelParam ? `
  <!-- Page label -->
  <text x="80" y="300" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="28" font-weight="500" fill="${muted}" letter-spacing="3" text-transform="uppercase">${escapeXml(labelParam.toUpperCase())}</text>` : ''}

  <!-- Club name (up to 2 lines) -->
  ${nameLines.map((line, i) => `
  <text x="80" y="${nameBaseY + i * nameLineHeight}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="84" font-weight="700" fill="${fg}" letter-spacing="-2.5">${escapeXml(line)}</text>`).join('')}

  <!-- Attribution -->
  <text x="80" y="580" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    font-size="20" font-weight="500" fill="${muted}" letter-spacing="2">POWERED BY TORNY</text>
</svg>`

  setHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return svg
})
