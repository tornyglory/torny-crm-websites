import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Venue packages — editor screen (create + edit).
 *
 * Three scenarios cover the full happy path:
 *   1. Create: start empty, fill identity + pricing + add one slot + one
 *      addon, submit → POST fires with the expected body + redirects to
 *      the newly-created package's edit route.
 *   2. Edit: existing package loads with slots + addons hydrated, admin
 *      changes a slot price, submits → PATCH body includes all slots
 *      (nested whole-shape replace) with the right slot carrying the
 *      new price.
 *   3. Add + remove slot in-session: starting from an existing package,
 *      adding a slot without an `id` + removing one with an `id`
 *      produces a PATCH body with the right diff shape.
 */

const CLUB_ID = 1
const PACKAGE_ID = 12

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

function packageEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'success',
    data: {
      id: PACKAGE_ID,
      slug: 'the-clubhouse',
      name: 'The clubhouse',
      sub: 'Timber-lined main room',
      description: 'The main indoor space.',
      hero_image_url: null,
      hero_image_alt: null,
      bond_cents: 30000,
      bond_label: 'Refundable bond',
      is_active: true,
      display_order: 10,
      slot_count: 2,
      addon_count: 1,
      last_booked_at: null,
      created_at: '2026-10-15T22:14:03Z',
      updated_at: '2026-10-28T09:40:00Z',
      slots: [
        { id: 101, label: 'Morning · 9am – 1pm', sub: '4 hours · $720', price_cents: 72000, duration_hours: 4, default_start_time: '09:00', is_disabled: false, display_order: 10 },
        { id: 102, label: 'Evening · 6pm – 11pm', sub: '5 hours · $900', price_cents: 90000, duration_hours: 5, default_start_time: '18:00', is_disabled: false, display_order: 20 },
      ],
      addons: [
        { id: 201, name: 'Grazing platters', description: 'Catered by Naenae Cafe', price_cents: 8500, price_suffix: '/ platter', countable: true, default_quantity: 6, default_selected: true, display_order: 10 },
      ],
      ...overrides,
    },
  }
}

