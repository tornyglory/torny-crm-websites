<script setup lang="ts">
/**
 * Honour board — searchable full-page experience.
 *
 * MVP reads from `/site.honour_board_recent[]` (capped at 60 entries by
 * brief 28) and does search / filter / sort / paging client-side. When
 * backend ships brief 31 (`/public/clubs/:slug/honour-{categories,entries}`)
 * this page swaps to a server-side data source so century-old clubs load
 * their full history.
 *
 * Rendered inside `<PageRenderer>` so a club that publishes its own custom
 * honour-board layout in the CRM keeps overriding this fallback.
 */
import { computed, ref } from 'vue'

const club = useClub()
const { data: site } = await useSite()

const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

usePageMeta('honour-board')

const rawEntries = computed(() => site.value?.honour_board_recent ?? [])

// ── Category rail ───────────────────────────────────────────────
// Derived from the entries payload. Once backend ships the categories
// endpoint we'll swap to that + `entry_count` / `latest_year`.
interface RailCategory {
  slug: string
  name: string
  count: number
  latest_year: number | null
}
const categories = computed<RailCategory[]>(() => {
  const map = new Map<string, RailCategory>()
  for (const e of rawEntries.value) {
    const existing = map.get(e.category_slug)
    if (existing) {
      existing.count += 1
      if (e.year != null && (existing.latest_year == null || e.year > existing.latest_year)) {
        existing.latest_year = e.year
      }
    } else {
      map.set(e.category_slug, {
        slug: e.category_slug,
        name: e.category_name,
        count: 1,
        latest_year: e.year ?? null,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
})

const activeCategorySlug = ref<string | 'all'>('all')

// ── Filter + search + sort ─────────────────────────────────────
const searchQuery = ref('')
const sortDir = ref<'year_desc' | 'year_asc'>('year_desc')

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  let list = rawEntries.value

  if (activeCategorySlug.value !== 'all') {
    list = list.filter((e) => e.category_slug === activeCategorySlug.value)
  }

  if (q.length > 0) {
    list = list.filter((e) => {
      if (`${e.year ?? ''}`.includes(q)) return true
      if ((e.member_name ?? '').toLowerCase().includes(q)) return true
      if ((e.notes ?? '').toLowerCase().includes(q)) return true
      if (e.players?.some((p) => p.display_name.toLowerCase().includes(q))) return true
      return false
    })
  }

  return [...list].sort((a, b) => {
    const ay = a.year ?? -Infinity
    const by = b.year ?? -Infinity
    return sortDir.value === 'year_desc' ? by - ay : ay - by
  })
})

const activeCategoryLabel = computed(() =>
  activeCategorySlug.value === 'all'
    ? 'All categories'
    : (categories.value.find((c) => c.slug === activeCategorySlug.value)?.name ?? 'Category'),
)

const yearRange = computed<string | null>(() => {
  const years = filtered.value.map((e) => e.year).filter((y): y is number => y != null)
  if (years.length === 0) return null
  const min = Math.min(...years)
  const max = Math.max(...years)
  return min === max ? String(min) : `${min}–${max}`
})

// ── Team display helpers ───────────────────────────────────────
function teamDisplay(e: (typeof rawEntries.value)[number]): string {
  if (e.players && e.players.length > 0) {
    return e.players.map((p) => p.display_name).join(', ')
  }
  return e.member_name
}
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('')
}
function formatAwarded(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-NZ', { month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}
</script>

<template>
  <PageRenderer slug="honour-board">
    <div class="hb" :style="{ '--brand': accent } as any">
      <!-- Head -->
      <header class="hb__head">
        <div class="hb__eyebrow">
          <template v-if="categories.length && yearRange">
            {{ categories.length }} categor{{ categories.length === 1 ? 'y' : 'ies' }} · {{ yearRange }}
          </template>
          <template v-else>Honour board</template>
        </div>
        <h1 class="hb__title">The honour board.</h1>
        <p class="hb__sub">Every winner of every event since we opened. Names on the wall, names on this page.</p>
      </header>

      <!-- Search + filters -->
      <div class="hb__toolbar" v-if="rawEntries.length">
        <div class="hb__search">
          <svg class="hb__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            v-model="searchQuery"
            class="hb__search-input"
            :placeholder="`Search ${rawEntries.length} champion${rawEntries.length === 1 ? '' : 's'} — name, year, category…`"
            autocomplete="off"
          />
          <button v-if="searchQuery" type="button" class="hb__search-clear" @click="searchQuery = ''" aria-label="Clear search">×</button>
        </div>
        <div class="hb__filters">
          <label class="hb__select">
            <span>Sort</span>
            <select v-model="sortDir">
              <option value="year_desc">Newest first</option>
              <option value="year_asc">Oldest first</option>
            </select>
          </label>
          <label class="hb__select">
            <span>Category</span>
            <select v-model="activeCategorySlug">
              <option value="all">All</option>
              <option v-for="c in categories" :key="c.slug" :value="c.slug">{{ c.name }}</option>
            </select>
          </label>
        </div>
      </div>

      <!-- Body: rail + table -->
      <div v-if="rawEntries.length" class="hb__grid">
        <!-- Category rail -->
        <aside class="rail" aria-label="Category filter">
          <div class="rail__label">Categories</div>
          <ul class="rail__list">
            <li>
              <button
                type="button"
                class="rail__item"
                :class="{ 'rail__item--active': activeCategorySlug === 'all' }"
                @click="activeCategorySlug = 'all'"
              >
                <span class="rail__item-dot" />
                <span class="rail__item-name">All categories</span>
                <span class="rail__item-count">{{ rawEntries.length }}</span>
              </button>
            </li>
            <li v-for="c in categories" :key="c.slug">
              <button
                type="button"
                class="rail__item"
                :class="{ 'rail__item--active': activeCategorySlug === c.slug }"
                @click="activeCategorySlug = c.slug"
              >
                <span class="rail__item-dot" />
                <span class="rail__item-name">{{ c.name }}</span>
                <span class="rail__item-count">{{ c.count }}</span>
              </button>
            </li>
          </ul>
        </aside>

        <!-- Results table -->
        <section class="results">
          <header class="results__head">
            <div class="results__eyebrow">
              {{ activeCategoryLabel }}<template v-if="yearRange"> · {{ yearRange }}</template>
            </div>
            <div class="results__title-row">
              <h2 class="results__title">
                <span class="results__count">{{ filtered.length }}</span>
                champion{{ filtered.length === 1 ? '' : 's' }}
              </h2>
              <div v-if="searchQuery" class="results__hint">
                Filtered by "{{ searchQuery }}"
              </div>
            </div>
          </header>

          <div v-if="filtered.length === 0" class="results__empty">
            <div class="results__empty-title">No results.</div>
            <p>Try a different category or clear the search.</p>
          </div>

          <table v-else class="results__table">
            <thead>
              <tr>
                <th class="col-year">Year</th>
                <th class="col-champ">Champion</th>
                <th class="col-notes">Notes</th>
                <th class="col-score">Score</th>
                <th class="col-awarded">Awarded</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in filtered" :key="`${e.category_slug}-${e.year}-${e.member_name}`" class="row">
                <td class="col-year">
                  <div class="row__year">{{ e.year ?? '—' }}</div>
                  <div v-if="activeCategorySlug === 'all'" class="row__cat">{{ e.category_name }}</div>
                </td>
                <td class="col-champ">
                  <div class="row__champ">
                    <span class="row__avatar" :style="{ background: accent } as any">{{ e.initials || initialsOf(e.member_name) }}</span>
                    <div class="row__names">
                      <div class="row__name">{{ teamDisplay(e) }}</div>
                      <div v-if="e.players && e.players.length > 1" class="row__positions">
                        <template v-for="(p, i) in e.players" :key="p.user_id ?? p.display_name">
                          <span v-if="p.position">{{ p.position }}</span>
                          <span v-if="i < (e.players?.length ?? 0) - 1 && p.position" class="row__positions-sep">·</span>
                        </template>
                      </div>
                    </div>
                  </div>
                </td>
                <td class="col-notes">{{ e.notes || '—' }}</td>
                <td class="col-score">{{ e.score || '—' }}</td>
                <td class="col-awarded">{{ formatAwarded(e.awarded_at) }}</td>
              </tr>
            </tbody>
          </table>

          <!-- MVP note: /site.honour_board_recent[] is capped at 60. When
               brief 31 ships, this becomes a real "Load older" pagination. -->
          <footer v-if="filtered.length && rawEntries.length >= 60" class="results__foot">
            <div class="results__foot-body">
              <div class="results__foot-title">Full history coming soon</div>
              <p>Showing the most recent 60 entries across all categories. The complete searchable archive lands when the public endpoint ships.</p>
            </div>
          </footer>
        </section>
      </div>

      <!-- Empty state — no entries at all -->
      <div v-else class="hb__empty">
        <div class="hb__empty-title">Honour board is coming together.</div>
        <p>Once results are recorded, they'll show up here — championship winners, pennant sides, life members.</p>
      </div>
    </div>
  </PageRenderer>
</template>

<style scoped>
.hb { display: flex; flex-direction: column; gap: 40px; padding: 64px 24px 96px; max-width: 1200px; margin: 0 auto; }

.hb__head { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.hb__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.hb__title { font-family: var(--font-display); font-size: clamp(40px, 5vw, 64px); font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); line-height: 1.05; }
.hb__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; line-height: 1.55; max-width: 560px; }

.hb__toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.hb__search { position: relative; flex: 1; min-width: 280px; }
.hb__search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--color-fog); pointer-events: none; }
.hb__search-input { width: 100%; padding: 12px 44px 12px 42px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; background: #fff; color: var(--color-ink); }
.hb__search-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 15%, transparent); }
.hb__search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: 0; font-size: 20px; color: var(--color-fog); cursor: pointer; padding: 0 6px; line-height: 1; }
.hb__filters { display: flex; gap: 10px; }
.hb__select { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.hb__select span { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.hb__select select { border: 0; background: transparent; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; cursor: pointer; }
.hb__select select:focus { outline: none; }

.hb__grid { display: grid; grid-template-columns: 220px 1fr; gap: 24px; align-items: start; }

/* Rail */
.rail { position: sticky; top: 24px; padding: 12px 8px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.rail__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; padding: 6px 12px 10px; }
.rail__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.rail__item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; background: transparent; border: 0; border-radius: 8px; cursor: pointer; text-align: left; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); }
.rail__item:hover { background: var(--color-surface); color: var(--color-ink); }
.rail__item--active { background: color-mix(in oklab, var(--brand) 12%, transparent); color: var(--color-ink); font-weight: 600; }
.rail__item-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-hairline); flex-shrink: 0; }
.rail__item--active .rail__item-dot { background: var(--brand); }
.rail__item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail__item-count { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); flex-shrink: 0; }
.rail__item--active .rail__item-count { color: var(--color-graphite); }

