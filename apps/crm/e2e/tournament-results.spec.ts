import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Tournament results editor.
 *
 * One flowing scenario covers the whole admin flow per the
 * sport-flexibility brief §6:
 *   - Load: GET /clubs/:cid/tournaments/:tid/results populates the
 *     table (unplaced entries render as "No result yet" rows)
 *   - Edit: admin types position + placement_label + prize + ticks won
 *     on the top 2 entries, leaves the third unplaced
 *   - Mark complete: admin ticks the "Mark tournament complete" box
 *   - Save: POST /results fires with the batch upsert body +
 *     mark_complete: true
 *   - Response: the view re-renders with the server-echoed results
 */

const CLUB_ID = 1
const TOURNAMENT_ID = 42

async function seedAuthAndClub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('torny.token', 'test-jwt-token-not-real')
    localStorage.setItem('torny.user', JSON.stringify({
      id: 1, email: 'test-admin@example.com', firstName: 'Test', lastName: 'Admin',
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
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications|venue-bookings)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], bookings: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

function resultsFixture(tournamentStatus: string | null = null) {
  return {
    tournament_id: tournamentStatus ? TOURNAMENT_ID : null,
    tournament_status: tournamentStatus,
    entries: [
      {
        entry_id: 7001, entry_number: 1,
        team_name: 'Team Willis',
        captain_user_id: 2, captain_email: 'ruth@example.co.nz', captain_phone: null,
        entry_status: 'confirmed',
        result: null,
      },
      {
        entry_id: 7002, entry_number: 2,
        team_name: 'Team Smith',
        captain_user_id: 3, captain_email: 'peter@example.co.nz', captain_phone: null,
        entry_status: 'confirmed',
        result: null,
      },
      {
        entry_id: 7003, entry_number: 3,
        team_name: 'Team Grey',
        captain_user_id: 4, captain_email: 'kim@example.co.nz', captain_phone: null,
        entry_status: 'confirmed',
        result: null,
      },
    ],
  }
}

test.describe('Tournament results editor', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('loads entries, edits results, marks complete, posts batch', async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null

    // Tournament metadata — the results editor pulls this to render the
    // title + "already complete" pill, so it must resolve before the
    // entries table shows.
    await page.route(new RegExp(`/clubs/\\d+/tournaments/${TOURNAMENT_ID}$`), async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            id: TOURNAMENT_ID, club_id: CLUB_ID,
            title: 'Spring Open 2026',
            format: 'fours', category: 'open',
            status: 'in_progress',
            starts_at: '2026-11-01T00:00:00Z', ends_at: null,
            entry_fee_cents: 5000, entry_unit: 'team',
            entry_cap: 32,
            payment_method: 'online',
            sanctioned_by: null,
            stats: { confirmed_count: 3, pending_count: 0, waitlisted_count: 0, withdrawn_count: 0, refunded_count: 0 },
          },
        }),
      })
    })

    await page.route(new RegExp(`/clubs/\\d+/tournaments/${TOURNAMENT_ID}/results$`), async (route: Route) => {
      const m = route.request().method()
      if (m === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: resultsFixture() }),
        })
        return
      }
      if (m === 'POST') {
        postedBody = route.request().postDataJSON() as Record<string, unknown>
        // Echo back a "complete" results payload so the view re-renders
        // with the server-confirmed state.
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: resultsFixture('complete') }),
        })
        return
      }
      return route.fallback()
    })

    await page.goto(`/crm/tournaments/${TOURNAMENT_ID}/results`)

    // Table renders all three entries.
    await expect(page.getByRole('heading', { name: /results/i })).toBeVisible()
    await expect(page.getByText('Team Willis')).toBeVisible()
    await expect(page.getByText('Team Smith')).toBeVisible()
    await expect(page.getByText('Team Grey')).toBeVisible()

    // Fill position + prize + won for the first two rows.
    const willisRow = page.locator('tr', { hasText: 'Team Willis' })
    await willisRow.getByLabel(/position/i).fill('1')
    await willisRow.getByLabel(/placement/i).fill('Champion')
    await willisRow.getByLabel(/prize/i).fill('750')
    await willisRow.getByLabel(/^won$/i).check()

    const smithRow = page.locator('tr', { hasText: 'Team Smith' })
    await smithRow.getByLabel(/position/i).fill('2')
    await smithRow.getByLabel(/placement/i).fill('Runner-up')
    await smithRow.getByLabel(/prize/i).fill('250')
    await smithRow.getByLabel(/^won$/i).check()

    // Leave Team Grey unplaced.

    // Tick the "Mark tournament complete" toggle at the bottom.
    await page.getByLabel(/mark tournament complete/i).check()

    // Save.
    await page.getByRole('button', { name: /save results/i }).click()

    // Assert on the posted shape — matches the brief §8 SubmitResultsInput
    // contract.
    await expect
      .poll(() => postedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = postedBody as unknown as {
      results: Array<{ entry_id: number; position?: number; placement_label?: string; prize_money_cents?: number; won?: boolean }>
      mark_complete?: boolean
    }
    expect(body.mark_complete).toBe(true)
    // All three entries should be in the batch (empty rows send through
    // the admin's intent — "I reviewed this one, no position").
    expect(body.results.map((r) => r.entry_id).sort()).toEqual([7001, 7002, 7003])

    const first = body.results.find((r) => r.entry_id === 7001)
    expect(first).toMatchObject({
      position: 1,
      placement_label: 'Champion',
      prize_money_cents: 75000,
      won: true,
    })
    const second = body.results.find((r) => r.entry_id === 7002)
    expect(second).toMatchObject({
      position: 2,
      placement_label: 'Runner-up',
      prize_money_cents: 25000,
      won: true,
    })
    // Team Grey — unplaced. Should still be in the batch so the backend
    // can clear a previously-set result if the admin changes their mind.
    const third = body.results.find((r) => r.entry_id === 7003)
    expect(third?.won).toBe(false)
  })
})
