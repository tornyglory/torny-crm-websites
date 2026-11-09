<script setup lang="ts">
/**
 * Tournament settings — admin surface for per-club tournament controls.
 *
 * Two fields:
 *   - Torny's platform fee (read-only, $1 flat per entry)
 *   - Global `is_active` kill switch for entry submits
 *
 * Mirrors the venue packages settings screen. The platform fee is
 * server-controlled (brief rejects PATCH with 400 `platform_fee_readonly`).
 */
import { onMounted, ref, watch } from 'vue'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  tournamentSettings as tournamentSettingsApi,
  ApiError,
  type TournamentSettings,
} from '@torny/api-client'
import CrmSpinner from '@/components/CrmSpinner.vue'

const clubStore = useClubStore()
const toast = useToast()

const settings = ref<TournamentSettings | null>(null)
const form = ref({ is_active: true })
const loading = ref(true)
const saving = ref(false)

async function loadSettings(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { loading.value = false; return }
  loading.value = true
  try {
    const res = await tournamentSettingsApi.get(cid)
    settings.value = res
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
    const res = await tournamentSettingsApi.update(cid, { is_active: form.value.is_active })
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
  <div class="ts">
    <header class="ts__head">
      <RouterLink to="/crm/tournaments" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All tournaments</span>
      </RouterLink>
      <div class="ts__title-row">
        <div class="ts__eyebrow">Tournaments</div>
        <h1 class="ts__title">Settings</h1>
      </div>
      <p class="ts__sub">Platform fee + global kill switch for tournament entries.</p>
    </header>

    <div v-if="loading" class="empty">Loading…</div>

    <form v-else class="form" @submit.prevent="save">
      <section class="card card--callout">
        <div class="callout__head">
          <div class="callout__eyebrow">Platform fee</div>
          <div class="callout__value">
            ${{ ((settings?.platform_fee_cents ?? 100) / 100).toFixed(2) }}
            <span class="callout__unit">/ entry</span>
          </div>
        </div>
        <p class="callout__body">
          Torny collects a flat {{ ((settings?.platform_fee_cents ?? 100) / 100).toFixed(0) === '1' ? '$1' : `$${((settings?.platform_fee_cents ?? 100) / 100).toFixed(2)}` }}
          per paid entry. The rest of the entry fee transfers to your Stripe account. This covers hosting, payment processing, and ongoing development — not editable from here.
        </p>
      </section>

      <section class="card">
        <h2 class="card__title">Accepting entries</h2>

        <label class="switch-row">
          <div>
            <div class="switch-row__label">Entries are open</div>
            <div class="switch-row__hint">
              Turn off to pause public entry submits on every tournament for this club.
              Tournament pages still render — the Enter button shows "Not accepting entries right now."
            </div>
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
        <RouterLink to="/crm/tournaments" class="btn btn--ghost">Cancel</RouterLink>
        <button type="submit" class="btn btn--ink" :disabled="saving">
          <CrmSpinner v-if="saving" size="sm" label="Saving" />
          <span>{{ saving ? 'Saving…' : 'Save settings' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.ts { max-width: 1280px; display: flex; flex-direction: column; gap: 24px; }

.ts__head { display: flex; flex-direction: column; gap: 0; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.ts__title-row { display: flex; align-items: baseline; gap: 12px; margin: 10px 0 6px; }
.ts__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.ts__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.ts__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }

.empty { padding: 48px; text-align: center; font-family: var(--font-body); color: var(--color-fog); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }

.form { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }

.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.card--callout { background: var(--color-surface); border-style: dashed; }
.card__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin: 0; }

.callout__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.callout__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.callout__value { font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-ink); line-height: 1; }
.callout__unit { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-fog); margin-left: 4px; }
.callout__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; line-height: 1.55; }

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
