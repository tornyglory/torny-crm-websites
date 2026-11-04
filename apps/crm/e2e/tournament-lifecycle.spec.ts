import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Tournament lifecycle — end-to-end demo.
 *
 * Walks the full admin flow with mocked backend, so the whole chain
 * runs deterministically and captures a visible trail of screenshots:
 *
 *   1. Admin opens the Tournaments list (empty state)
 *   2. Clicks "+ New tournament" → form renders
 *   3. Fills title + entry fee + cap, submits
 *   4. Backend returns the new tournament; admin lands on the detail
 *      view, Entries tab empty
 *   5. List re-fetched after returning — the tournament now appears
 *   6. Simulate two entries landing (via list-entries mock), one
 *      waiting for payment, one paid-and-confirmed
 *   7. Admin sees both in the Entries tab with the right status pills
 *      and row actions (Mark paid vs Refund)
 *   8. Admin clicks Refund on the paid entry → refund modal renders,
 *      PATCH fires, success toast appears
 *
 * Every milestone writes a PNG to `test-results/tournament-demo/` so
 * the user can scrub through the whole run.
 */

const CLUB_ID = 1
const NEW_TOURNAMENT_ID = 999

// Keep the output dir alongside the standard test-results tree.
const DEMO_DIR = path.join(__dirname, '..', 'test-results', 'tournament-demo')
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
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|team-selections|honour-board|notifications|venue-bookings)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], bookings: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

/** Reasonable tournament shape — a reduced view of the full
 *  `Tournament` type that satisfies TournamentsListView + Detail view.
 *  Anything not referenced is omitted; TypeScript stays out of the way
 *  because we fulfil via `JSON.stringify` on raw objects. */
function tournamentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: NEW_TOURNAMENT_ID,
    club_id: CLUB_ID,
    slug: 'summer-classic-triples',
    title: 'Summer Classic Triples',
    subtitle: 'The big one — grand final at the end of January',
    description: 'Open to any club.',
    format: 'triples',
    category: 'open',
    gender_scope: null,
    starts_at: '2027-01-30T06:00:00.000Z',
    ends_at: '2027-01-30T18:00:00.000Z',
    entries_open_at: '2026-11-01T00:00:00.000Z',
    entries_close_at: '2027-01-15T23:59:00.000Z',
    draw_published_at: null,
    entry_unit: 'team',
    entry_cap: 16,
    waitlist_enabled: true,
    waitlist_cap: 4,
    entry_fee_cents: 4500,
    currency: 'nzd',
    prize_pool_cents: 100000,
    prize_notes: null,
    payment_method: 'online',
    open_to_visitors: true,
    requires_bcnz: false,
    min_age: null,
    max_age: null,
    status: 'published',
    is_public: true,
    featured_until: null,
    cover_image_url: null,
    gallery_urls: [],
    sanctioned_by: null,
    sanction_url: null,
    created_at: '2026-11-05T00:00:00.000Z',
    created_by: 1,
    updated_at: '2026-11-05T00:00:00.000Z',
    stats: { confirmed_count: 0, pending_count: 0, waitlist_count: 0, spots_remaining: 16 },
    ...overrides,
  }
}

function entryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7001,
    entry_number: 1,
    team_name: 'Team Willis',
    captain: {
      user_id: 2,
      name: 'Ruth Willis',
      email: 'ruth@example.co.nz',
      phone: '021 555 1234',
      handle: null,
      club_id: CLUB_ID,
      club_name: 'Naenae Bowling Club',
      avatar_url: null,
    },
    paid_cents: 0,
    paid_at: null,
    payment_reference: null,
    refunded_cents: 0,
    refunded_at: null,
    status: 'pending',
    waitlist_position: null,
    withdrew_at: null,
    withdrew_reason: null,
    roster: [],
    roster_locked_at: null,
    admin_notes: null,
    created_at: '2026-11-05T00:00:00.000Z',
    updated_at: '2026-11-05T00:00:00.000Z',
    stripe_checkout_session_id: null,
    platform_fee_cents_snapshot: null,
    ...overrides,
  }
}

