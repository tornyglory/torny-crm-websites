<script setup lang="ts">
/**
 * Venue packages — settings screen.
 *
 * Three admin-editable fields (deposit %, balance due days, is_active)
 * plus a read-only "Torny takes 5%" callout so admins know what the
 * platform fee is before Stripe Connect (brief 72) ships. The settings
 * endpoint lazy-upserts on first GET — no "enable venue hire" button
 * needed.
 */
import { onMounted, ref, watch } from 'vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  venuePackages as venuePackagesApi,
  ApiError,
  type VenueSettings,
} from '@torny/api-client'
import CrmSpinner from '@/components/CrmSpinner.vue'

const clubStore = useClubStore()
const toast = useToast()

const settings = ref<VenueSettings | null>(null)
const form = ref({
  deposit_percent: 15,
  balance_due_days_before: 14,
  is_active: true,
})
const loading = ref(true)
const saving = ref(false)

async function loadSettings(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { loading.value = false; return }
  loading.value = true
  try {
    const res = await venuePackagesApi.getSettings(cid)
    settings.value = res
    form.value.deposit_percent = res.deposit_percent
    form.value.balance_due_days_before = res.balance_due_days_before
    form.value.is_active = res.is_active
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load settings.')
  } finally {
    loading.value = false
  }
}

onMounted(loadSettings)
watch(() => clubStore.current?.id, loadSettings)

async function save(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  saving.value = true
  try {
    const res = await venuePackagesApi.updateSettings(cid, {
      deposit_percent: form.value.deposit_percent,
      balance_due_days_before: form.value.balance_due_days_before,
      is_active: form.value.is_active,
    })
    settings.value = res
    toast.success('Settings saved.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not save settings.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="vs">
    <header class="vs__head">
      <RouterLink to="/crm/venue-packages" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All packages</span>
      </RouterLink>
      <div class="vs__title-row">
        <div class="vs__eyebrow">Venue hire</div>
        <h1 class="vs__title">Settings</h1>
      </div>
      <p class="vs__sub">Deposit, balance timing, and the platform fee that applies to every booking.</p>
    </header>

    <div v-if="loading" class="empty">Loading…</div>

    <form v-else class="form" @submit.prevent="save">
      <section class="card">
        <h2 class="card__title">Pricing</h2>

        <label class="field">
          <span class="field__label">Deposit charged at booking</span>
          <div class="field__input-row">
            <input
              v-model.number="form.deposit_percent"
              type="number"
              min="0"
              max="100"
              step="1"
              class="field__input field__input--pct"
            />
            <span class="field__suffix">% of the total</span>
          </div>
          <span class="field__hint">The % of the booking total that's charged on confirmation. Balance due closer to the booking date.</span>
        </label>

        <label class="field">
          <span class="field__label">Balance due before the booking</span>
          <div class="field__input-row">
            <input
              v-model.number="form.balance_due_days_before"
              type="number"
              min="0"
              max="60"
              step="1"
              class="field__input field__input--pct"
            />
            <span class="field__suffix">days before the booking date</span>
          </div>
          <span class="field__hint">Customers pay the remaining balance this many days before the event.</span>
        </label>
      </section>

      <section class="card card--callout">
        <div class="callout__head">
          <div class="callout__eyebrow">Platform fee</div>
          <div class="callout__value">{{ settings?.platform_fee_percent ?? 5 }}%</div>
        </div>
        <p class="callout__body">
          Torny collects {{ settings?.platform_fee_percent ?? 5 }}% of every deposit as `application_fee_amount` when
          a customer pays through Stripe. Covers hosting, payment processing, and ongoing development.
          Not editable from here — contact support if you need to discuss it.
        </p>
      </section>

      <section class="card">
        <h2 class="card__title">Public access</h2>

        <label class="switch-row">
          <div>
            <div class="switch-row__label">Venue hire is open</div>
            <div class="switch-row__hint">Turn off to pause public booking submissions. Existing bookings aren't affected.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': form.is_active }"
            @click="form.is_active = !form.is_active"
            :aria-pressed="form.is_active"
          >
            <span class="switch__knob" />
          </button>
        </label>
      </section>

      <div class="form__actions">
        <RouterLink to="/crm/venue-packages" class="btn btn--ghost">Cancel</RouterLink>
        <button type="submit" class="btn btn--ink" :disabled="saving">
          <CrmSpinner v-if="saving" size="sm" label="Saving" />
          <span>{{ saving ? 'Saving…' : 'Save settings' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.vs { max-width: 1280px; display: flex; flex-direction: column; gap: 24px; }

.vs__head { display: flex; flex-direction: column; gap: 0; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.vs__title-row { display: flex; align-items: baseline; gap: 12px; margin: 10px 0 6px; }
.vs__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.vs__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.vs__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }

.empty { padding: 48px; text-align: center; font-family: var(--font-body); color: var(--color-fog); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }

.form { display: flex; flex-direction: column; gap: 16px; }

.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.card__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin: 0; }
.card--callout { background: var(--color-surface); border-style: dashed; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; }
.field__input-row { display: flex; align-items: center; gap: 10px; }
.field__input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; }
.field__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__input--pct { width: 90px; text-align: right; font-family: var(--font-mono); }
.field__suffix { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

.callout__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.callout__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.callout__value { font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-ink); line-height: 1; }
.callout__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; line-height: 1.5; }

.switch-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.switch-row__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; line-height: 1.5; }
.switch { width: 44px; height: 26px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 20px; height: 20px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(18px); }

.form__actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; }
.btn { padding: 10px 18px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.btn--ink:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }
</style>
