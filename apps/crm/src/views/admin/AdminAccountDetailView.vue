<script setup lang="ts">
/**
 * Account detail view — brief 123 §3.
 *
 * Shows the account row metrics, timeline, and the action bar
 * (impersonate / comp plan / suspend). Refreshes on any action
 * completion so state transitions are visible immediately.
 */
import { computed, toRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AdminAccountRow } from '@torny/api-client'
import { useAdminWindow } from '@/composables/useAdminWindow'
import { useAdminAccount } from '@/composables/useAdminAccount'
import AdminWindowToggle from '@/components/admin/AdminWindowToggle.vue'
import AdminMetricCard from '@/components/admin/AdminMetricCard.vue'
import AdminMoney from '@/components/admin/AdminMoney.vue'
import AdminFlagBadges from '@/components/admin/AdminFlagBadges.vue'
import AdminTimelineList from '@/components/admin/AdminTimelineList.vue'
import AdminActionBar from '@/components/admin/AdminActionBar.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'

const route = useRoute()
const router = useRouter()
const { window, setWindow } = useAdminWindow()

const accountId = computed(() => {
  const raw = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
  return Number(raw)
})

const { data, loading, error, refresh } = useAdminAccount(accountId, toRef(window))

function w<K extends 'bookings' | 'bookings_gmv' | 'tournament_entries' | 'tournament_gmv' | 'member_joins' | 'emails_sent' | 'platform_take'>(
  row: AdminAccountRow,
  key: K,
): number {
  const field = key.endsWith('_gmv') || key === 'platform_take'
    ? `${key}_${window.value}_cents`
    : `${key}_${window.value}`
  return ((row as unknown as Record<string, number | undefined>)[field]) ?? 0
}

const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', comped: 'Comped' }

function backToList() {
  void router.push('/admin/accounts')
}
</script>

<template>
  <div class="detail">
    <div class="detail__crumb">
      <button type="button" class="detail__back" @click="backToList">← Accounts</button>
      <AdminWindowToggle :model-value="window" @update:model-value="setWindow" />
    </div>

    <AdminEmptyState
      v-if="error"
      tone="error"
      title="Could not load account"
      :detail="error"
      @retry="refresh"
    />

    <template v-else-if="data">
      <header class="detail__head">
        <div class="detail__head-main">
          <div class="detail__eyebrow">PLATFORM · ACCOUNT</div>
          <h1 class="detail__title">{{ data.account.name }}</h1>
          <div class="detail__sub">
            <span class="plan" :class="`plan--${data.account.plan}`">{{ PLAN_LABELS[data.account.plan] ?? data.account.plan }}</span>
            <span class="detail__sub-text">{{ data.account.subdomain }}</span>
            <span class="detail__sub-text">·</span>
            <span class="detail__sub-text">{{ data.account.owner_email ?? 'No owner email' }}</span>
          </div>
          <AdminFlagBadges class="detail__flags" :flags="data.account.flags" />
        </div>
        <AdminActionBar :account="data.account" @done="refresh" />
      </header>

      <section class="detail__section">
        <h2 class="detail__section-title">Revenue</h2>
        <div class="detail__grid detail__grid--3">
          <AdminMetricCard tone="accent" label="MRR" :loading="loading">
            <AdminMoney :cents="data.account.mrr_cents" :suffix="false" />
          </AdminMetricCard>
          <AdminMetricCard tone="accent" label="Platform take · window" :loading="loading" subtitle="Our cut of bookings + entries + add-ons">
            <AdminMoney :cents="w(data.account, 'platform_take')" :suffix="false" />
          </AdminMetricCard>
          <AdminMetricCard label="Lifetime platform take" :loading="loading" subtitle="All time">
            <AdminMoney :cents="data.account.lifetime_revenue_cents" :suffix="false" />
          </AdminMetricCard>
        </div>
      </section>

      <section class="detail__section">
        <h2 class="detail__section-title">Activity · window</h2>
        <div class="detail__grid detail__grid--3">
          <AdminMetricCard label="Bookings" :value="w(data.account, 'bookings')" :loading="loading">
            <template #default>
              <div class="detail__stacked">
                <div class="detail__stacked-main">{{ w(data.account, 'bookings') }}</div>
                <div class="detail__stacked-sub"><AdminMoney :cents="w(data.account, 'bookings_gmv')" /> GMV</div>
              </div>
            </template>
          </AdminMetricCard>
          <AdminMetricCard label="Tournament entries" :loading="loading">
            <template #default>
              <div class="detail__stacked">
                <div class="detail__stacked-main">{{ w(data.account, 'tournament_entries') }}</div>
                <div class="detail__stacked-sub"><AdminMoney :cents="w(data.account, 'tournament_gmv')" /> GMV</div>
              </div>
            </template>
          </AdminMetricCard>
          <AdminMetricCard label="Members" :loading="loading">
            <template #default>
              <div class="detail__stacked">
                <div class="detail__stacked-main">{{ data.account.member_count }}</div>
                <div class="detail__stacked-sub">+{{ w(data.account, 'member_joins') }} joined in window</div>
              </div>
            </template>
          </AdminMetricCard>
        </div>
      </section>

      <section class="detail__section">
        <h2 class="detail__section-title">Timeline</h2>
        <div class="detail__timeline">
          <AdminTimelineList :events="data.timeline" />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.detail { padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 28px; max-width: 1280px; }

.detail__crumb { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.detail__back { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); background: none; border: 0; cursor: pointer; padding: 6px 0; }
.detail__back:hover { color: var(--color-ink); }

.detail__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
.detail__head-main { display: flex; flex-direction: column; gap: 8px; }
.detail__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-fog); }
.detail__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.detail__sub { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.detail__sub-text { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.detail__flags { margin-top: 4px; }

.plan { display: inline-block; padding: 3px 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; }
.plan--starter { background: var(--color-surface); color: var(--color-graphite); }
.plan--pro { background: color-mix(in oklab, var(--color-accent) 15%, #fff); color: var(--color-accent); }
.plan--comped { background: color-mix(in oklab, var(--color-feature-violet) 15%, #fff); color: var(--color-feature-violet); }

.detail__section { display: flex; flex-direction: column; gap: 14px; }
.detail__section-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); margin: 0; }

.detail__grid { display: grid; gap: 14px; }
.detail__grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.detail__stacked { display: flex; flex-direction: column; gap: 4px; }
.detail__stacked-main { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; }
.detail__stacked-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); font-variant-numeric: tabular-nums; }

.detail__timeline { background: var(--color-ground); border: 1px solid var(--color-hairline); border-radius: 12px; padding: 24px; }

@media (max-width: 900px) {
  .detail__grid--3 { grid-template-columns: 1fr; }
}
</style>