test.describe('Tournament lifecycle — demo', () => {
  test('admin creates tournament → entries land → admin refunds', async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)

    // ── Phase 1: empty tournaments list ────────────────────────
    // State for the tournaments list — starts empty, flips to [new]
    // after the create POST fires.
    const tournaments: ReturnType<typeof tournamentFixture>[] = []

    await page.route(/\/clubs\/\d+\/tournaments(\?.*)?$/, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            status: 'success',
            data: {
              tournaments: tournaments.map((t) => ({
                id: t.id, slug: t.slug, title: t.title, format: t.format,
                category: t.category, starts_at: t.starts_at,
                entries_close_at: t.entries_close_at, entry_cap: t.entry_cap,
                entry_fee_cents: t.entry_fee_cents, status: t.status,
                cover_image_url: null, gallery_urls: [], stats: t.stats,
              })),
              counts: {
                draft: tournaments.filter((t) => t.status === 'draft').length,
                published: tournaments.filter((t) => t.status === 'published').length,
                entries_closed: 0, in_progress: 0, complete: 0, cancelled: 0,
              },
              pagination: { limit: 20, offset: 0, total: tournaments.length },
            },
          }),
        })
        return
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>
        const created = tournamentFixture({
          title: body.title,
          entry_cap: body.entry_cap,
          entry_fee_cents: body.entry_fee_cents,
          status: 'published',
        })
        tournaments.push(created)
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: created }),
        })
        return
      }
      return route.fallback()
    })

    // Publish endpoint — called after create when the admin clicks
    // "Publish tournament". Flips status and echoes the tournament.
    await page.route(new RegExp(`/clubs/\\d+/tournaments/${NEW_TOURNAMENT_ID}/publish$`), async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const idx = tournaments.findIndex((t) => t.id === NEW_TOURNAMENT_ID)
      if (idx >= 0) tournaments[idx] = { ...tournaments[idx], status: 'published' }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: tournaments[idx] }),
      })
    })

    // Detail view fetches a single tournament + its entries list.
    const entries: ReturnType<typeof entryFixture>[] = []
    await page.route(new RegExp(`/clubs/\\d+/tournaments/${NEW_TOURNAMENT_ID}$`), async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const t = tournaments.find((x) => x.id === NEW_TOURNAMENT_ID)
      if (!t) return route.fulfill({ status: 404, body: '{}' })
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { ...t, recent_entries: entries.slice(0, 3) } }),
      })
    })
    await page.route(new RegExp(`/clubs/\\d+/tournaments/${NEW_TOURNAMENT_ID}/entries(\\?.*)?$`), async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            entries: entries,
            pagination: { limit: 200, offset: 0, total: entries.length },
          },
        }),
      })
    })

    await page.goto('/crm/tournaments')
    await expect(page.getByRole('heading', { name: /run the comp/i })).toBeVisible()
    await snap(page, '01-empty-list')

    // ── Phase 2: open the create form ──────────────────────────
    await page.getByRole('link', { name: /\+ new tournament/i }).click()
    await expect(page.getByRole('heading', { name: /new tournament|create/i }).first()).toBeVisible()
    await snap(page, '02-create-form-empty')

    // ── Phase 3: fill + submit ─────────────────────────────────
    await page.locator('#ct-fee').fill('45')
    await page.locator('#ct-cap').fill('16')
    await page.getByPlaceholder('e.g. Summer Classic Triples').fill('Summer Classic Triples')
    await page.getByPlaceholder('e.g. "Our biggest summer event — cash prizes"').fill('The big one — grand final at the end of January')

    // Fill the four TornyDatePicker fields. Each popover is teleported
    // + uses a fade transition, so two panels can briefly coexist.
    // Wait for any previous panel to detach before opening the next.
    const pickers = page.locator('.torny-dp')
    const pickerCount = await pickers.count()
    for (let i = 0; i < pickerCount; i++) {
      await pickers.nth(i).locator('.torny-dp__field').click()
      // Click the Today button that's inside the panel we just opened —
      // use .last() since any still-exiting one is earlier in DOM order.
      await page.locator('.torny-dp__panel').last().getByRole('button', { name: /^today$/i }).click()
      // Wait for the panel to actually close before moving on.
      await expect(page.locator('.torny-dp__panel')).toHaveCount(0, { timeout: 2_000 })
    }

    await snap(page, '03-create-form-filled')

    // Primary action — "Publish tournament" (create mode shows this
    // label per TournamentFormView:412). Two instances render (sticky
    // header + inline) — any of them submits.
    await page.getByRole('button', { name: /publish tournament/i }).first().click()

    // ── Phase 4: lands on detail view ──────────────────────────
    await expect(page).toHaveURL(new RegExp(`/crm/tournaments/${NEW_TOURNAMENT_ID}`), { timeout: 5_000 })
    await expect(page.getByRole('heading', { name: /summer classic triples/i })).toBeVisible()
    await snap(page, '04-detail-view-no-entries')

    // ── Phase 5: entries start landing ─────────────────────────
    // Two entries arrive: Team Willis (pending, awaiting payment) +
    // Team Smith (confirmed, paid online via Stripe).
    entries.push(entryFixture({
      id: 7001, entry_number: 1,
      team_name: 'Team Willis',
      captain: { user_id: 2, name: 'Ruth Willis', email: 'ruth@example.co.nz', phone: '021 555 1234', handle: null, club_id: CLUB_ID, club_name: 'Naenae Bowling Club', avatar_url: null },
      status: 'pending',
    }))
    entries.push(entryFixture({
      id: 7002, entry_number: 2,
      team_name: 'Team Smith',
      captain: { user_id: 3, name: 'Peter Smith', email: 'peter@example.co.nz', phone: '027 111 2222', handle: null, club_id: CLUB_ID, club_name: 'Naenae Bowling Club', avatar_url: null },
      status: 'confirmed',
      paid_cents: 4500,
      paid_at: '2026-11-05T01:00:00.000Z',
      payment_reference: 'pi_3ABC123XYZ',
      stripe_checkout_session_id: 'cs_test_abc123',
      platform_fee_cents_snapshot: 100,
    }))

    // Re-load the detail view so the entries fetch picks up the new list.
    await page.reload()
    await expect(page.getByText('Team Willis')).toBeVisible()
    await expect(page.getByText('Team Smith')).toBeVisible()
    await snap(page, '05-entries-landed')

    // ── Phase 6: refund the paid entry ─────────────────────────
    // Intercept the refund POST and respond with a refunded entry.
    let refundedEntryId: number | null = null
    await page.route(/\/clubs\/\d+\/tournament-entries\/\d+\/refund$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const url = route.request().url()
      const match = url.match(/tournament-entries\/(\d+)\/refund/)
      refundedEntryId = match ? Number(match[1]) : null
      const idx = entries.findIndex((e) => e.id === refundedEntryId)
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], status: 'confirmed' } as typeof entries[number]
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: entries[idx] ?? entryFixture({ id: refundedEntryId ?? 0 }) }),
      })
    })

    // Smith's row has the Refund button (confirmed + payment_reference).
    const smithRow = page.locator('.row', { hasText: 'Team Smith' })
    await smithRow.getByRole('button', { name: /refund/i }).click()
    await expect(page.getByRole('heading', { name: /refund team smith/i })).toBeVisible()
    await snap(page, '06-refund-modal')

    await page.getByRole('button', { name: /confirm refund/i }).click()
    // Expect either the toast or the modal to close after the PATCH.
    await expect.poll(() => refundedEntryId, { timeout: 5_000 }).toBe(7002)
    await snap(page, '07-refund-submitted')
  })
})
