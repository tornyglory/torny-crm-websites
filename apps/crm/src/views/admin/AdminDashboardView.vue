<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClaimsStore } from '@/stores/claims'
import { usePlatformStatsStore } from '@/stores/platformStats'
import { usePlatformUsersStore } from '@/stores/platformUsers'
import StatCard from '@/components/admin/StatCard.vue'
import { useToast } from '@/composables/useToast'

const auth = useAuthStore()
const claims = useClaimsStore()
const platform = usePlatformStatsStore()
const platformUsers = usePlatformUsersStore()
const router = useRouter()
const toast = useToast()

const firstName = computed(() => auth.user?.firstName || 'there')
const stats = computed(() => platform.stats)
const topPending = computed(() => claims.pending.slice(0, 3))

const chart = computed(() => {
  const values = stats.value.weeklySignups
  const max = Math.max(...values, 1)
  return values.map(v => ({ value: v, pct: (v / max) * 100 }))
})

const actionLabels: Record<string, string> = {
  club_published: 'Published site',
  club_claimed: 'Claimed club',
  plan_upgraded: 'Upgraded plan',
  plan_downgraded: 'Downgraded plan',
  member_bulk_import: 'Bulk imported members',
}

const decidedBy = computed(() => {
  if (!auth.user) return 'Platform admin'
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || auth.user.email
})

function approve(id: string, name: string) {
  claims.approve(id, decidedBy.value)
  toast.success(`Approved ${name}`)
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="head__eyebrow">Platform overview · Today</div>
        <h1 class="head__title">Kia ora, {{ firstName }}.</h1>
        <p class="head__sub">
          <template v-if="claims.pendingCount === 0">All claims caught up. </template>
          <template v-else><strong>{{ claims.pendingCount }} claim{{ claims.pendingCount === 1 ? '' : 's' }}</strong> waiting on your review. </template>
          <template v-if="platformUsers.flagged.length > 0">
            <strong style="color: var(--color-danger)">{{ platformUsers.flagged.length }} user{{ platformUsers.flagged.length === 1 ? '' : 's' }}</strong> flagged for moderation.
          </template>
          <template v-else>Torny is running steady across {{ stats.activeClubs }} active clubs.</template>
        </p>
      </div>
      <div class="head__actions">
        <button class="btn-ghost" @click="claims.reset()">Reset demo data</button>
        <button class="btn-primary" @click="router.push('/admin/claims')">
          Review claims
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
        </button>
      </div>
    </header>

    <section class="stats">
      <StatCard label="Clubs on Torny" :value="stats.totalClubs" hint="138 live · rest pending review" tone="accent" />
      <StatCard label="Members managed" :value="stats.totalMembers.toLocaleString()" :delta="4.2" hint="+87 this week" />
      <StatCard label="Applications this week" :value="stats.applicationsThisWeek" :delta="12.5" />
      <StatCard label="Recurring revenue" :value="`$${stats.mrrNzd.toLocaleString()}`" :delta="stats.mrrDeltaPct" hint="NZD monthly" tone="positive" />
    </section>

    <div class="grid">
      <section class="panel panel--claims">
        <div class="panel__head">
          <div>
            <div class="panel__eyebrow">Claim queue</div>
            <div class="panel__title">Awaiting your review</div>
          </div>
          <RouterLink to="/admin/claims" class="panel__link">View all →</RouterLink>
        </div>
        <div v-if="topPending.length === 0" class="empty">
          <div class="empty__mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M5 12l5 5 9-11" /></svg>
          </div>
          <div class="empty__title">Inbox zero.</div>
          <div class="empty__sub">No pending claims — check back later.</div>
        </div>
        <ul v-else class="claim-list">
          <li v-for="c in topPending" :key="c.id" class="claim">
            <div class="claim__avatar">{{ c.clubName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() }}</div>
            <div class="claim__body">
              <div class="claim__club">{{ c.clubName }}</div>
              <div class="claim__meta">
                <span>{{ c.region }}</span>
                <span class="claim__sep">·</span>
                <span>{{ c.claimant.firstName }} {{ c.claimant.lastName }}</span>
                <span class="claim__sep">·</span>
                <span class="claim__role">{{ c.claimant.role }}</span>
                <span class="claim__sep">·</span>
                <span>{{ timeAgo(c.submittedAt) }}</span>
              </div>
            </div>
            <div class="claim__actions">
              <button class="btn-approve" @click="approve(c.id, c.clubName)">Approve</button>
              <RouterLink :to="`/admin/claims#${c.id}`" class="btn-review">Review</RouterLink>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel panel--chart">
        <div class="panel__eyebrow">Weekly signups</div>
        <div class="panel__title">Trailing 12 weeks</div>
        <div class="chart">
          <div v-for="(b, i) in chart" :key="i" class="chart__bar" :style="{ height: `${b.pct}%` }">
            <span class="chart__value">{{ b.value }}</span>
          </div>
        </div>
        <div class="chart__axis">
          <span>12w ago</span>
          <span>this week</span>
        </div>
      </section>

      <section class="panel panel--activity">
        <div class="panel__head">
          <div>
            <div class="panel__eyebrow">Activity</div>
            <div class="panel__title">Across the platform</div>
          </div>
        </div>
        <ul class="activity">
          <li v-for="a in stats.activityFeed" :key="a.id" class="activity__item">
            <span class="activity__dot" :class="`activity__dot--${a.action}`" />
            <div class="activity__body">
              <div class="activity__text">
                <strong>{{ a.actor }}</strong>
                <span class="activity__muted"> · {{ actionLabels[a.action] }} · </span>
                <strong>{{ a.club }}</strong>
                <span v-if="a.detail" class="activity__detail"> — {{ a.detail }}</span>
              </div>
              <div class="activity__ts">{{ a.region }} · {{ timeAgo(a.ts) }}</div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 32px 40px 60px; }

