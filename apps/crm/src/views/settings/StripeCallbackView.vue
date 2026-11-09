<script setup lang="ts">
/**
 * Stripe Connect OAuth callback — landing page after Stripe redirects
 * back from the Connect flow.
 *
 * The backend handles the OAuth code exchange + DB write before we land
 * here, so this page is pure presentation. Query string tells us which
 * state to render:
 *
 *   result=success + status=ready       → "Stripe connected" + auto-redirect
 *   result=success + status=onboarding  → "Almost there — finish in Stripe"
 *   result=success + status=restricted  → "Stripe has restricted your account"
 *   result=error    + code=<code>       → specific copy per code (§3 table)
 *
 * Success states auto-redirect to /crm/settings after 2 seconds per
 * brief §3 — admins who want to click through land on a "Back to
 * settings" button instead.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { StripeAccountStatus, StripeConnectErrorCode } from '@torny/api-client'

const route = useRoute()
const router = useRouter()

type Variant = 'ready' | 'onboarding' | 'restricted' | 'error'

const variant = computed<Variant>(() => {
  if (route.query.result === 'error') return 'error'
  const s = route.query.status as StripeAccountStatus | undefined
  if (s === 'onboarding') return 'onboarding'
  if (s === 'restricted') return 'restricted'
  return 'ready'
})

/** Error-specific copy, per brief §3 error-code table. Keep the raw
 *  code visible for support triage. */
const errorCode = computed<StripeConnectErrorCode | string>(() => String(route.query.code ?? ''))
const errorDescription = computed<string>(() => String(route.query.description ?? ''))

const errorCopy = computed(() => {
  const code = errorCode.value as StripeConnectErrorCode
  switch (code) {
    case 'access_denied':
      return {
        title: 'Connection cancelled',
        body: 'You cancelled the connection. Try again from Settings when you\'re ready.',
      }
    case 'bad_state':
      return {
        title: 'That link expired',
        body: 'The connect link is good for 15 minutes. Click "Connect Stripe" in Settings to start over.',
      }
    case 'missing_code_or_state':
      return {
        title: 'Something went wrong at Stripe',
        body: 'Stripe didn\'t send back everything we need. Try again from Settings.',
      }
    case 'forbidden':
      return {
        title: 'Permission changed',
        body: 'You no longer have permission to connect Stripe for this club.',
      }
    case 'stripe_exchange_failed':
      return {
        title: 'Stripe couldn\'t complete the connection',
        body: errorDescription.value || 'Try again from Settings. If this keeps failing, contact support with the error code below.',
      }
    case 'no_account_id':
      return {
        title: 'Unexpected response from Stripe',
        body: 'Stripe accepted the connection but didn\'t return an account id. Try again from Settings.',
      }
    case 'server_error':
      return {
        title: 'Something went wrong on our end',
        body: 'Try again in a moment. If this keeps failing, contact support with the error code below.',
      }
    default:
      return {
        title: 'Could not connect',
        body: errorDescription.value || 'Try again from Settings. If this keeps failing, contact support.',
      }
  }
})

// Auto-redirect to settings after 2s on any success state. Admins who
// want to stay (e.g. to read the onboarding hint) can still click
// through — the timer is a nicety, not a cage.
let redirectTimer: ReturnType<typeof setTimeout> | null = null
const countdown = ref(2)
onMounted(() => {
  if (variant.value === 'error') return
  const tick = () => {
    if (countdown.value <= 1) {
      router.replace('/crm/settings/integrations')
      return
    }
    countdown.value -= 1
    redirectTimer = setTimeout(tick, 1000)
  }
  redirectTimer = setTimeout(tick, 1000)
})
onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer)
})
</script>

<template>
  <div class="sc">
    <div class="sc__card" :class="`sc__card--${variant}`">
      <div class="sc__badge" :class="`sc__badge--${variant}`" aria-hidden="true">
        <svg v-if="variant === 'ready'" width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else-if="variant === 'onboarding' || variant === 'restricted'" width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M16 10v7M16 21v0.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
        <svg v-else width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M11 11l10 10M21 11L11 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
      </div>

      <template v-if="variant === 'ready'">
        <h1 class="sc__title">Stripe connected</h1>
        <p class="sc__sub">
          You're ready to accept deposits on venue bookings and tournament entries.
          Deposits go straight to your connected account.
        </p>
      </template>
      <template v-else-if="variant === 'onboarding'">
        <h1 class="sc__title">Almost there</h1>
        <p class="sc__sub">
          Stripe needs a few more details before your account can accept payments.
          Finish setup in your Stripe dashboard — we'll pick up the status automatically.
        </p>
      </template>
      <template v-else-if="variant === 'restricted'">
        <h1 class="sc__title">Stripe has restricted your account</h1>
        <p class="sc__sub">
          Your account needs attention in the Stripe dashboard before you can accept payments.
          Check for any requirements Stripe has flagged.
        </p>
      </template>
      <template v-else>
        <h1 class="sc__title">{{ errorCopy.title }}</h1>
        <p class="sc__sub">{{ errorCopy.body }}</p>
        <div v-if="errorCode" class="sc__code">
          <span class="sc__code-label">Error code</span>
          <code>{{ errorCode }}</code>
        </div>
      </template>

      <div class="sc__actions">
        <router-link to="/crm/settings/integrations" class="btn btn--ink">
          {{ variant === 'error' ? 'Back to settings' : countdown > 0 ? `Open settings (${countdown}s)` : 'Open settings' }}
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sc { max-width: 720px; display: flex; justify-content: center; padding: 48px 0; }

.sc__card { width: 100%; padding: 48px 40px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; }

.sc__badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; margin-bottom: 8px; border-radius: 999px; }
.sc__badge--ready { color: #16A34A; }
.sc__badge--onboarding { color: var(--color-accent); }
.sc__badge--restricted { color: #D97706; }
.sc__badge--error { color: var(--color-danger); }

.sc__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.sc__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-fog); margin: 0; max-width: 480px; line-height: 1.55; }

.sc__code { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 10px; margin-top: 4px; }
.sc__code-label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.sc__code code { font-family: var(--font-mono); font-size: 13px; color: var(--color-ink); }

.sc__actions { margin-top: 16px; display: flex; gap: 10px; }
.btn { padding: 10px 20px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover { background: var(--color-graphite); }
</style>
