/**
 * Shape locks for brief 85 — `max_bookings` on venue slots.
 *
 * Covers:
 *  - PATCH body carries `max_bookings` on the slot shape round-trip
 *  - PATCH echo exposes `max_bookings` on the response slot
 *  - Public `/venue-packages` carries `max_bookings` per brief §5
 *  - 400 `below_current_count` surfaces `data.conflicts` with the
 *    typed BelowCurrentCountData shape
 *  - 400 `bad_max_bookings` surfaces the typed error code
 *  - 409 `slot_unavailable` surfaces SlotUnavailableData on checkout
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ApiError,
  venuePackages,
  venueBookings,
  type BelowCurrentCountData,
  type SlotUnavailableData,
  type VenueSlot,
} from '@torny/api-client'

const VENUE_BASE = 'https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod'
const CLUB_ID = 5
const PACKAGE_ID = 9
const SLOT_ID = 12

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
  localStorage.setItem('torny.token', 'test-token')
})
afterEach(() => {
  localStorage.setItem('torny.token', 'test-token')
})

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message: string, data?: unknown) {
  return new Response(JSON.stringify({ status: 'error', code, message, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const PACKAGE_ECHO_WITH_CAPACITY = {
  id: PACKAGE_ID,
  slug: 'clubhouse',
  name: 'Clubhouse',
  sub: null,
  description: null,
  hero_image_url: null,
  hero_image_alt: null,
  bond_cents: 0,
  bond_label: null,
  is_active: true,
  display_order: 0,
  slot_count: 1,
  addon_count: 0,
  last_booked_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-11-09T00:00:00Z',
  slots: [
    {
      id: SLOT_ID,
      label: 'Afternoon',
      sub: null,
      price_cents: 30000,
      duration_hours: 4,
      default_start_time: '14:00',
      is_disabled: false,
      display_order: 10,
      max_bookings: 3,
    },
  ],
  addons: [],
}

describe('venuePackages.update — max_bookings round-trip', () => {
  it('PATCH carries max_bookings through the slot body to the server', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(PACKAGE_ECHO_WITH_CAPACITY))
    const slot: VenueSlot = {
      id: SLOT_ID,
      label: 'Afternoon',
      price_cents: 30000,
      duration_hours: 4,
      default_start_time: '14:00',
      is_disabled: false,
      max_bookings: 3,
    }
    const res = await venuePackages.update(CLUB_ID, PACKAGE_ID, { slots: [slot] })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${VENUE_BASE}/clubs/${CLUB_ID}/venue-packages/${PACKAGE_ID}`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.slots[0]).toMatchObject({ id: SLOT_ID, max_bookings: 3 })
    // The echo shows up on the resolved object so the editor can render
    // the updated capacity without a second fetch.
    expect(res.slots[0]!.max_bookings).toBe(3)
  })

  it('allows omitting max_bookings — server default (1) applies', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(PACKAGE_ECHO_WITH_CAPACITY))
    await venuePackages.update(CLUB_ID, PACKAGE_ID, {
      slots: [{ id: SLOT_ID, label: 'Afternoon', price_cents: 30000 }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body.slots[0].max_bookings).toBeUndefined()
  })
})

describe('venuePackages.update — error paths', () => {
  it('surfaces 400 `below_current_count` with the typed conflicts block', async () => {
    const conflictsData: BelowCurrentCountData = {
      field: 'max_bookings',
      conflicts: [
        {
          slot_id: SLOT_ID,
          requested_max: 1,
          dates: [
            { date: '2026-12-14', booked_count: 2 },
            { date: '2026-12-21', booked_count: 3 },
          ],
        },
      ],
    }
    fetchMock.mockResolvedValueOnce(
      errorResponse(
        400,
        'below_current_count',
        'Slot 12 already has 2 bookings on 2026-12-14. Cancel or move them before lowering the capacity.',
        conflictsData,
      ),
    )
    await expect(
      venuePackages.update(CLUB_ID, PACKAGE_ID, {
        slots: [{ id: SLOT_ID, label: 'Afternoon', price_cents: 30000, max_bookings: 1 }],
      }),
    ).rejects.toMatchObject({
      code: 'below_current_count',
    })
  })

  it('surfaces 400 `bad_max_bookings` on out-of-range values', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, 'bad_max_bookings', 'slot[0].max_bookings must be an integer between 1 and 999'),
    )
    let caught: ApiError | null = null
    try {
      await venuePackages.update(CLUB_ID, PACKAGE_ID, {
        slots: [{ id: SLOT_ID, label: 'Afternoon', price_cents: 30000, max_bookings: 0 }],
      })
    } catch (e) {
      caught = e as ApiError
    }
    expect(caught).not.toBeNull()
    expect(caught?.code).toBe('bad_max_bookings')
  })
})

describe('venuePackages.listPublic — max_bookings on the public shape', () => {
  it('surfaces max_bookings on every slot in the public response', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        packages: [
          {
            id: PACKAGE_ID,
            slug: 'clubhouse',
            name: 'Clubhouse',
            sub: null, description: null,
            hero_image_url: null, hero_image_alt: null,
            bond_cents: 0, bond_label: null,
            display_order: 0,
            slots: [
              {
                id: SLOT_ID,
                label: 'Afternoon',
                sub: null,
                price_cents: 30000,
                duration_hours: 4,
                default_start_time: '14:00',
                display_order: 10,
                max_bookings: 3,
              },
            ],
            addons: [],
          },
        ],
        settings: { deposit_percent: 15, balance_due_days_before: 14, is_active: true },
      }),
    )
    const res = await venuePackages.listPublic('nae-nae-bowling-club')
    expect(res.packages[0]!.slots[0]!.max_bookings).toBe(3)
  })
})

describe('venueBookings.checkout — slot_unavailable at capacity', () => {
  it('surfaces 409 slot_unavailable with a typed SlotUnavailableData block', async () => {
    const data: SlotUnavailableData = {
      slot_id: SLOT_ID,
      date: '2026-12-14',
      capacity: 3,
    }
    fetchMock.mockResolvedValueOnce(
      errorResponse(
        409,
        'slot_unavailable',
        'That slot is already fully booked for the selected date — please choose a different time or date.',
        data,
      ),
    )
    let caught: ApiError | null = null
    try {
      await venueBookings.checkout('nae-nae-bowling-club', {
        full_name: 'Jamie Tester',
        email: 'jamie@example.co.nz',
        booking_date: '2026-12-14',
        package_id: PACKAGE_ID,
        slot_id: SLOT_ID,
        attendee_count: 20,
        addons: [],
      })
    } catch (e) {
      caught = e as ApiError
    }
    expect(caught).not.toBeNull()
    expect(caught?.code).toBe('slot_unavailable')
    // Verify the data block matches the SlotUnavailableData shape.
    const body = caught?.body as { data?: SlotUnavailableData } | null
    expect(body?.data).toEqual(data)
  })
})
