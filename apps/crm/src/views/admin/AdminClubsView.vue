<script setup lang="ts">
/**
 * Accounts list — brief 123 §2, backend Phase 1.
 *
 * Phase A ships a basic table against `admin.listAccounts`. Phase A
 * follow-up (next ship) adds the full filter rail, sort controls,
 * cursor "Load more", and detail navigation. For now: window toggle,
 * search box, and a readable row per account with the critical metrics.
 *
 * Route stays `/admin/accounts` even though the view file retains the
 * old `AdminClubsView.vue` name — rename in a follow-up to keep this
 * ship reviewable.
 */
import { ref, watch } from 'vue'
import { admin, ApiError, type AdminAccountRow, type AdminAccountsList } from '@torny/api-client'
import { useAdminWindow } from '@/composables/useAdminWindow'
import AdminWindowToggle from '@/components/admin/AdminWindowToggle.vue'
import AdminMoney from '@/components/admin/AdminMoney.vue'
import AdminFlagBadges from '@/components/admin/AdminFlagBadges.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'

const { window, setWindow } = useAdminWindow()
const search = ref('')

const data = ref<AdminAccountsList | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let inFlight: AbortController | null = null

async function load() {
  inFlight?.abort()
  const ctrl = new AbortController()
  inFlight = ctrl
  loading.value = true
  error.value = null
  try {
    const res = await admin.listAccounts({
      window: window.value,
      q: search.value.trim() || undefined,
      sort: '-last_login',
      signal: ctrl.signal,
    })
    if (ctrl.signal.aborted) return
    data.value = res
  } catch (err) {
    if (ctrl.signal.aborted) return
    error.value = err instanceof ApiError ? err.message : 'Could not load accounts.'
  } finally {
    if (!ctrl.signal.aborted) loading.value = false
  }
}

// Debounce search input so typing doesn't blast the backend.
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => void load(), 300)
})
watch(window, () => void load(), { immediate: true })

// Read the windowed fields (e.g. `bookings_30d`) — cast via unknown
// since TS can't resolve the template-literal key against the row's
// index signatures when K is a union. Runtime correctness is covered
// by the index signatures themselves + the api-client types.
type WindowedCountKey = 'bookings' | 'tournament_entries' | 'member_joins' | 'emails_sent'
type WindowedMoneyKey = 'bookings_gmv' | 'tournament_gmv' | 'platform_take'
function w(row: AdminAccountRow, key: WindowedCountKey | WindowedMoneyKey): number {
  const field = key.endsWith('_gmv') || key === 'platform_take'
    ? `${key}_${window.value}_cents`
    : `${key}_${window.value}`
  const value = (row as unknown as Record<string, number | undefined>)[field]
  return value ?? 0
}

const PLAN_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', comped: 'Comped' }
</script>

<template>
  <div class="accounts">
    <header class="accounts__head">
      <div>
        <div class="accounts__eyebrow">PLATFORM · ACCOUNTS</div>
        <h1 class="accounts__title">Accounts</h1>
        <p class="accounts__sub">Every tenant, their usage, their revenue contribution.</p>
      </div>
      <AdminWindowToggle :model-value="window" @update:model-value="setWindow" />
    </header>

    <div class="accounts__controls">
      <input
        v-model="search"
        type="search"
        class="accounts__search"
        placeholder="Search name, subdomain, or owner email…"
      />
      <div class="accounts__count">
        <template v-if="data">
          Showing {{ data.items.length }} of ~{{ data.total_count }}
        </template>
        <template v-else-if="loading">Loading…</template>
      </div>
    </div>

    <AdminEmptyState
      v-if="error"
      tone="error"
      title="Could not load accounts"
      :detail="error"
      @retry="load"
    />

    <AdminEmptyState
      v-else-if="data && data.items.length === 0"
      tone="no-results"
      title="No accounts matched"
      detail="Clear the search or try a wider window."
    />

    <div v-else class="accounts__table-wrap">
      <table class="accounts__table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Plan</th>
            <th class="num">MRR</th>
            <th class="num">Members</th>
            <th class="num">Bookings</th>
            <th class="num">Bookings GMV</th>
            <th class="num">Entries</th>
            <th class="num">Entries GMV</th>
            <th class="num">Platform take</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data?.items" :key="row.id">
            <td>
              <div class="accounts__name">{{ row.name }}</div>
              <div class="accounts__sub-name">{{ row.subdomain }} · {{ row.owner_email ?? '—' }}</div>
            </td>
            <td>
              <span class="plan" :class="`plan--${row.plan}`">{{ PLAN_LABELS[row.plan] ?? row.plan }}</span>
            </td>
            <td class="num"><AdminMoney :cents="row.mrr_cents" :suffix="false" /></td>
            <td class="num">{{ row.member_count }}</td>
            <td class="num">{{ w(row, 'bookings') }}</td>
            <td class="num"><AdminMoney :cents="w(row, 'bookings_gmv')" :suffix="false" /></td>
            <td class="num">{{ w(row, 'tournament_entries') }}</td>
            <td class="num"><AdminMoney :cents="w(row, 'tournament_gmv')" :suffix="false" /></td>
            <td class="num"><AdminMoney :cents="w(row, 'platform_take')" :suffix="false" /></td>
            <td><AdminFlagBadges :flags="row.flags" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.accounts { padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 24px; max-width: 1480px; }

.accounts__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.accounts__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: rgba(255,255,255,0.45); }
.accounts__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: #fff; margin: 8px 0 6px; }
.accounts__sub { font-family: var(--font-body); font-size: 14px; color: rgba(255,255,255,0.6); margin: 0; }

.accounts__controls { display: flex; gap: 16px; align-items: center; justify-content: space-between; }
.accounts__search {
  flex: 1;
  max-width: 420px;
  padding: 10px 16px;
  font-family: var(--font-body);
  font-size: 14px;
  color: #fff;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 999px;
  outline: none;
}
.accounts__search::placeholder { color: rgba(255,255,255,0.4); }
.accounts__search:focus { border-color: rgba(255,255,255,0.3); }
.accounts__count { font-family: var(--font-mono); font-size: 11px; color: rgba(255,255,255,0.5); letter-spacing: 0.04em; }

.accounts__table-wrap { overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
.accounts__table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.accounts__table th,
.accounts__table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
.accounts__table th { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.03); position: sticky; top: 0; }
.accounts__table td { font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.85); }
.accounts__table td.num,
.accounts__table th.num { text-align: right; }
.accounts__table tbody tr:hover { background: rgba(255,255,255,0.02); }
.accounts__name { font-weight: 600; color: #fff; }
.accounts__sub-name { font-size: 11px; color: rgba(255,255,255,0.5); font-family: var(--font-mono); margin-top: 2px; }

.plan { display: inline-block; padding: 3px 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; }
.plan--starter { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.65); }
.plan--pro { background: color-mix(in oklab, var(--color-accent) 22%, transparent); color: color-mix(in oklab, var(--color-accent) 85%, #fff); }
.plan--comped { background: #2a1d3a; color: #c4a3ff; }
</style>
