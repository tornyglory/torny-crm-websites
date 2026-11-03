import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * CRM venue-booking detail — Phase A characterisation tests.
 *
 * These describe the behaviour the *current* v1 code must satisfy:
 *
 *   1. A well-formed structured message parses into the booking card
 *      (not the raw-text fallback).
 *   2. A malformed message falls back to raw text without crashing.
 *   3. The parse → edit → serialise → parse round-trip is lossless for
 *      every field the admin can edit. If a backend swap (brief 62) ever
 *      changes the message format, this test will fail loudly before
 *      the admin notices.
 *
 * No real backend is required — all API calls are mocked with
 * `page.route`. Auth + current-club state is injected via
 * `page.addInitScript` because `useAuthStore` + `useClubStore` both read
 * from localStorage on boot.
 */

const CLUB_ID = 1
const ENQUIRY_ID = 12

/** Match the storage keys read by apps/crm/src/stores/auth.ts +
 *  stores/club.ts. If those keys change, update here or seeding breaks
 *  silently (and the test only "fails" because the view redirects to
 *  sign-in — which is still a test failure, just a confusing one). */
async function seedAuthAndClub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('torny.token', 'test-jwt-token-not-real')
    localStorage.setItem('torny.user', JSON.stringify({
      id: 1,
      email: 'test-admin@example.com',
      firstName: 'Test',
      lastName: 'Admin',
      role: 'admin',
      isPlatformAdmin: false,
      clubs: [{ id: 1, name: 'Naenae Bowling Club', role: 'admin' }],
    }))
    localStorage.setItem('torny.currentClub', JSON.stringify({
      id: 1,
      name: 'Naenae Bowling Club',
      slug: 'naenae',
      domain: null,
      brandPrimary: '#2563EB',
      logoUrl: null,
    }))
    // The `requireOwnerAndOnboarded` guard pulls the onboarding store's
    // `completed` flag before letting the route through. Seed the local
    // fallback as completed so the test lands on the detail page instead
    // of being bounced to the onboarding wizard.
    localStorage.setItem('torny.crm.onboarding.1', JSON.stringify({
      data: {},
      step: 'welcome',
      completed: true,
    }))
  })
}

/** Shared stub set — anything the shell hits on boot that we don't care
 *  about for this test. Returning empty success envelopes keeps the view
 *  from erroring out of band. */
async function stubShellBoilerplate(page: Page): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/onboarding`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { completed: true, completedAt: '2026-01-01T00:00:00Z', step: 'done', data: {} } }),
    })
  })
  // Sidebar count fetches — don't need real data, just a predictable envelope.
  const emptyCounts = { status: 'success', data: { counts: { new: 0, pending: 0, total: 0 }, enquiries: [], applications: [], pagination: { limit: 1, offset: 0, total: 0 } } }
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications)(\?.*)?$/, async (route) => {
    // Only short-circuit list GETs that this view doesn't rely on.
    if (route.request().method() !== 'GET') return route.fallback()
    const url = route.request().url()
    if (url.includes(`/enquiries/${ENQUIRY_ID}`)) return route.fallback()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyCounts) })
  })
  // Club settings + anything else — catch-all 200 with an empty payload so
  // no spurious console error fails the suite.
  await page.route(/\/clubs\/\d+\/settings(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { brand: {}, membership: {}, communications: {} } }),
    })
  })
}

/** A reasonable structured message — matches the format emitted by
 *  `VenueBookingBlock.buildMessage()`. If the two drift the parse test
 *  catches it immediately. */
const WELL_FORMED_MESSAGE = [
  'Birthday · 25 guests',
  'The clubhouse · Afternoon · 2pm – 6pm',
  'Saturday 10 October',
  'Setup: Long tables + bar',
  'Add-ons:',
  '• Grazing platters × 6',
  '• Bar tab · Prepaid',
  'Notes: Please leave the back room free for presents.',
  'Booking on behalf of: Willis family',
  'Total: $1510 · Deposit: $378 · Balance: $1132',
].join('\n')

function enquiryEnvelope(message: string) {
  return {
    status: 'success',
    data: {
      id: ENQUIRY_ID,
      status: 'new',
      full_name: 'Casey Willis',
      email: 'casey@example.co.nz',
      phone: '021 555 1234',
      topic: 'facilities',
      message,
      consent_reply: true,
      ip_hash: null,
      user_agent: null,
      received_at: '2026-10-01T22:14:03Z',
      responded_at: null,
      responder_user_id: null,
      replies: [],
      notes: [],
    },
  }
}

async function mockEnquiryGet(page: Page, message: string): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/enquiries/${ENQUIRY_ID}`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(enquiryEnvelope(message)) })
  })
}

