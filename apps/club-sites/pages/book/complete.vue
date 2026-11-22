<script setup lang="ts">
/**
 * Venue booking checkout completion page.
 *
 * Stripe Checkout redirects here after the customer pays (or cancels)
 * the deposit on a venue booking. We fetch the booking by `?booking_ref=`
 * via the brief-111 public read endpoint and render a real receipt —
 * package, slot, date, addons, money. The `?result=success|cancelled`
 * query param is a UX hint only; the server's `payment_status` is the
 * source of truth (a nervous renter can edit the URL, they can't edit
 * the DB).
 *
 * The confirmation email (also fired by the webhook) remains the
 * canonical receipt; this page is the "and here it is on screen too"
 * surface.
 */
import { venueBookings, ApiError, type PublicVenueBookingRead } from '@torny/api-client'

const route = useRoute()
const club = useClub()

const result = computed<'success' | 'cancelled' | 'unknown'>(() => {
  const r = String(route.query.result ?? '')
  if (r === 'success') return 'success'
  if (r === 'cancelled') return 'cancelled'
  return 'unknown'
})
const bookingRef = computed<string>(() => String(route.query.booking_ref ?? ''))
const clubName = computed(() => club.value?.name ?? 'the club')
const accent = computed(() => club.value?.brand_primary ?? '#2563EB')

// Brief 111 — read the booking by ref. The Venue-stack endpoint keys
// on clubs_data.slug (same convention as venue-packages); brief 110's
// resolve fix now returns the right value under club.slug for drift
// clubs. 404s are intentional (bad ref, wrong-club ref, soft-deleted
// row) — we fall through to the thin query-param-only card.
const { data: booking, pending: bookingLoading } = await useAsyncData<PublicVenueBookingRead | null>(
  () => `venueBooking:${bookingRef.value || 'none'}`,
  async () => {
    const slug = club.value?.slug ?? null
    const ref = bookingRef.value
    if (!slug || !ref) return null
    try {
      return await venueBookings.publicGetByRef(slug, ref)
    } catch (err) {
      // Expected on bad / unknown refs — thin fallback card still
      // renders. Only log for anything other than the usual 4xx.
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) return null
      throw err
    }
  },
  { watch: [bookingRef, () => club.value?.slug] },
)

// Server-authoritative status copy. Prefers payment_status + status
// from the booking payload over the ?result= query hint.
interface StateCopy { badge: 'ok' | 'warn'; eyebrow: string; title: string; sub: string }
const stateCopy = computed<StateCopy>(() => {
  const b = booking.value
  // No booking payload — rely on the URL hint.
  if (!b) {
    if (result.value === 'cancelled') {
      return {
        badge: 'warn',
        eyebrow: 'Deposit cancelled',
        title: 'Nothing was charged',
        sub: "You cancelled the Stripe checkout and your booking wasn't confirmed. If this was a mistake, open your original enquiry email to try again.",
      }
    }
    if (result.value === 'success') {
      return {
        badge: 'ok',
        eyebrow: 'Deposit paid',
        title: "You're booked in",
        sub: `Thanks for your deposit. ${clubName.value} will be in touch to confirm the finer details. Keep an eye on your inbox for a confirmation email.`,
      }
    }
    return { badge: 'ok', eyebrow: 'Checkout complete', title: 'Checkout complete', sub: 'If you paid, your booking is confirmed — look for a confirmation email shortly.' }
  }
  // Booking present — drive from the server state.
  if (b.status === 'declined') {
    return { badge: 'warn', eyebrow: 'Declined', title: "This booking wasn't accepted", sub: `${clubName.value} wasn't able to confirm this date. If this was unexpected, reply to your original enquiry email.` }
  }
  if (b.status === 'cancelled') {
    return { badge: 'warn', eyebrow: 'Cancelled', title: 'Booking cancelled', sub: `${clubName.value} has cancelled this booking. Contact the club if you'd like to rebook.` }
  }
  if (b.payment_status === 'refunded' || b.payment_status === 'partially_refunded') {
    return { badge: 'warn', eyebrow: 'Refunded', title: 'Deposit refunded', sub: 'A refund has been issued back to your original payment method. Stripe typically takes 5–10 business days.' }
  }
  if (b.payment_status === 'paid') {
    return { badge: 'ok', eyebrow: 'Paid in full', title: "You're booked in", sub: `Thanks — the full amount has been settled. ${clubName.value} will confirm the finer details via your confirmation email.` }
  }
  if (b.payment_status === 'deposit_paid') {
    return { badge: 'ok', eyebrow: 'Deposit paid', title: "You're booked in", sub: `Thanks for your deposit. ${clubName.value} will be in touch to confirm the finer details. Keep an eye on ${b.email} for your confirmation email.` }
  }
  // Unpaid: enquiry-mode booking (no Stripe) OR webhook hasn't landed yet.
  return {
    badge: 'ok',
    eyebrow: 'Enquiry received',
    title: "We've got your request",
    sub: `${clubName.value} will be in touch to confirm the booking and payment. Watch for a confirmation email at ${b.email}.`,
  }
})

