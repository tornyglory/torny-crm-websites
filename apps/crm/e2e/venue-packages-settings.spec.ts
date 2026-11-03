import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Venue packages — settings screen.
 *
 * One tight scenario: the form loads the current settings via
 * `getSettings` (which lazy-upserts server-side), lets the admin edit
 * the three writable fields, PATCHes back on save, and shows the
 * platform-fee read-only callout so admins know what Torny takes even
 * though the field isn't editable yet.
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
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { new: 0, pending: 0, total: 0 }, enquiries: [], applications: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

test.describe('Venue packages — settings screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('loads current settings, saves changes, shows platform fee callout', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(`**/clubs/${CLUB_ID}/venue-settings`, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: {
              deposit_percent: 15,
              balance_due_days_before: 14,
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
              deposit_percent: patchedBody.deposit_percent ?? 15,
              balance_due_days_before: patchedBody.balance_due_days_before ?? 14,
              is_active: patchedBody.is_active ?? true,
              updated_at: '2026-11-03T00:00:00Z',
            },
          }),
        })
        return
      }
      return route.fallback()
    })

    await page.goto('/crm/venue-packages/settings')

    // Fields hydrated from the server response.
    const depositInput = page.getByLabel(/deposit/i)
    await expect(depositInput).toHaveValue('15')
    const dueInput = page.getByLabel(/balance.*days|due.*days/i)
    await expect(dueInput).toHaveValue('14')

    // Platform fee callout — admins must see what Torny takes.
    await expect(page.getByText(/5\s*%|platform fee/i).first()).toBeVisible()

    // Edit + save.
    await depositInput.fill('20')
    await dueInput.fill('21')
    await page.getByRole('button', { name: /save/i }).click()

    // PATCH body matches the edits.
    await expect
      .poll(() => patchedBody, { timeout: 5_000 })
      .not.toBeNull()
    expect(patchedBody).toMatchObject({
      deposit_percent: 20,
      balance_due_days_before: 21,
    })
  })
})