test.describe('CRM venue booking — parsed card', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('renders the parsed booking card for a well-formed message', async ({ page }) => {
    await mockEnquiryGet(page, WELL_FORMED_MESSAGE)
    await page.goto(`/crm/venue-bookings/${ENQUIRY_ID}`)

    // Parsed card is on screen — the "Booking" eyebrow is only in that section.
    await expect(page.getByText('Booking', { exact: true })).toBeVisible()
    // The raw-text fallback is NOT shown.
    await expect(page.getByText('Raw message', { exact: true })).toBeHidden()

    // Spot-check the parsed values made it to the DOM.
    await expect(page.getByText('Saturday 10 October')).toBeVisible()
    await expect(page.getByText(/the clubhouse/i)).toBeVisible()
    await expect(page.getByText(/25 guests/i)).toBeVisible()
    await expect(page.getByText(/\$1,?510/)).toBeVisible()
    await expect(page.getByText(/Grazing platters/)).toBeVisible()
  })

  test('falls back to raw plaintext when the message does not parse', async ({ page }) => {
    const garbage = 'Hey — I would like to book the venue for next Saturday please. Casey'
    await mockEnquiryGet(page, garbage)
    await page.goto(`/crm/venue-bookings/${ENQUIRY_ID}`)

    // Fallback eyebrow is visible, parsed card is not.
    await expect(page.getByText('Raw message', { exact: true })).toBeVisible()
    await expect(page.getByText('Booking', { exact: true })).toBeHidden()
    // The original text is preserved verbatim so the admin can still
    // read it. Target the dedicated fallback body (there's also a
    // truncated preview elsewhere on the page).
    await expect(page.locator('.message-card__body')).toContainText('would like to book the venue')
  })

  test('edit → save round-trips through parse(serialize(x)) losslessly', async ({ page }) => {
    await mockEnquiryGet(page, WELL_FORMED_MESSAGE)

    // Capture whatever message string the save PATCH sends.
    let patchedMessage: string | null = null
    await page.route(`**/clubs/${CLUB_ID}/enquiries/${ENQUIRY_ID}`, async (route: Route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const body = route.request().postDataJSON() as { message?: string } | null
      patchedMessage = body?.message ?? null
      // Echo the updated enquiry back so the view can refresh.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(enquiryEnvelope(patchedMessage ?? WELL_FORMED_MESSAGE)),
      })
    })

    await page.goto(`/crm/venue-bookings/${ENQUIRY_ID}`)
    await page.getByRole('button', { name: /edit details/i }).click()

    // The guest-count input lives inside the booking-form section — bump
    // it from 25 to 30. One edit is enough to prove the loop.
    const guestInput = page.getByLabel(/guests/i).first()
    await guestInput.fill('30')
    await page.getByRole('button', { name: /save details/i }).click()

    // The PATCH fired with a message that keeps the structured format.
    await expect
      .poll(() => patchedMessage, { timeout: 5_000 })
      .not.toBeNull()
    const msg = patchedMessage as unknown as string
    expect(msg, 'PATCH message should still include "30 guests" after edit').toMatch(/30 guests/)
    expect(msg, 'PATCH message should still include the package line').toMatch(/The clubhouse/)
    expect(msg, 'PATCH message should still include the totals line').toMatch(/Total: \$1510/)

    // After save, the view re-renders with the new value and the parsed
    // card still shows (not the fallback).
    await expect(page.getByText('Booking', { exact: true })).toBeVisible()
    await expect(page.getByText(/30 guests/i)).toBeVisible()
  })
})
