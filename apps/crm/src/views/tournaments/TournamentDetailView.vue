<script setup lang="ts">
/**
 * CRM Tournament detail — one tournament's admin surface.
 *
 * Landing tab is Entries (the busiest surface). Draw / Results / Settings
 * are stub tabs until brief 48 ships. Header carries the tournament title,
 * status pill, meta ribbon, and admin actions (message entrants / export CSV
 * / edit). Right rail shows capacity, revenue breakdown, bulk actions and
 * a recent activity feed — mirrors the Paper design 1:1.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  tournaments as tournamentsApi,
  type Tournament,
  type TournamentEntry,
  type EntryStatus,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const tournamentId = computed(() => {
  const raw = route.params.id
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(id) ? id : null
})

const tournament = ref<Tournament | null>(null)
const entries = ref<TournamentEntry[]>([])
const loading = ref(false)
const activeTab = ref<'overview' | 'entries' | 'draw' | 'results' | 'settings'>('entries')
const activeEntryStatus = ref<EntryStatus | 'all'>('all')
const selectedIds = ref<Set<number>>(new Set())
const savingEntry = ref<Set<number>>(new Set())

async function load() {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (typeof cid !== 'number' || tid == null) return
  loading.value = true
  try {
    const [t, e] = await Promise.all([
      tournamentsApi.get(cid, tid),
      tournamentsApi.listEntries(cid, tid, { limit: 200 }),
    ])
    tournament.value = t
    entries.value = e.entries
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load tournament.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => clubStore.current?.id, load)
watch(tournamentId, load)

// ── Actions ────────────────────────────────────────────────────

async function markPaid(entry: TournamentEntry) {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (typeof cid !== 'number' || tid == null || !tournament.value) return
  if (savingEntry.value.has(entry.id)) return
  savingEntry.value.add(entry.id)
  try {
    const updated = await tournamentsApi.updateEntry(cid, tid, entry.id, {
      paid_cents: tournament.value.entry_fee_cents,
      paid_at: new Date().toISOString(),
      status: 'confirmed',
    })
    const idx = entries.value.findIndex(e => e.id === entry.id)
    if (idx >= 0) entries.value[idx] = updated
    toast.success(`Marked ${entry.team_name ?? entry.captain.name} as paid.`)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not mark paid.')
  } finally {
    savingEntry.value.delete(entry.id)
  }
}

async function promote(entry: TournamentEntry) {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (typeof cid !== 'number' || tid == null) return
  if (savingEntry.value.has(entry.id)) return
  savingEntry.value.add(entry.id)
  try {
    const updated = await tournamentsApi.promoteEntry(cid, tid, entry.id)
    const idx = entries.value.findIndex(e => e.id === entry.id)
    if (idx >= 0) entries.value[idx] = updated
    toast.success(`Promoted ${entry.team_name ?? entry.captain.name}.`)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not promote.')
  } finally {
    savingEntry.value.delete(entry.id)
  }
}

function toggleSelect(id: number) {
  if (selectedIds.value.has(id)) selectedIds.value.delete(id)
  else selectedIds.value.add(id)
  // Force reactivity
  selectedIds.value = new Set(selectedIds.value)
}

// ── Derived filtered list ──────────────────────────────────────

const filteredEntries = computed(() => {
  if (activeEntryStatus.value === 'all') return entries.value
  return entries.value.filter(e => e.status === activeEntryStatus.value)
})

const confirmedEntries = computed(() =>
  filteredEntries.value.filter(e => e.status !== 'waitlisted' && e.status !== 'withdrawn'),
)
const waitlistEntries = computed(() =>
  filteredEntries.value
    .filter(e => e.status === 'waitlisted')
    .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0)),
)

const counts = computed(() => {
  const c: Record<string, number> = { all: entries.value.length }
  for (const e of entries.value) c[e.status] = (c[e.status] ?? 0) + 1
  return c
})

// ── Formatting ─────────────────────────────────────────────────

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}
function formatWhen(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const mins = Math.round((now - then) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
    const days = Math.round(hrs / 24)
    if (days === 1) return 'yesterday'
    return `${days} days ago`
  } catch { return iso }
}
function formatDate(iso: string | null): string {
  if (!iso) return 'TBC'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch { return iso }
}

const POSITION_TONE: Record<string, 'accent' | 'tangerine' | 'mint' | 'violet'> = {
  lead: 'accent',
  second: 'tangerine',
  third: 'violet',
  skip: 'mint',
  player: 'accent',
}
function positionLabel(position: string): string {
  if (position === 'lead') return 'L'
  if (position === 'second') return '2'
  if (position === 'third') return '3'
  if (position === 'skip') return 'S'
  return position.slice(0, 1).toUpperCase()
}
function tone(position: string): string {
  return POSITION_TONE[position] ?? 'fog'
}
function isVisitor(entry: TournamentEntry): boolean {
  const club = tournament.value?.club_id
  return club != null && entry.captain.club_id != null && entry.captain.club_id !== club
}

const capacityPct = computed(() => {
  if (!tournament.value || tournament.value.entry_cap <= 0) return 0
  return Math.round((tournament.value.stats.confirmed_count / tournament.value.entry_cap) * 100)
})

function goBack() {
  router.push({ name: 'tournaments' })
}
</script>

<template>
  <div class="td" v-if="tournament">
    <header class="td__head">
      <button class="crumb" @click="goBack">← Tournaments</button>
      <div class="td__title-row">
        <div class="td__title-wrap">
          <div class="td__title-line">
            <h1 class="td__title">{{ tournament.title }}</h1>
            <span class="td__pill">
              <span class="td__pill-dot"></span>
              {{ tournament.status.replace('_', ' ') }}
            </span>
          </div>
          <div class="td__meta">
            <span>{{ formatDate(tournament.starts_at) }}</span>
            <span class="td__meta-dot">·</span>
            <span>{{ tournament.format }} · {{ tournament.category }}</span>
            <span class="td__meta-dot">·</span>
            <span>{{ formatMoney(tournament.entry_fee_cents) }} / {{ tournament.entry_unit }} · {{ tournament.payment_method.replace('_', ' ') }}</span>
            <template v-if="tournament.sanctioned_by">
              <span class="td__meta-dot">·</span>
              <span>Sanctioned by {{ tournament.sanctioned_by }}</span>
            </template>
          </div>
        </div>
        <div class="td__actions">
          <button class="ghost-btn">Message entrants</button>
          <button class="ghost-btn">Export CSV</button>
          <RouterLink
            v-if="tournamentId != null"
            :to="{ name: 'tournament-edit', params: { id: tournamentId } }"
            class="primary-btn"
          >Edit tournament</RouterLink>
        </div>
      </div>
      <nav class="tabs">
        <button
          v-for="t in ['overview', 'entries', 'draw', 'results', 'settings'] as const"
          :key="t"
          type="button"
          class="tab"
          :class="{ 'is-on': activeTab === t }"
          @click="activeTab = t"
        >
          {{ t === 'entries' ? `Entries · ${entries.length}` : t }}
        </button>
      </nav>
    </header>

    <div class="td__body" v-if="activeTab === 'entries'">
      <div class="td__col-main">
        <div class="filter-row">
          <div class="chips">
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': activeEntryStatus === 'all' }"
              @click="activeEntryStatus = 'all'"
            >All · {{ counts.all ?? 0 }}</button>
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': activeEntryStatus === 'confirmed' }"
              @click="activeEntryStatus = 'confirmed'"
            >Confirmed · {{ counts.confirmed ?? 0 }}</button>
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': activeEntryStatus === 'pending' }"
              @click="activeEntryStatus = 'pending'"
            >Pending · {{ counts.pending ?? 0 }}</button>
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': activeEntryStatus === 'waitlisted' }"
              @click="activeEntryStatus = 'waitlisted'"
            >Waitlist · {{ counts.waitlisted ?? 0 }}</button>
            <button
              type="button"
              class="chip"
              :class="{ 'is-on': activeEntryStatus === 'withdrawn' }"
              @click="activeEntryStatus = 'withdrawn'"
            >Withdrawn · {{ counts.withdrawn ?? 0 }}</button>
          </div>
        </div>

        <div class="table">
          <div class="table__head">
            <div class="col-sel"></div>
            <div class="col-num">#</div>
            <div class="col-team">TEAM / CAPTAIN</div>
            <div class="col-roster">ROSTER</div>
            <div class="col-paid">PAID</div>
            <div class="col-when">REGISTERED</div>
            <div class="col-status">STATUS</div>
            <div class="col-actions">ACTIONS</div>
          </div>

          <div v-if="loading" class="empty">Loading…</div>
          <div v-else-if="entries.length === 0" class="empty">No entries yet.</div>

          <template v-else>
            <div
              v-for="entry in confirmedEntries"
              :key="entry.id"
              class="row"
              :class="{
                'row--tinted-accent': selectedIds.has(entry.id),
                'row--tinted-warn': entry.status === 'pending',
              }"
            >
              <div class="col-sel">
                <button
                  type="button"
                  class="check"
                  :class="{ 'is-on': selectedIds.has(entry.id) }"
                  :aria-pressed="selectedIds.has(entry.id)"
                  @click="toggleSelect(entry.id)"
                >
                  <svg v-if="selectedIds.has(entry.id)" width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" stroke-width="1.75" stroke-linecap="round"/></svg>
                </button>
              </div>
              <div class="col-num">{{ entry.entry_number }}</div>
              <div class="col-team">
                <div class="avatar" :style="{ background: 'var(--color-accent)' }">
                  {{ (entry.captain.name || '?').slice(0, 2).toUpperCase() }}
                </div>
                <div class="col-team-body">
                  <div class="team-line">
                    <span class="team-name">{{ entry.team_name ?? entry.captain.name }}</span>
                    <span v-if="isVisitor(entry)" class="visitor-chip">VISITOR</span>
                  </div>
                  <div class="team-sub">
                    {{ entry.captain.name }} · {{ entry.captain.club_name ?? '—' }}
                  </div>
                </div>
              </div>
              <div class="col-roster">
                <span
                  v-for="member in entry.roster"
                  :key="`${entry.id}-${member.position}`"
                  class="roster-pill"
                  :class="`roster-pill--${tone(member.position)}`"
                >
                  {{ positionLabel(member.position) }} · {{ (member.name ?? '—').split(' ')[0] }}
                </span>
              </div>
              <div
                class="col-paid"
                :class="{
                  'is-good': entry.paid_cents >= (tournament?.entry_fee_cents ?? 0) && entry.paid_cents > 0,
                  'is-warn': entry.status === 'pending',
                }"
              >
                <template v-if="entry.paid_cents > 0">{{ formatMoney(entry.paid_cents) }} ✓</template>
                <template v-else-if="entry.status === 'pending'">{{ formatMoney(tournament?.entry_fee_cents ?? 0) }} due</template>
                <template v-else>—</template>
              </div>
              <div class="col-when">
                {{ formatWhen(entry.created_at) }}
                <div class="col-when-sub">
                  {{ entry.payment_reference
                    ? `STRIPE · ${entry.payment_reference.slice(0, 8)}…`
                    : entry.status === 'pending' ? 'PAYMENT PENDING' : '' }}
                </div>
              </div>
              <div class="col-status">
                <span
                  class="status-pill"
                  :class="{
                    'status-pill--mint': entry.status === 'confirmed',
                    'status-pill--tangerine': entry.status === 'pending',
                    'status-pill--fog': entry.status === 'withdrawn' || entry.status === 'refunded',
                  }"
                >
                  <span class="status-pill-dot"></span>
                  {{ entry.status === 'pending' ? 'Awaiting pay' : entry.status }}
                </span>
              </div>
              <div class="col-actions">
                <button
                  v-if="entry.status === 'pending'"
                  type="button"
                  class="row-btn row-btn--primary"
                  :disabled="savingEntry.has(entry.id)"
                  @click="markPaid(entry)"
                >Mark paid</button>
                <button v-else type="button" class="row-btn">View</button>
              </div>
            </div>

            <div v-if="waitlistEntries.length > 0" class="waitlist-divider">
              <span class="waitlist-divider__label">WAITLIST · {{ waitlistEntries.length }} {{ waitlistEntries.length === 1 ? 'TEAM' : 'TEAMS' }}</span>
              <span class="waitlist-divider__rule"></span>
              <span class="waitlist-divider__hint">Auto-promotes as spots open</span>
            </div>

            <div
              v-for="entry in waitlistEntries"
              :key="`w-${entry.id}`"
              class="row row--waitlist"
            >
              <div class="col-sel">
                <button
                  type="button"
                  class="check"
                  :class="{ 'is-on': selectedIds.has(entry.id) }"
                  @click="toggleSelect(entry.id)"
                >
                  <svg v-if="selectedIds.has(entry.id)" width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" stroke-width="1.75" stroke-linecap="round"/></svg>
                </button>
              </div>
              <div class="col-num col-num--muted">W{{ entry.waitlist_position ?? '?' }}</div>
              <div class="col-team">
                <div class="avatar" :style="{ background: 'var(--color-feature-tangerine)' }">
                  {{ (entry.captain.name || '?').slice(0, 2).toUpperCase() }}
                </div>
                <div class="col-team-body">
                  <div class="team-line">
                    <span class="team-name">{{ entry.team_name ?? entry.captain.name }}</span>
                  </div>
                  <div class="team-sub">
                    {{ entry.captain.name }} · {{ entry.captain.club_name ?? '—' }}
                  </div>
                </div>
              </div>
              <div class="col-roster">
                <span
                  v-for="member in entry.roster"
                  :key="`w-${entry.id}-${member.position}`"
                  class="roster-pill"
                  :class="`roster-pill--${tone(member.position)}`"
                >
                  {{ positionLabel(member.position) }} · {{ (member.name ?? '—').split(' ')[0] }}
                </span>
              </div>
              <div class="col-paid col-paid--muted">On promote</div>
              <div class="col-when">
                {{ formatWhen(entry.created_at) }}
                <div class="col-when-sub">POSITION {{ entry.waitlist_position }}</div>
              </div>
              <div class="col-status">
                <span class="status-pill status-pill--fog">
                  <span class="status-pill-dot"></span>
                  Waitlist
                </span>
              </div>
              <div class="col-actions">
                <button
                  type="button"
                  class="row-btn"
                  :class="entry.waitlist_position === 1 ? 'row-btn--primary' : ''"
                  :disabled="savingEntry.has(entry.id)"
                  @click="promote(entry)"
                >Promote</button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <aside class="td__col-rail">
        <section class="rail-card rail-card--ink">
          <div class="rail-eyebrow rail-eyebrow--light">CAPACITY</div>
          <div class="rail-cap">
            <span class="rail-cap__val">{{ tournament.stats.confirmed_count }}</span>
            <span class="rail-cap__sub">of {{ tournament.entry_cap }} spots taken</span>
          </div>
          <div class="rail-progress">
            <div class="rail-progress__fill" :style="{ width: `${capacityPct}%` }"></div>
          </div>
          <div class="rail-cap-meta">
            <div>{{ tournament.stats.spots_remaining }} SPOTS LEFT</div>
            <div>{{ tournament.stats.waitlist_count }} ON WAITLIST</div>
          </div>
        </section>

        <section class="rail-card">
          <div class="rail-eyebrow">REVENUE</div>
          <div class="rail-revenue">
            <span class="rail-revenue__val">{{ formatMoney(tournament.stats.revenue_paid_cents ?? 0) }}</span>
            <span class="rail-revenue__note">✓ collected</span>
          </div>
          <div class="rail-ledger">
            <div class="ledger-row">
              <span>Paid ({{ tournament.stats.confirmed_count }})</span>
              <span>{{ formatMoney(tournament.stats.revenue_paid_cents ?? 0) }}</span>
            </div>
            <div class="ledger-row" v-if="(tournament.stats.revenue_pending_cents ?? 0) > 0">
              <span class="ledger-row__warn">Pending ({{ tournament.stats.pending_count }})</span>
              <span class="ledger-row__warn">{{ formatMoney(tournament.stats.revenue_pending_cents ?? 0) }}</span>
            </div>
            <div class="ledger-row">
              <span>Refunded</span>
              <span>$0</span>
            </div>
            <div class="ledger-row ledger-row--total">
              <span>Projected ({{ tournament.entry_cap }})</span>
              <span>{{ formatMoney(tournament.entry_fee_cents * tournament.entry_cap) }}</span>
            </div>
          </div>
        </section>

        <section class="rail-card">
          <div class="rail-eyebrow">
            BULK ACTIONS
            <template v-if="selectedIds.size > 0"> · {{ selectedIds.size }} SELECTED</template>
          </div>
          <div v-if="selectedIds.size === 0" class="rail-help">
            Select entries in the table to enable bulk actions.
          </div>
          <div v-else class="rail-actions">
            <button type="button" class="rail-action">Mark as paid</button>
            <button type="button" class="rail-action">Send reminder email</button>
            <button type="button" class="rail-action">Move to waitlist</button>
            <button type="button" class="rail-action rail-action--danger">Withdraw + refund</button>
          </div>
        </section>
      </aside>
    </div>

    <div v-else class="td__body">
      <div class="empty empty--full">
        <div class="empty__title">{{ activeTab }} lands in a follow-up brief.</div>
        <div class="empty__sub">This tab will surface draw generation, results posting and per-tournament settings when brief 48 ships.</div>
      </div>
    </div>
  </div>
  <div v-else class="td">
    <div class="empty empty--full">Loading tournament…</div>
  </div>
</template>

<style scoped>
.td { max-width: 1360px; }

.crumb { background: transparent; border: 0; padding: 0 0 12px; color: var(--color-fog); font-family: var(--font-body); font-size: 12px; font-weight: 500; cursor: pointer; }
.crumb:hover { color: var(--color-ink); }

.td__head { padding-bottom: 0; margin-bottom: 24px; }
.td__title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
.td__title-wrap { min-width: 0; }
.td__title-line { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
.td__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.td__pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); color: var(--color-feature-tangerine); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.td__pill-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-feature-tangerine); }

.td__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); flex-wrap: wrap; }
.td__meta-dot { opacity: 0.5; }

.td__actions { display: flex; gap: 8px; flex-shrink: 0; }
.ghost-btn { padding: 8px 14px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); cursor: pointer; }
.primary-btn { padding: 8px 14px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-hairline); }
.tab { padding: 10px 4px; margin-right: 20px; background: transparent; border: 0; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); cursor: pointer; text-transform: capitalize; }
.tab.is-on { color: var(--color-ink); font-weight: 600; border-bottom: 2px solid var(--color-ink); margin-bottom: -1px; }

.td__body { display: flex; gap: 24px; }
.td__col-main { flex: 1; min-width: 0; }
.td__col-rail { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; gap: 16px; }

.filter-row { padding: 10px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; margin-bottom: 16px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { padding: 6px 12px; background: transparent; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }

.table { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table__head, .row, .waitlist-divider { display: flex; align-items: center; gap: 12px; padding: 12px 20px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.row { padding: 14px 20px; font-family: var(--font-body); font-size: 12px; letter-spacing: 0; text-transform: none; color: var(--color-graphite); font-weight: 400; background: #fff; }
.row:last-child { border-bottom: 0; }
.row--tinted-accent { background: color-mix(in srgb, var(--color-accent) 5%, transparent); }
.row--tinted-warn { background: color-mix(in srgb, var(--color-feature-tangerine) 4%, transparent); }
.row--waitlist { color: var(--color-graphite); }

.col-sel { width: 20px; flex-shrink: 0; }
.col-num { width: 44px; flex-shrink: 0; font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); font-weight: 600; }
.col-num--muted { color: var(--color-graphite); }
.col-team { flex: 1.3; min-width: 0; display: flex; align-items: center; gap: 10px; }
.col-team-body { min-width: 0; flex: 1; }
.avatar { width: 32px; height: 32px; border-radius: 999px; color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 700; font-size: 11px; flex-shrink: 0; }
.team-line { display: flex; align-items: center; gap: 6px; }
.team-name { font-weight: 600; font-size: 13px; color: var(--color-ink); }
.team-sub { font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.visitor-chip { padding: 2px 6px; background: color-mix(in srgb, var(--color-feature-violet) 12%, transparent); color: var(--color-feature-violet); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }

.col-roster { flex: 1.4; min-width: 0; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.roster-pill { padding: 3px 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; line-height: 100%; }
.roster-pill--accent { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent-strong); }
.roster-pill--tangerine { background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); color: var(--color-feature-tangerine); }
.roster-pill--mint { background: color-mix(in srgb, var(--color-feature-mint) 12%, transparent); color: var(--color-feature-mint); }
.roster-pill--violet { background: color-mix(in srgb, var(--color-feature-violet) 12%, transparent); color: var(--color-feature-violet); }
.roster-pill--fog { background: var(--color-surface); color: var(--color-fog); }

.col-paid { width: 80px; flex-shrink: 0; font-weight: 600; font-size: 12px; color: var(--color-fog); }
.col-paid.is-good { color: var(--color-feature-mint); }
.col-paid.is-warn { color: var(--color-feature-tangerine); }
.col-paid--muted { color: var(--color-fog); font-weight: 400; }

.col-when { width: 110px; flex-shrink: 0; font-size: 11px; color: var(--color-fog); line-height: 1.3; }
.col-when-sub { font-family: var(--font-mono); font-size: 9px; color: var(--color-mute); margin-top: 3px; letter-spacing: 0.08em; }

.col-status { width: 130px; flex-shrink: 0; }
.status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; line-height: 100%; }
.status-pill-dot { width: 5px; height: 5px; border-radius: 999px; }
.status-pill--mint { background: color-mix(in srgb, var(--color-feature-mint) 12%, transparent); color: var(--color-feature-mint); }
.status-pill--mint .status-pill-dot { background: var(--color-feature-mint); }
.status-pill--tangerine { background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); color: var(--color-feature-tangerine); }
.status-pill--tangerine .status-pill-dot { background: var(--color-feature-tangerine); }
.status-pill--fog { background: var(--color-surface); border: 1px solid var(--color-hairline); color: var(--color-fog); }
.status-pill--fog .status-pill-dot { background: var(--color-fog); }

.col-actions { width: 100px; flex-shrink: 0; }
.row-btn { padding: 6px 12px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; color: var(--color-ink); cursor: pointer; }
.row-btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.check { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--color-mute); background: #fff; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.check.is-on { background: var(--color-ink); border-color: var(--color-ink); }

.waitlist-divider { padding: 10px 20px; color: var(--color-fog); }
.waitlist-divider__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; font-weight: 600; }
.waitlist-divider__rule { flex: 1; height: 1px; background: var(--color-hairline); }
.waitlist-divider__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); text-transform: none; letter-spacing: 0; }

.empty { padding: 32px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); background: #fff; }
.empty--full { padding: 64px 32px; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin-bottom: 4px; text-transform: capitalize; }
.empty__sub { font-size: 13px; color: var(--color-fog); }

/* Right rail */
.rail-card { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; display: flex; flex-direction: column; gap: 12px; }
.rail-card--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.rail-eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 600; }
.rail-eyebrow--light { color: rgba(255,255,255,0.5); }
.rail-cap { display: flex; align-items: baseline; gap: 8px; }
.rail-cap__val { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.03em; line-height: 100%; }
.rail-cap__sub { font-size: 13px; color: rgba(255,255,255,0.6); }
.rail-progress { height: 6px; background: rgba(255,255,255,0.1); border-radius: 999px; overflow: hidden; }
.rail-progress__fill { height: 100%; background: var(--color-feature-mint); border-radius: 999px; }
.rail-cap-meta { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; color: rgba(255,255,255,0.5); font-weight: 600; }

.rail-revenue { display: flex; align-items: baseline; gap: 8px; }
.rail-revenue__val { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 100%; }
.rail-revenue__note { font-size: 12px; color: var(--color-feature-mint); }
.rail-ledger { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--color-hairline); }
.ledger-row { display: flex; align-items: center; justify-content: space-between; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.ledger-row__warn { color: var(--color-feature-tangerine); font-weight: 600; }
.ledger-row--total { padding-top: 6px; border-top: 1px dashed var(--color-hairline); color: var(--color-ink); font-weight: 600; }

.rail-help { padding: 10px 12px; background: var(--color-surface); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.45; }
.rail-actions { display: flex; flex-direction: column; gap: 4px; }
.rail-action { padding: 10px 12px; background: var(--color-surface); border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-ink); text-align: left; cursor: pointer; }
.rail-action:hover { background: var(--color-hairline); }
.rail-action--danger { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 6%, transparent); }
</style>