// ── Money + date formatters ───────────────────────────────────

function dollars(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const n = cents / 100
  // Integer dollars when clean; two decimals otherwise. Matches the
  // brief-109 display treatment ("$720" not "$720.00").
  return `$${Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)}`
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
function longDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return DATE_FMT.format(new Date(y, m - 1, d))
}

const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return SHORT_DATE_FMT.format(new Date(y, m - 1, d))
}
</script>

<template>
  <div class="bc" :style="{ '--brand': accent } as any">
    <div class="bc__card">
      <!-- Status badge — ✓ for success, ! for cancelled / declined. -->
      <div
        class="bc__badge"
        :class="stateCopy.badge === 'ok' ? 'bc__badge--ok' : 'bc__badge--warn'"
        aria-hidden="true"
      >
        <svg v-if="stateCopy.badge === 'ok'" width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M16 10v7M16 21v0.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
      </div>

      <div class="bc__eyebrow">{{ stateCopy.eyebrow }}</div>
      <h1 class="bc__title">{{ stateCopy.title }}</h1>
      <p class="bc__sub">{{ stateCopy.sub }}</p>

      <!-- Loading hint before SSR has the booking (short — the fetch
           is server-side so this should rarely flash). -->
      <div v-if="bookingLoading && !booking" class="bc__loading">Loading your receipt…</div>

      <!-- Receipt — brief 111 full summary. Renders whenever the fetch
           succeeded; absent → fall through to the booking-ref-only card
           below. -->
      <div v-if="booking" class="bc__receipt">
        <div class="bc__receipt-head">
          <div class="bc__receipt-pkg">{{ booking.package.name ?? 'Your booking' }}</div>
          <div class="bc__receipt-slot">
            <template v-if="booking.slot.label">{{ booking.slot.label }}</template>
            <template v-else>—</template>
          </div>
          <div class="bc__receipt-date">{{ longDate(booking.booking_date) }}</div>
          <div v-if="booking.attendee_count != null" class="bc__receipt-attendees">
            {{ booking.attendee_count }} {{ booking.attendee_count === 1 ? 'guest' : 'guests' }}
          </div>
        </div>

        <!-- Add-ons -->
        <ul v-if="booking.addons.length > 0" class="bc__addons">
          <li v-for="(a, i) in booking.addons" :key="i" class="bc__addon">
            <span class="bc__addon-name">
              {{ a.name }}
              <span v-if="a.quantity > 1" class="bc__addon-qty">× {{ a.quantity }}</span>
            </span>
            <span class="bc__addon-amt">{{ dollars(a.amount_cents) }}</span>
          </li>
        </ul>

        <!-- Money -->
        <div class="bc__money">
          <div class="bc__money-row">
            <span>Subtotal</span>
            <span>{{ dollars(booking.subtotal_cents) }}</span>
          </div>
          <div v-if="booking.bond_cents > 0" class="bc__money-row">
            <span>{{ booking.bond_label ?? 'Refundable bond' }}</span>
            <span>{{ dollars(booking.bond_cents) }}</span>
          </div>
          <div class="bc__money-row bc__money-row--emph">
            <span>Deposit paid</span>
            <span>{{ dollars(booking.deposit_paid_cents) }}</span>
          </div>
          <div v-if="booking.balance_cents > 0" class="bc__money-row">
            <span>
              Balance
              <template v-if="booking.balance_due_date">
                · due {{ shortDate(booking.balance_due_date) }}
              </template>
            </span>
            <span>{{ dollars(booking.balance_cents) }}</span>
          </div>
        </div>

        <!-- Confirmation email line -->
        <p v-if="booking.email" class="bc__email-note">
          A confirmation is on its way to <strong>{{ booking.email }}</strong>.
        </p>
      </div>

      <!-- Booking reference — always rendered, even on the fallback. -->
      <div v-if="bookingRef" class="bc__ref">
        <span class="bc__ref-label">Booking reference</span>
        <code>{{ bookingRef }}</code>
      </div>

      <div class="bc__actions">
        <NuxtLink to="/venue-hire" class="btn btn--ink">Back to venue hire</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bc { max-width: 720px; margin: 0 auto; padding: 72px 20px; }
