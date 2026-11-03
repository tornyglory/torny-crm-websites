import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Venue packages — list screen.
 *
 * Phase A of the venue-packages CRM surface. The screen must:
 *   1. Render an empty state with a clear "+ New package" CTA when
 *      the backend returns `{ packages: [], counts: {...} }`.
 *   2. Render a populated grid when packages exist, with the key
 *      affordances (name, slug, slot/addon counts, bond, status chip,
 *      overflow menu).
 *   3. Filter chips drive the status query — clicking "Archived" sends
 *      `?status=archived` and the chip count reflects server-returned
 *      counts (not client-side).
 *   4. Clicking a package navigates to the editor route.
 *   5. Clicking "+ New package" navigates to /venue-packages/new.
 *
 * All API calls mocked; no backend touched.
 */

const CLUB_ID = 1

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
    localStorage.setItem('torny.crm.onboarding.1', JSON.stringify({
      data: {}, step: 'welcome', completed: true,
    }))
  })
}

async function stubShellBoilerplate(page: Page): Promise<void> {
  await page.route(`**/clubs/${CLUB_ID}/onboarding`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { completed: true, completedAt: '2026-01-01T00:00:00Z', step: 'done', data: {} } }),
    })
  })
  await page.route(/\/clubs\/\d+\/(enquiries|applications|members|events|tournaments|team-selections|honour-board|notifications)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'success', data: { counts: { new: 0, pending: 0, total: 0 }, enquiries: [], applications: [], pagination: { limit: 1, offset: 0, total: 0 } } }),
    })
  })
}

/** Capture the status query the view used on the last `/venue-packages`
 *  request. Lets the "filter chip drives status" test assert what the
 *  server was asked for, not just what rendered. */
function captureStatusQuery(): { last: string | null } {
  return { last: null }
}

async function mockPackagesList(
  page: Page,
  payload: {
    active: Array<Partial<VenuePackageListRow>>
    archived: Array<Partial<VenuePackageListRow>>
  },
  tracker?: { last: string | null },
): Promise<void> {
  await page.route(/\/clubs\/\d+\/venue-packages(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const url = new URL(route.request().url())
    const status = url.searchParams.get('status') ?? 'all'
    if (tracker) tracker.last = status

    let packages: Partial<VenuePackageListRow>[]
    if (status === 'active') packages = payload.active
    else if (status === 'archived') packages = payload.archived
    else packages = [...payload.active, ...payload.archived]

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        data: {
          packages: packages.map((p, i) => ({
            id: p.id ?? i + 100,
            slug: p.slug ?? `pkg-${i}`,
            name: p.name ?? `Package ${i}`,
            sub: p.sub ?? null,
            description: null,
            hero_image_url: null,
            hero_image_alt: null,
            bond_cents: p.bond_cents ?? 0,
            bond_label: null,
            is_active: p.is_active ?? true,
            display_order: (i + 1) * 10,
            slot_count: p.slot_count ?? 0,
            addon_count: p.addon_count ?? 0,
            last_booked_at: null,
            created_at: '2026-10-15T00:00:00Z',
            updated_at: '2026-10-28T00:00:00Z',
          })),
          counts: {
            all: payload.active.length + payload.archived.length,
            active: payload.active.length,
            archived: payload.archived.length,
          },
        },
      }),
    })
  })
}

interface VenuePackageListRow {
  id: number
  slug: string
  name: string
  sub: string | null
  bond_cents: number
  slot_count: number
  addon_count: number
  is_active: boolean
}

test.describe('Venue packages — list screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('renders empty state when the club has no packages', async ({ page }) => {
    await mockPackagesList(page, { active: [], archived: [] })
    await page.goto('/crm/venue-packages')

    await expect(page.getByRole('heading', { name: /venue packages/i })).toBeVisible()
    await expect(page.getByText('No packages yet', { exact: true })).toBeVisible()
    // Primary CTA leads to the editor's create route. Two render in the
    // empty state (header + empty-state CTA) — target the first one.
    await expect(page.getByRole('link', { name: /\+ new package/i }).first()).toBeVisible()
  })

  test('renders populated grid with name, bond, counts, status', async ({ page }) => {
    await mockPackagesList(page, {
      active: [
        { id: 12, slug: 'the-clubhouse', name: 'The clubhouse', sub: 'Timber-lined main room', bond_cents: 30000, slot_count: 4, addon_count: 3 },
        { id: 15, slug: 'green-bbq', name: 'Green + BBQ', sub: 'Covered BBQ area', bond_cents: 15000, slot_count: 3, addon_count: 2 },
      ],
      archived: [
        { id: 20, slug: 'old-pavilion', name: 'Old pavilion', bond_cents: 0, slot_count: 1, addon_count: 0, is_active: false },
      ],
    })
    await page.goto('/crm/venue-packages')

    await expect(page.getByText('The clubhouse')).toBeVisible()
    await expect(page.getByText('Green + BBQ')).toBeVisible()
    await expect(page.getByText('Old pavilion')).toBeVisible()
    // Slot / addon counts show somewhere on the card.
    await expect(page.getByText(/4 slots/i).first()).toBeVisible()
    await expect(page.getByText(/3 add[-\s]ons/i).first()).toBeVisible()
    // Bond chip renders with formatted dollar amount.
    await expect(page.getByText(/\$300/).first()).toBeVisible()
  })

  test('filter chips drive the server query', async ({ page }) => {
    const tracker = captureStatusQuery()
    await mockPackagesList(page, {
      active: [{ id: 12, name: 'The clubhouse' }],
      archived: [{ id: 20, name: 'Old pavilion', is_active: false }],
    }, tracker)
    await page.goto('/crm/venue-packages')

    // Initial load: "All" chip is active, server sees status omitted (or "all").
    await expect(page.getByText('The clubhouse')).toBeVisible()
    await expect(page.getByText('Old pavilion')).toBeVisible()
    expect(tracker.last === null || tracker.last === 'all').toBeTruthy()

    // Click "Archived" chip → server queried with status=archived, only
    // the archived package visible.
    await page.getByRole('button', { name: /archived/i }).click()
    await expect
      .poll(() => tracker.last, { timeout: 5_000 })
      .toBe('archived')
    await expect(page.getByText('Old pavilion')).toBeVisible()
    await expect(page.getByText('The clubhouse')).toBeHidden()
  })

  test('clicking a package navigates to the editor', async ({ page }) => {
    await mockPackagesList(page, {
      active: [{ id: 12, slug: 'the-clubhouse', name: 'The clubhouse', slot_count: 2 }],
      archived: [],
    })
    await page.goto('/crm/venue-packages')
    await page.getByText('The clubhouse').click()
    await expect(page).toHaveURL(/\/crm\/venue-packages\/12$/)
  })

  test('clicking "+ New package" navigates to the create route', async ({ page }) => {
    await mockPackagesList(page, { active: [], archived: [] })
    await page.goto('/crm/venue-packages')
    await page.getByRole('link', { name: /\+ new package/i }).first().click()
    await expect(page).toHaveURL(/\/crm\/venue-packages\/new$/)
  })
})
