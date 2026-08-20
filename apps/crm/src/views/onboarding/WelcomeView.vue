<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { useOnboardingStore } from '@/stores/onboarding'

const auth = useAuthStore()
const club = useClubStore()
const onboarding = useOnboardingStore()
const router = useRouter()

const firstName = computed(() => auth.user?.firstName || 'there')
const clubName = computed(() => club.current?.name || 'your club')

onMounted(() => {
  onboarding.setStep('welcome')
})

function begin() {
  onboarding.setStep(1)
  router.push({ name: 'onboarding-step-1' })
}
</script>

<template>
  <section class="welcome">
    <div class="welcome__eyebrow">Welcome to Torny CRM</div>
    <h1 class="welcome__title">Nice to meet you, {{ firstName }}.</h1>
    <p class="welcome__lede">
      Let's get <strong>{{ clubName }}</strong> set up so members can join, apply, and see what's on.
      Six short steps — you can save and finish later.
    </p>

    <div class="welcome__stats">
      <div class="stat">
        <div class="stat__value">6</div>
        <div class="stat__label">Setup steps</div>
      </div>
      <div class="stat">
        <div class="stat__value">~5 min</div>
        <div class="stat__label">Average time</div>
      </div>
      <div class="stat">
        <div class="stat__value">Now</div>
        <div class="stat__label">Site goes live</div>
      </div>
    </div>

    <ul class="welcome__list">
      <li>
        <span class="welcome__list-chip">1</span>
        <div>
          <div class="welcome__list-h">Club basics &amp; where you play</div>
          <div class="welcome__list-p">Name, region, address, greens, and rinks.</div>
        </div>
      </li>
      <li>
        <span class="welcome__list-chip">2</span>
        <div>
          <div class="welcome__list-h">Contact, hours &amp; membership tiers</div>
          <div class="welcome__list-p">How people reach you, when you're open, and what they pay.</div>
        </div>
      </li>
      <li>
        <span class="welcome__list-chip">3</span>
        <div>
          <div class="welcome__list-h">Brand &amp; public website</div>
          <div class="welcome__list-p">Logo, accent colour, tagline, then pick pages and publish.</div>
        </div>
      </li>
    </ul>

    <div class="welcome__actions">
      <button type="button" class="welcome__cta" @click="begin">
        Start setup
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
      <RouterLink :to="{ name: 'dashboard' }" class="welcome__skip">I'll do this later</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.welcome { max-width: 720px; margin: 40px auto 0; }
.welcome__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 20px; }
.welcome__title { font-family: var(--font-display); font-size: clamp(32px, 6.5vw, 56px); font-weight: 500; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 0 0 20px; }
.welcome__lede { font-family: var(--font-body); font-size: clamp(15px, 2vw, 17px); line-height: 1.55; color: var(--color-graphite); margin: 0 0 40px; max-width: 560px; }
.welcome__lede strong { color: var(--color-ink); font-weight: 700; }

.welcome__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 40px; }
.stat { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.stat__value { font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.stat__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-top: 6px; }

.welcome__list { list-style: none; padding: 0; margin: 0 0 40px; display: flex; flex-direction: column; gap: 8px; }
.welcome__list li { display: flex; gap: 16px; padding: 18px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.welcome__list-chip { width: 32px; height: 32px; border-radius: 8px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; font-weight: 700; flex-shrink: 0; }
.welcome__list-h { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.welcome__list-p { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

.welcome__actions { display: inline-flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.welcome__cta { display: inline-flex; align-items: center; gap: 10px; padding: 16px 28px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease; }
.welcome__cta:hover { background: var(--color-graphite); }
.welcome__skip { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-decoration: none; }
.welcome__skip:hover { color: var(--color-ink); }

@media (max-width: 900px) {
  .welcome { margin-top: 20px; }
  .welcome__lede { margin-bottom: 28px; }
  .welcome__stats { gap: 8px; margin-bottom: 28px; }
  .stat { padding: 14px 16px; }
  .stat__value { font-size: 22px; }
  .welcome__list { margin-bottom: 28px; }
  .welcome__list li { padding: 14px 16px; }
}

@media (max-width: 640px) {
  .welcome__stats { grid-template-columns: 1fr 1fr; }
  .welcome__stats .stat:last-child { grid-column: 1 / -1; }
  .welcome__actions { width: 100%; }
  .welcome__cta { flex: 1; justify-content: center; }
}
</style>
