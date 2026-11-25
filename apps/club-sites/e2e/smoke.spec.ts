import { test, expect, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * Public club-sites smoke suite.
 *
 * Runs against the live deployed site. Every public page in the nav
 * must return 200 and render without console or page errors. If any
 * page fails this is a production incident — the CF Pages worker
 * either isn't booting or is crashing on one of the routes.
 *
 * Context: brief 01b's `isomorphic-dompurify` landed in commit 01a9691
 * and silently 500'd every SSR'd page for ~2 weeks (jsdom can't
 * initialise on the Workers runtime). We had no equivalent of the
 * CRM's console-error gate for the public sites, so nothing caught
 * the regression. This file is that gate.
 *
 * Fixed in a10ced3 by swapping to `sanitize-html` — pure JS, works at
 * the edge. This suite would have caught that incident on the same
 * day the commit landed.
 */

const PUBLIC_PAGES = [
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About' },
  { path: '/events', label: 'Events' },
  { path: '/membership', label: 'Membership' },
  { path: '/contact', label: 'Contact' },
  { path: '/honour-board', label: 'Honour board' },
  { path: '/venue-hire', label: 'Venue hire' },
] as const

function isAllowedConsoleMessage(msg: ConsoleMessage): boolean {
  const text = msg.text()
  // Google Fonts occasionally logs a CORS warning during font swap —
  // not a page-error, doesn't affect rendering. Filter if seen.
  if (text.includes('fonts.googleapis.com')) return true
  // Pre-existing Vue hydration mismatch on `/` and `/contact` — the
  // SSR'd markup differs slightly from the client's first render.
  // Doesn't 500 or break the page (user-visible state is correct after
  // hydration), but Vue logs a console.error. Allow-listed so this
  // gate can ship and catch the bigger class of regressions (SSR
  // crashes, missing routes, broken builds); file a follow-up to
  // track down the source. Remove this filter once resolved.
  if (text.includes('Hydration completed but contains mismatches')) return true
  // 3rd-party embeds (if clubs ever add any via RichText) may log —
  // widen this filter with a comment if a real regression surfaces.
  return false
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (isAllowedConsoleMessage(msg)) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => { errors.push(err.message) })
  return errors
}

test.describe('public site smoke', () => {
  for (const { path, label } of PUBLIC_PAGES) {
    test(`${label} (${path}) renders without errors`, async ({ page }) => {
      const errors = trackConsoleErrors(page)
      const response = await page.goto(path)
      // Nitro returns a JSON error body with the 500 status on SSR
      // crashes — assert the raw HTTP first before inspecting DOM so
      // the failure message is unambiguous.
      expect(response?.status(), `HTTP status on ${path}`).toBe(200)
      // Every page emits a <title>. If this is empty the SSR'd markup
      // has lost the useSeoMeta output — usually a missing site payload.
      await expect(page).toHaveTitle(/.+/)
      await page.waitForLoadState('networkidle')
      expect(errors, `console errors on ${path}:\n${errors.join('\n')}`).toEqual([])
    })
  }

  test('OG image endpoint returns an SVG for the tenant', async ({ request }) => {
    const response = await request.get('/og.svg?label=Smoke')
    expect(response.status(), 'HTTP status on /og.svg').toBe(200)
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    const body = await response.text()
    expect(body.startsWith('<?xml'), 'SVG preamble').toBe(true)
    expect(body.includes('SMOKE'), 'label rendered').toBe(true)
  })
})
