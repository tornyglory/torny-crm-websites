<script setup lang="ts">
/**
 * MemberSummaryStats — the four-panel stat strip above the member
 * filters (expected fees / collected / outstanding / top tier),
 * extracted from MembersView.vue (brief 48). Pure display — no handlers,
 * no state, just a `summary` prop.
 *
 * The parent still fetches the summary and decides when to show the
 * strip; this component renders it when `summary` is non-null.
 */
import type { MembersSummary } from '@torny/api-client'

defineProps<{
  summary: MembersSummary | null
}>()

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `$${n}`
}
</script>

<template>
  <section v-if="summary" class="stats">
    <div class="stat-panel">
      <div class="stat-panel__label">
        Expected fees
        <span v-if="summary.season_name" class="stat-panel__label-season">
          · {{ summary.season_name }}<template v-if="summary.is_current_season"> · current</template>
        </span>
      </div>
      <div class="stat-panel__value">{{ fmtMoney(summary.expected_fees) }}</div>
      <div class="stat-panel__sub">{{ summary.counts.active }} active member{{ summary.counts.active === 1 ? '' : 's' }}</div>
    </div>
    <div class="stat-panel stat-panel--ok">
      <div class="stat-panel__label">Collected</div>
      <div class="stat-panel__value">{{ fmtMoney(summary.collected) }}</div>
      <div class="stat-panel__sub">
        <span>{{ summary.collection_rate }}% of expected</span>
      </div>
    </div>
    <div class="stat-panel" :class="{ 'stat-panel--warn': summary.outstanding > 0 }">
      <div class="stat-panel__label">Outstanding</div>
      <div class="stat-panel__value">{{ fmtMoney(summary.outstanding) }}</div>
      <div class="stat-panel__sub">
        <template v-if="summary.counts.lapsed > 0"><strong>{{ summary.counts.lapsed }} lapsed</strong> · </template>
        {{ summary.counts.pending }} pending
      </div>
    </div>
    <div class="stat-panel stat-panel--muted">
      <div class="stat-panel__label">Top tier</div>
      <div class="stat-panel__value stat-panel__value--sm">{{ summary.top_tiers[0]?.type_name ?? '—' }}</div>
      <div class="stat-panel__sub">{{ summary.top_tiers[0]?.count ?? 0 }} member{{ summary.top_tiers[0]?.count === 1 ? '' : 's' }}</div>
    </div>
  </section>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.stat-panel { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.stat-panel--ok { background: #F0FDF4; border-color: #BBF7D0; }
.stat-panel--ok .stat-panel__value { color: #14532D; }
.stat-panel--warn { background: #FFFBEB; border-color: #FDE68A; }
.stat-panel--warn .stat-panel__value { color: #92400E; }
.stat-panel--muted { background: var(--color-surface); }
.stat-panel__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.stat-panel__label-season { font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--color-graphite); }
.stat-panel__value { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin-top: 6px; line-height: 1.1; }
.stat-panel__value--sm { font-size: 16px; }
.stat-panel__sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.stat-panel__sub strong { color: #991B1B; font-weight: 700; }

@media (max-width: 900px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
