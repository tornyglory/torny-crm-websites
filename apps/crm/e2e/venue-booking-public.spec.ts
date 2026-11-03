import { test, expect, type Route } from '@playwright/test'

/**
 * Public venue-hire booking wizard — Phase A characterisation.
 *
 * These tests drive the three-step wizard against the running Nuxt site
 * on `localhost:3001`. The `?host=naenae.torny.co` query override tells
 * the tenant middleware which club to serve. Browser-side API calls land
 * at the production CRM API by default; we intercept them so the test
 * never hits prod.
 *
 * Requires `pnpm dev:sites` running separately (CRM webServer in
 * playwright.config.ts only covers 5174). The suite skips with a clear
 * message if 3001 is unreachable so this file doesn't fail CI on
 * machines without the sites server up.
 */

const SITES_URL = 'http://localhost:3001'
/** The club seeded in prod for the Naenae tenant. Backend's
 *  `/clubs/resolve?host=` only knows about hosts that match a registered
 *  `primary_host` row — currently `nae-nae-bowling-club.torny.co`
 *  (NOT `naenae.torny.co`). */
const BOOK_URL = `${SITES_URL}/venue-hire/book?host=nae-nae-bowling-club.torny.co`
const CLUB_SLUG = 'nae-nae-bowling-club'

interface ReachabilityResult {
  reachable: boolean
  reason: string | null
}

/** Called from `test.beforeAll` so the skip reason surfaces once per
 *  file instead of per test. Two separate failure modes:
 *   - Sites server not running on :3001 → start `pnpm dev:sites`.
 *   - Server running but naenae.torny.co isn't a known tenant → the
 *     backend's `/clubs/resolve` has no row for that host. Seed one
 *     (or point the test at a slug that is seeded) before un-skipping.
 */
async function checkReachability(): Promise<ReachabilityResult> {
  try {
    const res = await fetch(BOOK_URL, { method: 'GET' })
    if (res.status === 200) return { reachable: true, reason: null }
    if (res.status === 404) {
      return {
        reachable: false,
        reason: `Backend has no club seeded for the host in BOOK_URL — \`/clubs/resolve\` returns \`unknown_host\`. Confirm \`${CLUB_SLUG}\` is still registered or update BOOK_URL.`,
      }
    }
    return { reachable: false, reason: `Unexpected status ${res.status} from ${BOOK_URL}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { reachable: false, reason: `Nuxt sites dev server not reachable (${msg}) — start with \`pnpm dev:sites\`.` }
  }
}

test.describe('Public venue booking wizard', () => {
  test.beforeAll(async () => {
    const { reachable, reason } = await checkReachability()
    test.skip(!reachable, reason ?? 'unreachable')
  })

  test('completes all three steps + submits structured venue_bookings payload', async ({ page }) => {
    // Mock the packages fetch so the block knows package_id + slot_id.
    await page.route(`**/public/clubs/${CLUB_SLUG}/venue-packages`, async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            packages: [
              {
                id: 12,
                slug: 'the-clubhouse',
                name: 'The clubhouse',
                sub: 'Timber-lined main room',
                description: null,
                hero_image_url: null,
                hero_image_alt: null,
                bond_cents: 30000,
                bond_label: 'Refundable bond',
                display_order: 10,
                slots: [
                  { id: 101, label: 'Morning · 9am – 1pm', sub: '4 hours · $720', price_cents: 72000, duration_hours: 4, default_start_time: '09:00', display_order: 10 },
                ],
                addons: [],
              },
            ],
            settings: { deposit_percent: 15, balance_due_days_before: 14, is_active: true },
          },
        }),
      })
    })

    // Capture the structured venue_bookings submit body.
    let submittedBody: Record<string, unknown> | null = null
    await page.route(`**/public/clubs/${CLUB_SLUG}/venue-bookings`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      submittedBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            id: 777,
            booking_ref: 'BK-2026-XYZ',
            venue_package_id: 12,
            venue_slot_id: 101,
            package_name_snapshot: 'The clubhouse',
            slot_label_snapshot: 'Morning · 9am – 1pm',
            addons_snapshot: [],
            full_name: 'Ruth Willis',
            email: 'ruth@example.co.nz',
            phone: null,
            attendee_count: 25,
            message: null,
            booking_date: '2027-01-01',
            start_time: '09:00:00', end_time: null,
            slot_price_cents: 72000,
            addons_total_cents: 0,
            bond_cents: 30000,
            subtotal_cents: 72000,
            total_cents: 102000,
            deposit_percent_snapshot: 15,
            deposit_cents: 15300,
            balance_cents: 86700,
            balance_due_date: null,
            platform_fee_percent_snapshot: null, platform_fee_cents: null,
            status: 'pending', payment_status: 'unpaid',
            admin_notes: null,
            confirmed_at: null, confirmed_by_user_id: null,
            declined_at: null, declined_by_user_id: null, decline_reason: null,
            cancelled_at: null, cancelled_by_user_id: null,
            source: 'public_submit',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }),
      })
    })

    await page.goto(BOOK_URL)

    // ── Step 1: pick the first available (free) date + first non-disabled slot.
    await expect(page.getByRole('heading', { name: /when are you thinking/i })).toBeVisible()
    const firstFreeDay = page.locator('button.vb__cal-day--free').first()
    await firstFreeDay.click()
    const firstSlot = page.locator('li.vb__slot:not(.vb__slot--disabled)').first()
    await firstSlot.click()
    await page.getByRole('button', { name: /continue to details/i }).click()

    // ── Step 2: fill minimum required fields + submit.
    await expect(page.getByRole('heading', { name: /tell us about your event/i })).toBeVisible()
    await page.getByPlaceholder('Ruth Willis').fill('Ruth Willis')
    await page.getByPlaceholder('you@example.co.nz').fill('ruth@example.co.nz')
    await page.getByRole('button', { name: /confirm booking|book now|send booking/i }).click()

    // ── Step 3: confirmation renders with the server-returned ref.
    await expect(page.getByText(/you'?re booked in/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/booking confirmed/i)).toBeVisible()
    // Booking ref comes from the server now — our mock returns BK-2026-XYZ.
    await expect(page.getByText(/BK-2026-XYZ/)).toBeVisible()

    // ── Assert on the structured submit body.
    await expect
      .poll(() => submittedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = submittedBody as unknown as {
      full_name: string
      email: string
      package_id: number
      slot_id: number
      booking_date: string
      addons?: unknown[]
    }
    expect(body.full_name).toBe('Ruth Willis')
    expect(body.email).toBe('ruth@example.co.nz')
    expect(body.package_id, 'structured submit must carry package_id').toBe(12)
    expect(body.slot_id, 'structured submit must carry slot_id').toBe(101)
    expect(body.booking_date, 'booking_date is YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