/* Results */
.results { min-width: 0; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.results__head { padding: 20px 24px 16px; border-bottom: 1px solid var(--color-hairline); }
.results__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 8px; }
.results__title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.results__title { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.results__count { color: var(--brand); }
.results__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.results__table { width: 100%; border-collapse: collapse; font-family: var(--font-body); }
.results__table thead th { padding: 12px 16px; background: var(--color-surface); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); text-align: left; border-bottom: 1px solid var(--color-hairline); }
.results__table tbody tr { border-bottom: 1px solid var(--color-hairline); }
.results__table tbody tr:last-child { border-bottom: 0; }
.results__table td { padding: 14px 16px; vertical-align: middle; color: var(--color-ink); font-size: 14px; }

.col-year { width: 100px; font-family: var(--font-mono); font-weight: 700; font-size: 15px; }
.col-year .row__cat { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); font-weight: 500; margin-top: 4px; }
.col-champ { min-width: 240px; }
.row__champ { display: flex; align-items: center; gap: 12px; }
.row__avatar { width: 32px; height: 32px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-family: var(--font-display); font-size: 11px; font-weight: 700; flex-shrink: 0; }
.row__names { min-width: 0; }
.row__name { font-family: var(--font-display); font-weight: 600; color: var(--color-ink); }
.row__positions { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; }
.row__positions-sep { opacity: 0.5; }
.col-notes { color: var(--color-graphite); }
.col-score { font-family: var(--font-mono); font-weight: 600; color: var(--color-graphite); width: 100px; }
.col-awarded { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); width: 130px; white-space: nowrap; }

.results__empty { padding: 48px 24px; text-align: center; color: var(--color-fog); font-family: var(--font-body); }
.results__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }

.results__foot { padding: 18px 24px; background: var(--color-surface); border-top: 1px solid var(--color-hairline); }
.results__foot-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--color-ink); margin-bottom: 4px; }
.results__foot-body p { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); margin: 0; line-height: 1.5; }

.hb__empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.hb__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }

@media (max-width: 900px) {
  .hb__grid { grid-template-columns: 1fr; }
  .rail { position: static; }
  .rail__list { flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 6px; }
  .rail__item { flex-shrink: 0; padding: 8px 14px; background: var(--color-surface); border-radius: 999px; }
  .rail__item--active { background: var(--color-ink); color: #fff; }
  .rail__item--active .rail__item-count { color: rgba(255,255,255,0.7); }
  .rail__item-dot { display: none; }
  .col-notes { display: none; }
  .col-awarded { display: none; }
}
@media (max-width: 600px) {
  .hb__toolbar { flex-direction: column; align-items: stretch; }
  .hb__filters { justify-content: space-between; }
  .results__table td { padding: 10px 12px; font-size: 13px; }
  .col-score { display: none; }
  .col-year { width: 70px; }
}
</style>
