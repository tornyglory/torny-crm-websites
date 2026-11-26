<script setup lang="ts">
/**
 * Platform admin dashboard — brief 123 §4, backend Phase 1.
 *
 * Reads `GET /admin/metrics/overview` via `useAdminMetrics('overview')`
 * and renders the key signals a bootstrapped-SaaS founder actually asks:
 *   - MRR + transactional revenue in the window (two revenue axes)
 *   - Signups + churn in the window (growth)
 *   - Activity: bookings / entries / member joins / emails sent
 *   - Health counters: past-due, comped, suspended
 *
 * Window toggle is URL-driven via `useAdminWindow` so bookmarks + back
 * button work. Trend sparklines are Phase 2 — we render MetricCards
 * without charts until the backend fills the trend arrays.
 */
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useAdminWindow } from '@/composables/useAdminWindow'
import { useAdminMetrics } from '@/composables/useAdminMetrics'
import AdminWindowToggle from '@/components/admin/AdminWindowToggle.vue'
import AdminMetricCard from '@/components/admin/AdminMetricCard.vue'
import AdminMoney from '@/components/admin/AdminMoney.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'

const auth = useAuthStore()
const { window, setWindow } = useAdminWindow()
const { data, loading, error, refresh } = useAdminMetrics('overview', window)

const firstName = computed(() => auth.user?.firstName || 'there')

// Phase 1 windowed label — "last 7 days" / "year to date" / "all time"
const windowLabel = computed(() => {
  const w = window.value
  if (w === 'ytd') return 'year to date'
  if (w === 'all') return 'all time'
  return `last ${w === '7d' ? '7' : w === '30d' ? '30' : '90'} days`
})
</script>

