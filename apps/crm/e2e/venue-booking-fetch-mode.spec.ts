import { test, expect, type Route } from '@playwright/test'

/**
 * Public venue booking wizard — fetch mode (brief 73).
 *
 * The booking block now opts into pulling packages from the
 * `publicVenuePackages.list` endpoint when `fetchPackages: true`
 * (book.vue flipped this on). This test verifies two things:
 *
 *   1. Fetched packages override the hard-coded prop fallback: when the
 *      fetch returns a package with a distinctive name, that name shows
 *      up on the booking summary (NOT the fallback "The clubhouse").
 *   2. When the fetch returns `settings.is_active: false`, the wizard
 *      renders the "temporarily unavailable" state instead of step 1.
 *
 * Skips when the sites server + the real tenant aren't reachable (same
 * guard as `venue-booking-public.spec.ts`).
 */

const SITES_URL = 'http://localhost:3001'
const BOOK_URL = `${SITES_URL}/venue-hire/book?host=nae-nae-bowling-club.torny.co`
const CLUB_SLUG = 'nae-nae-bowling-club'

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(BOOK_URL, { method: 'GET' })
    return res.status === 200
  } catch {
    return false
  }
}

test.describe('Public venue booking — fetch mode', () => {
  test.beforeAll(async () => {
    const ok = await reachable()
    test.skip(!ok, 'Sites dev server unreachable or tenant not seeded — see venue-booking-public.spec.ts for guidance.')
  })

  test('fetched packages override the hard-coded fallback', async ({ page }) => {
    await page.route(`**/public/clubs/${CLUB_SLUG}/venue-packages`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            packages: [
              {
                id: 99,
                slug: 'the-garden-pavilion',
                name: 'The garden pavilion',
                sub: 'All-weather outdoor space',
                description: 'Covered pavilion with heaters.',
                hero_image_url: null,
                hero_image_alt: null,
                bond_cents: 20000,
                bond_label: 'Refundable bond',
                display_order: 10,
                slots: [
                  { id: 1, label: 'Pavilion afternoon · 2pm – 6pm', sub: '4 hours · $500', price_cents: 50000, duration_hours: 4, default_start_time: '14:00', display_order: 10 },
                ],
                addons: [],
              },
            ],
            settings: {
              deposit_percent: 15,
              balance_due_days_before: 14,
              is_active: true,
            },
          },
        }),
      })
    })

    await page.goto(BOOK_URL)
    // The booking summary rail renders the selected package's name. The
    // fetched package is picked by default (first in the list), so we
    // should see the garden pavilion, not the hard-coded clubhouse.
    await expect(page.getByText(/garden pavilion/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('The clubhouse')).toBeHidden()
  })

  test('venue hire paused: renders unavailable state', async ({ page }) => {
    await page.route(`**/public/clubs/${CLUB_SLUG}/venue-packages`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            packages: [],
            settings: {
              deposit_percent: 15,
              balance_due_days_before: 14,
              is_active: false,
            },
          },
        }),
      })
    })

    await page.goto(BOOK_URL)
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible({ timeout: 10_000 })
    // The step rail from the normal wizard isn't rendered.
    await expect(page.getByRole('heading', { name: /when are you thinking/i })).toBeHidden()
  })
})
