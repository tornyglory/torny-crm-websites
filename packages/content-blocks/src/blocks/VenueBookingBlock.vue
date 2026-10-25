<script setup lang="ts">
/**
 * Venue booking wizard — Paper artboards:
 *   CQV-0 "Booking · Step 1 · Availability + time picker"
 *   CVC-0 "Booking · Step 2 · Details form"
 *   CZU-0 "Booking · Confirmation"
 *
 * Public-site booking flow dropped onto `/venue-hire/book`. Reads
 * `?package=slug` from the URL and pre-selects a package; without a
 * match it falls back to the first configured package. Prices + add-on
 * maths all run client-side.
 *
 * Backend sink for v1: `enquiries.create()` with topic `facilities`
 * and a structured JSON block in `message` (admins can read it in the
 * Enquiries inbox). Brief 62 proposes the proper `venue_bookings`
 * resource with deposit payments.
 */
import { computed, inject, isRef, onMounted, reactive, ref, type Ref } from 'vue'
import { enquiries, ApiError } from '@torny/api-client'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type VenueBookingProps,
  type VenueBookingPackage,
  type VenueBookingSlot,
} from '../types'

const props = withDefaults(defineProps<VenueBookingProps>(), {
  eyebrow: '',
  heading: 'Book the venue',
  description: '',
  packages: () => [],
  occasions: () => [
    { label: 'Birthday', defaultSelected: true },
    { label: 'Wedding' },
    { label: 'Wake' },
    { label: 'Corporate day' },
    { label: 'Team building' },
    { label: 'Community' },
    { label: 'Other' },
  ],
  setupStyles: () => [
    'Long tables + bar',
    'Rounds of 8',
    'Cocktail / standing',
    'Theatre',
    'U-shape boardroom',
    'Keep it open',
  ],
  depositPercent: 25,
  leadTimeDays: 14,
  hostName: '',
  hostRole: 'Your host',
  hostInitials: '',
  hostPhone: '',
  submitLabel: 'Confirm booking',
  confirmationSubtitle:
    "Deposit charged. We've emailed confirmation and a calendar invite. {host} will call to confirm the finer details.",
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

// ── URL state ─────────────────────────────────────────────────
const urlPackageSlug = ref<string | null>(null)
onMounted(() => {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  urlPackageSlug.value = params.get('package')
})

// ── Package / step state ──────────────────────────────────────
const currentStep = ref<1 | 2 | 3>(1)
const selectedPackage = computed<VenueBookingPackage | null>(() => {
  if (props.packages.length === 0) return null
  if (urlPackageSlug.value) {
    const hit = props.packages.find((p) => p.slug === urlPackageSlug.value)
    if (hit) return hit
  }
  return props.packages[0] ?? null
})

// ── Calendar ──────────────────────────────────────────────────
const today = new Date()
today.setHours(0, 0, 0, 0)
const leadTimeMs = computed(() => (props.leadTimeDays ?? 14) * 86400_000)
const earliestBookable = computed(() => new Date(today.getTime() + leadTimeMs.value))

const visibleYear = ref<number>(earliestBookable.value.getFullYear())
const visibleMonth = ref<number>(earliestBookable.value.getMonth())

function prevMonth() {
  const d = new Date(visibleYear.value, visibleMonth.value - 1, 1)
  visibleYear.value = d.getFullYear()
  visibleMonth.value = d.getMonth()
}
function nextMonth() {
  const d = new Date(visibleYear.value, visibleMonth.value + 1, 1)
  visibleYear.value = d.getFullYear()
  visibleMonth.value = d.getMonth()
}

const monthLabel = computed(() =>
  new Date(visibleYear.value, visibleMonth.value, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  }),
)

interface CalendarCell { date: Date; day: number; inMonth: boolean; bookable: boolean }
const calendarCells = computed<CalendarCell[]>(() => {
  const first = new Date(visibleYear.value, visibleMonth.value, 1)
  const last = new Date(visibleYear.value, visibleMonth.value + 1, 0)
  // Monday-start grid.
  const dow = (first.getDay() + 6) % 7
  const cells: CalendarCell[] = []
  for (let i = 0; i < dow; i++) {
    const d = new Date(first.getTime() - (dow - i) * 86400_000)
    cells.push({ date: d, day: d.getDate(), inMonth: false, bookable: false })
  }
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(visibleYear.value, visibleMonth.value, d)
    cells.push({
      date,
      day: d,
      inMonth: true,
      bookable: date.getTime() >= earliestBookable.value.getTime(),
    })
  }
  // Pad trailing to complete the last week.
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!
    const d = new Date(last.date.getTime() + 86400_000)
    cells.push({ date: d, day: d.getDate(), inMonth: false, bookable: false })
  }
  return cells
})

const selectedDate = ref<Date | null>(null)
function pickDate(cell: CalendarCell) {
  if (!cell.bookable) return
  selectedDate.value = new Date(cell.date)
  // Pre-select default slot the first time a date is picked.
  if (!selectedSlot.value) {
    const def = selectedPackage.value?.slots.find((s) => s.defaultSelected && !s.disabled)
    selectedSlot.value = def ?? selectedPackage.value?.slots.find((s) => !s.disabled) ?? null
  }
}
function isSelectedDate(cell: CalendarCell): boolean {
  const s = selectedDate.value
  return !!s && cell.date.getTime() === s.getTime()
}

