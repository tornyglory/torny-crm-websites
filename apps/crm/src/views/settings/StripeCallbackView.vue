<script setup lang="ts">
/**
 * Stripe Connect OAuth callback — the landing page after Stripe
 * finishes its "Connect your account" dance.
 *
 * The backend handles the actual OAuth code exchange + DB write before
 * redirecting here, so this page is pure presentation. It reads the
 * query string and shows one of three states:
 *
 *   - success + status=ready    → "You're connected, ready to accept payments."
 *   - success + status=onboarding → "Almost there — finish setup in Stripe."
 *   - error                     → "Could not connect" + the raw Stripe code.
 *
 * Any other status flows into the connected branch — admins can check
 * the Stripe dashboard for progress; "restricted" / "under_review" /
 * similar states aren't actionable from here.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

type Variant = 'ready' | 'onboarding' | 'error'

const variant = computed<Variant>(() => {
  if (route.query.result === 'error') return 'error'
  return route.query.status === 'onboarding' ? 'onboarding' : 'ready'
})
const errorCode = computed<string>(() => String(route.query.code ?? ''))
</script>

<template>
  <div class="sc">
    <div class="sc__card" :class="`sc__card--${variant}`">
      <div class="sc__badge" :class="`sc__badge--${variant}`" aria-hidden="true">
        <svg v-if="variant !== 'error'" width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg v-else width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
          <path d="M16 10v7M16 21v0.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        </svg>
      </div>

      <template v-if="variant === 'ready'">
        <h1 class="sc__title">Stripe connected</h1>
        <p class="sc__sub">You're ready to accept payments on venue bookings and tournament entries. Deposits go straight to your connected account.</p>
      </template>
      <template v-else-if="variant === 'onboarding'">
        <h1 class="sc__title">Almost there</h1>
        <p class="sc__sub">Stripe needs a few more details before your account is ready to accept payments. Finish setup in your Stripe dashboard and we'll pick up the status automatically.</p>
      </template>
      <template v-else>
        <h1 class="sc__title">Could not connect</h1>
        <p class="sc__sub">Stripe returned an error during the connect flow. Try again from Settings — if it keeps failing, note the code below and contact support.</p>
        <div v-if="errorCode" class="sc__code">
          <span class="sc__code-label">Error code</span>
          <code>{{ errorCode }}</code>
        </div>
      </template>

      <div class="sc__actions">
        <router-link to="/crm/settings" class="btn btn--ink">
          {{ variant === 'error' ? 'Back to settings' : 'Open settings' }}
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
