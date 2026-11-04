import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Venue booking lifecycle — end-to-end demo.
 *
 * Mirrors `tournament-lifecycle.spec.ts`. Walks the full admin flow
 * with mocked backend so the chain runs deterministically + captures
 * a visible storyboard of PNGs:
 *
 *   1. Admin opens the Venue bookings inbox (empty)
 *   2. A public booking lands — pending state
 *   3. Admin opens the detail view, sees structured booking + deposit
 *      breakdown
 *   4. Admin clicks Confirm → POST fires, response carries a Stripe
 *      Checkout session_id + checkout_url (brief 72 PR #2)
 *   5. Customer pays (simulated) — webhook flips payment_status to
 *      `deposit_paid`, deposit_paid_at populates
 *   6. Admin re-fetches, sees Deposit paid chip + the Refund button
 *   7. Admin clicks Refund → modal explains refund_application_fee,
 *      confirms → POST /refund fires
 *
 * Every milestone writes a PNG to `test-results/venue-booking-demo/`.
 */

const CLUB_ID = 1
const BOOKING_ID = 7777

const DEMO_DIR = path.join(__dirname, '..', 'test-results', 'venue-booking-demo')
mkdirSync(DEMO_DIR, { recursive: true })

async function snap(page: Page, label: string): Promise<void> {
  await page.screenshot({ path: path.join(DEMO_DIR, `${label}.png`), fullPage: true })
}

async function seedAuthAndClub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('torny.token', 'test-jwt-token-not-real')
    localStorage.setItem('torny.user', JSON.stringify({
      id: 1, email: 'test-admin@example.com', firstName: 'Nev', lastName: 'Rodda',
      role: 'owner', isPlatformAdmin: false,
      clubs: [{ id: 1, name: 'Naenae Bowling Club', role: 'owner' }],
    }))
    localStorage.setItem('torny.currentClub', JSON.stringify({
      id: 1, name: 'Naenae Bowling Club', slug: 'naenae',
      domain: null, brandPrimary: '#145320', logoUrl: null,
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
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

/**
 * Full booking shape. Uses defaults that match a "Willis wedding, The
 * clubhouse, afternoon slot" scenario so the admin screens render
 * meaningful numbers. Override fields in each test phase to simulate
 * webhook transitions.
 */
function bookingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    booking_ref: 'BK-2026-NAE42',
    venue_package_id: 12,
    venue_slot_id: 101,
    package_name_snapshot: 'The clubhouse',
    slot_label_snapshot: 'Afternoon · 2pm – 6pm',
    addons_snapshot: [
      { addon_id: 201, name: 'Grazing platters', price_cents: 8500, price_suffix: '/ platter', quantity: 6, line_cents: 51000 },
      { addon_id: 203, name: 'Bar tab · Prepaid', price_cents: 40000, price_suffix: null, quantity: 1, line_cents: 40000 },
    ],
    full_name: 'Ruth Willis',
    email: 'ruth@willisfamily.co.nz',
    phone: '021 555 1234',
    attendee_count: 72,
    message: 'Low-wheat catering requested. Will drop off decorations Friday afternoon — happy to coordinate with the host.',
    booking_date: '2026-12-20',
    start_time: '14:00:00',
    end_time: null,
    slot_price_cents: 72000,
    addons_total_cents: 91000,
    bond_cents: 30000,
    subtotal_cents: 163000,
    total_cents: 193000,
    deposit_percent_snapshot: 15,
    deposit_cents: 28950,
    balance_cents: 164050,
    balance_due_date: '2026-12-06',
    platform_fee_percent_snapshot: null,
    platform_fee_cents: null,
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    stripe_refund_id: null,
    deposit_paid_at: null,
    refunded_at: null,
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
    created_at: '2026-11-05T05:14:00.000Z',
    updated_at: '2026-11-05T05:14:00.000Z',
    ...overrides,
  }
}

test.describe('Venue booking lifecycle — demo', () => {
  test('pending → admin confirms → deposit paid → admin refunds', async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)

    // Current booking state — mutated in place as the test marches
    // through the lifecycle.
    let current = bookingFixture()

    // ── List endpoint ─────────────────────────────────────────
    await page.route(/\/clubs\/\d+\/venue-bookings(\?.*)?$/, async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      // Admin-side list — just surfaces the current booking (filtered
      // by status in a real backend; mock ignores params for simplicity).
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            bookings: [current],
            counts: {
              pending:   current.status === 'pending'   ? 1 : 0,
              confirmed: current.status === 'confirmed' ? 1 : 0,
              declined:  0, cancelled: 0, completed: 0,
              total: 1,
            },
            pagination: { limit: 25, offset: 0, total: 1 },
          },
        }),
      })
    })

    // ── Detail endpoint + transition actions ──────────────────
    await page.route(new RegExp(`/clubs/\\d+/venue-bookings/${BOOKING_ID}$`), async (route: Route) => {
      const m = route.request().method()
      if (m === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: current }),
        })
        return
      }
      return route.fallback()
    })

    // ── Phase 1: empty-ish inbox, pending booking shown ───────
    await page.goto('/crm/venue-bookings')
    await expect(page.getByRole('heading', { name: /venue bookings/i })).toBeVisible()
    await expect(page.getByText('Ruth Willis')).toBeVisible()
    await snap(page, '01-pending-inbox')

    // ── Phase 2: admin opens the detail view ──────────────────
    await page.getByText('Ruth Willis').click()
    await expect(page).toHaveURL(new RegExp(`/crm/venue-bookings/${BOOKING_ID}`))
    await expect(page.getByRole('heading', { name: /ruth willis/i })).toBeVisible()
    await expect(page.getByText(/the clubhouse/i).first()).toBeVisible()
    await expect(page.getByText('BK-2026-NAE42')).toBeVisible()
    await snap(page, '02-detail-pending')

    // ── Phase 3: admin clicks Confirm → Stripe Checkout mint ──
    await page.route(new RegExp(`/clubs/\\d+/venue-bookings/${BOOKING_ID}/confirm$`), async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      // Backend: snapshots the fee, mints a Checkout session, returns
      // the booking with checkout_url (transient) + session_id.
      current = {
        ...current,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by_user_id: 1,
        platform_fee_percent_snapshot: 5,
        platform_fee_cents: Math.round(current.deposit_cents * 0.05),
        stripe_checkout_session_id: 'cs_test_naenae_42abc',
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_naenae_42abc',
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: current }),
      })
    })

    await page.getByRole('button', { name: /^confirm$/i }).click()
    await expect(page.getByText(/confirmed/i).first()).toBeVisible()
    await snap(page, '03-confirmed-stripe-session-minted')

    // ── Phase 4: simulate checkout.session.completed webhook ──
    // The webhook flips payment_status to deposit_paid + stamps
    // deposit_paid_at + populates stripe_payment_intent_id.
    current = {
      ...current,
      payment_status: 'deposit_paid',
      deposit_paid_at: new Date().toISOString(),
      stripe_payment_intent_id: 'pi_3ABC_naenae_42xyz',
      checkout_url: null, // transient — stripped on GETs
    }
    await page.reload()
    // Right rail should now show "Confirmed" and the Refund button
    // appears alongside the existing Cancel button.
    await expect(page.getByRole('button', { name: /refund deposit/i })).toBeVisible()
    await snap(page, '04-deposit-paid-webhook')

    // ── Phase 5: admin clicks Refund → modal → confirm ────────
    let refundFired = false
    await page.route(new RegExp(`/clubs/\\d+/venue-bookings/${BOOKING_ID}/refund$`), async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      refundFired = true
      current = {
        ...current,
        stripe_refund_id: 're_3ABC_naenae_refund',
        // status + refunded_at populate via webhook — stays deposit_paid
        // until charge.refunded fires. Admin UI copy explains this.
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: current }),
      })
    })

    await page.getByRole('button', { name: /refund deposit/i }).click()
    await expect(page.getByRole('heading', { name: /refund ruth willis/i })).toBeVisible()
    await snap(page, '05-refund-modal')

    await page.getByRole('button', { name: /confirm refund/i }).click()
    await expect.poll(() => refundFired, { timeout: 5_000 }).toBe(true)
    await snap(page, '06-refund-submitted')
  })
})
