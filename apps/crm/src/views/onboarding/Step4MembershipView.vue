<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore, type MembershipTier } from '@/stores/onboarding'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const router = useRouter()

const canContinue = computed(() => onboarding.data.tiers.length > 0)

const cadenceLabel = computed(() => {
  return { annual: 'per year', monthly: 'per month', season: 'per season' }[onboarding.data.cadence]
})

const toneMap: Record<MembershipTier['tone'], { bg: string; fg: string }> = {
  accent: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent-strong)' },
  mint: { bg: '#DCFCE7', fg: '#166534' },
  tangerine: { bg: '#FEF3C7', fg: '#92400E' },
  violet: { bg: '#EDE9FE', fg: '#5B21B6' },
}

onMounted(() => {
  onboarding.setStep(4)
})

function addTier() {
  const nextId = `tier-${Date.now()}`
  onboarding.data.tiers.push({
    id: nextId,
    name: 'Life member',
    description: 'Complimentary lifetime membership.',
    price: 0,
    tone: 'violet',
  })
}
function removeTier(id: string) {
  onboarding.data.tiers = onboarding.data.tiers.filter(t => t.id !== id)
}
function goNext() {
  router.push({ name: 'onboarding-step-5' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="4"
      title="Membership"
      description="The tiers people pay to join. Fees show on the /membership page and drive Torny's application flow. You can adjust anytime."
    />

    <form class="form" @submit.prevent="goNext">
      <div class="cadence-row">
        <div>
          <div class="field__label">Billing cadence</div>
          <div class="segmented segmented--pill">
            <button type="button" :class="{ 'is-on': onboarding.data.cadence === 'annual' }" @click="onboarding.data.cadence = 'annual'">Annual</button>
            <button type="button" :class="{ 'is-on': onboarding.data.cadence === 'monthly' }" @click="onboarding.data.cadence = 'monthly'">Monthly</button>
            <button type="button" :class="{ 'is-on': onboarding.data.cadence === 'season' }" @click="onboarding.data.cadence = 'season'">Season</button>
          </div>
        </div>
        <div class="discount">
          <span class="discount__dot" />
          <span class="discount__label"><b>First year 20% off</b> — new joiners only</span>
          <button type="button" class="toggle" :class="{ 'is-on': onboarding.data.firstYearDiscount }" @click="onboarding.data.firstYearDiscount = !onboarding.data.firstYearDiscount">
            <span class="toggle__dot" />
          </button>
        </div>
      </div>

      <div class="tiers">
        <div v-for="tier in onboarding.data.tiers" :key="tier.id" class="tier">
          <div class="tier__icon" :style="{ background: toneMap[tier.tone].bg, color: toneMap[tier.tone].fg }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <circle cx="12" cy="8" r="3" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
            </svg>
          </div>
          <div class="tier__body">
            <div class="tier__row">
              <input v-model="tier.name" class="tier__name" />
              <span v-if="tier.isDefault" class="tier__flag">Default</span>
            </div>
            <input v-model="tier.description" class="tier__desc" />
          </div>
          <div class="tier__price">
            <span class="tier__price-sign">$</span>
            <input v-model.number="tier.price" type="number" min="0" step="5" class="tier__price-input" />
            <span class="tier__price-unit">{{ cadenceLabel }}</span>
          </div>
          <button v-if="!tier.isDefault" type="button" class="tier__remove" aria-label="Remove tier" @click="removeTier(tier.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="14" height="14"><path d="M6 6l12 12M6 18L18 6" /></svg>
          </button>
        </div>
        <button type="button" class="add-tier" @click="addTier">+ Add membership type</button>
      </div>
    </form>

    <WizardFooter
      backTo="onboarding-step-3"
      skipTo="onboarding-step-5"
      :disabled="!canContinue"
      @continue="goNext"
    />
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.form { display: flex; flex-direction: column; gap: 20px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }

.cadence-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; }

.segmented--pill { display: inline-flex; padding: 4px; background: var(--color-surface); border-radius: 999px; }
.segmented--pill button { padding: 8px 16px; background: transparent; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented--pill button.is-on { background: #fff; color: var(--color-ink); font-weight: 600; }

.discount { display: inline-flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--color-accent-soft); border-radius: 12px; }
.discount__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); }
.discount__label { font-family: var(--font-body); font-size: 12px; color: var(--color-accent-strong); }
.discount__label b { font-weight: 600; }
.toggle { width: 32px; height: 20px; padding: 2px; background: var(--color-hairline); border: 0; border-radius: 999px; cursor: pointer; display: inline-flex; justify-content: flex-start; }
.toggle.is-on { background: var(--color-accent); justify-content: flex-end; }
.toggle__dot { width: 14px; height: 14px; border-radius: 999px; background: #fff; }

.tiers { display: flex; flex-direction: column; gap: 10px; }
.tier { display: flex; align-items: center; gap: 16px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.tier__icon { width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tier__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tier__row { display: flex; align-items: center; gap: 8px; }
.tier__name { border: 0; background: transparent; padding: 0; font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--color-ink); width: 100%; }
.tier__name:focus { outline: none; }
.tier__desc { border: 0; background: transparent; padding: 0; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); width: 100%; }
.tier__desc:focus { outline: none; color: var(--color-ink); }
.tier__flag { font-family: var(--font-mono); font-size: 10px; padding: 2px 8px; background: var(--color-accent-soft); color: var(--color-accent-strong); border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.tier__price { display: inline-flex; align-items: center; padding: 8px 12px; background: var(--color-surface); border-radius: 12px; gap: 4px; flex-shrink: 0; }
.tier__price-sign { font-family: var(--font-mono); font-size: 13px; color: var(--color-fog); }
.tier__price-input { width: 60px; padding: 4px 0; background: transparent; border: 0; font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; text-align: right; -moz-appearance: textfield; }
.tier__price-input::-webkit-outer-spin-button, .tier__price-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.tier__price-input:focus { outline: none; }
.tier__price-unit { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-left: 6px; }
.tier__remove { width: 32px; height: 32px; border-radius: 8px; background: transparent; border: 1px solid var(--color-hairline); color: var(--color-fog); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tier__remove:hover { background: var(--color-danger); border-color: var(--color-danger); color: #fff; }

.add-tier { padding: 12px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-accent); cursor: pointer; }
.add-tier:hover { background: var(--color-accent-soft); }

@media (max-width: 640px) {
  .cadence-row { flex-direction: column; align-items: stretch; gap: 16px; }
  .segmented--pill { align-self: stretch; display: flex; }
  .segmented--pill button { flex: 1; text-align: center; padding: 8px 12px; }
  .discount { justify-content: space-between; }
  .discount__label { font-size: 11px; }
  .tier { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .tier__body { flex-basis: calc(100% - 60px); }
  .tier__name { font-size: 15px; }
  .tier__price { order: 3; flex: 1; padding: 6px 10px; }
  .tier__price-input { font-size: 18px; width: 50px; }
  .tier__remove { order: 4; }
}
</style>
