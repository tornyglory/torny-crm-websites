<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const router = useRouter()

const days = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const

const canContinue = computed(() => /.+@.+\..+/.test(onboarding.data.email))

onMounted(() => {
  onboarding.setStep(3)
})

function toggleDay(key: typeof days[number]['key']) {
  onboarding.data.hours[key].open = !onboarding.data.hours[key].open
}
function goNext() {
  router.push({ name: 'onboarding-step-4' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="3"
      title="Contact &amp; hours"
      description="How members and enquirers reach you, and when the clubrooms are open."
    />

    <form class="form" @submit.prevent="goNext">
      <div class="field-row">
        <label class="field">
          <span class="field__label">Contact email</span>
          <input v-model="onboarding.data.email" type="email" class="field__input" placeholder="secretary@kelburnbowls.co.nz" />
        </label>
        <label class="field">
          <span class="field__label">Phone (optional)</span>
          <input v-model="onboarding.data.phone" type="tel" class="field__input" placeholder="+64 4 555 1234" />
        </label>
      </div>

      <div class="hours">
        <div class="hours__head">
          <div class="hours__title">Weekly hours</div>
          <div class="hours__sub">Toggle days you're open; edit times inline.</div>
        </div>
        <div class="hours__grid">
          <div v-for="d in days" :key="d.key" class="row" :class="{ 'is-closed': !onboarding.data.hours[d.key].open }">
            <button type="button" class="row__toggle" :class="{ 'is-on': onboarding.data.hours[d.key].open }" @click="toggleDay(d.key)" aria-label="Toggle open">
              <span class="row__toggle-dot" />
            </button>
            <div class="row__day">{{ d.label }}</div>
            <template v-if="onboarding.data.hours[d.key].open">
              <input v-model="onboarding.data.hours[d.key].from" type="time" class="row__time" />
              <span class="row__dash">–</span>
              <input v-model="onboarding.data.hours[d.key].to" type="time" class="row__time" />
            </template>
            <span v-else class="row__closed">Closed</span>
          </div>
        </div>
      </div>
    </form>

    <WizardFooter
      backTo="onboarding-step-2"
      skipTo="onboarding-step-4"
      :disabled="!canContinue"
      @continue="goNext"
    />
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.form { display: flex; flex-direction: column; gap: 20px; }
.field { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field__input { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 15px; color: var(--color-ink); }
.field__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field-row { display: flex; gap: 16px; }

.hours { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.hours__head { margin-bottom: 16px; }
.hours__title { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.hours__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.hours__grid { display: flex; flex-direction: column; }

.row { display: grid; grid-template-columns: 40px 130px 100px 12px 100px 1fr; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--color-hairline); }
.row:last-child { border-bottom: 0; }
.row.is-closed { opacity: 0.6; }
.row__toggle { width: 34px; height: 20px; padding: 2px; background: var(--color-hairline); border: 0; border-radius: 999px; cursor: pointer; display: inline-flex; justify-content: flex-start; }
.row__toggle.is-on { background: var(--color-ink); justify-content: flex-end; }
.row__toggle-dot { width: 16px; height: 16px; border-radius: 999px; background: #fff; }
.row__day { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.row__time { padding: 8px 10px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; color: var(--color-ink); }
.row__time:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.row__dash { text-align: center; color: var(--color-fog); }
.row__closed { grid-column: 3 / -1; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); font-style: italic; }

@media (max-width: 720px) {
  .field-row { flex-direction: column; gap: 16px; }
  .hours { padding: 18px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 0; }
  .row__toggle { flex-shrink: 0; }
  .row__day { flex: 1; min-width: 0; }
  .row__time { flex: 1; min-width: 90px; max-width: 45%; }
  .row__dash { color: var(--color-fog); }
  .row__closed { flex-basis: 100%; text-align: left; margin-left: 52px; }
}
</style>