.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.head__title { font-family: var(--font-display); font-size: 40px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 8px 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 560px; line-height: 1.5; }
.head__sub strong { color: var(--color-ink); font-weight: 700; }
.head__actions { display: inline-flex; gap: 10px; align-items: center; flex-shrink: 0; }
.btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-primary:hover { background: var(--color-graphite); }
.btn-ghost { padding: 12px 16px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-graphite); cursor: pointer; }
.btn-ghost:hover { background: #fff; color: var(--color-ink); }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }

.grid { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: auto auto; gap: 16px; }
.panel { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 24px; }
.panel--claims { grid-column: 1 / 2; grid-row: 1 / 3; }
.panel--chart { grid-column: 2 / 3; grid-row: 1 / 2; }
.panel--activity { grid-column: 2 / 3; grid-row: 2 / 3; }
.panel__head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.panel__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.panel__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); margin-top: 4px; letter-spacing: -0.01em; }
.panel__link { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-accent); text-decoration: none; }
.panel__link:hover { color: var(--color-accent-strong); }

.claim-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.claim { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--color-surface); border-radius: 12px; }
.claim__avatar { width: 44px; height: 44px; border-radius: 10px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.claim__body { flex: 1; min-width: 0; }
.claim__club { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.claim__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; }
.claim__sep { opacity: 0.5; }
.claim__role { color: var(--color-graphite); font-weight: 600; }
.claim__actions { display: inline-flex; gap: 8px; flex-shrink: 0; }
.btn-approve { padding: 8px 14px; background: var(--color-ink); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-approve:hover { background: var(--color-graphite); }
.btn-review { padding: 8px 14px; background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 500; text-decoration: none; }
.btn-review:hover { border-color: var(--color-ink); }

.empty { padding: 40px 20px; text-align: center; }
.empty__mark { width: 48px; height: 48px; border-radius: 999px; background: #DCFCE7; color: #166534; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

.chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin: 16px 0 8px; }
.chart__bar { flex: 1; background: var(--color-accent); border-radius: 4px 4px 0 0; position: relative; min-height: 4px; opacity: 0.4; transition: opacity 0.15s ease; }
.chart__bar:hover { opacity: 1; }
.chart__bar:last-child { opacity: 1; }
.chart__value { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); opacity: 0; transition: opacity 0.15s ease; }
.chart__bar:hover .chart__value, .chart__bar:last-child .chart__value { opacity: 1; }
.chart__bar:last-child .chart__value { color: var(--color-ink); font-weight: 700; }
.chart__axis { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); letter-spacing: 0.06em; text-transform: uppercase; }

.activity { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.activity__item { display: flex; gap: 12px; }
.activity__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-mute); flex-shrink: 0; margin-top: 6px; }
.activity__dot--club_published { background: #16A34A; }
.activity__dot--club_claimed { background: var(--color-accent); }
.activity__dot--plan_upgraded { background: #7C3AED; }
.activity__dot--plan_downgraded { background: var(--color-fog); }
.activity__dot--member_bulk_import { background: #EA580C; }
.activity__body { flex: 1; min-width: 0; }
.activity__text { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.4; }
.activity__text strong { font-weight: 600; }
.activity__muted { color: var(--color-fog); }
.activity__detail { color: var(--color-graphite); }
.activity__ts { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 4px; }

@media (max-width: 1100px) {
  .grid { grid-template-columns: 1fr; }
  .panel--claims, .panel--chart, .panel--activity { grid-column: 1; grid-row: auto; }
}
@media (max-width: 767px) {
  .page { padding: 20px; }
  .head { flex-direction: column; align-items: flex-start; }
  .stats { grid-template-columns: 1fr 1fr; }
}
</style>
