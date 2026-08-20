<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { useOnboardingStore } from '@/stores/onboarding'

const auth = useAuthStore()
const club = useClubStore()
const onboarding = useOnboardingStore()
const route = useRoute()
const router = useRouter()

interface RailStep { n: 1 | 2 | 3 | 4 | 5 | 6; label: string }
const steps: RailStep[] = [
  { n: 1, label: 'Club basics' },
  { n: 2, label: 'Where you play' },
  { n: 3, label: 'Contact & hours' },
  { n: 4, label: 'Membership' },
  { n: 5, label: 'Brand' },
  { n: 6, label: 'Website' },
]

const currentStep = computed(() => onboarding.stepNumber)
const isWelcome = computed(() => route.name === 'onboarding-welcome')
const isComplete = computed(() => route.name === 'onboarding-complete')
const showRail = computed(() => !isWelcome.value && !isComplete.value)

const stepsLeftLabel = computed(() => {
  if (currentStep.value == null) return ''
  const remaining = 6 - currentStep.value
  if (remaining <= 0) return 'nearly there'
  const mins = remaining + 1
  return `about ${mins} min left`
})

const displayName = computed(() => {
  if (!auth.user) return ''
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || auth.user.email
})

function saveAndExit() {
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="onboarding">
    <header class="onboarding__top">
      <div class="onboarding__wordmark">
        <span class="onboarding__dot" />
        <span class="onboarding__brand">Torny</span>
        <span class="onboarding__tag">{{ isComplete ? 'CRM · Ready' : 'CRM · Setup' }}</span>
      </div>
      <div class="onboarding__right">
        <template v-if="!isComplete">
          <span class="onboarding__right-muted">Setting up as</span>
          <span class="onboarding__right-strong">
            {{ displayName }}
            <template v-if="club.current?.name"> · {{ club.current.name }}</template>
          </span>
          <button v-if="!isWelcome" type="button" class="onboarding__save" @click="saveAndExit">Save &amp; exit</button>
        </template>
        <template v-else>
          <span class="onboarding__right-muted">Signed in as</span>
          <span class="onboarding__right-strong">
            {{ displayName }}
            <template v-if="club.current?.name"> · {{ club.current.name }}</template>
          </span>
        </template>
      </div>
    </header>

    <div class="onboarding__body">
      <aside v-if="showRail" class="rail">
        <div class="rail__eyebrow">Setup progress</div>
        <div class="rail__hint">Step {{ currentStep }} of 6 · {{ stepsLeftLabel }}</div>
        <div class="rail__bar" role="progressbar" :aria-valuenow="onboarding.progressPct" aria-valuemin="0" aria-valuemax="100">
          <span
            v-for="i in 6"
            :key="i"
            class="rail__bar-seg"
            :class="{ 'is-done': currentStep != null && i <= currentStep }"
          />
        </div>
        <ol class="rail__steps">
          <li
            v-for="s in steps"
            :key="s.n"
            class="rail__step"
            :class="{
              'is-active': currentStep === s.n,
              'is-done': currentStep != null && s.n < currentStep,
            }"
          >
            <span class="rail__chip">
              <svg v-if="currentStep != null && s.n < currentStep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12l5 5 9-11" /></svg>
              <span v-else>{{ s.n }}</span>
            </span>
            <span class="rail__label">{{ s.label }}</span>
          </li>
        </ol>
      </aside>

      <main class="onboarding__form" :class="{ 'onboarding__form--wide': !showRail }">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  min-height: 100vh;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
}

.onboarding__top {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 60px;
  background: #fff;
  border-bottom: 1px solid var(--color-hairline);
}
.onboarding__wordmark { display: inline-flex; align-items: baseline; gap: 10px; }
.onboarding__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); align-self: center; }
.onboarding__brand { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); }
.onboarding__tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; padding: 4px 8px; background: var(--color-surface); border-radius: 6px; }

.onboarding__right { display: inline-flex; align-items: center; gap: 16px; font-family: var(--font-body); font-size: 13px; }
.onboarding__right-muted { color: var(--color-fog); }
.onboarding__right-strong { font-weight: 700; color: var(--color-ink); }
.onboarding__save { padding: 8px 14px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-graphite); cursor: pointer; }
.onboarding__save:hover { background: var(--color-surface); color: var(--color-ink); }

.onboarding__body { flex: 1; display: flex; align-items: flex-start; }

.rail {
  width: 320px;
  padding: 40px 40px 40px 60px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex-shrink: 0;
  position: sticky;
  top: 73px;
}
.rail__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.rail__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: -12px; }
.rail__bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; margin: 6px 0 8px; }
.rail__bar-seg { height: 4px; background: var(--color-hairline); border-radius: 999px; }
.rail__bar-seg.is-done { background: var(--color-ink); }
.rail__steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.rail__step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  transition: background-color 0.15s ease;
}
.rail__step.is-active { background: var(--color-surface); }
.rail__chip {
  width: 24px; height: 24px; border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: transparent;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-body); font-size: 12px; font-weight: 600;
  color: var(--color-fog);
  flex-shrink: 0;
}
.rail__step.is-active .rail__chip { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.rail__step.is-done .rail__chip { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.rail__label { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); font-weight: 500; }
.rail__step.is-active .rail__label { color: var(--color-ink); font-weight: 700; }
.rail__step.is-done .rail__label { color: var(--color-ink); }

.onboarding__form { flex: 1; min-width: 0; padding: 40px 80px 60px 40px; }
.onboarding__form--wide { padding: 40px 60px 80px; }

@media (max-width: 900px) {
  .onboarding__top { padding: 16px 20px; }
  .onboarding__right-muted, .onboarding__save { display: none; }
  .onboarding__body { flex-direction: column; }
  .rail { width: 100%; padding: 20px 20px 0; position: static; }
  .rail__steps { flex-direction: row; overflow-x: auto; padding-bottom: 12px; }
  .rail__step { flex-shrink: 0; }
  .rail__label { display: none; }
  .rail__step.is-active .rail__label { display: inline; }
  .onboarding__form { padding: 20px; }
}
</style>
