<script setup lang="ts">
/**
 * Venue booking detail — v1. Backed by the Enquiries endpoints (reply,
 * archive, notes). The left column renders a parsed booking summary
 * card instead of raw plaintext when the parse succeeds, falling back
 * to the raw message otherwise.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import {
  enquiries as enquiriesApi,
  ApiError,
  type EnquiryDetail,
  type EnquiryStatus,
  type UpdateEnquiryInput,
} from '@torny/api-client'
import SendEmailModal, { type EmailRecipient, type SendEmailPayload } from '@/components/modals/SendEmailModal.vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { parseVenueBookingMessage, serializeVenueBookingMessage, formatMoney, type ParsedAddon } from './parseMessage'
import { useClickOutside } from '@/composables/useClickOutside'

interface BookingFormState {
  occasion: string
  guest_count: number | null
  package: string
  slot: string
  date_label: string
  setup: string
  addons: ParsedAddon[]
  notes: string
  booking_for: string
  total: number | null
  deposit: number | null
  balance: number | null
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const enquiryId = computed(() => Number(route.params.id))
const detail = ref<EnquiryDetail | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function loadDetail() {
  const cid = clubStore.current?.id
  const id = enquiryId.value
  if (typeof cid !== 'number' || Number.isNaN(id)) {
    loading.value = false
    notFound.value = true
    return
  }
  loading.value = true
  notFound.value = false
  try {
    detail.value = await enquiriesApi.get(cid, id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true
    else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load booking.')
      notFound.value = true
    }
    detail.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)
watch(() => enquiryId.value, loadDetail)
watch(() => clubStore.current?.id, loadDetail)

const parsed = computed(() => (detail.value ? parseVenueBookingMessage(detail.value.message) : null))

const statusTone: Record<EnquiryStatus, 'ok' | 'warn' | 'ink' | 'mute'> = {
  new: 'warn', read: 'ink', replied: 'ok', archived: 'mute',
}
const statusLabel: Record<EnquiryStatus, string> = {
  new: 'New', read: 'Read', replied: 'Replied', archived: 'Archived',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
  if (day < 28) { const wk = Math.floor(day / 7); return `${wk} week${wk === 1 ? '' : 's'} ago` }
  return new Date(iso).toLocaleDateString()
}
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── Notes ─────────────────────────────────────────────────────
const noteBody = ref('')
const addingNote = ref(false)

async function submitNote() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const body = noteBody.value.trim()
  if (!body) return
  addingNote.value = true
  try {
    const note = await enquiriesApi.addNote(cid, detail.value.id, body)
    detail.value.notes = [note, ...detail.value.notes]
    noteBody.value = ''
    toast.success('Note added.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not add note.')
  } finally {
    addingNote.value = false
  }
}

// ── Send email (bigger composer than inline reply) ────────────
const sendEmailOpen = ref(false)
const recipient = computed<EmailRecipient | null>(() => {
  if (!detail.value) return null
  return { name: detail.value.full_name, email: detail.value.email }
})
function openSendEmail() {
  if (!detail.value?.email) return
  sendEmailOpen.value = true
}
async function sendEmailViaReply(payload: SendEmailPayload) {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) throw new Error('No club or booking selected.')
  const res = await enquiriesApi.reply(cid, detail.value.id, {
    body: payload.body,
    subject: payload.subject,
  })
  if ('sent' in res.email_status && !res.email_status.sent) {
    const err = (res.email_status as { sent: false; error?: string }).error
    throw new Error(err ? `Delivery failed: ${err}` : 'Email delivery failed.')
  }
  await loadDetail()
}

// ── Customer card edit ────────────────────────────────────────
const editingCustomer = ref(false)
const customerDraft = ref({ full_name: '', email: '', phone: '' })
const savingCustomer = ref(false)

function openCustomerEdit() {
  if (!detail.value) return
  customerDraft.value = {
    full_name: detail.value.full_name,
    email: detail.value.email,
    phone: detail.value.phone ?? '',
  }
  editingCustomer.value = true
}
function cancelCustomerEdit() {
  if (savingCustomer.value) return
  editingCustomer.value = false
}
async function saveCustomer() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const patch: Record<string, string | null> = {}
  const d = customerDraft.value
  if (d.full_name.trim() && d.full_name.trim() !== detail.value.full_name) patch.full_name = d.full_name.trim()
  if (d.email.trim() && d.email.trim() !== detail.value.email) patch.email = d.email.trim()
  const trimmedPhone = d.phone.trim()
  const currentPhone = detail.value.phone ?? ''
  if (trimmedPhone !== currentPhone) patch.phone = trimmedPhone || null
  if (Object.keys(patch).length === 0) { editingCustomer.value = false; return }
  savingCustomer.value = true
  try {
    const fresh = await enquiriesApi.update(cid, detail.value.id, patch as UpdateEnquiryInput)
    // PATCH response omits the reply/note threads — keep ours.
    detail.value = { ...fresh, replies: detail.value.replies, notes: detail.value.notes }
    editingCustomer.value = false
    toast.success('Customer updated.')
  } catch (err) {
    toast.error(customerErrorMessage(err))
  } finally {
    savingCustomer.value = false
  }
}
function customerErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not update customer.'
  switch (err.code) {
    case 'bad_email':     return "That email isn't valid."
    case 'bad_full_name': return 'Name needs to be between 1 and 160 characters.'
    case 'bad_phone':     return 'Phone number is too long.'
    default:              return err.message || 'Could not update customer.'
  }
}

// ── Booking message edit ──────────────────────────────────────
// Structured form backed by the parser → serializer round-trip. The
// admin edits individual fields; on save we re-serialize to the exact
// plaintext VenueBookingBlock writes so parsing is stable next load.
const editingMessage = ref(false)
const savingMessage = ref(false)
const MESSAGE_MAX = 10000

function emptyForm(): BookingFormState {
  return {
    occasion: '', guest_count: null,
    package: '', slot: '',
    date_label: '', setup: '',
    addons: [],
    notes: '', booking_for: '',
    total: null, deposit: null, balance: null,
  }
}
const bookingForm = ref<BookingFormState>(emptyForm())

const serializedPreview = computed(() => serializeVenueBookingMessage(bookingForm.value))
const previewOverLimit = computed(() => serializedPreview.value.length > MESSAGE_MAX)

function openMessageEdit() {
  if (!detail.value) return
  const p = parseVenueBookingMessage(detail.value.message)
  // Hydrate from the parse. For junk messages (parse-fail) start blank
  // so admins can rebuild the structure cleanly; the raw text still
  // sits in the fallback card behind the modal.
  bookingForm.value = {
    occasion: p.occasion ?? '',
    guest_count: p.guest_count,
    package: p.package ?? '',
    slot: p.slot ?? '',
    date_label: p.date_label ?? '',
    setup: p.setup ?? '',
    addons: p.addons.map((a) => ({ name: a.name, quantity: a.quantity })),
    notes: p.notes ?? '',
    booking_for: p.booking_for ?? '',
    total: p.total,
    deposit: p.deposit,
    balance: p.balance,
  }
  editingMessage.value = true
}
function cancelMessageEdit() {
  if (savingMessage.value) return
  editingMessage.value = false
}

function addAddon() {
  bookingForm.value.addons.push({ name: '', quantity: null })
}
function removeAddon(idx: number) {
  bookingForm.value.addons.splice(idx, 1)
}

async function saveMessage() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const next = serializedPreview.value.trim()
  if (!next) { toast.error('Add at least an occasion + package.'); return }
  if (previewOverLimit.value) { toast.error('Message is over 10,000 characters.'); return }
  if (next === detail.value.message) { editingMessage.value = false; return }
  savingMessage.value = true
  try {
    const fresh = await enquiriesApi.update(cid, detail.value.id, { message: next })
    detail.value = { ...fresh, replies: detail.value.replies, notes: detail.value.notes }
    editingMessage.value = false
    toast.success('Booking details updated.')
  } catch (err) {
    if (err instanceof ApiError && err.code === 'bad_message') toast.error('Message failed validation — needs 1 to 10,000 characters.')
    else toast.error(err instanceof ApiError ? err.message : 'Could not update booking details.')
  } finally {
    savingMessage.value = false
  }
}

// ── Overflow menu + delete ────────────────────────────────────
const overflowOpen = ref(false)
const deleteConfirmOpen = ref(false)
const deleting = ref(false)

function toggleOverflow() { overflowOpen.value = !overflowOpen.value }
function openDeleteConfirm() { overflowOpen.value = false; deleteConfirmOpen.value = true }
function closeDeleteConfirm() { if (!deleting.value) deleteConfirmOpen.value = false }

async function confirmDelete() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  deleting.value = true
  try {
    await enquiriesApi.del(cid, detail.value.id)
    toast.success('Booking deleted.')
    router.push('/crm/venue-bookings')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not delete booking.')
    deleting.value = false
  }
}

// Close the overflow menu when the click lands anywhere outside it.
const overflowRef = ref<HTMLElement | null>(null)
useClickOutside(overflowRef, () => { if (overflowOpen.value) overflowOpen.value = false })

// ── Archive / unarchive ───────────────────────────────────────
const archiving = ref(false)
async function toggleArchive() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  const currentlyArchived = detail.value.status === 'archived'
  archiving.value = true
  try {
    await enquiriesApi.archive(cid, detail.value.id, currentlyArchived ? { unarchive: true } : {})
    toast.success(currentlyArchived ? 'Unarchived.' : 'Archived.')
    if (currentlyArchived) await loadDetail()
    else router.push('/crm/venue-bookings')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not update.')
  } finally {
    archiving.value = false
  }
}
</script>

<template>
  <div class="detail">
    <header class="detail__head">
      <router-link to="/crm/venue-bookings" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All venue bookings</span>
      </router-link>
      <div v-if="detail" class="detail__title-row">
        <h1 class="detail__title">
          {{ detail.full_name }}
          <template v-if="parsed?.occasion"> · {{ parsed.occasion }}</template>
        </h1>
        <span class="pill" :class="`pill--${statusTone[detail.status]}`">{{ statusLabel[detail.status] }}</span>
        <div class="detail__title-actions">
          <button
            type="button"
            class="detail__action-btn"
            :disabled="!detail.email || detail.status === 'archived'"
            :title="!detail.email ? 'No email on file' : detail.status === 'archived' ? 'Unarchive to send' : 'Send email'"
            @click="openSendEmail"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M2.5 4.5 8 9l5.5-4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Send email
          </button>
          <div ref="overflowRef" class="overflow">
            <button
              type="button"
              class="detail__action-btn detail__action-btn--icon"
              aria-label="More actions"
              :aria-expanded="overflowOpen"
              @click.stop="toggleOverflow"
            >⋯</button>
            <div v-if="overflowOpen" class="overflow__menu" @click.stop>
              <button type="button" class="overflow__item overflow__item--danger" @click="openDeleteConfirm">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9M7 7v4M9 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Delete booking…
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="detail" class="detail__sub">
        Submitted {{ timeAgo(detail.received_at) }} · {{ formatDateTime(detail.received_at) }}
      </p>
    </header>

    <div v-if="loading" class="empty"><div class="empty__title">Loading…</div></div>
    <div v-else-if="notFound" class="empty">
      <div class="empty__title">Booking not found</div>
      <div class="empty__hint">It may have been deleted or belongs to a different club.</div>
      <router-link to="/crm/venue-bookings" class="back back--emphasis">Back to venue bookings</router-link>
    </div>

    <div v-else-if="detail" class="detail__body">
      <div class="left">
        <!-- Parsed booking summary — only when parse succeeded. -->
        <section v-if="parsed?.ok" class="booking-card">
          <div class="booking-card__head">
            <div class="booking-card__eyebrow">
              <span class="booking-card__dot" />
              <span>Booking</span>
            </div>
            <button type="button" class="card-edit" @click="openMessageEdit">Edit details</button>
          </div>
          <div class="booking-card__hero">
            <div class="booking-card__hero-main">
              <div v-if="parsed.date_label" class="booking-card__date">{{ parsed.date_label }}</div>
              <div class="booking-card__pkg">
                {{ parsed.package }}
                <template v-if="parsed.slot"> · {{ parsed.slot }}</template>
              </div>
              <div v-if="parsed.guest_count != null" class="booking-card__guests">
                {{ parsed.guest_count }} guests
                <template v-if="parsed.setup"> · {{ parsed.setup }}</template>
              </div>
            </div>
            <div v-if="parsed.total != null" class="booking-card__totals">
              <div class="booking-card__total">{{ formatMoney(parsed.total) }}</div>
              <div class="booking-card__total-sub">
                <template v-if="parsed.deposit != null">Deposit {{ formatMoney(parsed.deposit) }}</template>
                <template v-if="parsed.deposit != null && parsed.balance != null"> · </template>
                <template v-if="parsed.balance != null">Balance {{ formatMoney(parsed.balance) }}</template>
              </div>
            </div>
          </div>

          <div v-if="parsed.addons.length" class="booking-card__addons">
            <div class="booking-card__section-label">Add-ons</div>
            <ul class="addons">
              <li v-for="(a, i) in parsed.addons" :key="i" class="addons__row">
                <span class="addons__name">{{ a.name }}</span>
                <span v-if="a.quantity != null" class="addons__qty">× {{ a.quantity }}</span>
              </li>
            </ul>
          </div>

          <div v-if="parsed.notes" class="booking-card__notes">
            <div class="booking-card__section-label">From the customer</div>
            <div class="booking-card__note-body">{{ parsed.notes }}</div>
          </div>

          <div v-if="parsed.booking_for" class="booking-card__for">
            <span class="booking-card__for-label">Booking on behalf of</span>
            <span class="booking-card__for-value">{{ parsed.booking_for }}</span>
          </div>
        </section>

        <!-- Fallback: show raw plaintext if we couldn't parse. -->
        <section v-else class="message-card">
          <div class="booking-card__head">
            <div class="message-card__eyebrow">
              <span class="message-card__dot" />
              <span>Raw message</span>
            </div>
            <button type="button" class="card-edit" @click="openMessageEdit">Edit</button>
          </div>
          <div class="message-card__body">{{ detail.message }}</div>
        </section>

        <!-- Customer card -->
        <section class="contact-card">
          <div class="booking-card__head">
            <div class="contact-card__eyebrow">
              <span class="contact-card__dot" />
              <span>Customer</span>
            </div>
            <button v-if="!editingCustomer" type="button" class="card-edit" @click="openCustomerEdit">Edit</button>
          </div>

          <div v-if="!editingCustomer" class="dl">
            <div class="dl__row"><dt>Name</dt><dd>{{ detail.full_name }}</dd></div>
            <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${detail.email}`">{{ detail.email }}</a></dd></div>
            <div v-if="detail.phone" class="dl__row"><dt>Phone</dt><dd><a class="link" :href="`tel:${detail.phone.replace(/\s+/g, '')}`">{{ detail.phone }}</a></dd></div>
            <div class="dl__row"><dt>Reply OK</dt><dd>{{ detail.consent_reply ? 'Yes' : 'No consent given' }}</dd></div>
          </div>

          <form v-else class="customer-edit" @submit.prevent="saveCustomer">
            <label class="field">
              <span>Name</span>
              <input v-model="customerDraft.full_name" type="text" required :disabled="savingCustomer" />
            </label>
            <label class="field">
              <span>Email</span>
              <input v-model="customerDraft.email" type="email" required :disabled="savingCustomer" />
            </label>
            <label class="field">
              <span>Phone <em>(empty to clear)</em></span>
              <input v-model="customerDraft.phone" type="tel" :disabled="savingCustomer" />
            </label>
            <div class="customer-edit__foot">
              <button type="button" class="card-btn" :disabled="savingCustomer" @click="cancelCustomerEdit">Cancel</button>
              <button type="submit" class="card-btn card-btn--primary" :disabled="savingCustomer">
                {{ savingCustomer ? 'Saving…' : 'Save customer' }}
              </button>
            </div>
          </form>
        </section>

        <!-- Reply thread -->
        <section v-if="detail.replies?.length" class="thread">
          <div class="thread__head">
            <h3 class="thread__title">Reply thread</h3>
            <span class="thread__count">{{ detail.replies.length }}</span>
          </div>
          <ul class="thread__list">
            <li v-for="r in detail.replies" :key="r.id" class="thread__reply">
              <div class="thread__reply-head">
                <span class="thread__author">{{ r.author_name ?? 'CRM' }}</span>
                <span class="thread__time">{{ timeAgo(r.sent_at) }}</span>
                <span v-if="r.email_status === 'failed'" class="thread__delivery thread__delivery--failed">Delivery failed</span>
              </div>
              <div class="thread__body">{{ r.body }}</div>
            </li>
          </ul>
        </section>
      </div>

      <!-- Right rail -->
      <aside class="rail">
        <div class="rail__status" :class="`rail__status--${statusTone[detail.status]}`">
          <div class="rail__avatar">{{ initials(detail.full_name) }}</div>
          <div class="rail__eyebrow">Status</div>
          <div class="rail__status-name">{{ statusLabel[detail.status] }}</div>
          <div v-if="detail.responded_at" class="rail__status-meta">Replied {{ timeAgo(detail.responded_at) }}</div>
          <div v-else-if="detail.status === 'archived'" class="rail__status-meta">Archived — no reply sent</div>
          <div v-else class="rail__status-meta">Awaiting reply</div>
        </div>

        <button
          type="button"
          class="rail-btn"
          :class="detail.status === 'archived' ? 'rail-btn--outline' : 'rail-btn--reject'"
          :disabled="archiving"
          @click="toggleArchive"
        >
          {{ archiving ? '…' : detail.status === 'archived' ? 'Unarchive' : 'Archive' }}
        </button>

        <div class="rail__notes">
          <div class="rail__notes-head">
            <h3 class="rail__notes-title">Internal notes</h3>
            <span class="rail__notes-count">{{ detail.notes?.length ?? 0 }}</span>
          </div>
          <p class="rail__hint">Only the CRM sees these. Never emailed.</p>
          <form class="note-form" @submit.prevent="submitNote">
            <textarea v-model="noteBody" rows="2" placeholder="Add an internal note…" :disabled="addingNote" />
            <button type="submit" class="rail-btn rail-btn--approve rail-btn--sm" :disabled="!noteBody.trim() || addingNote">
              {{ addingNote ? 'Adding…' : 'Add note' }}
            </button>
          </form>
          <ul v-if="detail.notes?.length" class="notes">
            <li v-for="n in detail.notes" :key="n.id" class="note">
              <div class="note__head">
                <span class="note__author">{{ n.author_name ?? 'CRM' }}</span>
                <span class="note__time">{{ timeAgo(n.created_at) }}</span>
              </div>
              <div class="note__body">{{ n.body }}</div>
            </li>
          </ul>
          <div v-else class="rail__notes-empty">No notes yet.</div>
        </div>
      </aside>
    </div>

    <SendEmailModal
      :open="sendEmailOpen"
      :club-id="clubStore.current?.id ?? null"
      :member="recipient"
      :send-handler="sendEmailViaReply"
      @close="sendEmailOpen = false"
    />

    <CrmModal
      :open="editingMessage"
      eyebrow="Venue bookings"
      :title="detail ? `Edit booking — ${detail.full_name}` : 'Edit booking'"
      width="lg"
      @close="cancelMessageEdit"
    >
      <form class="booking-form" @submit.prevent="saveMessage">
        <div class="booking-form__section">
          <div class="booking-form__section-label">Occasion</div>
          <div class="booking-form__row">
            <label class="field field--grow">
              <span>What's the booking for</span>
              <input v-model="bookingForm.occasion" type="text" placeholder="Birthday, Wedding, Corporate…" :disabled="savingMessage" />
            </label>
            <label class="field field--narrow">
              <span>Guests</span>
              <input v-model.number="bookingForm.guest_count" type="number" min="0" placeholder="40" :disabled="savingMessage" />
            </label>
          </div>
        </div>

        <div class="booking-form__section">
          <div class="booking-form__section-label">Package + slot</div>
          <div class="booking-form__row">
            <label class="field field--grow">
              <span>Package</span>
              <input v-model="bookingForm.package" type="text" placeholder="The clubhouse" :disabled="savingMessage" />
            </label>
            <label class="field field--grow">
              <span>Slot</span>
              <input v-model="bookingForm.slot" type="text" placeholder="Afternoon · 2pm – 6pm" :disabled="savingMessage" />
            </label>
          </div>
        </div>

        <div class="booking-form__section">
          <div class="booking-form__section-label">When + setup</div>
          <div class="booking-form__row">
            <label class="field field--grow">
              <span>Date</span>
              <input v-model="bookingForm.date_label" type="text" placeholder="Friday 13 November" :disabled="savingMessage" />
            </label>
            <label class="field field--grow">
              <span>Setup</span>
              <input v-model="bookingForm.setup" type="text" placeholder="Long tables + bar" :disabled="savingMessage" />
            </label>
          </div>
        </div>

        <div class="booking-form__section">
          <div class="booking-form__section-label-row">
            <div class="booking-form__section-label">Add-ons</div>
            <button type="button" class="card-edit" :disabled="savingMessage" @click="addAddon">+ Add</button>
          </div>
          <ul v-if="bookingForm.addons.length" class="addon-rows">
            <li v-for="(a, i) in bookingForm.addons" :key="i" class="addon-row">
              <label class="field field--grow">
                <span v-if="i === 0">Name</span>
                <input v-model="a.name" type="text" placeholder="Grazing platters" :disabled="savingMessage" />
              </label>
              <label class="field field--qty">
                <span v-if="i === 0">Qty</span>
                <input v-model.number="a.quantity" type="number" min="0" placeholder="—" :disabled="savingMessage" />
              </label>
              <button type="button" class="addon-row__remove" aria-label="Remove add-on" :disabled="savingMessage" @click="removeAddon(i)">×</button>
            </li>
          </ul>
          <div v-else class="booking-form__empty">No add-ons on this booking.</div>
        </div>

        <div class="booking-form__section">
          <div class="booking-form__section-label">From the customer</div>
          <label class="field">
            <span>Notes</span>
            <textarea
              v-model="bookingForm.notes"
              rows="3"
              placeholder="Dietary, access, anything they called out…"
              :disabled="savingMessage"
            />
          </label>
          <label class="field">
            <span>Booking on behalf of <em>(optional)</em></span>
            <input v-model="bookingForm.booking_for" type="text" placeholder="Douglas Rodda" :disabled="savingMessage" />
          </label>
        </div>

        <div class="booking-form__section">
          <div class="booking-form__section-label">Money</div>
          <div class="booking-form__row booking-form__row--money">
            <label class="field">
              <span>Total $</span>
              <input v-model.number="bookingForm.total" type="number" min="0" step="1" placeholder="1765" :disabled="savingMessage" />
            </label>
            <label class="field">
              <span>Deposit $</span>
              <input v-model.number="bookingForm.deposit" type="number" min="0" step="1" placeholder="441" :disabled="savingMessage" />
            </label>
            <label class="field">
              <span>Balance $</span>
              <input v-model.number="bookingForm.balance" type="number" min="0" step="1" placeholder="1324" :disabled="savingMessage" />
            </label>
          </div>
        </div>

        <div v-if="previewOverLimit" class="booking-form__warning">
          Message is over the 10,000-character limit — trim notes or add-ons.
        </div>
      </form>
      <template #footer>
        <button type="button" class="card-btn" :disabled="savingMessage" @click="cancelMessageEdit">Cancel</button>
        <button
          type="button"
          class="card-btn card-btn--primary"
          :disabled="savingMessage || previewOverLimit || !serializedPreview.trim()"
          @click="saveMessage"
        >
          {{ savingMessage ? 'Saving…' : 'Save details' }}
        </button>
      </template>
    </CrmModal>

    <CrmModal
      :open="deleteConfirmOpen"
      eyebrow="Danger zone"
      :title="detail ? `Delete booking — ${detail.full_name}?` : 'Delete booking?'"
      width="sm"
      @close="closeDeleteConfirm"
    >
      <p class="delete-copy">
        This permanently removes the booking, its reply history, and every internal note. It <strong>can't be undone</strong>.
      </p>
      <p class="delete-copy delete-copy--hint">
        If you just want it out of your inbox, use <strong>Archive</strong> instead — the booking stays searchable for audit.
      </p>
      <template #footer>
        <button type="button" class="card-btn" :disabled="deleting" @click="closeDeleteConfirm">Cancel</button>
        <button type="button" class="card-btn card-btn--danger" :disabled="deleting" @click="confirmDelete">
          {{ deleting ? 'Deleting…' : 'Delete permanently' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.detail { max-width: 1280px; display: flex; flex-direction: column; gap: 32px; }

.detail__head { display: flex; flex-direction: column; gap: 0; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.back--emphasis { color: var(--color-accent); margin-top: 16px; font-weight: 600; letter-spacing: normal; text-transform: none; font-size: 13px; }
.detail__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 6px; }
.detail__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.detail__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.detail__title-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.detail__action-btn { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.12s ease; }
.detail__action-btn:hover:not(:disabled) { background: var(--color-surface); }
.detail__action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.empty { padding: 96px 40px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 6px; }

.detail__body { display: grid; grid-template-columns: 1fr 340px; gap: 48px; align-items: flex-start; }
.left { display: flex; flex-direction: column; gap: 24px; min-width: 0; }

/* Booking summary card */
.booking-card { display: flex; flex-direction: column; gap: 20px; padding: 28px 32px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.booking-card__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.booking-card__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-accent); }
.booking-card__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.booking-card__hero-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.booking-card__date { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); }
.booking-card__pkg { font-family: var(--font-body); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.booking-card__guests { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); }
.booking-card__totals { text-align: right; flex-shrink: 0; }
.booking-card__total { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; }
.booking-card__total-sub { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 6px; letter-spacing: 0.04em; }

