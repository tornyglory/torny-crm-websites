/**
 * VenueBookingDetailView — detail view component tests.
 *
 * Mocks the api-client's `enquiries` resource so no network is hit.
 * Covers:
 *  - the booking card renders parsed fields on first load
 *  - "Edit details" opens the modal with the form hydrated from the
 *    parse, and Save PATCHes with the exact serialized plaintext
 *  - overflow → Delete → confirm fires DELETE and routes back to list
 *  - PATCH responses that omit `replies`/`notes` don't crash the view
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import VenueBookingDetailView from './VenueBookingDetailView.vue'
import { useClubStore } from '@/stores/club'

const { getMock, updateMock, delMock, archiveMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  updateMock: vi.fn(),
  delMock: vi.fn(),
  archiveMock: vi.fn(),
}))

vi.mock('@torny/api-client', async () => {
  const actual = await vi.importActual<typeof import('@torny/api-client')>('@torny/api-client')
  return {
    ...actual,
    enquiries: {
      get: getMock,
      update: updateMock,
      del: delMock,
      archive: archiveMock,
      addNote: vi.fn(),
      reply: vi.fn(),
    },
  }
})

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: toastInfo }),
}))

// Stub the SendEmailModal — it imports some bulky deps and we don't
// exercise its send path in these tests.
vi.mock('@/components/modals/SendEmailModal.vue', () => ({
  default: { template: '<div class="send-email-modal-stub" />' },
}))

const ROW_12_MESSAGE = `Birthday · 40 guests
The clubhouse · Afternoon · 2pm – 6pm
Friday 13 November
Setup: Long tables + bar
Add-ons:
• Grazing platters × 9
Notes: Yes, we have a bunch of people that are vegetarian.
Booking on behalf of: Douglas Rodda
Total: $1765 · Deposit: $441 · Balance: $1324`

const fakeDetail = {
  id: 12,
  club_id: 5,
  status: 'new' as const,
  full_name: 'Test Booking',
  email: 'testbooking@torny.co',
  phone: '021456854',
  topic: 'facilities' as const,
  message: ROW_12_MESSAGE,
  consent_reply: 1 as const,
  created_at: '2026-10-26T11:05:06.000Z',
  updated_at: '2026-10-26T11:05:06.000Z',
  received_at: '2026-10-26T11:05:06.000Z',
  responded_at: null,
  responder_user_id: null,
  replies: [],
  notes: [],
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
  await router.push('/crm/venue-bookings/12')
  await router.isReady()
  const wrapper = mount(VenueBookingDetailView, {
    global: { plugins: [pinia, router] },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  getMock.mockReset()
  updateMock.mockReset()
  delMock.mockReset()
  archiveMock.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastInfo.mockReset()
  getMock.mockResolvedValue({ ...fakeDetail })
})

describe('VenueBookingDetailView — initial render', () => {
  it('fetches the detail for the route id', async () => {
    await mountView()
    expect(getMock).toHaveBeenCalledWith(5, 12)
  })

  it('renders the parsed date on the booking card', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Friday 13 November')
  })

  it('renders the parsed package + slot', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('The clubhouse')
    expect(wrapper.text()).toContain('Afternoon · 2pm – 6pm')
  })

  it('renders the parsed add-on', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Grazing platters')
  })

  it('renders the formatted total', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('$1,765')
  })

  it('renders the booking-on-behalf-of card', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('Douglas Rodda')
  })
})

describe('VenueBookingDetailView — edit details modal', () => {
  it('opens the modal when "Edit details" is clicked', async () => {
    const { wrapper } = await mountView()
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit details')
    expect(editBtn).toBeTruthy()
    await editBtn!.trigger('click')
    await nextTick()
    expect(wrapper.find('.booking-form').exists()).toBe(true)
  })

  it('hydrates the modal form from the parsed message', async () => {
    const { wrapper } = await mountView()
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit details')
    await editBtn!.trigger('click')
    await nextTick()
    // Vue's v-model sets `.value` on the DOM node — not an HTML attr —
    // so pull it off the elements directly.
    const values = wrapper
      .findAll<HTMLInputElement>('.booking-form input')
      .map((n) => n.element.value)
    expect(values).toContain('Birthday')
    expect(values).toContain('The clubhouse')
    expect(values).toContain('Afternoon · 2pm – 6pm')
    expect(values).toContain('Friday 13 November')
    expect(values).toContain('Grazing platters')
  })

  it('PATCHes with the serialized plaintext when Save is pressed', async () => {
    updateMock.mockResolvedValue({ ...fakeDetail, message: ROW_12_MESSAGE })
    const { wrapper } = await mountView()
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit details')
    await editBtn!.trigger('click')
    await nextTick()

    // Change the occasion field.
    const occInput = wrapper.find('input[placeholder^="Birthday"]')
    expect(occInput.exists()).toBe(true)
    await occInput.setValue('Wedding')

    const saveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase().startsWith('save details'))
    expect(saveBtn).toBeTruthy()
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(updateMock).toHaveBeenCalled()
    const [clubId, enquiryId, patch] = updateMock.mock.calls[0]!
    expect(clubId).toBe(5)
    expect(enquiryId).toBe(12)
    expect(patch.message).toContain('Wedding · 40 guests')
    // The rest of the structure survives the round-trip.
    expect(patch.message).toContain('The clubhouse · Afternoon · 2pm – 6pm')
    expect(patch.message).toContain('Total: $1765 · Deposit: $441 · Balance: $1324')
  })

  it('does not crash when the PATCH response omits replies/notes', async () => {
    // Simulate the backend's actual payload shape — PATCH omits the
    // thread arrays because they're not editable.
    const stripped = { ...fakeDetail, message: ROW_12_MESSAGE } as Record<string, unknown>
    delete stripped.replies
    delete stripped.notes
    updateMock.mockResolvedValue(stripped)

    const { wrapper } = await mountView()
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit details')
    await editBtn!.trigger('click')
    await nextTick()
    const saveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase().startsWith('save details'))
    await saveBtn!.trigger('click')
    await flushPromises()

    // We should still be on the page with the booking card rendering.
    expect(wrapper.text()).toContain('Friday 13 November')
  })
})

describe('VenueBookingDetailView — delete flow', () => {
  it('opens the delete confirm from the overflow menu', async () => {
    const { wrapper } = await mountView()
    const overflowBtn = wrapper.find('.detail__action-btn--icon')
    expect(overflowBtn.exists()).toBe(true)
    await overflowBtn.trigger('click')
    await nextTick()
    expect(wrapper.find('.overflow__menu').exists()).toBe(true)

    const deleteItem = wrapper
      .findAll('.overflow__item')
      .find((b) => b.text().toLowerCase().includes('delete'))
    expect(deleteItem).toBeTruthy()
    await deleteItem!.trigger('click')
    await nextTick()
    expect(wrapper.text()).toContain("can't be undone")
  })

  it('calls enquiries.del and routes back to the list on confirm', async () => {
    delMock.mockResolvedValue(undefined)
    const { wrapper, router } = await mountView()

    const overflowBtn = wrapper.find('.detail__action-btn--icon')
    await overflowBtn.trigger('click')
    await nextTick()
    const deleteItem = wrapper
      .findAll('.overflow__item')
      .find((b) => b.text().toLowerCase().includes('delete'))
    await deleteItem!.trigger('click')
    await nextTick()

    const confirmBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase().startsWith('delete permanently'))
    expect(confirmBtn).toBeTruthy()
    await confirmBtn!.trigger('click')
    await flushPromises()

    expect(delMock).toHaveBeenCalledWith(5, 12)
    expect(router.currentRoute.value.name).toBe('venue-bookings')
  })
})

describe('VenueBookingDetailView — error branches', () => {
  // Lazy-import ApiError from the real module so we can throw an error
  // shape that matches what the api-client surfaces at runtime.
  async function makeApiError(code: string, message: string, status = 400) {
    const { ApiError } = await import('@torny/api-client')
    return new ApiError(status, message, code, { code, message })
  }

  async function openEditModal(wrapper: ReturnType<typeof mount>) {
    const editBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit details')
    await editBtn!.trigger('click')
    await nextTick()
  }

  async function clickSave(wrapper: ReturnType<typeof mount>) {
    const saveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase().startsWith('save details'))
    await saveBtn!.trigger('click')
    await flushPromises()
  }

  it('bad_email on customer save → targeted error toast + form stays open', async () => {
    updateMock.mockRejectedValueOnce(await makeApiError('bad_email', "That email isn't valid."))
    const { wrapper } = await mountView()
    const customerEditBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit')
    await customerEditBtn!.trigger('click')
    await nextTick()
    const emailInput = wrapper.find<HTMLInputElement>('.customer-edit input[type="email"]')
    await emailInput.setValue('not-an-email')
    await wrapper.find('.customer-edit').trigger('submit')
    await flushPromises()
    expect(updateMock).toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    expect(toastError.mock.calls[0]![0]).toContain("isn't valid")
    expect(wrapper.find('.customer-edit').exists()).toBe(true)
  })

  it('bad_full_name on customer save → "between 1 and 160 characters" toast', async () => {
    updateMock.mockRejectedValueOnce(await makeApiError('bad_full_name', 'Name too long'))
    const { wrapper } = await mountView()
    const customerEditBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit')
    await customerEditBtn!.trigger('click')
    await nextTick()
    const nameInput = wrapper.find<HTMLInputElement>('.customer-edit input[type="text"]')
    await nameInput.setValue('x'.repeat(161))
    // jsdom doesn't bubble submit from clicking type="submit" buttons the
    // way browsers do; trigger submit directly on the form.
    await wrapper.find('.customer-edit').trigger('submit')
    await flushPromises()
    expect(updateMock).toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    expect(toastError.mock.calls[0]![0]).toContain('1 and 160 characters')
  })

  it('nothing-to-patch (no changes) on customer save → short-circuits locally, no PATCH', async () => {
    const { wrapper } = await mountView()
    const customerEditBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase() === 'edit')
    await customerEditBtn!.trigger('click')
    await nextTick()
    // Submit without changing anything.
    await wrapper.find('.customer-edit').trigger('submit')
    await flushPromises()
    await nextTick()
    // Patch body is empty → FE short-circuits, no API call, no error.
    expect(updateMock).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    // Edit mode exited — the customer-edit form is unmounted.
    expect(wrapper.find('.customer-edit').exists()).toBe(false)
  })

  it('bad_message on booking save → specific error toast + modal stays open', async () => {
    updateMock.mockRejectedValueOnce(await makeApiError('bad_message', 'Message failed validation'))
    const { wrapper } = await mountView()
    await openEditModal(wrapper)
    const occInput = wrapper.find<HTMLInputElement>('input[placeholder^="Birthday"]')
    await occInput.setValue('Something new')
    await clickSave(wrapper)
    expect(toastError).toHaveBeenCalled()
    expect(toastError.mock.calls[0]![0]).toContain('1 to 10,000')
    expect(wrapper.find('.booking-form').exists()).toBe(true)
  })

  it('delete 404 → surfaces error toast and stays on the page', async () => {
    delMock.mockRejectedValueOnce(await makeApiError('not_found', 'Not found', 404))
    const { wrapper, router } = await mountView()
    const overflowBtn = wrapper.find('.detail__action-btn--icon')
    await overflowBtn.trigger('click')
    await nextTick()
    const deleteItem = wrapper
      .findAll('.overflow__item')
      .find((b) => b.text().toLowerCase().includes('delete'))
    await deleteItem!.trigger('click')
    await nextTick()
    const confirmBtn = wrapper
      .findAll('button')
      .find((b) => b.text().toLowerCase().startsWith('delete permanently'))
    await confirmBtn!.trigger('click')
    await flushPromises()
    expect(delMock).toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    // Should not have redirected — still on the detail page.
    expect(router.currentRoute.value.name).toBe('venue-booking-detail')
  })
})
