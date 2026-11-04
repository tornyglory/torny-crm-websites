<script setup lang="ts">
/**
 * Stripe Connect card — the admin surface for connecting / managing
 * the club's Stripe account.
 *
 * Fetches `stripeConnect.status()` on mount. Renders a status badge,
 * shows the masked account id when connected, surfaces the right CTA
 * per state (Connect / Reconnect / Disconnect), and handles the
 * "already connected but reconnecting" confirm flow.
 *
 * Disconnect is owner-only (committee can see status, admin can start
 * a new connect, only owner can tear down an existing one). The confirm
 * modal warns that pending charges will settle on the club's Stripe
 * account with no refund — matches brief §5.
 */
import { computed, onMounted, ref, watch } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import {
  stripeConnect,
  ApiError,
  type StripeAccountStatus,
  type StripeStatus,
} from '@torny/api-client'

const clubStore = useClubStore()
const authStore = useAuthStore()
const toast = useToast()

const status = ref<StripeStatus | null>(null)
const loading = ref(true)
const starting = ref(false)
const disconnecting = ref(false)
const disconnectOpen = ref(false)
const reconnectConfirmOpen = ref(false)

const isOwner = computed(() => authStore.user?.role === 'owner')

async function loadStatus(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { loading.value = false; return }
  loading.value = true
  try {
    status.value = await stripeConnect.status(cid)
  } catch (err) {
    // Non-fatal — the backend sends 404 when the endpoint isn't yet
    // reachable on a given stack; show the "not configured" state
    // rather than a scary error.
    if (err instanceof ApiError && err.status !== 404) {
      toast.error(err.message || 'Could not load Stripe status.')
    }
    status.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadStatus)
watch(() => clubStore.current?.id, loadStatus)

/** Start the OAuth dance. If already connected + ready, confirm first
 *  so we don't accidentally overwrite the active connection. */
async function onConnectClick(): Promise<void> {
  if (status.value?.connected && status.value.status === 'ready') {
    reconnectConfirmOpen.value = true
    return
  }
  await startConnect()
}

async function startConnect(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || starting.value) return
  starting.value = true
  try {
    const res = await stripeConnect.start(cid)
    // The server-minted URL carries state + scope + redirect. No
    // further assembly needed — just hand control to Stripe.
    window.location.href = res.authorize_url
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not start Stripe connect.')
  } finally {
    // `window.location.href` doesn't resolve this promise, so the spinner
    // keeps spinning until the navigation happens. That's intentional.
    starting.value = false
  }
}

async function submitDisconnect(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || disconnecting.value) return
  disconnecting.value = true
  try {
    const res = await stripeConnect.disconnect(cid)
    if (res.disconnected) toast.success('Stripe disconnected.')
    else toast.info('Already disconnected.')
    disconnectOpen.value = false
    await loadStatus()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not disconnect Stripe.')
  } finally {
    disconnecting.value = false
  }
}

// ── UI mapping per brief §4 ──────────────────────────────────
interface Variant {
  tone: 'ok' | 'warn' | 'danger' | 'mute'
  label: string
  body: string
  cta: string
}
const variant = computed<Variant>(() => {
  const s = (status.value?.status ?? 'none') as StripeAccountStatus
  switch (s) {
    case 'ready':
      return {
        tone: 'ok',
        label: 'Connected',
        body: 'Your Stripe account is live. Venue deposits land on your account; Torny takes 5% as a platform fee. Tournament entry fees route via Torny with a $1 flat fee per entry.',
        cta: 'Connect a different account',
      }
    case 'onboarding':
      return {
        tone: 'warn',
        label: 'Needs Stripe setup',
        body: 'Stripe needs more details before you can accept payments. Reconnect to pick up where you left off.',
        cta: 'Finish Stripe setup',
      }
    case 'restricted':
      return {
        tone: 'danger',
        label: 'Restricted',
        body: 'Stripe has flagged requirements on your account. Open the Stripe dashboard to resolve them, then reconnect.',
        cta: 'Re-verify with Stripe',
      }
    default:
      return {
        tone: 'mute',
        label: 'Not connected',
        body: 'Connect your Stripe account to take venue deposits and tournament entry fees online. Clubs already use their own Stripe for both; nothing routes through a separate Torny account.',
        cta: 'Connect Stripe',
      }
  }
})
</script>

