<script setup lang="ts">
import { usePlatformStatsStore } from '@/stores/platformStats'

const platform = usePlatformStatsStore()

interface RegionRow { region: string; clubs: number; members: number; growth: number }
const regions: RegionRow[] = [
  { region: 'Wellington', clubs: 22, members: 3120, growth: 5.4 },
  { region: 'Auckland', clubs: 41, members: 6402, growth: 8.1 },
  { region: 'Canterbury', clubs: 18, members: 2418, growth: 3.2 },
  { region: 'Waikato', clubs: 16, members: 1876, growth: 4.9 },
  { region: 'Bay of Plenty', clubs: 12, members: 1442, growth: 6.2 },
  { region: 'Otago', clubs: 9, members: 1120, growth: 2.1 },
  { region: 'Northland', clubs: 8, members: 840, growth: 7.4 },
  { region: 'Manawatū-Whanganui', clubs: 6, members: 542, growth: 1.8 },
  { region: 'Nelson-Tasman', clubs: 6, members: 444, growth: 3.6 },
]
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="head__eyebrow">Platform · Members</div>
        <h1 class="head__title">{{ platform.stats.totalMembers.toLocaleString() }} members</h1>
        <p class="head__sub">
          Aggregate view across every club on Torny. +{{ platform.stats.newMembersThisWeek }} new members joined this week.
        </p>
      </div>
    </header>

    <div class="table">
      <div class="table__head">
        <span>Region</span>
        <span>Clubs</span>
        <span>Members</span>
        <span>Growth (30d)</span>
      </div>
      <div v-for="r in regions" :key="r.region" class="table__row">
        <span class="cell cell--strong">{{ r.region }}</span>
        <span class="cell cell--num">{{ r.clubs }}</span>
        <span class="cell cell--num">{{ r.members.toLocaleString() }}</span>
        <span class="cell">
          <span class="growth" :class="{ 'is-down': r.growth < 0 }">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path v-if="r.growth >= 0" d="M12 19V5M5 12l7-7 7 7" /><path v-else d="M12 5v14M5 12l7 7 7-7" /></svg>
            {{ Math.abs(r.growth).toFixed(1) }}%
          </span>
        </span>
      </div>
    </div>

    <p class="note">Backend not wired yet — regions and totals are illustrative. Once /platform/analytics is live, this will drive off real data.</p>
  </div>
</template>

<style scoped>
.page { padding: 32px 40px 60px; }
.head { margin-bottom: 24px; }
.head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.head__title { font-family: var(--font-display); font-size: 40px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 8px 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 560px; line-height: 1.5; }

.table { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table__head, .table__row { display: grid; grid-template-columns: 2fr 100px 140px 140px; gap: 16px; padding: 14px 20px; align-items: center; }
.table__head { background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.table__row { border-bottom: 1px solid var(--color-hairline); }
.table__row:last-child { border-bottom: 0; }
.table__row:hover { background: var(--color-surface); }

.cell { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.cell--strong { font-weight: 600; }
.cell--num { font-family: var(--font-mono); font-size: 13px; color: var(--color-graphite); font-weight: 600; }

.growth { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 11px; padding: 3px 8px; background: #DCFCE7; color: #166534; border-radius: 6px; font-weight: 700; }
.growth.is-down { background: #FEE2E2; color: #991B1B; }

.note { font-family: var(--font-body); font-size: 12px; color: var(--color-mute); margin-top: 20px; font-style: italic; }

@media (max-width: 900px) {
  .page { padding: 20px; }
  .head__title { font-size: 32px; }
}
</style>
