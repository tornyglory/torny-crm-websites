import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * StripeConnectCard — the admin surface on Settings → Integrations.
 *
 * Covers:
 *   1. Not-connected state renders the Connect CTA.
 *   2. Ready state renders the masked account id + "Connected" pill +
 *      Disconnect button (only for owners).
 *   3. Clicking Connect calls `connect-start` + navigates to the
 *      authorize_url returned by the server.
 *   4. Non-owner in ready state sees an explanatory hint instead of
 *      the Disconnect button.
 */

const CLUB_ID = 1

async function seedAuthAndClub(page: Page, role: 'owner' | 'admin' = 'owner'): Promise<void> {
  await page.addInitScript((roleArg) => {
    localStorage.setItem('torny.token', 'test-jwt-token-not-real')
    localStorage.setItem('torny.user', JSON.stringify({
      id: 1, email: 'test-admin@example.com', firstName: 'Test', lastName: 'Admin',
      role: roleArg, isPlatformAdmin: false,
      clubs: [{ id: 1, name: 'Naenae Bowling Club', role: roleArg }],
    }))
    localStorage.setItem('torny.currentClub', JSON.stringify({
      id: 1, name: 'Naenae Bowling Club', slug: 'naenae',
      domain: null, brandPrimary: '#2563EB', logoUrl: null,
    }))
    localStorage.setItem('torny.crm.onboarding.1', JSON.stringify({
      data: {}, step: 'welcome', completed: true,
    }))
  }, role)
}

async function stubShellBoilerplate(page: Page): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/onboarding`, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { completed: true, completedAt: '2026-01-01T00:00:00Z', step: 'done', data: {} } }),
    })
  })
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications|venue-bookings|settings)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], bookings: [], pagination: { limit: 1, offset: 0, total: 0 }, brand: {}, membership: {}, communications: {} } }),
    })
  })
}

async function mockStripeStatus(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/stripe/status`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data }),
    })
  })
}

test.describe('Stripe Connect card', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page, 'owner')
    await stubShellBoilerplate(page)
  })

  test('not-connected state shows Connect CTA', async ({ page }) => {
    await mockStripeStatus(page, {
      connected: false,
      stripe_account_id_masked: null,
      status: 'none',
      connected_at: null,
      requirements_due: [],
    })
    await page.goto('/crm/settings')
    // Jump to the integrations pane.
    // Settings tabs are list items, not buttons — target by visible text.
    await page.locator('li.nav__item', { hasText: /integrations/i }).click()

    await expect(page.getByRole('heading', { name: /stripe payments/i })).toBeVisible()
    await expect(page.getByText('Not connected', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^connect stripe$/i })).toBeVisible()
    // Disconnect doesn't appear when nothing is connected.
    await expect(page.getByRole('button', { name: /disconnect/i })).toBeHidden()
  })

  test('ready state shows masked account id + Disconnect for owners', async ({ page }) => {
    await mockStripeStatus(page, {
      connected: true,
      stripe_account_id_masked: 'acct_1NYZ…dX4Q',
      status: 'ready',
      connected_at: '2026-11-01T00:00:00Z',
      requirements_due: [],
    })
    await page.goto('/crm/settings')
    // Settings tabs are list items, not buttons — target by visible text.
    await page.locator('li.nav__item', { hasText: /integrations/i }).click()

    await expect(page.getByText('Connected', { exact: true })).toBeVisible()
    await expect(page.getByText(/acct_1NYZ.*dX4Q/)).toBeVisible()
    await expect(page.getByRole('button', { name: /disconnect/i })).toBeVisible()
  })

  test('clicking Connect calls connect-start + navigates to authorize_url', async ({ page }) => {
    await mockStripeStatus(page, {
      connected: false,
      stripe_account_id_masked: null,
      status: 'none',
      connected_at: null,
      requirements_due: [],
    })
    // Intercept the connect-start POST + return a Stripe URL. The
    // component does `window.location.href = authorize_url` — we assert
    // that the intercepted POST fired, not that the browser actually
    // navigates (Playwright can't follow cross-origin to Stripe in a
    // test, and we don't need to).
    let startedForClubId: number | null = null
    await page.route(`**/clubs/${CLUB_ID}/stripe/connect-start`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      startedForClubId = CLUB_ID
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            // Return a localhost URL instead of connect.stripe.com so
            // the browser's cross-origin navigation doesn't fail the
            // test. The real backend returns the Stripe URL.
            authorize_url: '/crm/settings/stripe/callback?result=success&status=onboarding',
            already_connected: false,
            current_status: 'none',
          },
        }),
      })
    })

    await page.goto('/crm/settings')
    // Settings tabs are list items, not buttons — target by visible text.
    await page.locator('li.nav__item', { hasText: /integrations/i }).click()
    await page.getByRole('button', { name: /^connect stripe$/i }).click()

    await expect.poll(() => startedForClubId, { timeout: 5_000 }).toBe(CLUB_ID)
  })

  test('ready state hides Disconnect from non-owners + shows hint', async ({ page }) => {
    await seedAuthAndClub(page, 'admin')
    await mockStripeStatus(page, {
      connected: true,
      stripe_account_id_masked: 'acct_1NYZ…dX4Q',
      status: 'ready',
      connected_at: '2026-11-01T00:00:00Z',
      requirements_due: [],
    })
    await page.goto('/crm/settings')
    // Settings tabs are list items, not buttons — target by visible text.
    await page.locator('li.nav__item', { hasText: /integrations/i }).click()

    await expect(page.getByRole('button', { name: /disconnect/i })).toBeHidden()
    await expect(page.getByText(/only the club owner can disconnect/i)).toBeVisible()
  })
})
