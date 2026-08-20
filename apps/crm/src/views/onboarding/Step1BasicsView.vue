<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import { useClubStore } from '@/stores/club'
import WizardHeader from '@/components/onboarding/WizardHeader.vue'
import WizardFooter from '@/components/onboarding/WizardFooter.vue'

const onboarding = useOnboardingStore()
const club = useClubStore()
const router = useRouter()

const canContinue = computed(() => onboarding.data.clubName.trim().length > 1)

onMounted(() => {
  onboarding.setStep(1)
  if (!onboarding.data.clubName && club.current?.name) {
    onboarding.data.clubName = club.current.name
  }
})

function goNext() {
  router.push({ name: 'onboarding-step-2' })
}
</script>

<template>
  <div class="page">
    <WizardHeader
      :step="1"
      title="Club basics"
      description="The essentials — how members and directory listings find you. You can edit any of this later."
    />

    <form class="form" @submit.prevent="goNext">
      <label class="field">
        <span class="field__label">Club name</span>
        <input v-model="onboarding.data.clubName" type="text" class="field__input" placeholder="e.g. Kelburn Bowling Club" />
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field__label">Year founded</span>
          <input v-model="onboarding.data.yearFounded" type="text" inputmode="numeric" maxlength="4" class="field__input" placeholder="1898" />
        </label>

        <label class="field">
          <span class="field__label">Club type</span>
          <div class="segmented">
            <button type="button" :class="{ 'is-on': onboarding.data.clubType === 'community' }" @click="onboarding.data.clubType = 'community'">Community</button>
            <button type="button" :class="{ 'is-on': onboarding.data.clubType === 'private' }" @click="onboarding.data.clubType = 'private'">Private</button>
            <button type="button" :class="{ 'is-on': onboarding.data.clubType === 'district' }" @click="onboarding.data.clubType = 'district'">District</button>
          </div>
        </label>
      </div>

      <label class="field">
        <span class="field__label">Short description</span>
        <textarea v-model="onboarding.data.shortDescription" rows="3" class="field__textarea" placeholder="One or two sentences. Appears on your directory listing and site header." />
        <span class="field__hint">{{ onboarding.data.shortDescription.length }} / 200</span>
      </label>
    </form>

    <WizardFooter skipTo="onboarding-step-2" :disabled="!canContinue" @continue="goNext" />
  </div>
</template>

<style scoped>
.page { max-width: 720px; margin: 0 auto; }
.form { display: flex; flex-direction: column; gap: 20px; }
.field { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field__input { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 15px; color: var(--color-ink); }
.field__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__textarea { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 14px; resize: vertical; color: var(--color-ink); line-height: 1.5; }
.field__textarea:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__hint { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); align-self: flex-end; }
.field-row { display: flex; gap: 16px; }

.segmented { display: inline-flex; padding: 4px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; align-self: flex-start; }
.segmented button { padding: 10px 16px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }

@media (max-width: 640px) {
  .field-row { flex-direction: column; gap: 16px; }
  .segmented { align-self: stretch; }
  .segmented button { flex: 1; padding: 10px 8px; text-align: center; }
}
</style>
