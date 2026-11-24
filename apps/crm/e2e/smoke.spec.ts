import { test, expect, type ConsoleMessage } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Baseline smoke tests.
 *
 * These are the two "always true" assertions about the CRM. If either fails
 * something fundamental has broken — bad router config, missing dependency,
 * syntax error on an entrypoint file, etc. Keep them cheap and keep them
 * green; richer flows live in sibling spec files.
 *
 * **Console-error policy.** Every test captures console errors and fails if
 * any are logged. This is how we catch "silently rendered but broken" UI
 * regressions — the kind we spent an hour chasing on the OPEN RATE hero
 * card. If a legitimate warning starts firing in dev (e.g. Vue devtools
 * noise), filter it in `isAllowedConsoleMessage` with a comment explaining
 * why.
 */

function isAllowedConsoleMessage(msg: ConsoleMessage): boolean {
  const text = msg.text()
  // Vite's dev HMR websocket warnings during route changes.
  if (text.includes('[vite]')) return true
  // Vue devtools recommendation banner.
  if (text.includes('You are running a development build of Vue')) return true
  return false
}

function trackConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (isAllowedConsoleMessage(msg)) return
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => { errors.push(err.message) })
  return errors
}

test.describe('smoke', () => {
  test('sign-in page renders without console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /sign in to torny/i })).toBeVisible()
    await expect(page.getByPlaceholder('you@yourclub.co.nz')).toBeVisible()
    // Give any async hydration a frame to settle, then assert clean console.
    await page.waitForLoadState('networkidle')
    expect(errors, `console errors on sign-in page:\n${errors.join('\n')}`).toEqual([])
  })

  test('protected route redirects unauthed user to sign-in', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await page.goto('/crm/members')
    // Router guard redirects to `/?redirect=/crm/members` — the sign-in
    // page preserving the original destination so sign-in can return
    // the user there. Assert on the heading (strongest signal that we're
    // actually on the sign-in page) and on the preserved redirect query.
    await expect(page.getByRole('heading', { name: /sign in to torny/i })).toBeVisible()
    await expect(page).toHaveURL(/\?redirect=\/crm\/members/)
    expect(errors, `console errors during redirect:\n${errors.join('\n')}`).toEqual([])
  })

  /**
   * Accessibility baseline for the sign-in page.
   *
   * Runs axe-core at WCAG 2.1 A + AA level. Serious + critical violations
   * fail the suite — moderate/minor are reported for triage but don't block.
   *
   * This is the entry point every CRM user hits, so any regression here
   * is user-visible. Once this test is green, duplicate the pattern across
   * authenticated flows as they come online.
   */
  test('sign-in page passes axe-core WCAG A + AA baseline', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /sign in to torny/i })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )

    if (blocking.length > 0) {
      const summary = blocking
        .map((v) => `[${v.impact}] ${v.id} — ${v.help}\n  ${v.nodes.length} node(s): ${v.nodes[0]?.target.join(' ')}`)
        .join('\n\n')
      throw new Error(`axe-core found ${blocking.length} blocking violation(s):\n\n${summary}`)
    }
  })
})