const selectedDateLabel = computed(() => {
  if (!selectedDate.value) return ''
  return selectedDate.value.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
})

// ── Slot state ────────────────────────────────────────────────
const selectedSlot = ref<VenueBookingSlot | null>(null)
function pickSlot(s: VenueBookingSlot) {
  if (s.disabled) return
  selectedSlot.value = s
}
function isSelectedSlot(s: VenueBookingSlot): boolean {
  return selectedSlot.value?.label === s.label
}

// ── Step 2 state ──────────────────────────────────────────────
const form = reactive({
  occasion: props.occasions.find((o) => o.defaultSelected)?.label ?? props.occasions[0]?.label ?? '',
  guests: 40,
  setupStyle: props.setupStyles[0] ?? '',
  fullName: '',
  email: '',
  phone: '',
  bookingFor: '',
  notes: '',
})
function bumpGuests(delta: number) {
  form.guests = Math.max(1, form.guests + delta)
}

// Add-on state is a map keyed by addon index for the selected package.
interface AddonState { checked: boolean; quantity: number }
const addonState = ref<Record<string, AddonState>>({})
function addonKey(i: number): string {
  return `${selectedPackage.value?.slug ?? 'pkg'}:${i}`
}
function addonFor(i: number): AddonState {
  const key = addonKey(i)
  if (!addonState.value[key]) {
    const a = selectedPackage.value?.addons?.[i]
    addonState.value[key] = {
      checked: Boolean(a?.defaultSelected),
      quantity: a?.defaultQuantity ?? (a?.countable ? 1 : 1),
    }
  }
  return addonState.value[key]!
}
function toggleAddon(i: number) {
  const s = addonFor(i)
  s.checked = !s.checked
}
function bumpAddon(i: number, delta: number) {
  const s = addonFor(i)
  if (!s.checked) s.checked = true
  s.quantity = Math.max(1, s.quantity + delta)
}

// ── Running totals ────────────────────────────────────────────
interface LineItem { label: string; amount: number }
const lineItems = computed<LineItem[]>(() => {
  const items: LineItem[] = []
  const pkg = selectedPackage.value
  const slot = selectedSlot.value
  if (pkg && slot) items.push({ label: `${pkg.name} · ${slot.label}`, amount: slot.price })
  if (pkg?.addons) {
    pkg.addons.forEach((a, i) => {
      const s = addonFor(i)
      if (!s.checked) return
      const qty = a.countable ? s.quantity : 1
      items.push({
        label: a.countable ? `${a.name} × ${qty}` : a.name,
        amount: a.price * qty,
      })
    })
  }
  if (pkg?.bondAmount) {
    items.push({ label: pkg.bondLabel ?? 'Refundable bond', amount: pkg.bondAmount })
  }
  return items
})
const total = computed(() => lineItems.value.reduce((n, l) => n + l.amount, 0))
const deposit = computed(() => Math.round((total.value * (props.depositPercent ?? 25)) / 100))
const balance = computed(() => total.value - deposit.value)

const balanceDueDate = computed(() => {
  if (!selectedDate.value) return ''
  const d = new Date(selectedDate.value.getTime() - 14 * 86400_000)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
})

// ── Validation ────────────────────────────────────────────────
const canContinueFromStep1 = computed(() => !!selectedDate.value && !!selectedSlot.value)
const canSubmit = computed(() =>
  canContinueFromStep1.value &&
  !!form.occasion &&
  form.guests > 0 &&
  !!form.fullName.trim() &&
  /.+@.+\..+/.test(form.email.trim()),
)

// ── Submit ────────────────────────────────────────────────────
const submitting = ref(false)
const submitError = ref<string | null>(null)
const bookingRef = ref<string | null>(null)

function makeBookingRef(): string {
  const now = new Date()
  const yr = now.getFullYear()
  const n = Math.floor(1000 + Math.random() * 9000)
  const prefix = (ctx.value?.clubSlug ?? 'club').slice(0, 3).toUpperCase()
  return `${prefix}-${yr}-${n}`
}

/** Compact JSON payload the CRM admin can read in the enquiry message. */
function buildMessage(): string {
  const pkg = selectedPackage.value
  const slot = selectedSlot.value
  const summary = [
    `${form.occasion} · ${form.guests} guests`,
    `${pkg?.name ?? '—'} · ${slot?.label ?? '—'}`,
    selectedDateLabel.value,
    `Setup: ${form.setupStyle}`,
  ].join('\n')
  const addons = (pkg?.addons ?? [])
    .map((a, i) => ({ addon: a, state: addonFor(i) }))
    .filter((x) => x.state.checked)
    .map(({ addon, state }) =>
      addon.countable ? `• ${addon.name} × ${state.quantity}` : `• ${addon.name}`,
    )
    .join('\n')
  const notes = form.notes.trim() ? `\nNotes: ${form.notes.trim()}` : ''
  const booking = form.bookingFor.trim() ? `\nBooking on behalf of: ${form.bookingFor.trim()}` : ''
  const totals = `\nTotal: $${total.value} · Deposit: $${deposit.value} · Balance: $${balance.value}`
  const addonBlock = addons ? `\nAdd-ons:\n${addons}` : ''
  return `${summary}${addonBlock}${notes}${booking}${totals}`
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitError.value = null
  if (!clubSlug.value) {
    submitError.value = "This preview isn't connected to a live club. Publish the site first."
    return
  }
  submitting.value = true
  try {
    await enquiries.create(clubSlug.value, {
      full_name: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      topic: 'facilities',
      message: buildMessage(),
      consent_reply: true,
    })
    bookingRef.value = makeBookingRef()
    currentStep.value = 3
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = err.message || "We couldn't send that. Try again."
    } else {
      submitError.value = "We couldn't send that. Try again."
    }
  } finally {
    submitting.value = false
  }
}

