<script setup lang="ts">
/**
 * Platform-wide transactions ledger — brief 125.
 *
 * "All the money flowing through Torny and how much of it is ours."
 * Aggregate tiles at the top (gross, platform take, effective rate,
 * count-by-kind), a top-clubs-by-GMV strip, and a sortable / filterable
 * table of every booking + entry across every club.
 *
 * Shape matches the per-account transactions view (admin/accounts/:id)
 * but with an additional Club column and no account-detail navigation
 * crumb at the top. Clicking a club chip in the top-clubs strip jumps
 * to that account's detail page.
 */
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  admin,
  ApiError,
  type AdminPlatformTransactionsList,
  type AdminTransactionKind,
  type AdminTransactionStatus,
  type AdminListAllTransactionsParams,
} from '@torny/api-client'
import { useAdminWindow } from '@/composables/useAdminWindow'
import AdminWindowToggle from '@/components/admin/AdminWindowToggle.vue'
import AdminMetricCard from '@/components/admin/AdminMetricCard.vue'
import AdminMoney from '@/components/admin/AdminMoney.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'

const router = useRouter()
const { window, setWindow } = useAdminWindow()

// ── Filter state (all URL-independent for now — URL-driven for the
//    load-more follow-up ship, keep sync local for first cut) ──────
const search = ref('')
const kindFilter = ref<AdminTransactionKind | 'all'>('all')
const statusFilter = ref<AdminTransactionStatus | 'all'>('all')
const sort = ref<'-at' | '-amount_cents' | '-platform_fee_cents'>('-at')

const data = ref<AdminPlatformTransactionsList | null>(null)
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
    const params: AdminListAllTransactionsParams = {
      window: window.value,
      q: search.value.trim() || undefined,
      sort: sort.value,
      signal: ctrl.signal,
    }
    const filter: NonNullable<AdminListAllTransactionsParams['filter']> = {}
    if (kindFilter.value !== 'all') filter.kind = kindFilter.value
    if (statusFilter.value !== 'all') filter.status = statusFilter.value
    if (Object.keys(filter).length > 0) params.filter = filter
    const res = await admin.listAllTransactions(params)
    if (ctrl.signal.aborted) return
    data.value = res
  } catch (err) {
    if (ctrl.signal.aborted) return
    error.value = err instanceof ApiError ? err.message : 'Could not load transactions.'
  } finally {
    if (!ctrl.signal.aborted) loading.value = false
  }
}

// Debounce search; refetch on every other filter / sort / window change.
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => void load(), 300)
})
watch([window, kindFilter, statusFilter, sort], () => void load(), { immediate: true })

function openAccount(clubId: number) {
  void router.push({ name: 'admin-account-detail', params: { id: String(clubId) } })
}

