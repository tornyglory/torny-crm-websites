<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClaimsStore } from '@/stores/claims'
import { usePlatformStatsStore } from '@/stores/platformStats'
import { SPORTS, SPORT_CODES, sportShort, type SportCode } from '@/stores/sports'

const claims = useClaimsStore()
const platform = usePlatformStatsStore()

interface ClubRow { name: string; region: string; sport: SportCode; status: 'active' | 'pending' | 'rejected'; members: number; joined: string }

const sample: ClubRow[] = [
  { name: 'Naenae Bowling', region: 'Wellington', sport: 'bowls', status: 'active', members: 142, joined: '2026-01-12' },
  { name: 'Kelburn Bowling Club', region: 'Wellington', sport: 'bowls', status: 'pending', members: 0, joined: '2026-08-19' },
  { name: 'Petone Central', region: 'Wellington', sport: 'bowls', status: 'pending', members: 0, joined: '2026-08-19' },
  { name: 'Ashburton MSA Bowls', region: 'Canterbury', sport: 'bowls', status: 'pending', members: 0, joined: '2026-08-18' },
  { name: 'Cambridge Bowls', region: 'Waikato', sport: 'bowls', status: 'active', members: 189, joined: '2026-03-04' },
  { name: 'Titirangi RSA', region: 'Auckland', sport: 'bowls', status: 'active', members: 96, joined: '2026-02-22' },
  { name: 'Whangarei Bowling Club', region: 'Northland', sport: 'bowls', status: 'pending', members: 0, joined: '2026-08-18' },
  { name: 'Waihi Beach Bowls', region: 'Bay of Plenty', sport: 'bowls', status: 'rejected', members: 0, joined: '2026-08-14' },
  { name: 'Waitakere Tennis', region: 'Auckland', sport: 'tennis', status: 'active', members: 214, joined: '2026-06-01' },
  { name: 'Christchurch Golf', region: 'Canterbury', sport: 'golf', status: 'active', members: 312, joined: '2026-05-18' },
  { name: 'Wellington Pétanque', region: 'Wellington', sport: 'petanque', status: 'active', members: 42, joined: '2026-07-02' },
  { name: 'Karori Croquet', region: 'Wellington', sport: 'croquet', status: 'pending', members: 0, joined: '2026-08-19' },
]

const query = ref('')
const statusFilter = ref<'all' | 'active' | 'pending' | 'rejected'>('all')
const sportFilter = ref<'all' | SportCode>('all')

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return sample.filter(r => {
    if (statusFilter.value !== 'all' && r.status !== statusFilter.value) return false
    if (sportFilter.value !== 'all' && r.sport !== sportFilter.value) return false
    if (q && !`${r.name} ${r.region}`.toLowerCase().includes(q)) return false
    return true
  })
})

const sportBreakdown = computed(() => {
  const counts = new Map<SportCode, number>()
  for (const r of sample) {
    if (r.status !== 'active') continue
    counts.set(r.sport, (counts.get(r.sport) ?? 0) + 1)
  }
  return SPORT_CODES.filter(c => counts.has(c)).map(c => ({ code: c, count: counts.get(c) ?? 0 }))
})

