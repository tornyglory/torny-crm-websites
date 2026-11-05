<script setup lang="ts">
/**
 * Team selections list — brief 74.
 *
 * Two scope tabs (upcoming / past) backed by `GET /clubs/:id/team-
 * selections?scope=…`. Fill bar per row from the server-computed
 * confirmed_count / total_slots so we don't need to open the full
 * selection to render the list.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  teamSelections,
  type TeamSelectionListItem,
  type TeamSelectionStatus,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

type Scope = 'upcoming' | 'past'
const activeTab = ref<Scope>('upcoming')
const selections = ref<TeamSelectionListItem[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)

async function load() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  loading.value = true
  errorMsg.value = null
  try {
    const res = await teamSelections.list(cid, { scope: activeTab.value, limit: 50 })
    selections.value = res.selections
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Could not load team selections.'
    errorMsg.value = msg
    toast.error(msg)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => clubStore.current?.id, load)
watch(activeTab, load)

const statusTone: Record<TeamSelectionStatus, string> = {
  draft: 'warn',
  confirmed: 'ok',
  sent: 'info',
  played: 'muted',
  cancelled: 'danger',
}

function openEditor(t: TeamSelectionListItem) {
  router.push({ name: 'team-editor', params: { id: String(t.id) } })
}

function newSelection() {
  router.push({ name: 'team-editor', params: { id: 'new' } })
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-NZ', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function fillPercent(t: TeamSelectionListItem): number {
  if (t.total_slots <= 0) return 0
  return Math.round((t.confirmed_count / t.total_slots) * 100)
}

/** Header count is just the current tab's length — the list endpoint
 *  already filtered by scope so no client-side split is needed. */
const visibleCount = computed(() => selections.value.length)
</script>

<template>
  <div class="teams">
    <header class="teams__header">
      <div>
        <div class="teams__eyebrow">Selections</div>
        <h1 class="teams__heading">Team selections</h1>
        <p class="teams__sub">
          Every draft, confirmation, and post-match card.
          <template v-if="activeTab === 'upcoming'">{{ visibleCount }} upcoming.</template>
          <template v-else>{{ visibleCount }} past.</template>
        </p>
      </div>
      <button class="btn btn--primary" @click="newSelection">+ New selection</button>
    </header>

    <div class="teams__tabs">
      <button class="tab" :class="{ 'is-active': activeTab === 'upcoming' }" @click="activeTab = 'upcoming'">
        <span>Upcoming</span>
      </button>
      <button class="tab" :class="{ 'is-active': activeTab === 'past' }" @click="activeTab = 'past'">
        <span>Past</span>
      </button>
    </div>

    <div v-if="loading && selections.length === 0" class="state state--loading">Loading…</div>
    <div v-else-if="errorMsg" class="state state--error">{{ errorMsg }}</div>
    <div v-else-if="selections.length === 0" class="state state--empty">
      <div class="state__title">
        <template v-if="activeTab === 'upcoming'">No upcoming selections.</template>
        <template v-else>No past selections.</template>
      </div>
      <div class="state__sub">
        <template v-if="activeTab === 'upcoming'">Create one to start picking your team for the next fixture.</template>
        <template v-else>Once selections play out, they’ll show here.</template>
      </div>
      <button v-if="activeTab === 'upcoming'" class="btn btn--primary" @click="newSelection">+ New selection</button>
    </div>

    <ul v-else class="list">
      <li v-for="t in selections" :key="t.id" class="row" @click="openEditor(t)">
        <div class="row__left">
          <div class="row__comp">{{ t.competition }}</div>
          <div class="row__title">{{ t.round_label }} · {{ t.opponent }}</div>
          <div class="row__meta">
            <span class="tag" :class="`tag--${t.venue}`">{{ t.venue }}</span>
            <span>{{ formatWhen(t.starts_at) }}</span>
            <span class="dot">·</span>
            <span>{{ t.format_label }}</span>
          </div>
          <div v-if="t.manager_note" class="row__note">“{{ t.manager_note }}”</div>
        </div>
        <div class="row__right">
          <div class="row__fill">
            <div class="fill__bar">
              <div class="fill__inner" :style="{ width: `${fillPercent(t)}%` }" />
            </div>
            <div class="fill__label">{{ t.confirmed_count }} / {{ t.total_slots }} confirmed</div>
          </div>
          <span class="badge" :class="`badge--${statusTone[t.status]}`">{{ t.status }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.teams { max-width: 1280px; }
.teams__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.teams__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.teams__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.teams__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.teams__tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.state { padding: 48px 24px; text-align: center; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; color: var(--color-fog); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.state__title { font-family: var(--font-display); font-size: 18px; color: var(--color-ink); }
.state__sub { font-size: 13px; max-width: 420px; }
.state--error { color: var(--color-danger); }
.state .btn { margin-top: 12px; }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 16px; align-items: center; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.15s ease, transform 0.05s ease; }
.row:hover { border-color: var(--color-mute); }
.row:active { transform: scale(0.998); }
.row__left { flex: 1; min-width: 0; }
.row__comp { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.row__title { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-ink); margin: 3px 0; }
.row__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); flex-wrap: wrap; }
.row__meta .dot { opacity: 0.5; }
.row__note { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); font-style: italic; margin-top: 6px; }
.row__right { display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
.row__fill { width: 180px; text-align: right; }
.fill__bar { height: 6px; background: var(--color-surface); border-radius: 999px; overflow: hidden; margin-bottom: 4px; }
.fill__inner { height: 100%; background: var(--color-ink); border-radius: 999px; transition: width 0.2s ease; }
.fill__label { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.tag { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tag--home { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.tag--away { background: var(--color-hairline); color: var(--color-graphite); }

.badge { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge--ok { background: #DCFCE7; color: #166534; }
.badge--warn { background: #FEF3C7; color: #92400E; }
.badge--info { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--muted { background: var(--color-hairline); color: var(--color-graphite); }
.badge--danger { background: #FEE2E2; color: #991B1B; }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }

@media (max-width: 767px) {
  .row { flex-direction: column; align-items: stretch; }
  .row__right { justify-content: space-between; }
  .row__fill { width: auto; flex: 1; text-align: left; }
}
</style>