const KIND_LABELS: Record<string, string> = {
  venue_booking: 'Venue booking',
  tournament_entry: 'Tournament entry',
  subscription_charge: 'Subscription',
  addon_charge: 'Add-on',
}
const STATUS_LABELS: Record<AdminTransactionStatus, string> = {
  succeeded: 'Succeeded',
  refunded: 'Refunded',
  failed: 'Failed',
  pending: 'Pending',
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
function fmtRate(n: number): string {
  // effective_take_rate is a decimal fraction (0.00638 == 0.638%)
  return `${(n * 100).toFixed(2)}%`
}
</script>

<template>
  <div class="txns">
    <header class="txns__head">
      <div>
        <div class="txns__eyebrow">PLATFORM · LEDGER</div>
        <h1 class="txns__title">Transactions</h1>
        <p class="txns__sub">Every booking, entry, and future add-on charge flowing through Torny — with our cut.</p>
      </div>
      <AdminWindowToggle :model-value="window" @update:model-value="setWindow" />
    </header>

    <AdminEmptyState
      v-if="error"
      tone="error"
      title="Could not load transactions"
      :detail="error"
      @retry="load"
    />

    <template v-else>
      <!-- Aggregate tiles -->
      <section class="txns__tiles">
        <AdminMetricCard tone="accent" label="Gross · window" :loading="loading" subtitle="Total $ moving through Torny">
          <AdminMoney :cents="data?.aggregates.gross_cents" :suffix="false" />
        </AdminMetricCard>
        <AdminMetricCard tone="accent" label="Platform take · window" :loading="loading" subtitle="Our cut of the gross">
          <AdminMoney :cents="data?.aggregates.platform_take_cents" :suffix="false" />
        </AdminMetricCard>
        <AdminMetricCard label="Take rate" :loading="loading" subtitle="Platform take ÷ gross">
          {{ data ? fmtRate(data.aggregates.effective_take_rate) : '—' }}
        </AdminMetricCard>
        <AdminMetricCard label="Transactions" :value="data?.total_count ?? '—'" :loading="loading" subtitle="Rows in window" />
      </section>

      <!-- Top clubs strip -->
      <section v-if="data && data.aggregates.top_clubs_by_gmv.length > 0" class="txns__top-clubs">
        <div class="txns__strip-label">Top clubs by GMV</div>
        <div class="txns__chips">
          <button
            v-for="c in data.aggregates.top_clubs_by_gmv"
            :key="c.club_id"
            type="button"
            class="txns__chip"
            @click="openAccount(c.club_id)"
          >
            <span class="txns__chip-name">{{ c.name }}</span>
            <span class="txns__chip-gross"><AdminMoney :cents="c.gross_cents" :suffix="false" /></span>
            <span class="txns__chip-take"><AdminMoney :cents="c.platform_take_cents" :suffix="false" /> take</span>
          </button>
        </div>
      </section>

      <!-- Filters + search -->
      <section class="txns__controls">
        <div class="txns__filters">
          <select v-model="kindFilter" class="txns__select">
            <option value="all">All kinds</option>
            <option value="venue_booking">Venue bookings</option>
            <option value="tournament_entry">Tournament entries</option>
            <option value="subscription_charge">Subscriptions</option>
            <option value="addon_charge">Add-ons</option>
          </select>
          <select v-model="statusFilter" class="txns__select">
            <option value="all">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
            <option value="failed">Failed</option>
          </select>
          <select v-model="sort" class="txns__select">
            <option value="-at">Newest first</option>
            <option value="-amount_cents">Largest amount</option>
            <option value="-platform_fee_cents">Largest platform take</option>
          </select>
        </div>
        <input
          v-model="search"
          type="search"
          class="txns__search"
          placeholder="Search club, member, or email…"
        />
      </section>

      <!-- Table -->
      <AdminEmptyState
        v-if="data && data.items.length === 0"
        tone="no-results"
        title="No transactions matched"
        detail="Clear the filters or try a wider window."
      />
      <div v-else class="txns__table-wrap">
        <table class="txns__table">
          <thead>
            <tr>
              <th>When</th>
              <th>Club</th>
              <th>Member</th>
              <th>Kind</th>
              <th>Reference</th>
              <th class="num">Amount</th>
              <th class="num">Platform take</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data?.items" :key="row.id">
              <td class="txns__when">{{ fmtDateTime(row.at) }}</td>
              <td>
                <button type="button" class="txns__club" @click="openAccount(row.club.id)">
                  {{ row.club.name }}
                </button>
              </td>
              <td>
                <template v-if="row.member">
                  <div class="txns__member-name">{{ row.member.name }}</div>
                  <div class="txns__member-email">{{ row.member.email }}</div>
                </template>
                <span v-else class="txns__anon">Anonymous</span>
              </td>
              <td>
                <span class="kind-chip" :class="`kind-chip--${row.kind}`">
                  {{ KIND_LABELS[row.kind] ?? row.kind }}
                </span>
              </td>
              <td class="txns__ref">{{ row.ref.label }}</td>
              <td class="num"><AdminMoney :cents="row.amount_cents" :suffix="false" /></td>
              <td class="num"><AdminMoney :cents="row.platform_fee_cents" :suffix="false" /></td>
              <td>
                <span class="status-chip" :class="`status-chip--${row.status}`">
                  {{ STATUS_LABELS[row.status] }}
                </span>
              </td>
              <td>
                <a
                  v-if="row.stripe_dashboard_url"
                  :href="row.stripe_dashboard_url"
                  target="_blank"
                  rel="noopener"
                  class="txns__stripe-link"
                  title="Open in Stripe"
                >↗</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.txns { padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 24px; max-width: 1480px; }

.txns__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.txns__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-fog); }
.txns__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 8px 0 6px; }
.txns__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.txns__tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 1100px) { .txns__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .txns__tiles { grid-template-columns: 1fr; } }

