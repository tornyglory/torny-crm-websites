<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore, stepForField } from '@/stores/onboarding'
import { useToast } from '@/composables/useToast'

const onboarding = useOnboardingStore()
const router = useRouter()
const toast = useToast()

const clubName = computed(() => onboarding.data.clubName || 'Your club')
// Prefer the server-provided publicUrl (guaranteed correct subdomain) over
// whatever the user typed in step 6.
const publicUrl = computed(() => onboarding.publicUrl)
const subdomain = computed(() => {
  if (publicUrl.value) {
    const match = publicUrl.value.match(/https?:\/\/([^./]+)/)
    if (match) return match[1]!
  }
  return onboarding.data.subdomain || 'yourclub'
})

const finalizeError = ref<string | null>(null)

interface NextCard { to: { name: string }; label: string; title: string; desc: string; tone: 'accent' | 'mint' | 'tangerine'; time: string }
const cards: NextCard[] = [
  { to: { name: 'members' }, tone: 'accent', time: '5 min', title: 'Invite your members', desc: 'Upload your CSV or send join links so people can complete their own profile.', label: 'Go to Members' },
  { to: { name: 'events' }, tone: 'tangerine', time: '3 min', title: 'Schedule your first event', desc: 'Set up a roll-up or tournament so members have something to look forward to on day one.', label: 'New event' },
  { to: { name: 'settings' }, tone: 'mint', time: '2 min', title: 'Add your committee', desc: 'Give your president, secretary, and greenkeeper roles so they can help admin the club.', label: 'Team settings' },
]

const toneMap = {
  accent: { bg: 'var(--color-accent-soft)', fg: 'var(--color-accent-strong)' },
  mint: { bg: '#DCFCE7', fg: '#166534' },
  tangerine: { bg: '#FEF3C7', fg: '#92400E' },
} as const

onMounted(async () => {
  if (onboarding.completed) return
  const result = await onboarding.markComplete()
  if (result === 'validation') {
    const errs = onboarding.validationErrors
    const first = errs[0]
    // Show the actual error the server sent — otherwise a mystery bounce is
    // impossible for the owner to diagnose. Prefer the message, fall back to
    // "<field>: <code>" if the server only gave us structured data.
    const summary = first
      ? (first.message || `${first.field}: ${first.code}`)
      : 'Something in the wizard was rejected but the server didn\'t say what.'
    toast.error(summary)
    // Preserve any additional errors in the console so the user can share
    // them when reporting.
    if (errs.length > 1) console.warn('Additional onboarding validation errors:', errs.slice(1))

    // Bounce back to the step that owns the failing field. When the field
    // is missing or unrecognised, fall back to step 1 (all typed state is
    // preserved) instead of the welcome page — welcome makes the wizard
    // feel like it's forgetting the user's work.
    const jumpTo = first ? stepForField(first.field) : 1
    if (jumpTo === 'welcome') router.replace({ name: 'onboarding-step-1' })
    else router.replace({ name: `onboarding-step-${jumpTo}` })
  } else if (result === 'error') {
    finalizeError.value = onboarding.saveError ?? 'Something went wrong finishing setup.'
  }
})

function enterDashboard() {
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="page">
    <div class="hero">
      <div class="hero__badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="34" height="34"><path d="M5 12l5 5 9-11" /></svg>
        <span class="hero__ping" />
      </div>
      <div class="hero__eyebrow">Setup complete</div>
      <h1 class="hero__title">{{ clubName }} is on Torny.</h1>
      <p class="hero__lede">
        Your site is publishing to
        <span class="hero__code">{{ subdomain }}.torny.club</span>
        &mdash; usually ready within a minute. Here's where to go next.
      </p>
      <div v-if="finalizeError" class="hero__error">{{ finalizeError }}</div>
    </div>

    <div class="cards">
      <RouterLink v-for="c in cards" :key="c.title" :to="c.to" class="card">
        <div class="card__head">
          <div class="card__icon" :style="{ background: toneMap[c.tone].bg, color: toneMap[c.tone].fg }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <circle cx="12" cy="8" r="3" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
            </svg>
          </div>
          <span class="card__time">{{ c.time }}</span>
        </div>
        <div class="card__title">{{ c.title }}</div>
        <div class="card__desc">{{ c.desc }}</div>
        <div class="card__cta">
          <span>{{ c.label }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </div>
      </RouterLink>
    </div>

    <div class="actions">
      <button type="button" class="actions__primary" @click="enterDashboard">
        Enter dashboard
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
      <a :href="`https://${subdomain}.torny.club`" target="_blank" rel="noopener" class="actions__ghost">View live site</a>
    </div>

    <p class="foot">Everything you just set is editable from <RouterLink :to="{ name: 'settings' }">Settings</RouterLink> anytime.</p>
  </div>
</template>

<style scoped>
.page { max-width: 1080px; margin: 40px auto 0; display: flex; flex-direction: column; align-items: center; gap: 40px; text-align: center; }

.hero { display: flex; flex-direction: column; align-items: center; gap: 20px; max-width: 640px; }
.hero__badge { position: relative; width: 80px; height: 80px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.hero__ping { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-accent); border: 3px solid var(--color-surface); }
.hero__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.hero__title { font-family: var(--font-display); font-size: 56px; font-weight: 500; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 0; }
.hero__lede { font-family: var(--font-body); font-size: 17px; line-height: 1.5; color: var(--color-graphite); margin: 0; max-width: 520px; }
.hero__code { font-family: var(--font-mono); font-weight: 600; color: var(--color-ink); }
.hero__error { padding: 12px 16px; background: #FEE2E2; color: #991B1B; border-radius: 12px; font-family: var(--font-body); font-size: 13px; }

.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 100%; text-align: left; }
.card { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; text-decoration: none; color: inherit; display: flex; flex-direction: column; gap: 12px; transition: border-color 0.15s ease, transform 0.15s ease; }
.card:hover { border-color: var(--color-ink); transform: translateY(-2px); }
.card__head { display: flex; align-items: center; justify-content: space-between; }
.card__icon { width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; }
.card__time { font-family: var(--font-mono); font-size: 10px; padding: 3px 8px; background: var(--color-surface); color: var(--color-fog); border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.card__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.01em; }
.card__desc { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 1.55; }
.card__cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }

.actions { display: inline-flex; align-items: center; gap: 14px; margin-top: 8px; }
.actions__primary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 32px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease; }
.actions__primary:hover { background: var(--color-graphite); }
.actions__ghost { padding: 16px 24px; background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; }
.actions__ghost:hover { background: #fff; color: var(--color-ink); }

.foot { font-family: var(--font-body); font-size: 12px; color: var(--color-mute); text-align: center; margin-top: 0; }
.foot a { color: var(--color-fog); font-weight: 600; text-decoration: none; }
.foot a:hover { color: var(--color-ink); }

@media (max-width: 900px) {
  .cards { grid-template-columns: 1fr; }
  .hero__title { font-size: clamp(28px, 6vw, 40px); }
  .hero__lede { font-size: 15px; }
  .hero__badge { width: 64px; height: 64px; }
}

@media (max-width: 640px) {
  .page { gap: 28px; }
  .card { padding: 20px; }
  .actions { flex-direction: column; width: 100%; }
  .actions__primary, .actions__ghost { width: 100%; justify-content: center; text-align: center; padding: 14px 18px; }
}
</style>