function initials(name: string) { return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() }
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="head__eyebrow">Platform · Directory</div>
        <h1 class="head__title">All clubs</h1>
        <p class="head__sub">
          Every club on Torny — {{ platform.stats.activeClubs }} active, {{ claims.pendingCount }} awaiting review, across {{ sportBreakdown.length }} sport{{ sportBreakdown.length === 1 ? '' : 's' }}.
        </p>
      </div>
    </header>

    <section class="sport-summary">
      <div v-for="s in sportBreakdown" :key="s.code" class="sport-summary__pill">
        <span class="sport-summary__label">{{ SPORTS[s.code].label }}</span>
        <span class="sport-summary__count">{{ s.count }}</span>
      </div>
    </section>

    <div class="filters">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input v-model="query" type="search" placeholder="Search by club or region…" />
      </div>
      <div class="segmented">
        <button :class="{ 'is-on': statusFilter === 'all' }" @click="statusFilter = 'all'">All</button>
        <button :class="{ 'is-on': statusFilter === 'active' }" @click="statusFilter = 'active'">Active</button>
        <button :class="{ 'is-on': statusFilter === 'pending' }" @click="statusFilter = 'pending'">Pending</button>
        <button :class="{ 'is-on': statusFilter === 'rejected' }" @click="statusFilter = 'rejected'">Rejected</button>
      </div>
      <select v-model="sportFilter" class="select">
        <option value="all">All sports</option>
        <option v-for="code in SPORT_CODES" :key="code" :value="code">{{ SPORTS[code].label }}</option>
      </select>
    </div>

    <div v-if="rows.length" class="table">
      <div class="table__head">
        <span>Club</span>
        <span>Sport</span>
        <span>Region</span>
        <span>Members</span>
        <span>Joined</span>
        <span>Status</span>
      </div>
      <div v-for="r in rows" :key="r.name" class="table__row">
        <div class="cell cell--club">
          <div class="avatar">{{ initials(r.name) }}</div>
          <span>{{ r.name }}</span>
        </div>
        <span class="cell">
          <span class="sport-chip">{{ sportShort(r.sport) }}</span>
        </span>
        <span class="cell">{{ r.region }}</span>
        <span class="cell cell--num">{{ r.members.toLocaleString() }}</span>
        <span class="cell cell--num">{{ new Date(r.joined).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: '2-digit' }) }}</span>
        <span class="cell"><span class="pill" :class="`pill--${r.status}`">{{ r.status }}</span></span>
      </div>
    </div>

    <div v-else class="empty">
      <div class="empty__title">No clubs match.</div>
      <div class="empty__sub">Try clearing the filters or search.</div>
    </div>

    <p class="note">Backend not wired yet — this is a static snapshot. Sport column will drive off the club's registered sport once the platform API is live.</p>
  </div>
</template>

<style scoped>
.page { padding: 32px 40px 60px; }
.head { margin-bottom: 20px; }
.head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.head__title { font-family: var(--font-display); font-size: 40px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 8px 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 640px; line-height: 1.5; }

.sport-summary { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.sport-summary__pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); }
.sport-summary__label { font-weight: 600; color: var(--color-ink); }
.sport-summary__count { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); padding-left: 4px; border-left: 1px solid var(--color-hairline); margin-left: 2px; }

.filters { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
.search { flex: 1; min-width: 240px; position: relative; display: flex; align-items: center; }
.search svg { position: absolute; left: 14px; color: var(--color-fog); pointer-events: none; }
.search input { width: 100%; padding: 11px 14px 11px 40px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.search input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.segmented { display: inline-flex; padding: 4px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.segmented button { padding: 7px 12px; background: transparent; border: 0; border-radius: 6px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }
.select { padding: 10px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.table { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table__head, .table__row { display: grid; grid-template-columns: 2fr 120px 1fr 100px 120px 120px; gap: 16px; padding: 14px 20px; align-items: center; }
.table__head { background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.table__row { border-bottom: 1px solid var(--color-hairline); }
.table__row:last-child { border-bottom: 0; }
.table__row:hover { background: var(--color-surface); }

.cell { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.cell--num { font-family: var(--font-mono); font-size: 12px; color: var(--color-graphite); }
.cell--club { display: flex; align-items: center; gap: 12px; font-weight: 600; }
.avatar { width: 32px; height: 32px; border-radius: 8px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 11px; font-weight: 700; flex-shrink: 0; }

.sport-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 5px; font-family: var(--font-body); font-size: 11px; font-weight: 600; color: var(--color-graphite); }

.pill { font-family: var(--font-mono); font-size: 10px; padding: 3px 8px; border-radius: 5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
.pill--active { background: #DCFCE7; color: #166534; }
.pill--pending { background: #FEF3C7; color: #92400E; }
.pill--rejected { background: #FEE2E2; color: #991B1B; }

.empty { padding: 60px 20px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

.note { font-family: var(--font-body); font-size: 12px; color: var(--color-mute); margin-top: 20px; font-style: italic; }

@media (max-width: 1000px) {
  .page { padding: 20px; }
  .head__title { font-size: 32px; }
  .table__head, .table__row { grid-template-columns: 1fr 100px 100px 90px; gap: 12px; }
  .table__head span:nth-child(5), .table__row .cell:nth-child(5),
  .table__head span:nth-child(4), .table__row .cell:nth-child(4) { display: none; }
}
</style>
