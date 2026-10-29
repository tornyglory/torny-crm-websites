/**
 * VenueBookingsView — list view component tests.
 *
 * Covers the wiring the parser tests can't:
 *  - club id → enquiriesApi.list is called with topic='facilities' pinned
 *  - a parsed row surfaces the right human-facing bits
 *  - status chip clicks re-fetch with the new status param
 *  - a row click navigates to /crm/venue-bookings/:id
 *
 * We mock @torny/api-client so no network is hit. The club store is
 * primed via pinia's `createTestingPinia`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import VenueBookingsView from './VenueBookingsView.vue'
import { useClubStore } from '@/stores/club'

// ── Mock the api-client. Only `enquiries.list` is touched by this view.
// `vi.mock` is hoisted — use `vi.hoisted()` so our mock fn exists when
// the factory runs. Alternative is a module-level setter but this reads
// cleaner.
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))
vi.mock('@torny/api-client', async () => {
  const actual = await vi.importActual<typeof import('@torny/api-client')>('@torny/api-client')
  return {
    ...actual,
    enquiries: { list: listMock },
  }
})

// ── Mock the toast — assertions don't care about its UI.
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// A row with the full row-12 message as `message_preview`.
const row12Preview = `Birthday · 40 guests
The clubhouse · Afternoon · 2pm – 6pm
Friday 13 November
Setup: Long tables + bar`

const fakeRow = {
  id: 12,
  status: 'new' as const,
  full_name: 'Test Booking',
  email: 'testbooking@torny.co',
  phone: '021456854',
  topic: 'facilities' as const,
  message_preview: row12Preview,
  received_at: new Date().toISOString(),
  responded_at: null,
  responder_user_id: null,
  note_count: 0,
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/crm/venue-bookings', name: 'venue-bookings', component: { template: '<div />' } },
      {
        path: '/crm/venue-bookings/:id',
        name: 'venue-booking-detail',
        component: { template: '<div />' },
      },
    ],
  })
}

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const club = useClubStore()
  club.setCurrent({
    id: 5,
    name: 'Naenae Bowling Club',
    slug: 'naenae',
    domain: null,
    brandPrimary: null,
    logoUrl: null,
  })
  const router = makeRouter()
  await router.push('/crm/venue-bookings')
  await router.isReady()
  const wrapper = mount(VenueBookingsView, {
    global: { plugins: [pinia, router] },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  listMock.mockReset()
  listMock.mockResolvedValue({
    enquiries: [fakeRow],
    counts: { new: 1, read: 0, replied: 0, archived: 0 },
    pagination: { limit: 50, offset: 0, total: 1 },
  })
})

describe('VenueBookingsView — list fetch', () => {
  it('calls enquiriesApi.list with topic pinned to facilities', async () => {
    await mountView()
    expect(listMock).toHaveBeenCalled()
    const [clubId, params] = listMock.mock.calls[0]!
    expect(clubId).toBe(5)
    expect(params.topic).toBe('facilities')
  })

  it('defaults the status filter to new', async () => {
    await mountView()
    const [, params] = listMock.mock.calls[0]!
    expect(params.status).toBe('new')
  })
})

describe('VenueBookingsView — row rendering', () => {
  it('surfaces the parsed occasion as a badge', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Birthday')
  })

  it('surfaces the parsed date label on the row summary', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Friday 13 November')
  })

  it('surfaces the parsed guest count', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('40 guests')
  })

  it('surfaces the parsed package', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('The clubhouse')
  })

  it('shows the customer full_name + email', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Test Booking')
    expect(wrapper.text()).toContain('testbooking@torny.co')
  })
})

describe('VenueBookingsView — chip filter + row click', () => {
  it('re-fetches with status=replied when the Replied chip is clicked', async () => {
    const { wrapper } = await mountView()
    listMock.mockClear()
    const chip = wrapper
      .findAll('.chip')
      .find((n) => n.text().toLowerCase().includes('replied'))
    expect(chip).toBeTruthy()
    await chip!.trigger('click')
    await flushPromises()
    expect(listMock).toHaveBeenCalled()
    const [, params] = listMock.mock.calls[0]!
    expect(params.status).toBe('replied')
  })

  it('navigates to the detail route when the row is clicked', async () => {
    const { wrapper, router } = await mountView()
    const row = wrapper.find('.row')
    expect(row.exists()).toBe(true)
    await row.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('venue-booking-detail')
    expect(router.currentRoute.value.params.id).toBe('12')
  })
})

describe('VenueBookingsView — empty state', () => {
  it('shows the inbox-zero copy when no rows + status=new', async () => {
    listMock.mockResolvedValueOnce({
      enquiries: [],
      counts: { new: 0, read: 0, replied: 0, archived: 0 },
      pagination: { limit: 50, offset: 0, total: 0 },
    })
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Nothing new')
  })
})
