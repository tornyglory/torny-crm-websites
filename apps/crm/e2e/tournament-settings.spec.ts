import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Tournament settings — admin surface at /crm/tournaments/settings.
 *
 * Covers: load the current settings, display the platform fee as
 * read-only ($1 default from brief), toggle is_active + PATCH on save.
 */

const CLUB_ID = 1

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
  await page.route(`**/clubs/${CLUB_ID}/onboarding`, async (route) => {
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

test.describe('Tournament settings', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('loads settings, shows $1 platform fee, saves is_active toggle', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(`**/clubs/${CLUB_ID}/tournament-settings`, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: {
              platform_fee_cents: 100,
              is_active: true,
              updated_at: '2026-10-28T00:00:00Z',
            },
          }),
        })
        return
      }
      if (method === 'PATCH') {
        patchedBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: {
              platform_fee_cents: 100,
              is_active: patchedBody.is_active ?? true,
              updated_at: '2026-11-04T00:00:00Z',
            },
          }),
        })
        return
      }
      return route.fallback()
    })

    await page.goto('/crm/tournaments/settings')
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible()
    await expect(page.getByText(/\$1\.00/)).toBeVisible()
    await expect(page.getByText(/entries are open/i)).toBeVisible()

    // Toggle off and save.
    await page.locator('button.switch').first().click()
    await page.getByRole('button', { name: /save settings/i }).click()

    await expect.poll(() => patchedBody, { timeout: 5_000 }).not.toBeNull()
    expect(patchedBody).toMatchObject({ is_active: false })
  })
})