.booking-card__section-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.booking-card__addons { padding-top: 20px; border-top: 1px solid var(--color-hairline); }
.addons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.addons__row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 8px 12px; background: var(--color-surface); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.addons__qty { font-family: var(--font-mono); font-size: 12px; color: var(--color-graphite); }

.booking-card__notes { padding-top: 20px; border-top: 1px solid var(--color-hairline); }
.booking-card__note-body { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--color-ink); white-space: pre-wrap; }

.booking-card__for { padding: 12px 14px; background: var(--color-surface); border-radius: 10px; display: flex; flex-direction: column; gap: 2px; }
.booking-card__for-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.booking-card__for-value { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }

/* Raw-message fallback */
.message-card { display: flex; flex-direction: column; gap: 16px; padding: 28px 32px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.message-card__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.message-card__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-accent); }
.message-card__body { font-family: var(--font-body); font-size: 15px; line-height: 1.55; color: var(--color-ink); white-space: pre-wrap; }

/* Customer card */
.contact-card { display: flex; flex-direction: column; gap: 16px; padding: 24px 28px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.contact-card__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.contact-card__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-accent); }

.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 100px 1fr; gap: 16px; padding: 8px 0; align-items: baseline; }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

/* Thread */
.thread { display: flex; flex-direction: column; gap: 16px; padding: 24px 28px; background: var(--color-surface); border-radius: 14px; }
.thread__head { display: flex; align-items: baseline; gap: 10px; }
.thread__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.thread__count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: #fff; }
.thread__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.thread__reply { padding: 16px 18px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.thread__reply-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.thread__author { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.thread__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.thread__delivery { margin-left: auto; padding: 2px 8px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.thread__delivery--failed { background: #FEE2E2; color: #991B1B; }
.thread__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.5; white-space: pre-wrap; }

/* Right rail */
.rail { position: sticky; top: 32px; display: flex; flex-direction: column; gap: 20px; }
.rail__status { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 24px 24px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; }
.rail__status::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.rail__status--ok::before   { background: #16A34A; }
.rail__status--warn::before { background: var(--color-accent); }
.rail__status--ink::before  { background: var(--color-ink); }
.rail__status--mute::before { background: var(--color-mute); }
.rail__avatar { width: 56px; height: 56px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.rail__eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.rail__status-name { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.rail__status-meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.rail__section { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.rail__section-head { display: flex; align-items: baseline; gap: 10px; }
.rail__section-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.rail__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; line-height: 1.5; }

.reply-form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__head { display: flex; align-items: baseline; justify-content: space-between; }
.field > span, .field__head > span:first-child { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.field__counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-mute); }
.field__counter--over { color: var(--color-danger); }
.field input, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field textarea { min-height: 96px; line-height: 1.5; }
.field input:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }

.rail-btn { padding: 12px 18px; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; border: 0; transition: background 120ms, color 120ms, border-color 120ms; }
.rail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rail-btn--sm { padding: 8px 12px; font-size: 13px; }
.rail-btn--approve { background: var(--color-ink); color: #fff; }
.rail-btn--approve:hover:not(:disabled) { background: var(--color-graphite); }
.rail-btn--reject { background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.rail-btn--reject:hover:not(:disabled) { border-color: var(--color-ink); background: var(--color-surface); }
.rail-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.rail-btn--outline:hover:not(:disabled) { background: var(--color-surface); }

.rail__notes { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.rail__notes-head { display: flex; align-items: baseline; gap: 10px; }
.rail__notes-title { font-family: var(--font-display); font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin: 0; }
.rail__notes-count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); padding: 2px 8px; border-radius: 999px; background: var(--color-surface); }
.rail__notes-empty { padding: 16px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); background: var(--color-surface); border-radius: 10px; }
.note-form { display: flex; flex-direction: column; gap: 8px; }
.note-form textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; min-height: 68px; }
.note-form textarea:focus { outline: none; border-color: var(--color-ink); }
.notes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.note { padding: 12px 14px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; }
.note__head { display: flex; gap: 8px; align-items: baseline; }
.note__author { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }
.note__time { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.note__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin-top: 6px; }

/* Pills */
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok   { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--ink  { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

/* Card head — shared eyebrow row + edit affordance */
.booking-card__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.card-edit {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--color-hairline); background: #fff;
  color: var(--color-ink); font-family: var(--font-body); font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.card-edit:hover { background: var(--color-surface); border-color: var(--color-mute); }

/* Icon-only overflow button */
.detail__action-btn--icon { padding: 0 10px; min-width: 36px; justify-content: center; font-size: 18px; line-height: 1; }
.overflow { position: relative; }
.overflow__menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 10;
  min-width: 200px; padding: 6px;
  background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px;
  box-shadow: 0 12px 32px -12px rgba(15, 23, 42, 0.18);
  display: flex; flex-direction: column; gap: 2px;
}
.overflow__item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border: 0; border-radius: 8px;
  background: transparent; color: var(--color-ink);
  font-family: var(--font-body); font-size: 13px; font-weight: 500;
  cursor: pointer; text-align: left;
}
.overflow__item:hover { background: var(--color-surface); }
.overflow__item--danger { color: var(--color-danger); }
.overflow__item--danger:hover { background: #FEE2E2; color: #991B1B; }

/* Shared card buttons for cancel/save/danger inside edit flows */
.card-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 10px;
  border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink);
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background 0.12s ease;
}
.card-btn:hover:not(:disabled) { background: var(--color-surface); }
.card-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.card-btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.card-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.card-btn--danger  { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
.card-btn--danger:hover:not(:disabled)  { background: #B91C1C; border-color: #B91C1C; }

/* Booking-edit modal — structured form */
.booking-form { display: flex; flex-direction: column; gap: 20px; }
.booking-form__section { display: flex; flex-direction: column; gap: 10px; }
.booking-form__section-label-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.booking-form__section-label {
  font-family: var(--font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog);
}
.booking-form__row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.booking-form__row--money { gap: 10px; }
.booking-form__row--money .field { flex: 1 1 120px; }
.booking-form__row .field--grow { flex: 1 1 220px; }
.booking-form__row .field--narrow { flex: 0 0 110px; }

.booking-form .field { display: flex; flex-direction: column; gap: 6px; }
.booking-form .field > span {
  font-family: var(--font-body); font-size: 11px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog);
}
.booking-form .field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.booking-form .field input,
.booking-form .field textarea {
  padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px;
  font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff;
  box-sizing: border-box; width: 100%;
}
.booking-form .field textarea { line-height: 1.5; resize: vertical; min-height: 68px; }
.booking-form .field input:focus,
.booking-form .field textarea:focus { outline: none; border-color: var(--color-ink); }

/* Add-ons list — rows with name + qty + remove */
.addon-rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.addon-row { display: flex; align-items: flex-end; gap: 8px; }
.addon-row .field--qty { flex: 0 0 90px; }
.addon-row__remove {
  flex: 0 0 32px; height: 36px; margin-bottom: 1px;
  border: 1px solid var(--color-hairline); border-radius: 8px;
  background: #fff; color: var(--color-fog);
  font-family: var(--font-body); font-size: 18px; line-height: 1; cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.addon-row__remove:hover:not(:disabled) {
  background: #FEE2E2; border-color: #FCA5A5; color: #991B1B;
}
.addon-row__remove:disabled { opacity: 0.5; cursor: not-allowed; }

.booking-form__empty {
  padding: 12px 14px; background: var(--color-surface); border-radius: 8px;
  font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-align: center;
}
.booking-form__warning {
  padding: 10px 12px; background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: 8px;
  font-family: var(--font-body); font-size: 12px; font-weight: 600; color: #991B1B;
}

/* Customer card — edit mode */
.customer-edit { display: flex; flex-direction: column; gap: 14px; }
.customer-edit .field { display: flex; flex-direction: column; gap: 6px; }
.customer-edit .field > span { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.customer-edit .field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.customer-edit .field input {
  padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px;
  font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff;
}
.customer-edit .field input:focus { outline: none; border-color: var(--color-ink); }
.customer-edit__foot { display: flex; gap: 8px; justify-content: flex-end; }

/* Delete confirm */
.delete-copy { margin: 0 0 12px; font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--color-ink); }
.delete-copy--hint { color: var(--color-fog); font-size: 13px; margin-bottom: 0; }

@media (max-width: 1023px) {
  .detail__body { grid-template-columns: 1fr; gap: 32px; }
  .rail { position: static; }
}
</style>