.txns__top-clubs { display: flex; flex-direction: column; gap: 10px; }
.txns__strip-label { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.txns__chips { display: flex; gap: 10px; flex-wrap: wrap; }
.txns__chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 16px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  cursor: pointer;
  font-family: var(--font-body);
  text-align: left;
}
.txns__chip:hover { background: var(--color-surface); border-color: var(--color-ink); }
.txns__chip-name { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.txns__chip-gross { font-size: 15px; font-weight: 700; color: var(--color-accent); font-variant-numeric: tabular-nums; }
.txns__chip-take { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); font-variant-numeric: tabular-nums; }

.txns__controls { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.txns__filters { display: flex; gap: 10px; flex-wrap: wrap; }
.txns__select {
  padding: 8px 14px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.txns__select:focus { border-color: var(--color-ink); }
.txns__search {
  flex: 1;
  max-width: 360px;
  padding: 8px 14px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  outline: none;
}
.txns__search::placeholder { color: var(--color-fog); }
.txns__search:focus { border-color: var(--color-ink); }

.txns__table-wrap { overflow-x: auto; background: var(--color-ground); border: 1px solid var(--color-hairline); border-radius: 12px; }
.txns__table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.txns__table th,
.txns__table td { padding: 11px 14px; text-align: left; border-bottom: 1px solid var(--color-hairline); vertical-align: middle; }
.txns__table th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
  background: var(--color-surface);
  position: sticky;
  top: 0;
}
.txns__table td { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.txns__table td.num,
.txns__table th.num { text-align: right; }
.txns__table tbody tr:hover { background: var(--color-surface); }
.txns__table tbody tr:last-child td { border-bottom: 0; }

.txns__when { font-family: var(--font-mono); font-size: 12px; color: var(--color-graphite); }
.txns__club { background: none; border: 0; padding: 0; color: var(--color-accent); font: inherit; cursor: pointer; text-align: left; }
.txns__club:hover { text-decoration: underline; }
.txns__member-name { font-weight: 500; }
.txns__member-email { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); margin-top: 1px; }
.txns__anon { font-style: italic; color: var(--color-fog); }
.txns__ref { color: var(--color-graphite); max-width: 240px; }
.txns__stripe-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px; height: 28px;
  border-radius: 999px;
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 700;
}
.txns__stripe-link:hover { background: color-mix(in oklab, var(--color-accent) 10%, transparent); }

.kind-chip { display: inline-block; padding: 2px 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; background: var(--color-surface); color: var(--color-graphite); }
.kind-chip--venue_booking { background: color-mix(in oklab, var(--color-accent) 12%, #fff); color: var(--color-accent); }
.kind-chip--tournament_entry { background: color-mix(in oklab, var(--color-feature-tangerine) 12%, #fff); color: var(--color-feature-tangerine); }
.kind-chip--subscription_charge { background: color-mix(in oklab, var(--color-feature-violet) 12%, #fff); color: var(--color-feature-violet); }
.kind-chip--addon_charge { background: color-mix(in oklab, var(--color-feature-mint) 12%, #fff); color: var(--color-feature-mint); }

.status-chip { display: inline-block; padding: 2px 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; }
.status-chip--succeeded { background: color-mix(in oklab, var(--color-feature-mint) 15%, #fff); color: var(--color-feature-mint); }
.status-chip--pending { background: var(--color-surface); color: var(--color-graphite); }
.status-chip--refunded { background: color-mix(in oklab, var(--color-feature-violet) 15%, #fff); color: var(--color-feature-violet); }
.status-chip--failed { background: color-mix(in oklab, var(--color-danger) 15%, #fff); color: var(--color-danger); }
</style>