function goStep(step: 1 | 2 | 3) {
  if (step === 2 && !canContinueFromStep1.value) return
  if (step === 3) return // only via submit
  currentStep.value = step
}

const confirmationCopy = computed(() =>
  (props.confirmationSubtitle ?? '').replace('{host}', props.hostName || 'our host'),
)

function initialsForHost(): string {
  if (props.hostInitials) return props.hostInitials.toUpperCase()
  const parts = (props.hostName ?? '').trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase() || 'NB'
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
</script>

<template>
  <section class="vb" :style="{ '--brand': brand } as any">
    <!-- Step rail -->
    <div class="vb__rail">
      <ol class="vb__steps">
        <li class="vb__step" :class="{ 'vb__step--done': currentStep > 1, 'vb__step--active': currentStep === 1 }">
          <span class="vb__step-dot">{{ currentStep > 1 ? '✓' : '1' }}</span>
          <span class="vb__step-label">Pick a date</span>
        </li>
        <li class="vb__step-line" :class="{ 'vb__step-line--done': currentStep > 1 }" aria-hidden="true" />
        <li class="vb__step" :class="{ 'vb__step--done': currentStep > 2, 'vb__step--active': currentStep === 2 }">
          <span class="vb__step-dot">{{ currentStep > 2 ? '✓' : '2' }}</span>
          <span class="vb__step-label">Your details</span>
        </li>
        <li class="vb__step-line" :class="{ 'vb__step-line--done': currentStep > 2 }" aria-hidden="true" />
        <li class="vb__step" :class="{ 'vb__step--active': currentStep === 3 }">
          <span class="vb__step-dot">3</span>
          <span class="vb__step-label">Confirm &amp; pay</span>
        </li>
      </ol>
      <div v-if="selectedPackage" class="vb__context">
        <span class="vb__context-dot" />
        <span>Booking · {{ selectedPackage.name }}</span>
      </div>
    </div>

    <!-- ── STEP 1 ────────────────────────────────────────────── -->
    <template v-if="currentStep === 1">
      <header class="vb__head">
        <span class="vb__eyebrow">Step 1 of 3</span>
        <h1 class="vb__title">When are you thinking?</h1>
      </header>

      <div class="vb__body">
        <!-- Calendar -->
        <section class="vb__calendar">
          <div class="vb__cal-head">
            <div class="vb__cal-month">
              <button type="button" class="vb__cal-nav" @click="prevMonth" aria-label="Previous month">‹</button>
              <span class="vb__cal-month-name">{{ monthLabel }}</span>
              <button type="button" class="vb__cal-nav" @click="nextMonth" aria-label="Next month">›</button>
            </div>
            <div class="vb__legend">
              <span class="vb__legend-item"><span class="vb__legend-sw vb__legend-sw--free" />Free</span>
              <span class="vb__legend-item"><span class="vb__legend-sw vb__legend-sw--mute" />Lead time</span>
            </div>
          </div>
          <div class="vb__cal-grid">
            <div v-for="d in DOW" :key="d" class="vb__cal-dow">{{ d }}</div>
            <button
              v-for="(cell, i) in calendarCells"
              :key="i"
              type="button"
              class="vb__cal-day"
              :class="{
                'vb__cal-day--out': !cell.inMonth,
                'vb__cal-day--muted': cell.inMonth && !cell.bookable,
                'vb__cal-day--free': cell.inMonth && cell.bookable,
                'vb__cal-day--selected': cell.inMonth && isSelectedDate(cell),
              }"
              :disabled="!cell.inMonth || !cell.bookable"
              @click="pickDate(cell)"
            >
              <span class="vb__cal-day-n">{{ cell.day }}</span>
              <span v-if="cell.inMonth && cell.bookable" class="vb__cal-day-sub">Free</span>
            </button>
          </div>
        </section>

        <!-- Slot picker rail -->
        <aside class="vb__slot-rail">
          <div v-if="selectedDate" class="vb__selected-card">
            <div class="vb__selected-eyebrow"><span class="vb__context-dot vb__context-dot--white" /> Selected date</div>
            <div class="vb__selected-name">{{ selectedDateLabel }}</div>
            <div v-if="selectedPackage" class="vb__selected-sub">
              {{ selectedPackage.name }} · {{ (selectedPackage.slots.filter(s => !s.disabled)).length }} slots free
            </div>
          </div>
          <div v-else class="vb__selected-card vb__selected-card--empty">
            <div class="vb__selected-eyebrow">Pick a date</div>
            <div class="vb__selected-name">Tap a day to continue</div>
          </div>

          <div class="vb__slot-head">Pick a slot</div>
          <ul class="vb__slot-list">
            <li
              v-for="s in (selectedPackage?.slots ?? [])"
              :key="s.label"
              class="vb__slot"
              :class="{
                'vb__slot--selected': isSelectedSlot(s),
                'vb__slot--disabled': s.disabled,
              }"
              @click="pickSlot(s)"
            >
              <div class="vb__slot-copy">
                <div class="vb__slot-label">{{ s.label }}</div>
                <div v-if="s.sub" class="vb__slot-sub">{{ s.sub }}</div>
              </div>
              <div class="vb__slot-check" aria-hidden="true">
                <svg v-if="isSelectedSlot(s)" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </li>
          </ul>

          <div class="vb__total-card">
            <div class="vb__total-row">
              <div>
                <div class="vb__total-label">Estimated total</div>
                <div class="vb__total-sub">Excl. catering &amp; bond</div>
              </div>
              <div class="vb__total-value">${{ total || 0 }}</div>
            </div>
            <button
              type="button"
              class="vb__primary"
              :disabled="!canContinueFromStep1"
              @click="goStep(2); currentStep = 2"
            >
              Continue to details
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h8M7 3.5L10.5 7 7 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </aside>
      </div>
    </template>

    <!-- ── STEP 2 ────────────────────────────────────────────── -->
    <template v-else-if="currentStep === 2">
      <header class="vb__head">
        <span class="vb__eyebrow">Step 2 of 3</span>
        <h1 class="vb__title">Tell us about your event.</h1>
      </header>

      <div class="vb__body">
        <!-- Form column -->
        <div class="vb__form-col">
          <!-- The event -->
          <section class="vb__card">
            <div class="vb__card-head"><span class="vb__card-num">01</span><h2 class="vb__card-title">The event</h2></div>
            <label class="vb__field">
              <span class="vb__field-label">What's the occasion?</span>
              <div class="vb__chip-row">
                <button
                  v-for="o in props.occasions"
                  :key="o.label"
                  type="button"
                  class="vb__chip"
                  :class="{ 'vb__chip--active': form.occasion === o.label }"
                  @click="form.occasion = o.label"
                >{{ o.label }}</button>
              </div>
            </label>
            <div class="vb__field-row">
              <label class="vb__field">
                <span class="vb__field-label">Estimated guests</span>
                <div class="vb__stepper">
                  <input type="number" min="1" v-model.number="form.guests" />
                  <button type="button" class="vb__step-btn" @click="bumpGuests(-1)" aria-label="Fewer guests">–</button>
                  <button type="button" class="vb__step-btn vb__step-btn--dark" @click="bumpGuests(1)" aria-label="More guests">+</button>
                </div>
              </label>
              <label class="vb__field">
                <span class="vb__field-label">Setup style</span>
                <select v-model="form.setupStyle">
                  <option v-for="s in props.setupStyles" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
            </div>
          </section>

          <!-- Add-ons -->
          <section v-if="(selectedPackage?.addons?.length ?? 0) > 0" class="vb__card">
            <div class="vb__card-head"><span class="vb__card-num">02</span><h2 class="vb__card-title">Add-ons</h2></div>
            <ul class="vb__addons">
              <li
                v-for="(a, i) in (selectedPackage?.addons ?? [])"
                :key="a.name"
                class="vb__addon"
                :class="{ 'vb__addon--on': addonFor(i).checked }"
              >
                <button type="button" class="vb__addon-check" @click="toggleAddon(i)" :aria-pressed="addonFor(i).checked">
                  <svg v-if="addonFor(i).checked" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="vb__addon-copy">
                  <div class="vb__addon-name">{{ a.name }}</div>
                  <div v-if="a.description" class="vb__addon-desc">{{ a.description }}</div>
                </div>
                <div class="vb__addon-price">
                  ${{ a.price }}<span v-if="a.priceSuffix" class="vb__addon-suffix">{{ a.priceSuffix }}</span>
                </div>
                <div v-if="a.countable" class="vb__addon-qty">
                  <button type="button" class="vb__step-btn" @click="bumpAddon(i, -1)" aria-label="Less">–</button>
                  <span>{{ addonFor(i).quantity }}</span>
                  <button type="button" class="vb__step-btn vb__step-btn--dark" @click="bumpAddon(i, 1)" aria-label="More">+</button>
                </div>
              </li>
            </ul>
          </section>

          <!-- You -->
          <section class="vb__card">
            <div class="vb__card-head"><span class="vb__card-num">03</span><h2 class="vb__card-title">You</h2></div>
            <div class="vb__field-row">
              <label class="vb__field">
                <span class="vb__field-label">Full name</span>
                <input v-model="form.fullName" type="text" placeholder="Ruth Willis" />
              </label>
              <label class="vb__field">
                <span class="vb__field-label">Email</span>
                <input v-model="form.email" type="email" placeholder="you@example.co.nz" />
              </label>
            </div>
            <div class="vb__field-row">
              <label class="vb__field">
                <span class="vb__field-label">Phone</span>
                <input v-model="form.phone" type="tel" placeholder="027 000 0000" />
              </label>
              <label class="vb__field">
                <span class="vb__field-label">Booking on behalf of <em>— optional</em></span>
                <input v-model="form.bookingFor" type="text" placeholder="e.g. Willis family" />
              </label>
            </div>
            <label class="vb__field">
              <span class="vb__field-label">Anything we should know? <em>— dietary, access, deliveries</em></span>
              <textarea v-model="form.notes" rows="3" placeholder="Two guests use wheelchairs. Cake being delivered from Ferns Bakery at 5:30 — happy to accept." />
            </label>
          </section>

          <div v-if="submitError" class="vb__error" role="alert">{{ submitError }}</div>

          <div class="vb__nav-row">
            <button type="button" class="vb__secondary" @click="goStep(1); currentStep = 1">← Back</button>
            <button
              type="button"
              class="vb__primary"
              :disabled="!canSubmit || submitting"
              @click="submit"
            >
              {{ submitting ? 'Submitting…' : props.submitLabel }}
              <svg v-if="!submitting" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7h8M7 3.5L10.5 7 7 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>

        <!-- Summary rail -->
        <aside class="vb__summary">
          <div class="vb__summary-eyebrow"><span class="vb__context-dot vb__context-dot--white" /> Booking summary</div>
          <div class="vb__summary-name">{{ selectedPackage?.name ?? '—' }}</div>
          <div class="vb__summary-sub">
            {{ selectedDateLabel || 'Pick a date' }}<template v-if="selectedSlot"> · {{ selectedSlot.label }}</template>
          </div>

          <ul class="vb__summary-lines">
            <li v-for="(l, i) in lineItems" :key="i">
              <span>{{ l.label }}</span><span>${{ l.amount }}</span>
            </li>
          </ul>

          <div class="vb__summary-foot">
            <div class="vb__summary-deposit">
              <span class="vb__summary-eyebrow vb__summary-eyebrow--inline">Due today · deposit</span>
              <span class="vb__summary-total">${{ deposit }}</span>
            </div>
            <div v-if="balance > 0" class="vb__summary-balance">
              <span>Balance <template v-if="balanceDueDate">due {{ balanceDueDate }}</template></span>
              <span>${{ balance }}</span>
            </div>
          </div>

          <div class="vb__summary-note">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 6l1.5 1.5L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/></svg>
            Free cancellation until 14 days before.
          </div>
        </aside>
      </div>
    </template>

    <!-- ── STEP 3 — Confirmation ─────────────────────────────── -->
    <template v-else>
      <div class="vb__confirm-hero">
        <div class="vb__confirm-ref">REF · {{ bookingRef }}</div>
        <div class="vb__confirm-check"><svg viewBox="0 0 32 32" width="28" height="28" fill="none"><path d="M9 17l5 5 10-11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="vb__confirm-eyebrow">You're booked in</div>
        <h2 class="vb__confirm-title">
          See you {{ selectedDateLabel.split(',')[0] || 'soon' }}, {{ form.fullName.split(' ')[0] || 'there' }}.
        </h2>
        <p class="vb__confirm-sub">{{ confirmationCopy }}</p>
        <div v-if="bookingRef" class="vb__confirm-ctas">
          <a class="vb__confirm-ghost" href="#">Add to calendar ↗</a>
        </div>
        <div class="vb__confirm-badge">● BOOKING CONFIRMED</div>
      </div>

      <div class="vb__confirm-body">
        <section class="vb__card vb__card--details">
          <div class="vb__card-head vb__card-head--split">
            <h3 class="vb__card-title">Booking details</h3>
            <span class="vb__pill vb__pill--ok">● Deposit paid</span>
          </div>
          <dl class="vb__detail-list">
            <div><dt>When</dt><dd>{{ selectedDateLabel }}<br /><span class="vb__muted">{{ selectedSlot?.label }}</span></dd></div>
            <div><dt>Where</dt><dd>{{ selectedPackage?.name }}<br /><span class="vb__muted">Confirmation emailed to {{ form.email }}</span></dd></div>
            <div><dt>Occasion</dt><dd>{{ form.occasion }} · {{ form.guests }} guests<br /><span class="vb__muted">{{ form.setupStyle }}</span></dd></div>
          </dl>
          <ul class="vb__detail-lines">
            <li v-for="(l, i) in lineItems" :key="i"><span>{{ l.label }}</span><span>${{ l.amount.toFixed(2) }}</span></li>
            <li class="vb__detail-total"><span>Total</span><span>${{ total.toFixed(2) }}</span></li>
            <li class="vb__detail-deposit"><span>Deposit paid today</span><span>−${{ deposit.toFixed(2) }}</span></li>
            <li class="vb__detail-balance"><span>Balance <template v-if="balanceDueDate">due {{ balanceDueDate }}</template></span><span>${{ balance.toFixed(2) }}</span></li>
          </ul>
        </section>

        <aside class="vb__timeline">
          <div class="vb__timeline-eyebrow">What happens now</div>
          <ol class="vb__timeline-list">
            <li class="vb__timeline-item vb__timeline-item--done">
              <span class="vb__timeline-dot">✓</span>
              <div><div class="vb__timeline-title">Deposit taken</div><div class="vb__timeline-sub">${{ deposit }} received · just now</div></div>
            </li>
            <li class="vb__timeline-item vb__timeline-item--active">
              <span class="vb__timeline-dot">2</span>
              <div><div class="vb__timeline-title">{{ hostName || 'Your host' }} will call in the next two days</div><div class="vb__timeline-sub">To confirm access, catering timing, and go through the setup with you.</div></div>
            </li>
            <li v-if="balance > 0" class="vb__timeline-item">
              <span class="vb__timeline-dot">3</span>
              <div><div class="vb__timeline-title">Balance due <template v-if="balanceDueDate">{{ balanceDueDate }}</template></div><div class="vb__timeline-sub">Auto-charged to card on file. Change any time before then.</div></div>
            </li>
            <li class="vb__timeline-item">
              <span class="vb__timeline-dot">{{ balance > 0 ? '4' : '3' }}</span>
              <div><div class="vb__timeline-title">Show up · {{ selectedDateLabel.split(',')[0] }}</div><div class="vb__timeline-sub">Doors open from 1:30 for setup. Bond returned within 5 days.</div></div>
            </li>
          </ol>

          <div v-if="hostName" class="vb__host-card">
            <div class="vb__host-avatar">{{ initialsForHost() }}</div>
            <div class="vb__host-copy">
              <div class="vb__host-name">{{ hostName }}</div>
              <div class="vb__host-role">{{ hostRole }}</div>
            </div>
            <div v-if="hostPhone" class="vb__host-phone">{{ hostPhone }}</div>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.vb {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 48px max(48px, calc((100vw - var(--container-content, 1200px)) / 2)) 96px;
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: 40px;
}

