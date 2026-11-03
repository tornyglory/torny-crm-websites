import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * CRM venue bookings — detail screen (brief 62 v1).
 *
 * Covers:
 *   1. Loads structured fields (customer, package, slot, date,
 *      pricing breakdown) from `venueBookings.get`.
 *   2. Confirm button fires POST .../confirm and the view
 *      re-renders with the new status.
 *   3. Decline flow captures a reason + fires POST .../decline.
 *   4. Cancel from confirmed → POST .../cancel + re-render.
 *   5. Delete → DELETE request + navigate back to list.
 */

const CLUB_ID = 1
const BOOKING_ID = 42

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

function makeBooking(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BOOKING_ID,
    booking_ref: 'BK-2026-55B785',
    venue_package_id: 12,
    venue_slot_id: 101,
    package_name_snapshot: 'The clubhouse',
    slot_label_snapshot: 'Morning · 9am – 1pm',
    addons_snapshot: [
      { addon_id: 201, name: 'Grazing platters', price_cents: 8500, price_suffix: '/ platter', quantity: 3, line_cents: 25500 },
    ],
    full_name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '021 123 4567',
    attendee_count: 25,
    message: 'Please leave the back room free for presents.',
    booking_date: '2026-12-15',
    start_time: '09:00:00',
    end_time: null,
    slot_price_cents: 72000,
    addons_total_cents: 25500,
    bond_cents: 30000,
    subtotal_cents: 97500,
    total_cents: 127500,
    deposit_percent_snapshot: 15,
    deposit_cents: 19125,
    balance_cents: 108375,
    balance_due_date: '2026-12-01',
    platform_fee_percent_snapshot: null,
    platform_fee_cents: null,
    status: 'pending',
    payment_status: 'unpaid',
    admin_notes: null,
    confirmed_at: null,
    confirmed_by_user_id: null,
    declined_at: null,
    declined_by_user_id: null,
    decline_reason: null,
    cancelled_at: null,
    cancelled_by_user_id: null,
    source: 'public_submit',
    created_at: '2026-11-03T04:12:00.000Z',
    updated_at: '2026-11-03T04:12:00.000Z',
    ...overrides,
  }
}

async function mockBookingGet(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/venue-bookings/${BOOKING_ID}`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data }),
    })
  })
}

test.describe('CRM venue booking — detail screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('renders structured fields from the booking row', async ({ page }) => {
    await mockBookingGet(page, makeBooking())
    await page.goto(`/crm/venue-bookings/${BOOKING_ID}`)

    await expect(page.getByRole('heading', { name: /jane doe/i })).toBeVisible()
    await expect(page.getByText('BK-2026-55B785')).toBeVisible()
    await expect(page.getByText('The clubhouse').first()).toBeVisible()
    await expect(page.getByText(/morning · 9am – 1pm/i)).toBeVisible()
    // Pricing breakdown: deposit $191.25, balance $1083.75, total $1275.
    await expect(page.getByText(/\$1,?275/).first()).toBeVisible()
    // Addon snapshot rendered as a line item.
    await expect(page.getByText(/grazing platters/i)).toBeVisible()
    // Message from the customer.
    await expect(page.getByText(/leave the back room free/i)).toBeVisible()
  })

  test('confirm button flips status + re-renders', async ({ page }) => {
    // Track which endpoint the button hit.
    let confirmed = false
    await page.route(`**/clubs/${CLUB_ID}/venue-bookings/${BOOKING_ID}/confirm`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      confirmed = true
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: makeBooking({ status: 'confirmed', confirmed_at: '2026-11-04T12:00:00Z' }) }),
      })
    })
    await mockBookingGet(page, makeBooking())
    await page.goto(`/crm/venue-bookings/${BOOKING_ID}`)

    await page.getByRole('button', { name: /^confirm/i }).click()

    await expect.poll(() => confirmed, { timeout: 5_000 }).toBe(true)
    // The status pill flips to Confirmed.
    await expect(page.getByText(/confirmed/i).first()).toBeVisible()
  })

  test('decline flow captures a reason', async ({ page }) => {
    let declinedBody: Record<string, unknown> | null = null
    await page.route(`**/clubs/${CLUB_ID}/venue-bookings/${BOOKING_ID}/decline`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      declinedBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: makeBooking({ status: 'declined', decline_reason: (declinedBody as { reason?: string } | null)?.reason ?? null }) }),
      })
    })
    await mockBookingGet(page, makeBooking())
    await page.goto(`/crm/venue-bookings/${BOOKING_ID}`)

    await page.getByRole('button', { name: /^decline/i }).click()
    // Decline opens a modal with an optional reason field.
    await page.getByLabel(/reason/i).fill('Already booked for a wedding.')
    // Dialog's "Decline" button submits.
    await page.getByRole('button', { name: /confirm decline|decline booking/i }).click()

    await expect.poll(() => declinedBody, { timeout: 5_000 }).not.toBeNull()
    expect(declinedBody).toMatchObject({ reason: 'Already booked for a wedding.' })
  })

  test('cancel on a confirmed booking fires the cancel endpoint', async ({ page }) => {
    let cancelled = false
    await page.route(`**/clubs/${CLUB_ID}/venue-bookings/${BOOKING_ID}/cancel`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      cancelled = true
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: makeBooking({ status: 'cancelled', cancelled_at: '2026-11-04T12:00:00Z' }) }),
      })
    })
    await mockBookingGet(page, makeBooking({ status: 'confirmed', confirmed_at: '2026-11-04T10:00:00Z' }))
    await page.goto(`/crm/venue-bookings/${BOOKING_ID}`)

    await page.getByRole('button', { name: /^cancel booking/i }).click()
    // Confirm inside the modal.
    await page.getByRole('button', { name: /confirm cancellation|cancel it/i }).click()

    await expect.poll(() => cancelled, { timeout: 5_000 }).toBe(true)
  })

  test('delete fires DELETE then navigates back to the list', async ({ page }) => {
    let deleted = false
    await page.route(`**/clubs/${CLUB_ID}/venue-bookings/${BOOKING_ID}`, async (route: Route) => {
      const method = route.request().method()
      if (method === 'DELETE') {
        deleted = true
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { deleted: true, booking_id: BOOKING_ID } }),
        })
        return
      }
      if (method === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: makeBooking() }),
        })
        return
      }
      return route.fallback()
    })
    await page.goto(`/crm/venue-bookings/${BOOKING_ID}`)

    // Delete action is behind the overflow menu to avoid foot-guns.
    await page.getByRole('button', { name: /booking actions menu/i }).click()
    await page.getByRole('button', { name: /delete booking/i }).click()
    // Confirm delete in modal.
    await page.getByRole('button', { name: /confirm delete|delete permanently/i }).click()

    await expect.poll(() => deleted, { timeout: 5_000 }).toBe(true)
    await expect(page).toHaveURL(/\/crm\/venue-bookings$/)
  })
})