test.describe('Venue packages — editor screen', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthAndClub(page)
    await stubShellBoilerplate(page)
  })

  test('create flow: POST includes slot + addon + redirects to edit route', async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null

    await page.route(/\/clubs\/\d+\/venue-packages$/, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      postedBody = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify(packageEnvelope({ name: postedBody.name, slug: 'the-clubhouse' })),
      })
    })

    await page.goto('/crm/venue-packages/new')
    await expect(page.getByRole('heading', { name: /new package|create.*package/i })).toBeVisible()

    // Identity
    await page.getByLabel(/package name/i).fill('The clubhouse')
    await page.getByLabel(/sub.*line|short description/i).fill('Timber-lined main room')

    // Pricing — bond
    await page.getByLabel(/bond amount/i).fill('300')

    // Add a slot
    await page.getByRole('button', { name: /add slot/i }).click()
    const slotLabel = page.getByLabel(/slot label/i).first()
    await slotLabel.fill('Morning · 9am – 1pm')
    await page.getByLabel(/slot price/i).first().fill('720')

    // Add an addon
    await page.getByRole('button', { name: /add add[-\s]?on/i }).click()
    await page.getByLabel(/add[-\s]?on name/i).first().fill('Grazing platters')
    await page.getByLabel(/add[-\s]?on price/i).first().fill('85')

    // Submit
    await page.getByRole('button', { name: /create package|save package/i }).click()

    await expect
      .poll(() => postedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = postedBody as unknown as {
      name: string
      slots: Array<{ label: string; price_cents: number }>
      addons: Array<{ name: string; price_cents: number }>
      bond_cents: number
    }
    expect(body.name).toBe('The clubhouse')
    expect(body.bond_cents).toBe(30000)
    expect(body.slots).toHaveLength(1)
    expect(body.slots[0]).toMatchObject({ label: 'Morning · 9am – 1pm', price_cents: 72000 })
    expect(body.addons).toHaveLength(1)
    expect(body.addons[0]).toMatchObject({ name: 'Grazing platters', price_cents: 8500 })

    // Redirect to edit route of the newly created package.
    await expect(page).toHaveURL(new RegExp(`/crm/venue-packages/${PACKAGE_ID}$`))
  })

  test('edit flow: slot price change round-trips through nested PATCH', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(/\/clubs\/\d+\/venue-packages\/\d+$/, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packageEnvelope()) })
        return
      }
      if (method === 'PATCH') {
        patchedBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packageEnvelope()) })
        return
      }
      return route.fallback()
    })

    await page.goto(`/crm/venue-packages/${PACKAGE_ID}`)
    await expect(page.getByLabel(/package name/i)).toHaveValue('The clubhouse')

    // Bump the first slot's price from 720 → 800.
    const firstSlotPrice = page.getByLabel(/slot price/i).first()
    await expect(firstSlotPrice).toHaveValue('720')
    await firstSlotPrice.fill('800')

    await page.getByRole('button', { name: /save package|save changes/i }).click()

    await expect
      .poll(() => patchedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = patchedBody as unknown as {
      slots: Array<{ id?: number; label: string; price_cents: number }>
    }
    // Both existing slots sent back with ids so backend knows to UPDATE.
    expect(body.slots).toHaveLength(2)
    const first = body.slots.find((s) => s.id === 101)
    expect(first, 'slot 101 should still be present with its id').toBeTruthy()
    expect(first?.price_cents).toBe(80000)
    const second = body.slots.find((s) => s.id === 102)
    expect(second?.price_cents).toBe(90000)
  })

  test('max_bookings: editor carries the capacity input through the PATCH body', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(/\/clubs\/\d+\/venue-packages\/\d+$/, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        // Seed slot 101 with max_bookings=1 (default) so we can bump it.
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(packageEnvelope({
            slots: [
              { id: 101, label: 'Morning · 9am – 1pm', sub: '4 hours · $720', price_cents: 72000, duration_hours: 4, default_start_time: '09:00', is_disabled: false, display_order: 10, max_bookings: 1 },
              { id: 102, label: 'Evening · 6pm – 11pm', sub: '5 hours · $900', price_cents: 90000, duration_hours: 5, default_start_time: '18:00', is_disabled: false, display_order: 20, max_bookings: 1 },
            ],
          })),
        })
        return
      }
      if (method === 'PATCH') {
        patchedBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(packageEnvelope({
            slots: [
              { id: 101, label: 'Morning · 9am – 1pm', sub: null, price_cents: 72000, duration_hours: 4, default_start_time: '09:00', is_disabled: false, display_order: 10, max_bookings: 3 },
              { id: 102, label: 'Evening · 6pm – 11pm', sub: null, price_cents: 90000, duration_hours: 5, default_start_time: '18:00', is_disabled: false, display_order: 20, max_bookings: 1 },
            ],
          })),
        })
        return
      }
      return route.fallback()
    })

    await page.goto(`/crm/venue-packages/${PACKAGE_ID}`)
    await expect(page.getByLabel(/package name/i)).toHaveValue('The clubhouse')

    // Bump slot 101's capacity from 1 → 3.
    const capacityInputs = page.getByLabel(/simultaneous bookings per date/i)
    await expect(capacityInputs.first()).toHaveValue('1')
    await capacityInputs.first().fill('3')

    await page.getByRole('button', { name: /save package|save changes/i }).click()

    await expect
      .poll(() => patchedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = patchedBody as unknown as {
      slots: Array<{ id?: number; max_bookings: number }>
    }
    const first = body.slots.find((s) => s.id === 101)
    expect(first?.max_bookings).toBe(3)
    // Untouched slot keeps the default.
    const second = body.slots.find((s) => s.id === 102)
    expect(second?.max_bookings).toBe(1)
  })

  test('max_bookings: 400 below_current_count surfaces conflicting dates inline', async ({ page }) => {
    let patchCount = 0

    await page.route(/\/clubs\/\d+\/venue-packages\/\d+$/, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(packageEnvelope({
            slots: [
              { id: 101, label: 'Morning · 9am – 1pm', sub: null, price_cents: 72000, duration_hours: 4, default_start_time: '09:00', is_disabled: false, display_order: 10, max_bookings: 3 },
              { id: 102, label: 'Evening · 6pm – 11pm', sub: null, price_cents: 90000, duration_hours: 5, default_start_time: '18:00', is_disabled: false, display_order: 20, max_bookings: 1 },
            ],
          })),
        })
        return
      }
      if (method === 'PATCH') {
        patchCount += 1
        // Backend rejects the lowering with the typed conflicts block.
        await route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({
            status: 'error',
            code: 'below_current_count',
            message: 'Slot 101 already has 2 bookings on 2026-12-14. Cancel or move them before lowering the capacity.',
            data: {
              field: 'max_bookings',
              conflicts: [
                {
                  slot_id: 101,
                  requested_max: 1,
                  dates: [
                    { date: '2026-12-14', booked_count: 2 },
                    { date: '2026-12-21', booked_count: 3 },
                  ],
                },
              ],
            },
          }),
        })
        return
      }
      return route.fallback()
    })

    await page.goto(`/crm/venue-packages/${PACKAGE_ID}`)
    const capacityInputs = page.getByLabel(/simultaneous bookings per date/i)
    await expect(capacityInputs.first()).toHaveValue('3')

    // Try to drop slot 101's capacity to 1 — backend 400s.
    await capacityInputs.first().fill('1')
    await page.getByRole('button', { name: /save package|save changes/i }).click()

    await expect
      .poll(() => patchCount, { timeout: 5_000 })
      .toBeGreaterThan(0)

    // Conflict panel renders inline below slot 101's capacity input,
    // listing both offending dates with their booking counts.
    const conflict = page.locator('.conflict').first()
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText(/cancel these bookings first/i)
    await expect(conflict).toContainText('14 Dec 2026')
    await expect(conflict).toContainText('2 bookings')
    await expect(conflict).toContainText('21 Dec 2026')
    await expect(conflict).toContainText('3 bookings')
  })

  test('add + remove: PATCH diff carries insert (no id) + omits the removed slot', async ({ page }) => {
    let patchedBody: Record<string, unknown> | null = null

    await page.route(/\/clubs\/\d+\/venue-packages\/\d+$/, async (route: Route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packageEnvelope()) })
        return
      }
      if (method === 'PATCH') {
        patchedBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packageEnvelope()) })
        return
      }
      return route.fallback()
    })

    await page.goto(`/crm/venue-packages/${PACKAGE_ID}`)

    // Remove the second slot (id 102).
    const removeButtons = page.getByRole('button', { name: /remove slot/i })
    await removeButtons.nth(1).click()

    // Add a new slot — fills defaults then overrides.
    await page.getByRole('button', { name: /add slot/i }).click()
    const slotLabels = page.getByLabel(/slot label/i)
    // The newly added slot is the last one in the list.
    const newSlotLabel = slotLabels.last()
    await newSlotLabel.fill('Full day · 9am – 11pm')
    const slotPrices = page.getByLabel(/slot price/i)
    await slotPrices.last().fill('2340')

    await page.getByRole('button', { name: /save package|save changes/i }).click()

    await expect
      .poll(() => patchedBody, { timeout: 5_000 })
      .not.toBeNull()
    const body = patchedBody as unknown as {
      slots: Array<{ id?: number; label: string; price_cents: number }>
    }
    // Expect: slot 101 kept with id, slot 102 removed, new slot sent
    // without an id so backend INSERTs it.
    expect(body.slots.find((s) => s.id === 101)).toBeTruthy()
    expect(body.slots.find((s) => s.id === 102), 'slot 102 should be deleted — not in body').toBeFalsy()
    const inserted = body.slots.find((s) => s.id == null)
    expect(inserted, 'a new slot without an id should be present').toBeTruthy()
    expect(inserted?.label).toBe('Full day · 9am – 11pm')
    expect(inserted?.price_cents).toBe(234000)
  })
})
