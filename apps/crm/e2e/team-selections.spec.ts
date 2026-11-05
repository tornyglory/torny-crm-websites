import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Team selections — brief 74.
 *
 * Covers the two editor modes and the list:
 *   - List: loads scope=upcoming via GET and renders fill bars from
 *     confirmed_count/total_slots
 *   - Create (/teams/new): fills the fixture form, submits POST, lands
 *     on /teams/:id after router.replace
 *   - Edit (/teams/:id): loads detail + roster pool, drops a pool chip
 *     onto an empty slot, debounced PATCH fires with the brief §3.d
 *     roster body
 *   - Publish: opens the modal, submits with a note, POST hits
 *     /publish and the notify_summary toast shows
 */

const CLUB_ID = 1
const SELECTION_ID = 42

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
  await page.route(/\/clubs\/\d+\/(enquiries|applications|events|tournaments|honour-board|notifications|venue-bookings)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { pending: 0, new: 0, total: 0 }, enquiries: [], applications: [], bookings: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

function selectionFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SELECTION_ID,
    club_id: CLUB_ID,
    competition: 'Pennant Div 3',
    round_label: 'Round 8',
    opponent: 'Petone A',
    venue: 'home',
    starts_at: '2027-11-23T00:30:00Z',
    format_label: 'Fours × 2',
    event_id: null,
    manager_note: null,
    green_closure_note: null,
    status: 'draft',
    sent_at: null,
    played_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    confirmed_count: 0,
    total_slots: 4,
    rinks: [
      {
        id: 34, position: 0, label: 'Rink 1',
        slots: [
          { id: 101, position: 'Lead',   slot_order: 0, member: null, notified_member_id: null, notified_at: null },
          { id: 102, position: 'Second', slot_order: 1, member: null, notified_member_id: null, notified_at: null },
          { id: 103, position: 'Third',  slot_order: 2, member: null, notified_member_id: null, notified_at: null },
          { id: 104, position: 'Skip',   slot_order: 3, member: null, notified_member_id: null, notified_at: null },
        ],
      },
    ],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

const ROSTER_FIXTURE = {
  members: [
    {
      user_id: 2001, name: 'Denise Peters', handle: null,
      email: 'denise@example.co.nz', phone: null, avatar_url: null,
      member_number: 42, club_role: 'member',
      computed_status: 'active',
      joined_at: '2024-01-01T00:00:00Z', revoked_at: null,
      dob: null, address: null, last_active_at: null, title: null, notes: null,
      position_group: 'all' as const, public_visible: true, bio: null,
      preferred_position: 'Lead', playing_level: 'A',
      membership: null,
      last_played_at: '2026-10-28T00:00:00Z',
    },
    {
      user_id: 2002, name: 'Marcus Tuilagi', handle: null,
      email: 'marcus@example.co.nz', phone: null, avatar_url: null,
      member_number: 43, club_role: 'member',
      computed_status: 'active',
      joined_at: '2024-01-01T00:00:00Z', revoked_at: null,
      dob: null, address: null, last_active_at: null, title: null, notes: null,
      position_group: 'all' as const, public_visible: true, bio: null,
      preferred_position: 'Skip', playing_level: 'A',
      membership: null,
      last_played_at: null,
    },
  ],
  counts: { total: 2, active: 2, pending: 0, lapsed: 0, pending_invites: 0 },
  pagination: { page: 1, limit: 200, total_items: 2, total_pages: 1, has_next_page: false, has_previous_page: false },
  filters: { status: 'active' as const, role: null, search: null },
  pending_invites: [],
}

test.describe('Team selections', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('list loads scope=upcoming and renders fill bars', async ({ page }) => {
    const listUrls: string[] = []
    await page.route(/\/clubs\/\d+\/team-selections\?[^/]*$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      listUrls.push(route.request().url())
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            selections: [
              {
                id: 1, competition: 'Pennant Div 3', round_label: 'Round 8',
                opponent: 'Petone A', venue: 'home',
                starts_at: '2027-11-23T00:30:00Z', format_label: 'Fours × 2',
                event_id: null, manager_note: null, status: 'draft',
                sent_at: null, played_at: null,
                confirmed_count: 4, total_slots: 8,
                created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
              },
            ],
            count: 1, total: 1,
          },
        }),
      })
    })

    await page.goto('/crm/teams')
    await expect(page.getByRole('heading', { name: /team selections/i })).toBeVisible()
    await expect(page.getByText('Petone A', { exact: false })).toBeVisible()
    await expect(page.getByText('4 / 8 confirmed')).toBeVisible()

    // The first list fetch should carry the default scope=upcoming filter.
    await expect
      .poll(() => listUrls.length, { timeout: 2_000 })
      .toBeGreaterThan(0)
    expect(listUrls[0]).toMatch(/scope=upcoming/)
  })

  test('create form POSTs the brief §3.c body and router-replaces to the new editor', async ({ page }) => {
    let createBody: Record<string, unknown> | null = null

    await page.route(/\/clubs\/\d+\/team-selections(\?[^/]*)?$/, async (route: Route) => {
      const m = route.request().method()
      if (m === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { selections: [], count: 0, total: 0 } }),
        })
        return
      }
      if (m === 'POST') {
        createBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { selection: selectionFixture({ id: 999 }) } }),
        })
        return
      }
      return route.fallback()
    })

    // After create, the view navigates to /crm/teams/999 and fetches detail +
    // roster — stub both so the landing doesn't crash.
    await page.route(/\/clubs\/\d+\/team-selections\/999$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: { selection: selectionFixture({ id: 999 }) } }),
      })
    })
    await page.route(/\/clubs\/\d+\/members(\?[^/]*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: ROSTER_FIXTURE }),
      })
    })

    await page.goto('/crm/teams/new')
    await expect(page.getByRole('heading', { name: /pick a fixture/i })).toBeVisible()

    await page.getByLabel(/competition/i).fill('Pennant Div 3')
    await page.getByLabel(/round/i).fill('Round 8')
    await page.getByLabel(/opponent/i).fill('Petone A')
    // TornyDatePicker + TornyTimePicker are both popover-based. Open the
    // date one, pick Today; open the time one, nudge the minute grid and
    // commit via Set. The mocked backend doesn't enforce the brief's
    // starts_in_past guard so Today-at-12:30 lands cleanly.
    await page.locator('.torny-dp .torny-dp__field').click()
    await page.locator('.torny-dp__panel').last().getByRole('button', { name: /^today$/i }).click()
    await expect(page.locator('.torny-dp__panel')).toHaveCount(0, { timeout: 2_000 })

    await page.locator('.torny-tp .torny-tp__field').click()
    // Seeded draft is already 12:30 AM (createForm default). Hitting Set
    // commits that round-trip through the popover's draft → model path —
    // the test cares about the commit, not which minute cell was picked.
    await page.locator('.torny-tp__panel').last().getByRole('button', { name: /^set$/i }).click()
    await expect(page.locator('.torny-tp__panel')).toHaveCount(0, { timeout: 2_000 })

    await page.getByRole('button', { name: /create \+ start picking/i }).click()

    await expect
      .poll(() => createBody, { timeout: 4_000 })
      .not.toBeNull()
    const body = createBody as unknown as {
      competition: string
      venue: string
      format_shape: { positions: string[]; rink_count: number }
    }
    expect(body.competition).toBe('Pennant Div 3')
    expect(body.venue).toBe('home')
    expect(body.format_shape).toEqual({
      positions: ['Lead', 'Second', 'Third', 'Skip'],
      rink_count: 2,
    })

    // router.replace to /crm/teams/999.
    await expect(page).toHaveURL(/\/crm\/teams\/999$/)
  })

  test('editor loads detail + roster pool, dropping a chip fires a debounced roster PATCH', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(new RegExp(`/clubs/\\d+/team-selections/${SELECTION_ID}$`), async (route: Route) => {
      const m = route.request().method()
      if (m === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { selection: selectionFixture() } }),
        })
        return
      }
      if (m === 'PATCH') {
        patchedBody = route.request().postDataJSON() as Record<string, unknown>
        const echo = selectionFixture({
          confirmed_count: 1,
          rinks: [
            {
              id: 34, position: 0, label: 'Rink 1',
              slots: [
                { id: 101, position: 'Lead', slot_order: 0,
                  member: {
                    user_id: 2001, name: 'Denise Peters',
                    preferred_position: 'Lead', playing_level: 'A',
                    last_played_at: '2026-10-28T00:00:00Z',
                    avatar_url: null,
                  },
                  notified_member_id: null, notified_at: null },
                { id: 102, position: 'Second', slot_order: 1, member: null, notified_member_id: null, notified_at: null },
                { id: 103, position: 'Third',  slot_order: 2, member: null, notified_member_id: null, notified_at: null },
                { id: 104, position: 'Skip',   slot_order: 3, member: null, notified_member_id: null, notified_at: null },
              ],
            },
          ],
        })
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ status: 'success', data: { selection: echo } }),
        })
        return
      }
      return route.fallback()
    })

    await page.route(/\/clubs\/\d+\/members(\?[^/]*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: ROSTER_FIXTURE }),
      })
    })

    await page.goto(`/crm/teams/${SELECTION_ID}`)
    await expect(page.getByRole('heading', { name: /vs petone a/i })).toBeVisible()
    await expect(page.getByText('Denise Peters')).toBeVisible()

    // HTML5 drag-drop is finicky in headless; simulate by dispatching the
    // drop handler directly via a dataTransfer carrier. The editor's
    // onDragStart stores the member id on the component; we can trigger
    // the same path by firing dragstart on a pool chip then drop on the
    // target slot.
    const poolChip = page.locator('.chip', { hasText: 'Denise Peters' })
    const targetSlot = page.locator('.slot', { hasText: 'Lead' }).first()
    await poolChip.dragTo(targetSlot)

    // Debounce is 800ms; the PATCH fires after the debounce.
    await expect
      .poll(() => patchedBody, { timeout: 5_000 })
      .not.toBeNull()

    const body = patchedBody as unknown as {
      rinks: Array<{ id: number; slots: Array<{ id: number; member_id: number | null }> }>
    }
    expect(body.rinks).toHaveLength(1)
    const leadSlot = body.rinks[0]!.slots.find((s) => s.id === 101)
    expect(leadSlot?.member_id).toBe(2001)
  })

  test('publish opens a modal, POSTs /publish, and surfaces the notify_summary', async ({ page }) => {
    let publishBody: Record<string, unknown> | null = null

    await page.route(new RegExp(`/clubs/\\d+/team-selections/${SELECTION_ID}$`), async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      // Return a confirmed selection with 4 filled slots so publish is enabled.
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            selection: selectionFixture({
              status: 'confirmed', confirmed_count: 4, total_slots: 4,
              rinks: [
                {
                  id: 34, position: 0, label: 'Rink 1',
                  slots: [
                    { id: 101, position: 'Lead', slot_order: 0,
                      member: { user_id: 2001, name: 'Denise Peters', preferred_position: 'Lead', playing_level: 'A', last_played_at: null, avatar_url: null },
                      notified_member_id: null, notified_at: null },
                    { id: 102, position: 'Second', slot_order: 1,
                      member: { user_id: 2002, name: 'Marcus Tuilagi', preferred_position: 'Skip', playing_level: 'A', last_played_at: null, avatar_url: null },
                      notified_member_id: null, notified_at: null },
                    { id: 103, position: 'Third',  slot_order: 2,
                      member: { user_id: 2003, name: 'Reggie Marcs', preferred_position: 'Third', playing_level: 'A', last_played_at: null, avatar_url: null },
                      notified_member_id: null, notified_at: null },
                    { id: 104, position: 'Skip',   slot_order: 3,
                      member: { user_id: 2004, name: 'Sione Vagana', preferred_position: 'Skip', playing_level: 'B', last_played_at: null, avatar_url: null },
                      notified_member_id: null, notified_at: null },
                  ],
                },
              ],
            }),
          },
        }),
      })
    })

    await page.route(new RegExp(`/clubs/\\d+/team-selections/${SELECTION_ID}/publish$`), async (route) => {
      publishBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          data: {
            selection: selectionFixture({ status: 'sent', sent_at: '2026-11-05T02:00:00Z' }),
            notify_summary: { picked: 4, dropped: 0, already_notified: 0 },
          },
        }),
      })
    })

    await page.route(/\/clubs\/\d+\/members(\?[^/]*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'success', data: ROSTER_FIXTURE }),
      })
    })

    await page.goto(`/crm/teams/${SELECTION_ID}`)
    await expect(page.getByRole('heading', { name: /vs petone a/i })).toBeVisible()

    await page.getByRole('button', { name: /publish \+ notify/i }).first().click()
    await expect(page.getByRole('heading', { name: /publish \+ notify players/i })).toBeVisible()
    await page.getByLabel(/manager note/i).fill('Weather looks perfect.')
    await page.getByRole('button', { name: /publish \+ notify/i }).last().click()

    await expect
      .poll(() => publishBody, { timeout: 4_000 })
      .not.toBeNull()
    expect(publishBody).toEqual({ message: 'Weather looks perfect.' })
    // Status pill flips to "sent" after the publish echo.
    await expect(page.locator('.status-pill--sent')).toBeVisible()
  })
})
