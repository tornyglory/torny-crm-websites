<script setup lang="ts">
/**
 * Venue booking detail (brief 62 v1).
 *
 * Reads a structured `venue_bookings` row and lets admins drive the
 * state machine: pending → confirmed / declined, confirmed → cancelled.
 * Soft-delete sits behind an overflow menu to avoid an easy-to-hit
 * foot-gun — the delete modal asks for explicit confirmation.
 *
 * Replaces the pre-brief workaround that parsed plaintext out of an
 * enquiry's `message` field. Snapshot fields render directly from the
 * server — no parsing, no round-trip drift.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import { useClickOutside } from '@/composables/useClickOutside'
import {
  venueBookings as venueBookingsApi,
  ApiError,
  type VenueBooking,
  type BookingStatus,
  type AddonLine,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'

const route = useRoute()
const router = useRouter()
const clubStore = useClubStore()
const toast = useToast()

const bookingId = computed(() => Number(route.params.id))
const detail = ref<VenueBooking | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function loadDetail(): Promise<void> {
  const cid = clubStore.current?.id
  const id = bookingId.value
  if (typeof cid !== 'number' || Number.isNaN(id)) {
    loading.value = false
    notFound.value = true
    return
  }
  loading.value = true
  notFound.value = false
  try {
    detail.value = await venueBookingsApi.get(cid, id)
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
watch(() => bookingId.value, loadDetail)
watch(() => clubStore.current?.id, loadDetail)

// ── Display helpers ──────────────────────────────────────────
const statusTone: Record<BookingStatus, 'ok' | 'warn' | 'danger' | 'ink' | 'mute'> = {
  pending: 'warn', confirmed: 'ok', declined: 'danger', cancelled: 'mute', completed: 'ink',
}
const statusLabel: Record<BookingStatus, string> = {
  pending: 'Pending', confirmed: 'Confirmed', declined: 'Declined',
  cancelled: 'Cancelled', completed: 'Completed',
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
const DATE_FMT = new Intl.DateTimeFormat('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d)
}
function formatTime(hms: string | null): string {
  if (!hms) return '—'
  const [h, m] = hms.split(':')
  if (!h || !m) return hms
  const hourNum = Number(h)
  const suffix = hourNum >= 12 ? 'pm' : 'am'
  const twelve = hourNum % 12 || 12
  return `${twelve}:${m}${suffix}`
}
const DATETIME_FMT = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : DATETIME_FMT.format(d)
}
function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Transitions ──────────────────────────────────────────────
const confirmSubmitting = ref(false)
async function submitConfirm(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value || confirmSubmitting.value) return
  confirmSubmitting.value = true
  try {
    const updated = await venueBookingsApi.confirm(cid, detail.value.id)
    detail.value = updated
    toast.success('Booking confirmed.')
  } catch (err) {
    const code = err instanceof ApiError ? (err.body as { code?: string } | undefined)?.code : null
    toast.error(code === 'bad_status_transition'
      ? 'Booking is no longer pending — refresh to see the latest state.'
      : err instanceof ApiError ? err.message : 'Could not confirm.')
  } finally {
    confirmSubmitting.value = false
  }
}

const declineOpen = ref(false)
const declineSubmitting = ref(false)
const declineReason = ref('')
function openDecline(): void { declineReason.value = ''; declineOpen.value = true }
async function submitDecline(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  declineSubmitting.value = true
  try {
    const updated = await venueBookingsApi.decline(cid, detail.value.id, declineReason.value.trim() || undefined)
    detail.value = updated
    toast.success('Booking declined.')
    declineOpen.value = false
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not decline.')
  } finally {
    declineSubmitting.value = false
  }
}

const cancelOpen = ref(false)
const cancelSubmitting = ref(false)
function openCancel(): void { cancelOpen.value = true }
async function submitCancel(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  cancelSubmitting.value = true
  try {
    const updated = await venueBookingsApi.cancel(cid, detail.value.id)
    detail.value = updated
    toast.success('Booking cancelled.')
    cancelOpen.value = false
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not cancel.')
  } finally {
    cancelSubmitting.value = false
  }
}

const deleteOpen = ref(false)
const deleteSubmitting = ref(false)
function openDelete(): void { overflowOpen.value = false; deleteOpen.value = true }
async function submitDelete(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !detail.value) return
  deleteSubmitting.value = true
  try {
    await venueBookingsApi.remove(cid, detail.value.id)
    toast.success('Booking deleted.')
    router.push('/crm/venue-bookings')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not delete.')
  } finally {
    deleteSubmitting.value = false
  }
}

// ── Overflow menu ─────────────────────────────────────────────
const overflowOpen = ref(false)
const overflowRef = ref<HTMLElement | null>(null)
useClickOutside(overflowRef, () => { overflowOpen.value = false })
</script>

<template>
  <div class="bd">
    <header class="bd__head">
      <router-link to="/crm/venue-bookings" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All bookings</span>
      </router-link>
      <div v-if="detail" class="bd__title-row">
        <h1 class="bd__title">{{ detail.full_name }}</h1>
        <span class="pill" :class="`pill--${statusTone[detail.status]}`">{{ statusLabel[detail.status] }}</span>
        <span class="bd__ref">{{ detail.booking_ref }}</span>
        <div ref="overflowRef" class="overflow">
          <button type="button" class="icon-btn" aria-label="Booking actions menu" @click="overflowOpen = !overflowOpen">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>
          </button>
          <div v-if="overflowOpen" class="overflow__menu" role="menu">
            <button type="button" class="overflow__item overflow__item--danger" @click="openDelete">Delete booking</button>
          </div>
        </div>
      </div>
    </header>

    <div v-if="loading" class="empty">
      <div class="empty__title">Loading…</div>
    </div>
    <div v-else-if="notFound" class="empty">
      <div class="empty__title">Booking not found</div>
      <router-link to="/crm/venue-bookings" class="back back--emphasis">Back to bookings</router-link>
    </div>

    <div v-else-if="detail" class="bd__body">
      <div class="left">
        <!-- Booking summary -->
        <section class="card">
          <div class="card__head">
            <div class="card__eyebrow"><span class="card__dot" />Booking</div>
          </div>
          <div class="card__hero">
            <div class="card__hero-main">
              <div class="card__date">{{ formatDate(detail.booking_date) }}</div>
              <div class="card__pkg">
                {{ detail.package_name_snapshot ?? '—' }}
                <template v-if="detail.slot_label_snapshot"> · {{ detail.slot_label_snapshot }}</template>
              </div>
              <div v-if="detail.start_time || detail.attendee_count != null" class="card__sub">
                <template v-if="detail.start_time">Starts {{ formatTime(detail.start_time) }}</template>
                <template v-if="detail.start_time && detail.attendee_count != null"> · </template>
                <template v-if="detail.attendee_count != null">{{ detail.attendee_count }} guests</template>
              </div>
            </div>
            <div class="card__totals">
              <div class="card__total">{{ formatCurrency(detail.total_cents) }}</div>
              <div class="card__total-sub">
                Deposit {{ formatCurrency(detail.deposit_cents) }} · Balance {{ formatCurrency(detail.balance_cents) }}
              </div>
            </div>
          </div>

          <div v-if="detail.addons_snapshot.length > 0" class="card__addons">
            <div class="card__section-label">Add-ons</div>
            <ul class="addons">
              <li v-for="(a, i) in (detail.addons_snapshot as AddonLine[])" :key="i" class="addons__row">
                <span class="addons__name">{{ a.name }}</span>
                <span v-if="a.quantity > 1" class="addons__qty">× {{ a.quantity }}</span>
                <span class="addons__amount">{{ formatCurrency(a.line_cents) }}</span>
              </li>
            </ul>
          </div>

          <div v-if="detail.message" class="card__notes">
            <div class="card__section-label">From the customer</div>
            <div class="card__note-body">{{ detail.message }}</div>
          </div>
        </section>

        <!-- Pricing breakdown -->
        <section class="card">
          <h2 class="card__title">Pricing</h2>
          <dl class="dl">
            <div class="dl__row"><dt>Slot</dt><dd>{{ formatCurrency(detail.slot_price_cents) }}</dd></div>
            <div v-if="detail.addons_total_cents > 0" class="dl__row"><dt>Add-ons</dt><dd>{{ formatCurrency(detail.addons_total_cents) }}</dd></div>
            <div v-if="detail.bond_cents > 0" class="dl__row"><dt>Bond</dt><dd>{{ formatCurrency(detail.bond_cents) }}</dd></div>
            <div class="dl__row dl__row--total"><dt>Total</dt><dd>{{ formatCurrency(detail.total_cents) }}</dd></div>
            <div class="dl__row"><dt>Deposit ({{ detail.deposit_percent_snapshot }}%)</dt><dd>{{ formatCurrency(detail.deposit_cents) }}</dd></div>
            <div class="dl__row"><dt>Balance</dt><dd>{{ formatCurrency(detail.balance_cents) }}<span v-if="detail.balance_due_date" class="dl__muted"> · due {{ detail.balance_due_date }}</span></dd></div>
          </dl>
        </section>

        <!-- Customer -->
        <section class="card">
          <h2 class="card__title">Customer</h2>
          <dl class="dl">
            <div class="dl__row"><dt>Name</dt><dd>{{ detail.full_name }}</dd></div>
            <div class="dl__row"><dt>Email</dt><dd><a class="link" :href="`mailto:${detail.email}`">{{ detail.email }}</a></dd></div>
            <div v-if="detail.phone" class="dl__row"><dt>Phone</dt><dd><a class="link" :href="`tel:${detail.phone.replace(/\s+/g, '')}`">{{ detail.phone }}</a></dd></div>
          </dl>
        </section>

        <!-- Workflow metadata -->
        <section class="card">
          <h2 class="card__title">Timeline</h2>
          <dl class="dl">
            <div class="dl__row"><dt>Submitted</dt><dd>{{ formatDateTime(detail.created_at) }}</dd></div>
            <div v-if="detail.confirmed_at" class="dl__row"><dt>Confirmed</dt><dd>{{ formatDateTime(detail.confirmed_at) }}</dd></div>
            <div v-if="detail.declined_at" class="dl__row"><dt>Declined</dt><dd>{{ formatDateTime(detail.declined_at) }}</dd></div>
            <div v-if="detail.decline_reason" class="dl__row"><dt>Reason</dt><dd>{{ detail.decline_reason }}</dd></div>
            <div v-if="detail.cancelled_at" class="dl__row"><dt>Cancelled</dt><dd>{{ formatDateTime(detail.cancelled_at) }}</dd></div>
          </dl>
        </section>
      </div>

      <!-- Right rail: status actions -->
      <aside class="rail">
        <div class="rail__status" :class="`rail__status--${statusTone[detail.status]}`">
          <div class="rail__avatar">{{ initials(detail.full_name) }}</div>
          <div class="rail__eyebrow">STATUS</div>
          <div class="rail__status-name">{{ statusLabel[detail.status] }}</div>
          <div class="rail__status-meta">
            <template v-if="detail.status === 'pending'">Awaiting decision</template>
            <template v-else-if="detail.confirmed_at">Confirmed {{ formatDateTime(detail.confirmed_at) }}</template>
            <template v-else-if="detail.declined_at">Declined {{ formatDateTime(detail.declined_at) }}</template>
            <template v-else-if="detail.cancelled_at">Cancelled {{ formatDateTime(detail.cancelled_at) }}</template>
          </div>
        </div>

        <div v-if="detail.status === 'pending'" class="rail__actions">
          <button type="button" class="rail-btn rail-btn--primary" :disabled="confirmSubmitting" @click="submitConfirm">
            {{ confirmSubmitting ? 'Confirming…' : 'Confirm' }}
          </button>
          <button type="button" class="rail-btn rail-btn--danger" @click="openDecline">Decline</button>
        </div>
        <div v-else-if="detail.status === 'confirmed'" class="rail__actions">
          <button type="button" class="rail-btn rail-btn--danger" @click="openCancel">Cancel booking</button>
        </div>
      </aside>
    </div>

    <!-- Decline modal -->
    <CrmModal
      :open="declineOpen"
      eyebrow="Decline booking"
      :title="detail ? `Decline ${detail.full_name}'s booking?` : 'Decline booking'"
      width="sm"
      @close="declineOpen = false"
    >
      <p class="modal-hint">
        The reason is stored for audit + emailed to the customer if supplied.
      </p>
      <label class="field">
        <span class="field__label">Reason (optional)</span>
        <textarea v-model="declineReason" rows="3" placeholder="Already booked for a wedding. Try another weekend?" />
      </label>
      <template #footer>
        <button type="button" class="rail-btn rail-btn--ghost" :disabled="declineSubmitting" @click="declineOpen = false">Back</button>
        <button type="button" class="rail-btn rail-btn--danger" :disabled="declineSubmitting" @click="submitDecline">
          {{ declineSubmitting ? 'Declining…' : 'Decline booking' }}
        </button>
      </template>
    </CrmModal>

    <!-- Cancel modal -->
    <CrmModal
      :open="cancelOpen"
      eyebrow="Cancel booking"
      :title="detail ? `Cancel ${detail.full_name}'s booking?` : 'Cancel booking'"
      width="sm"
      @close="cancelOpen = false"
    >
      <p class="modal-hint">
        Marks the booking as cancelled and emails the customer. Deposits / refunds land with Stripe Connect — for now, handle refunds manually.
      </p>
      <template #footer>
        <button type="button" class="rail-btn rail-btn--ghost" :disabled="cancelSubmitting" @click="cancelOpen = false">Back</button>
        <button type="button" class="rail-btn rail-btn--danger" :disabled="cancelSubmitting" @click="submitCancel">
          {{ cancelSubmitting ? 'Cancelling…' : 'Confirm cancellation' }}
        </button>
      </template>
    </CrmModal>

    <!-- Delete modal -->
    <CrmModal
      :open="deleteOpen"
      eyebrow="Danger zone"
      :title="detail ? `Delete ${detail.full_name}'s booking?` : 'Delete booking'"
      width="sm"
      @close="deleteOpen = false"
    >
      <p class="modal-hint">
        Soft-deletes the row — it disappears from the inbox but stays in the DB for audit. This action doesn't notify the customer.
      </p>
      <template #footer>
        <button type="button" class="rail-btn rail-btn--ghost" :disabled="deleteSubmitting" @click="deleteOpen = false">Back</button>
        <button type="button" class="rail-btn rail-btn--danger" :disabled="deleteSubmitting" @click="submitDelete">
          {{ deleteSubmitting ? 'Deleting…' : 'Confirm delete' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.bd { max-width: 1280px; display: flex; flex-direction: column; gap: 32px; }

.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.back--emphasis { color: var(--color-accent); margin-top: 16px; font-weight: 600; letter-spacing: normal; text-transform: none; font-size: 13px; }

.bd__head { display: flex; flex-direction: column; gap: 0; }
.bd__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 4px 0 6px; }
.bd__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.bd__ref { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }

.overflow { position: relative; margin-left: auto; }
.icon-btn { width: 36px; height: 36px; border-radius: 999px; background: transparent; border: 1px solid var(--color-hairline); color: var(--color-ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.icon-btn:hover { background: var(--color-surface); }
.overflow__menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 180px; padding: 6px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; box-shadow: 0 20px 44px -18px rgba(15, 23, 42, 0.28); z-index: 10; }
.overflow__item { display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; background: transparent; border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.overflow__item:hover { background: var(--color-surface); }
.overflow__item--danger { color: var(--color-danger); }

.empty { padding: 96px 40px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-ink); }

.bd__body { display: grid; grid-template-columns: 1fr 340px; gap: 32px; align-items: flex-start; }
.left { display: flex; flex-direction: column; gap: 16px; }

.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.card__head { display: flex; justify-content: space-between; align-items: center; }
.card__eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.card__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); }
.card__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin: 0; }
.card__section-label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }

.card__hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.card__hero-main { display: flex; flex-direction: column; gap: 4px; }
.card__date { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.card__pkg { font-family: var(--font-body); font-size: 15px; color: var(--color-ink); font-weight: 500; }
.card__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.card__totals { text-align: right; }
.card__total { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-ink); }
.card__total-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.card__notes { padding: 16px 18px; background: var(--color-surface); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
.card__note-body { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); line-height: 1.55; font-style: italic; }

.addons { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.addons__row { display: flex; gap: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); align-items: baseline; }
.addons__name { flex: 1; }
.addons__qty { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.addons__amount { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }

.dl { display: flex; flex-direction: column; margin: 0; }
.dl__row { display: grid; grid-template-columns: 140px 1fr; gap: 20px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.dl__row:first-child { border-top: 0; padding-top: 4px; }
.dl__row:last-child { padding-bottom: 4px; }
.dl__row--total dt, .dl__row--total dd { font-weight: 700; color: var(--color-ink); }
.dl dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.dl dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }
.dl__muted { color: var(--color-fog); }
.link { color: var(--color-accent); text-decoration: none; }
.link:hover { text-decoration: underline; }

/* Rail */
.rail { position: sticky; top: 32px; display: flex; flex-direction: column; gap: 16px; }
.rail__status { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 24px 24px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; }
.rail__status::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--color-graphite); }
.rail__status--ok::before { background: #16A34A; }
.rail__status--warn::before { background: var(--color-accent); }
.rail__status--danger::before { background: var(--color-danger); }
.rail__status--ink::before { background: var(--color-ink); }
.rail__avatar { width: 56px; height: 56px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.rail__eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.rail__status-name { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.rail__status-meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.rail__actions { display: flex; flex-direction: column; gap: 8px; }

.rail-btn { padding: 12px 16px; border-radius: 10px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; border: 0; transition: background 120ms, color 120ms, border-color 120ms; }
.rail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rail-btn--primary { background: var(--color-ink); color: #fff; }
.rail-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.rail-btn--danger { background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); }
.rail-btn--danger:hover:not(:disabled) { border-color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 6%, #fff); }
.rail-btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.rail-btn--ghost:hover:not(:disabled) { background: var(--color-surface); }

/* Pills */
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }
.pill--ink { background: var(--color-ink); color: #fff; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

/* Modal form */
.modal-hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0 0 12px; line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field textarea:focus { outline: none; border-color: var(--color-ink); }

@media (max-width: 1023px) {
  .bd__body { grid-template-columns: 1fr; gap: 32px; }
  .rail { position: static; }
}
</style>
