import { test, expect, type ConsoleMessage } from '@playwright/test'

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
})
