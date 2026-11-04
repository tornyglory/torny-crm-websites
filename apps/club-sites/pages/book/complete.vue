<script setup lang="ts">
/**
 * Venue booking checkout completion page.
 *
 * Stripe Checkout redirects here after the customer pays (or cancels)
 * the deposit on a venue booking. We read `?result=` + `?booking_ref=`
 * from the query string and render a thank-you / cancelled state.
 *
 * No API fetch — the webhook has already updated the booking's
 * `payment_status` server-side by the time the browser lands here. The
 * confirmation email (also fired by the webhook) is the canonical
 * receipt.
 */
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
</script>

<template>
  <div class="bc" :style="{ '--brand': accent } as any">
    <div class="bc__card">
      <template v-if="result === 'success'">
        <div class="bc__badge bc__badge--ok" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
            <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="bc__eyebrow">Deposit paid</div>
        <h1 class="bc__title">You're booked in</h1>
        <p class="bc__sub">
          Thanks for your deposit. {{ clubName }} will be in touch to confirm the finer details.
          Keep an eye on your inbox for a confirmation email.
        </p>
        <div v-if="bookingRef" class="bc__ref">
          <span class="bc__ref-label">Booking reference</span>
          <code>{{ bookingRef }}</code>
        </div>
      </template>

      <template v-else-if="result === 'cancelled'">
        <div class="bc__badge bc__badge--warn" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
            <path d="M16 10v7M16 21v0.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </div>
        <div class="bc__eyebrow">Deposit cancelled</div>
        <h1 class="bc__title">Nothing was charged</h1>
        <p class="bc__sub">
          You cancelled the Stripe checkout and your booking wasn't confirmed. If this was a mistake, open your original enquiry email to try again.
        </p>
        <div v-if="bookingRef" class="bc__ref">
          <span class="bc__ref-label">Booking reference</span>
          <code>{{ bookingRef }}</code>
        </div>
      </template>

      <template v-else>
        <h1 class="bc__title">Checkout complete</h1>
        <p class="bc__sub">If you paid, your booking is confirmed — look for a confirmation email shortly.</p>
      </template>

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

.bc__ref { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; background: #F5F5F2; border: 1px dashed #D7D7D2; border-radius: 10px; margin-top: 4px; }
.bc__ref-label { font-family: var(--font-body, sans-serif); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6A6A5F; }
.bc__ref code { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 14px; color: #1C1C19; }

.bc__actions { margin-top: 16px; display: flex; gap: 10px; }
.btn { padding: 12px 22px; border: 0; border-radius: 999px; font-family: var(--font-body, sans-serif); font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.btn--ink { background: #1C1C19; color: #fff; }
.btn--ink:hover { background: #3A3A33; }
</style>
