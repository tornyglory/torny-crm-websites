<script setup lang="ts">
/**
 * Venue packages — list screen.
 *
 * The admin surface for managing bookable packages (The Clubhouse,
 * Green + BBQ, …). Each row shows the identity + counts + bond + a
 * status pill. Filter chips drive the server query (not client-side)
 * so counts stay authoritative. Clicking a card opens the editor.
 *
 * Backed by brief 73 §1-§5 (venuePackages resource).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  venuePackages as venuePackagesApi,
  ApiError,
  type VenuePackageListItem,
} from '@torny/api-client'

const router = useRouter()
const clubStore = useClubStore()
const toast = useToast()

type StatusFilter = 'all' | 'active' | 'archived'

const packages = ref<VenuePackageListItem[]>([])
const counts = ref({ all: 0, active: 0, archived: 0 })
const loading = ref(true)
const statusFilter = ref<StatusFilter>('all')
const search = ref('')
const debouncedSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
let listAbort: AbortController | null = null

watch(search, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { debouncedSearch.value = q.trim() }, 240)
})

async function loadList(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') { packages.value = []; loading.value = false; return }
  if (listAbort) listAbort.abort()
  listAbort = new AbortController()
  loading.value = true
  try {
    const res = await venuePackagesApi.list(
      cid,
      {
        status: statusFilter.value,
        search: debouncedSearch.value || undefined,
      },
      { signal: listAbort.signal },
    )
    packages.value = res.packages
    counts.value = res.counts
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    toast.error(err instanceof ApiError ? err.message : 'Could not load packages.')
    packages.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { void loadList() })
watch(() => clubStore.current?.id, () => { void loadList() })
watch([statusFilter, debouncedSearch], () => { void loadList() })

const emptyMessage = computed(() => {
  if (debouncedSearch.value) return { title: 'No matches', hint: 'Try a different search.' }
  switch (statusFilter.value) {
    case 'active':   return { title: 'No active packages', hint: 'Create one to accept bookings.' }
    case 'archived': return { title: 'No archived packages', hint: 'Archived packages live here for audit.' }
    default:         return { title: 'No packages yet', hint: 'Create your first package to accept bookings.' }
  }
})

function openPackage(p: VenuePackageListItem): void {
  router.push(`/crm/venue-packages/${p.id}`)
}

function formatBond(cents: number): string {
  if (cents === 0) return 'No bond'
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
</script>

<template>
  <div class="vp">
    <header class="vp__header">
      <div>
        <div class="vp__eyebrow">Venue hire</div>
        <h1 class="vp__heading">Venue packages</h1>
        <p class="vp__sub">
          {{ counts.active }} active · {{ counts.all }} total
        </p>
      </div>
      <div class="vp__actions">
        <div class="search">
          <svg class="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input v-model="search" placeholder="Search name, slug…" class="search__input" />
          <button v-if="search" class="search__clear" aria-label="Clear search" @click="search = ''">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <RouterLink to="/crm/venue-packages/settings" class="btn btn--ghost">Settings</RouterLink>
        <RouterLink to="/crm/venue-packages/new" class="btn btn--ink">+ New package</RouterLink>
      </div>
    </header>

    <div class="filters">
      <div class="chips">
        <button
          v-for="tab in (['all', 'active', 'archived'] as const)"
          :key="tab"
          class="chip"
          :class="{ 'is-active': statusFilter === tab }"
          @click="statusFilter = tab"
        >
          <span class="chip__label">{{ tab === 'all' ? 'All' : tab === 'active' ? 'Active' : 'Archived' }}</span>
          <span class="chip__count">{{ counts[tab] }}</span>
        </button>
      </div>
    </div>

    <div v-if="loading && packages.length === 0" class="empty">
      <div class="empty__title">Loading…</div>
    </div>

    <ul v-else-if="packages.length > 0" class="grid">
      <li
        v-for="p in packages"
        :key="p.id"
        class="card"
        :class="{ 'card--archived': !p.is_active }"
        tabindex="0"
        @click="openPackage(p)"
        @keydown.enter="openPackage(p)"
      >
        <div class="card__media">
          <img v-if="p.hero_image_url" :src="p.hero_image_url" :alt="p.hero_image_alt ?? ''" />
          <div v-else class="card__media-placeholder" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 4l10 5v10l-10 5-10-5V9l10-5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity="0.4"/></svg>
          </div>
          <span v-if="!p.is_active" class="card__status card__status--archived">Archived</span>
        </div>
        <div class="card__body">
          <div class="card__name-row">
            <div class="card__name">{{ p.name }}</div>
            <div class="card__slug">{{ p.slug }}</div>
          </div>
          <div v-if="p.sub" class="card__sub">{{ p.sub }}</div>
          <div class="card__meta">
            <span class="badge badge--mute">{{ p.slot_count }} slots</span>
            <span class="badge badge--mute">{{ p.addon_count }} add-ons</span>
            <span class="badge" :class="p.bond_cents > 0 ? 'badge--accent' : 'badge--mute'">
              {{ formatBond(p.bond_cents) }}
            </span>
          </div>
        </div>
      </li>
    </ul>

    <div v-else class="empty">
      <div class="empty__title">{{ emptyMessage.title }}</div>
      <div class="empty__hint">{{ emptyMessage.hint }}</div>
      <RouterLink v-if="statusFilter !== 'archived' && !debouncedSearch" to="/crm/venue-packages/new" class="btn btn--ink empty__cta">+ New package</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.vp { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }

.vp__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.vp__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.vp__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.vp__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.vp__actions { display: flex; gap: 10px; align-items: center; }

/* Search */
.search { position: relative; display: flex; align-items: center; min-width: 260px; }
.search__icon { position: absolute; left: 12px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 9px 36px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__clear { position: absolute; right: 8px; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }

/* Buttons */
.btn { padding: 8px 14px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover { background: var(--color-graphite); }
.btn--ghost { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }

/* Chips */
.filters { display: flex; align-items: center; gap: 12px; }
.chips { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 0; background: transparent; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.chip.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.chip__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.chip.is-active .chip__count { background: var(--color-accent-soft); color: var(--color-accent); }

/* Grid */
.grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; display: flex; flex-direction: column; }
.card:hover { border-color: var(--color-mute); box-shadow: var(--shadow-sm); }
.card:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.card--archived { opacity: 0.75; }

.card__media { position: relative; aspect-ratio: 16 / 9; background: var(--color-surface); display: flex; align-items: center; justify-content: center; color: var(--color-fog); }
.card__media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card__media-placeholder { color: var(--color-fog); }
.card__status { position: absolute; top: 10px; right: 10px; padding: 3px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.card__status--archived { background: var(--color-ink); color: #fff; }

.card__body { padding: 16px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.card__name-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.card__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.card__slug { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.card__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.4; }
.card__meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; padding-top: 4px; }

.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; }
.badge--mute { background: var(--color-surface); color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.badge--accent { background: var(--color-accent-soft); color: var(--color-accent); }

/* Empty */
.empty { padding: 64px 32px; text-align: center; font-family: var(--font-body); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 6px; }
.empty__cta { margin-top: 20px; }

@media (max-width: 767px) {
  .vp__actions { width: 100%; }
  .search { flex: 1; min-width: 0; }
}
</style>