.bc__card { background: #fff; border: 1px solid #E5E5E5; border-radius: 16px; padding: 48px 40px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; }

.bc__badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 999px; margin-bottom: 8px; }
.bc__badge--ok { color: #16A34A; }
.bc__badge--warn { color: #D97706; }

.bc__eyebrow { font-family: var(--font-body, sans-serif); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6A6A5F; }
.bc__title { font-family: var(--font-display, sans-serif); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: #1C1C19; margin: 0; }
.bc__sub { font-family: var(--font-body, sans-serif); font-size: 15px; line-height: 1.6; color: rgba(0,0,0,0.65); margin: 0; max-width: 480px; }

.bc__loading { font-family: var(--font-body, sans-serif); font-size: 13px; color: #6A6A5F; margin-top: 8px; }

/* Brief 111 — receipt */
.bc__receipt {
  width: 100%;
  max-width: 480px;
  margin-top: 24px;
  padding: 24px;
  background: #F5F5F2;
  border: 1px solid #E5E5E5;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  text-align: left;
}
.bc__receipt-head { display: flex; flex-direction: column; gap: 2px; align-items: center; text-align: center; }
.bc__receipt-pkg { font-family: var(--font-display, sans-serif); font-size: 20px; font-weight: 700; color: #1C1C19; }
.bc__receipt-slot { font-family: var(--font-body, sans-serif); font-size: 14px; font-weight: 600; color: #3D3D37; }
.bc__receipt-date { font-family: var(--font-body, sans-serif); font-size: 13px; color: #6A6A5F; margin-top: 4px; }
.bc__receipt-attendees { font-family: var(--font-body, sans-serif); font-size: 12px; color: #6A6A5F; }

.bc__addons { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.bc__addon { display: flex; justify-content: space-between; gap: 12px; font-family: var(--font-body, sans-serif); font-size: 13px; color: #3D3D37; }
.bc__addon-name { min-width: 0; overflow-wrap: break-word; }
.bc__addon-qty { color: #6A6A5F; font-weight: 500; margin-left: 4px; }
.bc__addon-amt { font-variant-numeric: tabular-nums; color: #1C1C19; flex-shrink: 0; }

.bc__money { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px dashed #D7D7D2; }
.bc__money-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-body, sans-serif);
  font-size: 13px;
  color: #3D3D37;
}
.bc__money-row span:last-child { font-variant-numeric: tabular-nums; }
.bc__money-row--emph {
  font-size: 14px;
  font-weight: 700;
  color: #1C1C19;
  padding-top: 4px;
}

.bc__email-note {
  margin: 4px 0 0;
  font-family: var(--font-body, sans-serif);
  font-size: 13px;
  color: #6A6A5F;
  text-align: center;
}
.bc__email-note strong { color: #1C1C19; }

.bc__ref { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; background: #F5F5F2; border: 1px dashed #D7D7D2; border-radius: 10px; margin-top: 4px; }
.bc__ref-label { font-family: var(--font-body, sans-serif); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6A6A5F; }
.bc__ref code { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 14px; color: #1C1C19; }

.bc__actions { margin-top: 16px; display: flex; gap: 10px; }
.btn { padding: 12px 22px; border: 0; border-radius: 999px; font-family: var(--font-body, sans-serif); font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.btn--ink { background: #1C1C19; color: #fff; }
.btn--ink:hover { background: #3A3A33; }

@media (max-width: 640px) {
  .bc { padding: 48px 16px; }
  .bc__card { padding: 32px 20px; }
  .bc__title { font-size: 26px; }
  .bc__receipt { padding: 18px; }
}
</style>
