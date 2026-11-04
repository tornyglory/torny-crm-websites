import { test, expect, type Page } from '@playwright/test'

/**
 * Stripe OAuth Connect callback page.
 *
 * Covers:
 *   - success + ready status renders the success state + "back to settings" CTA
 *   - success + onboarding status renders the "finish in Stripe" state
 *   - error renders the error state with the Stripe error code if present
 *
 * No API calls — the backend has already finished the OAuth dance and
 * updated the DB before redirecting here. This page just reads the
 * query string and shows status.
 */

async function seedAuthAndClub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('torny.token', 'test-jwt-token-not-real')
    localStorage.setItem('torny.user', JSON.stringify({
      id: 1, email: 'test-admin@example.com', firstName: 'Test', lastName: 'Admin',
      role: 'admin', isPlatformAdmin: false,
      clubs: [{ id: 1, name: 'Naenae Bowling Club', role: 'admin' }],
    }))
    localStorage.setItem('torny.currentClub', JSON.stringify({
      id: 1, name: 'Naenae Bowling Club', slug: 'naenae',
      domain: null, brandPrimary: '#2563EB', logoUrl: null,
    }))
    localStorage.setItem('torny.crm.onboarding.1', JSON.stringify({
      data: {}, step: 'welcome', completed: true,
    }))
  })
}

async function stubShellBoilerplate(page: Page): Promise<void> {
  await page.route(`**/clubs/1/onboarding`, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { completed: true, completedAt: '2026-01-01T00:00:00Z', step: 'done', data: {} } }),
    })
  })
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications|venue-bookings)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], bookings: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

test.describe('Stripe Connect callback', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('success + ready renders connected state', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=success&club_id=1&status=ready')
    // Assert fast — the view auto-redirects to /crm/settings after 2s.
    await expect(page.getByRole('heading', { name: /stripe connected/i })).toBeVisible({ timeout: 1_500 })
    await expect(page.getByText(/accept deposits/i)).toBeVisible()
  })

  test('success + onboarding renders "finish setup" state', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=success&club_id=1&status=onboarding')
    await expect(page.getByRole('heading', { name: /almost there|finish setup/i })).toBeVisible()
    await expect(page.getByText(/finish setting up|stripe dashboard/i)).toBeVisible()
  })

  test('error access_denied renders cancellation copy', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=error&code=access_denied')
    await expect(page.getByRole('heading', { name: /connection cancelled/i })).toBeVisible()
    await expect(page.getByText(/cancelled the connection/i)).toBeVisible()
    await expect(page.getByText('access_denied')).toBeVisible()
  })

  test('error bad_state renders expired-link copy', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=error&code=bad_state')
    await expect(page.getByRole('heading', { name: /link expired/i })).toBeVisible()
    await expect(page.getByText(/15 minutes/i)).toBeVisible()
  })

  test('error stripe_exchange_failed shows description when present', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=error&code=stripe_exchange_failed&description=Account+not+verified')
    await expect(page.getByText(/Account not verified/)).toBeVisible()
    await expect(page.getByText('stripe_exchange_failed')).toBeVisible()
  })

  test('restricted status renders attention copy', async ({ page }) => {
    await page.goto('/crm/settings/stripe/callback?result=success&club_id=1&status=restricted')
    await expect(page.getByRole('heading', { name: /restricted your account/i })).toBeVisible()
  })
})
