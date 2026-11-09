<script setup lang="ts">
/**
 * Post-checkout landing page — Stripe's success_url sends admins here
 * after they confirm card details on the Checkout page.
 *
 * Design intent: celebrate the upgrade, confirm what just happened,
 * show what's newly accessible, and send them back into the CRM with
 * a next step. Not a dead-end "thanks" screen.
 *
 * Timing caveat: Stripe's webhook ping that flips the backend's plan
 * row from 'starter' to 'pro' can arrive after the admin lands here.
 * We optimistically assume Pro (they wouldn't be here otherwise) and
 * display backend state once it catches up — no spinners shown for the
 * webhook race because the user doesn't care about the mechanism.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, billing as billingApi, type PlanState } from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const router = useRouter()
const clubStore = useClubStore()

const state = ref<PlanState | null>(null)
const errorMessage = ref<string | null>(null)

async function loadState() {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  try {
    state.value = await billingApi.get(clubId)
  } catch (err) {
    errorMessage.value = err instanceof ApiError ? err.message : 'Could not refresh plan state.'
  }
}

onMounted(() => {
  void loadState()
})

const nextChargeText = computed(() => {
  const s = state.value
  if (!s) return null
  if (s.subscription_status === 'trialing' && s.trial_ends_at) {
    return `Free until ${fmtDate(s.trial_ends_at)} · first charge same day`
  }
  if ((s.subscription_status === 'active' || s.subscription_status === 'past_due') && s.current_period_end) {
    return `Next charge ${fmtDate(s.current_period_end)}`
  }
  return null
})

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface UnlockedFeature {
  label: string
  blurb: string
  to: string
}

// Every Pro feature with a CRM landing page. Keeps parity with the
// Starter-vs-Pro comparison on Settings → Billing and the signup wizard.
const unlocked: UnlockedFeature[] = [
  { label: 'Venue bookings',  blurb: 'Public enquiry form + packages + capacity.', to: '/crm/venue-bookings' },
  { label: 'Tournaments',     blurb: 'Draws, rosters, entry payments.',             to: '/crm/tournaments' },
  { label: 'Team selections', blurb: 'Pick XIs, send announcements to members.',    to: '/crm/team-selections' },
  { label: 'Honour boards',   blurb: 'Immortalise champions on the website.',       to: '/crm/honour-board' },
]

function goToDashboard() { router.replace('/crm') }
function goToBilling() { router.replace('/crm/settings/billing') }
</script>

<template>
  <div class="bs">
    <div class="bs__card">
      <div class="bs__badge" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.12" />
          <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>

      <h1 class="bs__title">Welcome to Pro</h1>
      <p class="bs__sub">
        Your subscription is live. Here's what's now switched on across the CRM
        and your public site.
      </p>

      <div class="bs__meta">
        <div class="bs__meta-pill">Pro plan</div>
        <div v-if="nextChargeText" class="bs__meta-note">{{ nextChargeText }}</div>
      </div>

      <div class="bs__unlocked">
        <div class="bs__unlocked-eyebrow">What's now unlocked</div>
        <ul class="bs__unlocked-list">
          <li v-for="f in unlocked" :key="f.to">
            <router-link class="bs__unlocked-item" :to="f.to">
              <span class="bs__unlocked-check" aria-hidden="true">✓</span>
              <span class="bs__unlocked-text">
                <strong>{{ f.label }}</strong>
                <span class="bs__unlocked-blurb">{{ f.blurb }}</span>
              </span>
              <span class="bs__unlocked-arrow" aria-hidden="true">→</span>
            </router-link>
          </li>
        </ul>
      </div>

      <p v-if="errorMessage" class="bs__err">{{ errorMessage }}</p>

      <div class="bs__actions">
        <button class="btn btn--ink" @click="goToDashboard">Go to dashboard</button>
        <button class="btn btn--outline" @click="goToBilling">Back to billing</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bs { max-width: 720px; padding: 32px 0 48px; margin: 0 auto; }

.bs__card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  padding: 44px 40px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.bs__badge {
  color: #16A34A;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin-bottom: 4px;
}

.bs__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-ink);
}
.bs__sub {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-fog);
  max-width: 480px;
  line-height: 1.55;
}

.bs__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}
.bs__meta-pill {
  padding: 4px 14px;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.bs__meta-note {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}

.bs__unlocked {
  width: 100%;
  margin-top: 20px;
  padding: 18px 20px 22px;
  background: var(--color-surface, #fafafa);
  border-radius: 14px;
  text-align: left;
}
.bs__unlocked-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--color-mute);
  margin-bottom: 12px;
}
.bs__unlocked-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.bs__unlocked-item {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  text-decoration: none;
  color: var(--color-ink);
  transition: border-color 120ms ease, transform 120ms ease;
}
.bs__unlocked-item:hover {
  border-color: var(--color-accent, #4f46e5);
  transform: translateX(2px);
}
.bs__unlocked-check {
  color: #16A34A;
  font-weight: 700;
  font-size: 15px;
  text-align: center;
}
.bs__unlocked-text { display: flex; flex-direction: column; gap: 2px; font-family: var(--font-body); }
.bs__unlocked-text strong { font-size: 14px; font-weight: 600; }
.bs__unlocked-blurb { font-size: 12px; color: var(--color-fog); }
.bs__unlocked-arrow { color: var(--color-mute); font-size: 16px; }

.bs__err {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fef2f2;
  color: #b91c1c;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 12px;
}

.bs__actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.btn {
  padding: 10px 20px;
  border-radius: 999px;
  border: none;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover { background: var(--color-graphite, #333); }
.btn--outline { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover { border-color: var(--color-ink); }

@media (max-width: 640px) {
  .bs { padding: 16px; }
  .bs__card { padding: 32px 20px 28px; }
  .bs__title { font-size: 26px; }
}
</style>