<template>
  <div class="dashboard">
    <header class="dashboard__head">
      <div>
        <div class="dashboard__eyebrow">PLATFORM · OVERVIEW</div>
        <h1 class="dashboard__title">Hey {{ firstName }}.</h1>
        <p class="dashboard__sub">Health of the Torny platform — {{ windowLabel }}.</p>
      </div>
      <AdminWindowToggle :model-value="window" @update:model-value="setWindow" />
    </header>

    <AdminEmptyState
      v-if="error"
      tone="error"
      title="Could not load overview"
      :detail="error"
      @retry="refresh"
    />

    <template v-else>
      <!-- Revenue (two axes — subscription + transactional) -->
      <section class="dashboard__section">
        <h2 class="dashboard__section-title">Revenue</h2>
        <div class="dashboard__grid dashboard__grid--3">
          <AdminMetricCard tone="accent" label="MRR" :loading="loading">
            <AdminMoney :cents="data?.revenue_cents.mrr" :suffix="false" />
          </AdminMetricCard>
          <AdminMetricCard tone="accent" :label="`Transactional · ${windowLabel}`" :loading="loading" subtitle="Platform take on bookings + entries + add-ons">
            <AdminMoney :cents="data?.revenue_cents.transactional_in_window" :suffix="false" />
          </AdminMetricCard>
          <AdminMetricCard :label="`Total · ${windowLabel}`" :loading="loading" subtitle="MRR + transactional, combined">
            <AdminMoney :cents="data?.revenue_cents.total_in_window" :suffix="false" />
          </AdminMetricCard>
        </div>
      </section>

      <!-- Accounts (the base) -->
      <section class="dashboard__section">
        <h2 class="dashboard__section-title">Accounts</h2>
        <div class="dashboard__grid dashboard__grid--4">
          <AdminMetricCard label="Total accounts" :value="data?.accounts.total ?? '—'" :loading="loading" />
          <AdminMetricCard label="Paying" :value="data?.accounts.paying ?? '—'" :loading="loading" subtitle="Pro + comped" />
          <AdminMetricCard :label="`Active · ${windowLabel}`" :value="data?.accounts.active_in_window ?? '—'" :loading="loading" subtitle="Had admin login" />
          <AdminMetricCard :label="`Signups · ${windowLabel}`" :value="data?.accounts.signups_in_window ?? '—'" :loading="loading" />
        </div>
      </section>

      <!-- Health signals — tones flip warn/danger when non-zero -->
      <section class="dashboard__section">
        <h2 class="dashboard__section-title">Watchlist</h2>
        <div class="dashboard__grid dashboard__grid--4">
          <AdminMetricCard
            label="Past due"
            :value="data?.accounts.past_due ?? '—'"
            :tone="(data?.accounts.past_due ?? 0) > 0 ? 'warn' : 'default'"
            :loading="loading"
            subtitle="Stripe-reported past-due subscriptions (Phase 2 — zero until the Stripe webhook mirror ships)"
          />
          <AdminMetricCard
            label="Suspended"
            :value="data?.accounts.suspended ?? '—'"
            :tone="(data?.accounts.suspended ?? 0) > 0 ? 'warn' : 'default'"
            :loading="loading"
          />
          <AdminMetricCard
            label="Comped"
            :value="data?.accounts.comped ?? '—'"
            :tone="(data?.accounts.comped ?? 0) > 0 ? 'accent' : 'default'"
            :loading="loading"
            subtitle="Manual plan overrides (incl. free-build deals)"
          />
          <AdminMetricCard
            :label="`Churned · ${windowLabel}`"
            :value="data?.accounts.churned_in_window ?? '—'"
            :loading="loading"
            subtitle="Phase 2 — needs subscription cancellation event stream"
          />
        </div>
      </section>

      <!-- Activity — the usage story -->
      <section class="dashboard__section">
        <h2 class="dashboard__section-title">Activity · {{ windowLabel }}</h2>
        <div class="dashboard__grid dashboard__grid--3">
          <AdminMetricCard label="Bookings" :value="data?.activity.bookings_in_window ?? '—'" :loading="loading">
            <template #default>
              <div class="dashboard__stacked">
                <div class="dashboard__stacked-main">{{ data?.activity.bookings_in_window ?? '—' }}</div>
                <div class="dashboard__stacked-sub">
                  <AdminMoney :cents="data?.activity.bookings_gmv_in_window_cents" /> GMV
                </div>
              </div>
            </template>
          </AdminMetricCard>
          <AdminMetricCard label="Tournament entries" :loading="loading">
            <template #default>
              <div class="dashboard__stacked">
                <div class="dashboard__stacked-main">{{ data?.activity.tournament_entries_in_window ?? '—' }}</div>
                <div class="dashboard__stacked-sub">
                  <AdminMoney :cents="data?.activity.tournament_gmv_in_window_cents" /> GMV
                </div>
              </div>
            </template>
          </AdminMetricCard>
          <AdminMetricCard label="Member joins" :value="data?.activity.member_joins_in_window ?? '—'" :loading="loading" />
        </div>
        <div class="dashboard__grid dashboard__grid--2 dashboard__grid--secondary">
          <AdminMetricCard label="Emails sent" :value="data?.activity.emails_sent_in_window ?? '—'" :loading="loading" subtitle="Currently counts batches; Phase 3 switches to recipient count" />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard { padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 32px; max-width: 1280px; }

.dashboard__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.dashboard__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-fog); }
.dashboard__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 8px 0 6px; }
.dashboard__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.dashboard__section { display: flex; flex-direction: column; gap: 14px; }
.dashboard__section-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); margin: 0; }

.dashboard__grid { display: grid; gap: 14px; }
.dashboard__grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dashboard__grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dashboard__grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dashboard__grid--secondary { margin-top: 6px; }

.dashboard__stacked { display: flex; flex-direction: column; gap: 4px; }
.dashboard__stacked-main { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; }
.dashboard__stacked-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); font-variant-numeric: tabular-nums; }

@media (max-width: 1100px) {
  .dashboard__grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard__grid--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .dashboard { padding: 24px 20px 40px; }
  .dashboard__grid--4, .dashboard__grid--3, .dashboard__grid--2 { grid-template-columns: 1fr; }
}
</style>
