<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const router = useRouter()

const surfaces = ['tifdwarf', 'cotula', 'synthetic', 'mixed'] as const

const canContinue = computed(() =>
  onboarding.data.address.trim().length > 2 && onboarding.data.region.trim().length > 0,
)

onMounted(() => {
  onboarding.setStep(2)
})

function bumpGreens(delta: number) {
  onboarding.data.greens = Math.max(1, Math.min(20, onboarding.data.greens + delta))
}
function bumpRinks(delta: number) {
  onboarding.data.rinks = Math.max(1, Math.min(20, onboarding.data.rinks + delta))
}
function goNext() {
  router.push({ name: 'onboarding-step-3' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="2"
      title="Where you play"
      description="Where the club sits on the map, what timezone you run in, and how many greens and rinks."
    />

    <form class="form" @submit.prevent="goNext">
      <label class="field">
        <span class="field__label">Street address</span>
        <input v-model="onboarding.data.address" type="text" class="field__input" placeholder="e.g. 12 Salamanca Rd, Kelburn" />
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field__label">Suburb / city</span>
          <input v-model="onboarding.data.suburb" type="text" class="field__input" placeholder="Wellington" />
        </label>
        <label class="field">
          <span class="field__label">Region</span>
          <input v-model="onboarding.data.region" type="text" class="field__input" placeholder="Wellington" />
        </label>
        <label class="field">
          <span class="field__label">Country</span>
          <input v-model="onboarding.data.country" type="text" class="field__input" />
        </label>
      </div>

      <div class="greens">
        <div class="greens__head">
          <div>
            <div class="greens__title">Greens &amp; rinks</div>
            <div class="greens__sub">Used to size event fields and the booking grid.</div>
          </div>
          <div class="segmented">
            <button
              v-for="opt in surfaces"
              :key="opt"
              type="button"
              :class="{ 'is-on': onboarding.data.greenSurface === opt }"
              @click="onboarding.data.greenSurface = opt"
            >{{ opt.charAt(0).toUpperCase() + opt.slice(1) }}</button>
          </div>
        </div>

        <div class="counters">
          <div class="counter">
            <div class="counter__label">Greens</div>
            <div class="counter__ctrl">
              <button type="button" @click="bumpGreens(-1)" aria-label="Decrease greens">−</button>
              <span class="counter__value">{{ onboarding.data.greens }}</span>
              <button type="button" @click="bumpGreens(1)" aria-label="Increase greens">+</button>
            </div>
          </div>
          <div class="counter">
            <div class="counter__label">Rinks per green</div>
            <div class="counter__ctrl">
              <button type="button" @click="bumpRinks(-1)" aria-label="Decrease rinks">−</button>
              <span class="counter__value">{{ onboarding.data.rinks }}</span>
              <button type="button" @click="bumpRinks(1)" aria-label="Increase rinks">+</button>
            </div>
          </div>
        </div>
      </div>
    </form>

    <WizardFooter
      backTo="onboarding-step-1"
      skipTo="onboarding-step-3"
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

.greens { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; display: flex; flex-direction: column; gap: 20px; }
.greens__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.greens__title { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.greens__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }

.segmented { display: inline-flex; padding: 4px; background: var(--color-surface); border-radius: 10px; }
.segmented button { padding: 8px 12px; background: transparent; border: 0; border-radius: 6px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }

.counters { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.counter { padding: 16px; background: var(--color-surface); border-radius: 12px; }
.counter__label { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.counter__ctrl { display: inline-flex; align-items: center; gap: 12px; margin-top: 8px; }
.counter__ctrl button { width: 32px; height: 32px; border-radius: 8px; background: #fff; border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 16px; color: var(--color-ink); cursor: pointer; }
.counter__ctrl button:hover { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.counter__value { font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-ink); min-width: 32px; text-align: center; }

@media (max-width: 640px) {
  .field-row { flex-direction: column; gap: 16px; }
  .greens { padding: 18px; gap: 16px; }
  .greens__head { flex-direction: column; align-items: stretch; gap: 6px; }
  .counters { grid-template-columns: 1fr; gap: 10px; }
  .counter { padding: 14px; }
  .counter__value { font-size: 24px; }
}
</style>
