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

  test('completes all three steps + submits a parseable booking message', async ({ page }) => {
    // Capture the POST body so we can inspect what the wizard sends.
    let submittedBody: Record<string, unknown> | null = null
    await page.route(`**/public/clubs/${CLUB_SLUG}/enquiries`, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      submittedBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            enquiry_id: 999,
            status: 'new',
            received_at: new Date().toISOString(),
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
    // Full name + email are the only strictly-required fields (phone is
    // optional per the schema). Guest count comes with a default from the
    // calendar step; occasion defaults to Birthday.
    // Labels are rendered as sibling `<span>`s inside the `<label>` so
    // the accessible-name computation is flaky across inputs. Target by
    // placeholder — stable and unambiguous.
    await page.getByPlaceholder('Ruth Willis').fill('Ruth Willis')
    await page.getByPlaceholder('you@example.co.nz').fill('ruth@example.co.nz')

    // The submit label is configurable; the fallback page sets it to
    // "Confirm booking". Match loosely so the test survives wording tweaks.
    await page.getByRole('button', { name: /confirm booking|book now|send booking/i }).click()

    // ── Step 3: confirmation renders. "You're booked in" is the fixed
    // eyebrow on the confirmation hero, "Booking confirmed" is the
    // status pill — both are stable across the configurable copy.
    await expect(page.getByText(/you'?re booked in/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/booking confirmed/i)).toBeVisible()
    // Booking ref follows a "NAE-YYYY-####" shape (client-side generated).
    await expect(page.getByText(/REF\s*·\s*[A-Z]{2,4}-\d{4}-\d+/)).toBeVisible()

    // ── Assert on the captured submit body.
    await expect
      .poll(() => submittedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = submittedBody as unknown as {
      full_name: string
      email: string
      topic: string
      message: string
      consent_reply: boolean
    }
    expect(body.topic, 'topic is facilities so CRM filter picks it up').toBe('facilities')
    expect(body.full_name).toBe('Ruth Willis')
    expect(body.email).toBe('ruth@example.co.nz')
    expect(body.consent_reply, 'consent_reply must be true for the enquiry POST to accept').toBe(true)

    // The message must be structured — parseMessage.ts expects a totals
    // line and a package line. Spot-check both are present so a drift in
    // buildMessage() surfaces here, not only when an admin opens the CRM.
    expect(body.message, 'message must include "Total:" line').toMatch(/Total: \$\d+/)
    expect(body.message, 'message must include a package·slot line').toMatch(/·/)
  })
})