/* Step rail */
.vb__rail { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.vb__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: row; align-items: center; gap: 12px; }
.vb__step { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-mute); }
.vb__step--active { color: var(--color-ink); font-weight: 600; }
.vb__step--done { color: var(--color-fog); text-decoration: line-through; }
.vb__step-dot { width: 26px; height: 26px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #fff; border: 1px solid var(--color-hairline); color: var(--color-mute); font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
.vb__step--active .vb__step-dot { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.vb__step--done .vb__step-dot { background: var(--color-success); color: #fff; border-color: var(--color-success); }
.vb__step-line { width: 36px; height: 1px; background: var(--color-hairline); }
.vb__step-line--done { background: var(--color-success); }
.vb__context { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: var(--color-surface); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__context-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--brand); }
.vb__context-dot--white { background: #fff; }

/* Head */
.vb__head { display: flex; flex-direction: column; gap: 8px; }
.vb__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.vb__title { margin: 0; font-family: var(--font-display); font-size: 56px; font-weight: 700; line-height: 100%; letter-spacing: -0.02em; color: var(--color-ink); }

.vb__body { display: grid; grid-template-columns: 1fr 420px; gap: 32px; align-items: flex-start; }

/* Calendar */
.vb__calendar { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 20px; }
.vb__cal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--color-hairline); margin-bottom: 10px; }
.vb__cal-month { display: inline-flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--color-surface); border-radius: 10px; }
.vb__cal-nav { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; color: var(--color-graphite); cursor: pointer; font-size: 14px; line-height: 1; }
.vb__cal-nav:hover { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.vb__cal-month-name { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.vb__legend { display: flex; gap: 14px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__legend-item { display: inline-flex; align-items: center; gap: 6px; }
.vb__legend-sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.vb__legend-sw--free { background: #DCFCE7; }
.vb__legend-sw--mute { background: var(--color-surface); border: 1px solid var(--color-hairline); }
.vb__cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.vb__cal-dow { padding: 8px 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; text-align: center; }
.vb__cal-day { aspect-ratio: 1 / 0.9; border: 1px solid transparent; background: #F0FDF4; border-radius: 10px; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; padding: 8px 10px; cursor: pointer; font-family: var(--font-body); color: var(--color-ink); transition: transform 120ms; text-align: left; }
.vb__cal-day:hover:not(:disabled) { transform: translateY(-1px); }
.vb__cal-day-n { font-family: var(--font-display); font-size: 15px; font-weight: 700; }
.vb__cal-day-sub { font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-success); text-transform: uppercase; }
.vb__cal-day--out { visibility: hidden; cursor: default; }
.vb__cal-day--muted { background: var(--color-surface); color: var(--color-mute); cursor: not-allowed; }
.vb__cal-day--muted .vb__cal-day-sub { color: var(--color-mute); }
.vb__cal-day--free { background: #F0FDF4; }
.vb__cal-day--selected { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.vb__cal-day--selected .vb__cal-day-sub { color: rgba(255,255,255,0.7); }

/* Slot rail */
.vb__slot-rail { display: flex; flex-direction: column; gap: 12px; }
.vb__selected-card { padding: 20px; border-radius: 14px; background: var(--color-ink); color: #fff; display: flex; flex-direction: column; gap: 6px; }
.vb__selected-card--empty { background: var(--color-surface); color: var(--color-fog); border: 1px dashed var(--color-hairline); }
.vb__selected-eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.72); }
.vb__selected-card--empty .vb__selected-eyebrow { color: var(--color-fog); }
.vb__selected-name { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.vb__selected-sub { font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.72); }
.vb__selected-card--empty .vb__selected-sub { color: var(--color-mute); }
.vb__selected-eyebrow--inline { color: var(--color-fog); }

.vb__slot-head { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; padding: 4px 2px; }
.vb__slot-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.vb__slot { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; cursor: pointer; transition: border 120ms, background 120ms; }
.vb__slot:hover { border-color: var(--color-graphite); }
.vb__slot--selected { background: var(--color-accent-soft); border-color: var(--color-accent); }
.vb__slot--disabled { opacity: 0.4; cursor: not-allowed; }
.vb__slot-copy { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.vb__slot-label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.vb__slot-sub { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__slot-check { width: 22px; height: 22px; border-radius: 999px; border: 1px solid var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; color: #fff; background: #fff; flex-shrink: 0; }
.vb__slot--selected .vb__slot-check { background: var(--color-accent); border-color: var(--color-accent); }

/* Total card */
.vb__total-card { background: var(--color-surface); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }
.vb__total-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.vb__total-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__total-sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.vb__total-value { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.01em; line-height: 1; }
.vb__primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 20px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; }
.vb__primary:hover:not(:disabled) { background: var(--color-graphite); }
.vb__primary:disabled { background: var(--color-mute); cursor: not-allowed; }
.vb__secondary { padding: 12px 18px; background: transparent; border: 1px solid var(--color-hairline); color: var(--color-ink); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; }
.vb__secondary:hover { background: var(--color-surface); }

/* Form cards */
.vb__form-col { display: flex; flex-direction: column; gap: 16px; }
.vb__card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.vb__card-head { display: inline-flex; align-items: center; gap: 10px; }
.vb__card-head--split { justify-content: space-between; }
.vb__card-num { padding: 2px 8px; background: var(--color-surface); border-radius: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); }
.vb__card-title { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); }
.vb__field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.vb__field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.vb__field-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__field-label em { color: var(--color-mute); font-style: normal; text-transform: none; letter-spacing: 0; }
.vb__field input, .vb__field select, .vb__field textarea { padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; }
.vb__field input:focus, .vb__field select:focus, .vb__field textarea:focus { outline: none; border-color: var(--color-ink); }
.vb__field textarea { resize: vertical; min-height: 72px; }

/* Chip row */
.vb__chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.vb__chip { padding: 8px 14px; border-radius: 999px; background: transparent; border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); cursor: pointer; }
.vb__chip:hover { background: var(--color-surface); }
.vb__chip--active { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }

/* Stepper */
.vb__stepper { display: inline-flex; align-items: stretch; gap: 6px; }
.vb__stepper input { flex: 1; }
.vb__step-btn { width: 36px; border-radius: 10px; background: #fff; border: 1px solid var(--color-hairline); cursor: pointer; font-family: var(--font-body); font-size: 16px; color: var(--color-graphite); display: inline-flex; align-items: center; justify-content: center; }
.vb__step-btn:hover { background: var(--color-surface); }
.vb__step-btn--dark { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.vb__step-btn--dark:hover { background: var(--color-graphite); }

/* Add-ons */
.vb__addons { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.vb__addon { display: grid; grid-template-columns: 32px 1fr auto auto; gap: 12px; align-items: center; padding: 14px 16px; border: 1px solid var(--color-hairline); border-radius: 12px; background: #fff; }
.vb__addon--on { background: var(--color-accent-soft); border-color: var(--color-accent); }
.vb__addon-check { width: 24px; height: 24px; border-radius: 6px; background: #fff; border: 1px solid var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
.vb__addon--on .vb__addon-check { background: var(--color-accent); border-color: var(--color-accent); }
.vb__addon-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vb__addon-name { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.vb__addon-desc { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.vb__addon-price { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-ink); white-space: nowrap; }
.vb__addon-suffix { font-family: var(--font-mono); font-size: 10px; font-weight: 500; color: var(--color-fog); margin-left: 4px; letter-spacing: 0; }
.vb__addon-qty { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--color-ink); }
.vb__addon-qty .vb__step-btn { width: 28px; height: 28px; font-size: 14px; }

/* Summary rail */
.vb__summary { background: var(--color-ink); color: #fff; padding: 20px; border-radius: 14px; display: flex; flex-direction: column; gap: 12px; }
.vb__summary-eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255,255,255,0.6); text-transform: uppercase; display: inline-flex; align-items: center; gap: 8px; }
.vb__summary-eyebrow--inline { color: rgba(255,255,255,0.6); display: block; }
.vb__summary-name { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
.vb__summary-sub { font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.72); }
.vb__summary-lines { list-style: none; padding: 14px 0; margin: 8px 0 0; border-top: 1px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; gap: 6px; }
.vb__summary-lines li { display: flex; justify-content: space-between; font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.86); }
.vb__summary-lines li span:last-child { font-family: var(--font-mono); color: rgba(255,255,255,0.72); }
.vb__summary-foot { padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; gap: 6px; }
.vb__summary-deposit { display: flex; justify-content: space-between; align-items: baseline; }
.vb__summary-total { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; }
.vb__summary-balance { display: flex; justify-content: space-between; font-family: var(--font-body); font-size: 12px; color: rgba(255,255,255,0.72); }
.vb__summary-note { margin-top: 10px; display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; background: rgba(255,255,255,0.08); border-radius: 10px; font-family: var(--font-body); font-size: 12px; color: rgba(255,255,255,0.86); }
.vb__summary-note svg { color: #2E5D3C; }

/* Nav row */
.vb__nav-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 8px; }
.vb__error { padding: 10px 14px; background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: 10px; color: #991B1B; font-family: var(--font-body); font-size: 13px; }

/* Confirmation */
.vb__confirm-hero { background: var(--color-ink); color: #fff; border-radius: 20px; padding: 48px 32px 32px; text-align: center; position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.vb__confirm-ref { position: absolute; top: 20px; left: 24px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255,255,255,0.65); }
.vb__confirm-badge { position: absolute; top: 18px; right: 20px; padding: 5px 12px; background: rgba(16,185,129,0.14); color: #86EFAC; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; }
.vb__confirm-check { width: 60px; height: 60px; border-radius: 999px; background: rgba(16,185,129,0.14); color: #86EFAC; display: inline-flex; align-items: center; justify-content: center; border: 2px solid rgba(16,185,129,0.5); }
.vb__confirm-eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255,255,255,0.65); text-transform: uppercase; }
.vb__confirm-title { margin: 0; font-family: var(--font-display); font-size: 48px; font-weight: 700; letter-spacing: -0.02em; line-height: 100%; max-width: 720px; }
.vb__confirm-sub { font-family: var(--font-body); font-size: 15px; color: rgba(255,255,255,0.72); max-width: 520px; line-height: 155%; margin: 4px 0 0; }
.vb__confirm-ctas { display: flex; gap: 10px; margin-top: 12px; }
.vb__confirm-ghost { padding: 10px 18px; background: #fff; color: var(--color-ink); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; }

.vb__confirm-body { display: grid; grid-template-columns: 1fr 400px; gap: 16px; }
.vb__card--details { gap: 20px; }
.vb__pill { padding: 4px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.vb__pill--ok { background: #DCFCE7; color: var(--color-success); }
.vb__detail-list { margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.vb__detail-list > div { display: grid; grid-template-columns: 100px 1fr; gap: 16px; padding: 10px 0; border-top: 1px solid var(--color-hairline); }
.vb__detail-list > div:first-child { border-top: 0; }
.vb__detail-list dt { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; margin: 0; }
.vb__detail-list dd { margin: 0; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); font-weight: 600; }
.vb__muted { color: var(--color-fog); font-weight: 400; }
.vb__detail-lines { list-style: none; padding: 14px 0 0; margin: 0; border-top: 1px solid var(--color-hairline); display: flex; flex-direction: column; gap: 6px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.vb__detail-lines li { display: flex; justify-content: space-between; }
.vb__detail-lines li span:last-child { font-family: var(--font-mono); }
.vb__detail-total { padding-top: 10px; border-top: 1px solid var(--color-hairline); color: var(--color-ink); font-weight: 700; }
.vb__detail-deposit { color: var(--color-success); }
.vb__detail-balance { color: var(--color-ink); font-weight: 700; }

/* Confirmation timeline */
.vb__timeline { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.vb__timeline-eyebrow { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__timeline-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.vb__timeline-item { display: grid; grid-template-columns: 32px 1fr; gap: 12px; padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 12px; }
.vb__timeline-item--done { background: #F0FDF4; border-color: #BBF7D0; }
.vb__timeline-item--active { background: var(--color-accent-soft); border-color: var(--color-accent); }
.vb__timeline-dot { width: 26px; height: 26px; border-radius: 999px; background: #fff; border: 1px solid var(--color-hairline); color: var(--color-fog); font-family: var(--font-mono); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.vb__timeline-item--done .vb__timeline-dot { background: var(--color-success); border-color: var(--color-success); color: #fff; }
.vb__timeline-item--active .vb__timeline-dot { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
.vb__timeline-title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.vb__timeline-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.vb__host-card { display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: center; padding: 12px 14px; background: var(--color-surface); border-radius: 12px; }
.vb__host-avatar { width: 36px; height: 36px; border-radius: 999px; background: var(--color-accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; }
.vb__host-name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.vb__host-role { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vb__host-phone { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); }

/* Mobile */
@media (max-width: 1023px) {
  .vb { padding: 32px 20px 48px; gap: 24px; }
  .vb__title { font-size: 40px; }
  .vb__body { grid-template-columns: 1fr; }
  .vb__confirm-body { grid-template-columns: 1fr; }
  .vb__confirm-title { font-size: 36px; }
  .vb__field-row { grid-template-columns: 1fr; }
  .vb__addon { grid-template-columns: 28px 1fr; grid-template-rows: auto auto; gap: 10px; }
  .vb__addon-price { grid-column: 2; }
  .vb__addon-qty { grid-column: 2; justify-self: start; }
}
</style>
