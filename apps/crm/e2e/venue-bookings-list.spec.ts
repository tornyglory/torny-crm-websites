import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * CRM venue bookings — list screen (rewritten against brief 62 v1).
 *
 * The old implementation filtered `enquiries.list({ topic: 'facilities' })`
 * and parsed plaintext for each row. The new one reads structured
 * bookings from `venueBookings.list()` with proper workflow statuses
 * (pending / confirmed / declined / cancelled / completed).
 *
 * Covers:
 *   1. Empty state when the club has no bookings.
 *   2. Populated list renders structured fields (customer, package,
 *      slot, booking date, status pill, total $).
 *   3. Status chips drive the server query — clicking "Confirmed"
 *      fires GET with `status=confirmed`.
 *   4. Clicking a row navigates to the detail route.
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

interface BookingRow {
  id?: number
  booking_ref?: string
  status?: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed'
  full_name?: string
  package_name_snapshot?: string
  slot_label_snapshot?: string
  booking_date?: string
  total_cents?: number
}

function makeBooking(overrides: BookingRow = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? 100,
    booking_ref: overrides.booking_ref ?? 'BK-2026-55B785',
    venue_package_id: 12,
    venue_slot_id: 101,
    package_name_snapshot: overrides.package_name_snapshot ?? 'The clubhouse',
    slot_label_snapshot: overrides.slot_label_snapshot ?? 'Morning · 9am – 1pm',
    addons_snapshot: [],
    full_name: overrides.full_name ?? 'Jane Doe',
    email: 'jane@example.com',
    phone: null,
    attendee_count: 25,
    message: null,
    booking_date: overrides.booking_date ?? '2026-12-15',
    start_time: '09:00:00',
    end_time: null,
    slot_price_cents: 72000,
    addons_total_cents: 0,
    bond_cents: 30000,
    subtotal_cents: 72000,
    total_cents: overrides.total_cents ?? 102000,
    deposit_percent_snapshot: 15,
    deposit_cents: 15300,
    balance_cents: 86700,
    balance_due_date: '2026-12-01',
    platform_fee_percent_snapshot: null,
    platform_fee_cents: null,
    status: overrides.status ?? 'pending',
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
  }
}

async function mockBookingsList(
  page: Page,
  payload: { pending?: BookingRow[]; confirmed?: BookingRow[]; declined?: BookingRow[]; cancelled?: BookingRow[]; completed?: BookingRow[] },
  tracker?: { lastStatus: string | null },
): Promise<void> {
  const pendingRows = (payload.pending ?? []).map((r) => makeBooking({ ...r, status: 'pending' }))
  const confirmedRows = (payload.confirmed ?? []).map((r) => makeBooking({ ...r, status: 'confirmed' }))
  const declinedRows = (payload.declined ?? []).map((r) => makeBooking({ ...r, status: 'declined' }))
  const cancelledRows = (payload.cancelled ?? []).map((r) => makeBooking({ ...r, status: 'cancelled' }))
  const completedRows = (payload.completed ?? []).map((r) => makeBooking({ ...r, status: 'completed' }))
  const allRows = [...pendingRows, ...confirmedRows, ...declinedRows, ...cancelledRows, ...completedRows]

  await page.route(/\/clubs\/\d+\/venue-bookings(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const url = new URL(route.request().url())
    const statusParam = url.searchParams.get('status')
    if (tracker) tracker.lastStatus = statusParam

    let visible: Record<string, unknown>[]
    if (!statusParam) visible = allRows
    else {
      const wanted = new Set(statusParam.split(','))
      visible = allRows.filter((r) => wanted.has(r.status as string))
    }

    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: {
          bookings: visible,
          counts: {
            pending: pendingRows.length,
            confirmed: confirmedRows.length,
            declined: declinedRows.length,
            cancelled: cancelledRows.length,
            completed: completedRows.length,
            total: allRows.length,
          },
          pagination: { limit: 25, offset: 0, total: visible.length },
        },
      }),
    })
  })
}

test.describe('CRM venue bookings — list screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('renders empty state when the club has no bookings', async ({ page }) => {
    await mockBookingsList(page, {})
    await page.goto('/crm/venue-bookings')

    await expect(page.getByRole('heading', { name: /venue bookings/i })).toBeVisible()
    await expect(page.getByText(/no bookings yet|inbox zero/i).first()).toBeVisible()
  })

  test('renders structured booking rows', async ({ page }) => {
    await mockBookingsList(page, {
      pending: [
        { id: 42, booking_ref: 'BK-2026-AAA', full_name: 'Jane Doe', package_name_snapshot: 'The clubhouse', slot_label_snapshot: 'Morning · 9am – 1pm', booking_date: '2026-12-15', total_cents: 102000 },
        { id: 43, booking_ref: 'BK-2026-BBB', full_name: 'Peter Smith', package_name_snapshot: 'Green + BBQ', slot_label_snapshot: 'Afternoon · 2pm – 6pm', booking_date: '2027-01-10', total_cents: 50000 },
      ],
      confirmed: [
        { id: 50, booking_ref: 'BK-2026-CCC', full_name: 'Ruth Willis', package_name_snapshot: 'The clubhouse', slot_label_snapshot: 'Evening · 6pm – 11pm', booking_date: '2026-12-20', total_cents: 150000 },
      ],
    })
    await page.goto('/crm/venue-bookings')

    // Pending status is the default filter — Jane and Peter show, Ruth hidden.
    await expect(page.getByText('Jane Doe')).toBeVisible()
    await expect(page.getByText('Peter Smith')).toBeVisible()
    await expect(page.getByText('The clubhouse').first()).toBeVisible()
    await expect(page.getByText(/morning · 9am – 1pm/i)).toBeVisible()
    // Formatted booking date (local or iso — accept both).
    await expect(page.getByText(/15 dec|2026-12-15/i).first()).toBeVisible()
    // Total dollar value shown on the row.
    await expect(page.getByText(/\$1,?020/).first()).toBeVisible()
  })

  test('status chips drive the server query', async ({ page }) => {
    const tracker: { lastStatus: string | null } = { lastStatus: null }
    await mockBookingsList(page, {
      pending: [{ id: 42, full_name: 'Jane Doe' }],
      confirmed: [{ id: 50, full_name: 'Ruth Willis' }],
    }, tracker)
    await page.goto('/crm/venue-bookings')

    // Default is Pending — we should have issued GET with status=pending.
    await expect
      .poll(() => tracker.lastStatus, { timeout: 5_000 })
      .toBe('pending')
    await expect(page.getByText('Jane Doe')).toBeVisible()
    await expect(page.getByText('Ruth Willis')).toBeHidden()

    // Click Confirmed chip → GET with status=confirmed, Ruth visible,
    // Jane hidden.
    await page.getByRole('button', { name: /^confirmed/i }).click()
    await expect
      .poll(() => tracker.lastStatus, { timeout: 5_000 })
      .toBe('confirmed')
    await expect(page.getByText('Ruth Willis')).toBeVisible()
    await expect(page.getByText('Jane Doe')).toBeHidden()
  })

  test('clicking a row navigates to the detail route', async ({ page }) => {
    await mockBookingsList(page, {
      pending: [{ id: 42, full_name: 'Jane Doe' }],
    })
    await page.goto('/crm/venue-bookings')
    await page.getByText('Jane Doe').click()
    await expect(page).toHaveURL(/\/crm\/venue-bookings\/42$/)
  })
})
