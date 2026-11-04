<script setup lang="ts">
/**
 * Tournament entry checkout completion page.
 *
 * Stripe Checkout redirects here after a player pays (or cancels)
 * their tournament entry fee. Reads `?result=` + `?entry_id=` from the
 * query string.
 *
 * Mirrors `/book/complete` — no fetch, just read + render. The webhook
 * has already set `tournament_entries.status` server-side.
 */
const route = useRoute()
const club = useClub()

const result = computed<'success' | 'cancelled' | 'offline' | 'unknown'>(() => {
  const r = String(route.query.result ?? '')
  // `?offline=1` is passed by the enter page when the club isn't on
  // Stripe or the tournament is free — the entry is already recorded,
  // payment happens via the club directly.
  if (r === 'success' && route.query.offline === '1') return 'offline'
  if (r === 'success') return 'success'
  if (r === 'cancelled') return 'cancelled'
  return 'unknown'
})
const entryId = computed<string>(() => String(route.query.entry_id ?? ''))
const clubName = computed(() => club.value?.name ?? 'the club')
const accent = computed(() => club.value?.brand_primary ?? '#2563EB')
</script>

<template>
  <div class="ec" :style="{ '--brand': accent } as any">
    <div class="ec__card">
      <template v-if="result === 'success'">
        <div class="ec__badge ec__badge--ok" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
            <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="ec__eyebrow">Entry confirmed</div>
        <h1 class="ec__title">You're in</h1>
        <p class="ec__sub">
          Your entry is confirmed. {{ clubName }} will send draws, start times, and anything else you need ahead of the day. Confirmation email on its way.
        </p>
        <div v-if="entryId" class="ec__ref">
          <span class="ec__ref-label">Entry ID</span>
          <code>{{ entryId }}</code>
        </div>
      </template>

      <template v-else-if="result === 'offline'">
        <div class="ec__badge ec__badge--ok" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
            <path d="M10 16.5l4 4 8-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <div class="ec__eyebrow">Entry received</div>
        <h1 class="ec__title">You're on the list</h1>
        <p class="ec__sub">
          {{ clubName }} will contact you about paying the entry fee — usually on the day, by cash or bank transfer.
          Check your email for confirmation details.
        </p>
        <div v-if="entryId" class="ec__ref">
          <span class="ec__ref-label">Entry ID</span>
          <code>{{ entryId }}</code>
        </div>
      </template>

      <template v-else-if="result === 'cancelled'">
        <div class="ec__badge ec__badge--warn" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="currentColor" opacity="0.1" />
            <path d="M16 10v7M16 21v0.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        </div>
        <div class="ec__eyebrow">Entry cancelled</div>
        <h1 class="ec__title">Nothing was charged</h1>
        <p class="ec__sub">
          You cancelled the checkout and your entry wasn't confirmed. Head back to the tournament page to try again — your details are still there.
        </p>
        <div v-if="entryId" class="ec__ref">
          <span class="ec__ref-label">Entry ID</span>
          <code>{{ entryId }}</code>
        </div>
      </template>

      <template v-else>
        <h1 class="ec__title">Checkout complete</h1>
        <p class="ec__sub">If you paid, your entry is confirmed — look for a confirmation email shortly.</p>
      </template>

      <div class="ec__actions">
        <NuxtLink to="/tournaments" class="btn btn--ink">Back to tournaments</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ec { max-width: 720px; margin: 0 auto; padding: 72px 20px; }
.ec__card { background: #fff; border: 1px solid #E5E5E5; border-radius: 16px; padding: 48px 40px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; }

.ec__badge { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 999px; margin-bottom: 8px; }
.ec__badge--ok { color: #16A34A; }
.ec__badge--warn { color: #D97706; }

.ec__eyebrow { font-family: var(--font-body, sans-serif); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6A6A5F; }
.ec__title { font-family: var(--font-display, sans-serif); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: #1C1C19; margin: 0; }
.ec__sub { font-family: var(--font-body, sans-serif); font-size: 15px; line-height: 1.6; color: rgba(0,0,0,0.65); margin: 0; max-width: 480px; }

.ec__ref { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; background: #F5F5F2; border: 1px dashed #D7D7D2; border-radius: 10px; margin-top: 4px; }
.ec__ref-label { font-family: var(--font-body, sans-serif); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6A6A5F; }
.ec__ref code { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 14px; color: #1C1C19; }

.ec__actions { margin-top: 16px; display: flex; gap: 10px; }
.btn { padding: 12px 22px; border: 0; border-radius: 999px; font-family: var(--font-body, sans-serif); font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.btn--ink { background: #1C1C19; color: #fff; }
.btn--ink:hover { background: #3A3A33; }
</style>