<template>
  <section class="sc-card">
    <header class="sc-card__head">
      <div class="sc-card__title-row">
        <div class="sc-card__brand">
          <!-- Stripe-ish mark; no wordmark asset needed for v1. -->
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="16" height="14" rx="3" fill="#635BFF"/>
            <path d="M8.2 13.8c-1 0-1.9-.3-2.5-.8l.6-1.2c.6.4 1.4.7 2 .7.6 0 .9-.2.9-.5 0-.4-.4-.5-1.2-.7-1.2-.3-2-.8-2-1.9 0-1.1.9-1.9 2.4-1.9.9 0 1.6.2 2.2.6l-.6 1.2c-.5-.3-1.1-.5-1.6-.5-.5 0-.8.2-.8.5 0 .3.3.4 1.1.6 1.3.3 2.1.8 2.1 2 0 1.2-1 2-2.6 2z" fill="#fff"/>
          </svg>
        </div>
        <h2 class="sc-card__title">Stripe payments</h2>
        <span v-if="status" class="pill" :class="`pill--${variant.tone}`">
          {{ variant.label }}
        </span>
      </div>
    </header>

    <div v-if="loading" class="sc-card__empty">Loading…</div>

    <template v-else>
      <p class="sc-card__body">{{ variant.body }}</p>

      <div v-if="status?.connected && status.stripe_account_id_masked" class="sc-card__account">
        <div class="sc-card__account-row">
          <span class="sc-card__account-label">Connected account</span>
          <code class="sc-card__account-id">{{ status.stripe_account_id_masked }}</code>
        </div>
        <div v-if="status.connected_at" class="sc-card__account-row">
          <span class="sc-card__account-label">Since</span>
          <span>{{ new Date(status.connected_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }}</span>
        </div>
      </div>

      <div v-if="status?.requirements_due && status.requirements_due.length > 0" class="sc-card__requirements">
        <div class="sc-card__requirements-eyebrow">Needs your attention in Stripe</div>
        <ul>
          <li v-for="r in status.requirements_due" :key="r"><code>{{ r }}</code></li>
        </ul>
      </div>

      <div class="sc-card__actions">
        <button
          type="button"
          class="btn btn--ink"
          :disabled="starting"
          @click="onConnectClick"
        >
          {{ starting ? 'Redirecting…' : variant.cta }}
        </button>
        <button
          v-if="status?.connected && status.status === 'ready' && isOwner"
          type="button"
          class="btn btn--danger"
          @click="disconnectOpen = true"
        >
          Disconnect
        </button>
        <span v-else-if="status?.connected && status.status === 'ready' && !isOwner" class="sc-card__owner-hint">
          Only the club owner can disconnect Stripe.
        </span>
      </div>
    </template>

    <CrmModal
      :open="reconnectConfirmOpen"
      eyebrow="Reconnect Stripe"
      title="Replace the current connection?"
      width="sm"
      @close="reconnectConfirmOpen = false"
    >
      <p class="modal-hint">
        You're already connected to Stripe. Going through this flow again will overwrite the current connection with whichever account you pick on Stripe's side — the existing one isn't disconnected first.
      </p>
      <p class="modal-hint">
        If you're swapping accounts intentionally, carry on. Otherwise cancel.
      </p>
      <template #footer>
        <button type="button" class="btn btn--outline" @click="reconnectConfirmOpen = false">Cancel</button>
        <button type="button" class="btn btn--ink" :disabled="starting" @click="reconnectConfirmOpen = false; void startConnect()">
          Continue to Stripe
        </button>
      </template>
    </CrmModal>

    <CrmModal
      :open="disconnectOpen"
      eyebrow="Danger zone"
      title="Disconnect Stripe?"
      width="sm"
      @close="disconnectOpen = false"
    >
      <p class="modal-hint">
        Nothing is refunded — any pending charges settle on your Stripe account as normal. You just lose the ability to take new deposits through Torny until you reconnect.
      </p>
      <p class="modal-hint">
        If a customer paid for a venue booking but hasn't been charged yet, that Checkout session will still work. You won't be able to issue refunds through the CRM after disconnecting.
      </p>
      <template #footer>
        <button type="button" class="btn btn--outline" :disabled="disconnecting" @click="disconnectOpen = false">Cancel</button>
        <button type="button" class="btn btn--danger" :disabled="disconnecting" @click="submitDisconnect">
          {{ disconnecting ? 'Disconnecting…' : 'Disconnect Stripe' }}
        </button>
      </template>
    </CrmModal>
  </section>
</template>

<style scoped>
.sc-card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sc-card__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.sc-card__title-row { display: flex; align-items: center; gap: 12px; }
.sc-card__brand { width: 36px; height: 36px; border-radius: 10px; background: var(--color-surface); display: inline-flex; align-items: center; justify-content: center; }
.sc-card__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); margin: 0; }

.sc-card__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0; max-width: 640px; }

.sc-card__account { padding: 14px 16px; background: var(--color-surface); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
.sc-card__account-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-family: var(--font-body); font-size: 13px; }
.sc-card__account-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.sc-card__account-id { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); }

.sc-card__requirements { padding: 14px 16px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 10px; }
.sc-card__requirements-eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #92400E; margin-bottom: 6px; }
.sc-card__requirements ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.sc-card__requirements code { font-family: var(--font-mono); font-size: 12px; color: #78350F; }

.sc-card__actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.sc-card__owner-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.sc-card__empty { padding: 20px; text-align: center; font-family: var(--font-body); color: var(--color-fog); }

.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }
.pill--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

.btn { padding: 10px 18px; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.btn--outline { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover:not(:disabled) { background: var(--color-surface); }
.btn--danger { background: transparent; color: var(--color-danger); border: 1px solid var(--color-hairline); }
.btn--danger:hover:not(:disabled) { border-color: var(--color-danger); background: color-mix(in oklab, var(--color-danger) 6%, #fff); }

.modal-hint { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.55; margin: 0 0 12px; }
.modal-hint:last-child { margin-bottom: 0; }
</style>
