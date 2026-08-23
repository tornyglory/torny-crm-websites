<script setup lang="ts">
import { computed, inject } from 'vue'
import type { EventListProps, BlockContext } from '../types'
import { BLOCK_CONTEXT_KEY } from '../types'

const props = withDefaults(defineProps<EventListProps>(), {
  heading: 'Upcoming events',
  limit: 6,
  upcomingOnly: true,
})

// The parent page (Nuxt club-sites `pages/index.vue`, CRM preview, etc.)
// provides the site data via provide(BLOCK_CONTEXT_KEY). Blocks that don't
// need data don't have to touch this.
const ctx = inject<BlockContext | null>(BLOCK_CONTEXT_KEY, null)

const events = computed(() => {
  const all = ctx?.events ?? []
  const filtered = props.upcomingOnly !== false
    ? all.filter((e) => new Date(e.starts_at).getTime() >= Date.now())
    : all
  return filtered.slice(0, props.limit ?? 6)
})

const brand = computed(() => ctx?.brandPrimary ?? '#2563EB')

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string): string { return String(new Date(iso).getDate()) }
function fmtMonth(iso: string): string { return MONTH_ABBR[new Date(iso).getMonth()] ?? '' }
function fmtLine(iso: string): string {
  const d = new Date(iso)
  const day = DAY_ABBR[d.getDay()]
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  const time = m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}${ampm}`
  return `${day} · ${time}`
}
</script>

<template>
  <section class="event-list" :style="{ '--brand': brand } as any">
    <h2 v-if="heading" class="event-list__heading">{{ heading }}</h2>

    <div v-if="events.length === 0" class="event-list__empty">
      Nothing scheduled just yet — check back soon.
    </div>

    <ul v-else class="event-list__list">
      <li v-for="e in events" :key="e.id" class="event">
        <div class="event__date">
          <div class="event__day">{{ fmtDay(e.starts_at) }}</div>
          <div class="event__month">{{ fmtMonth(e.starts_at) }}</div>
        </div>
        <div class="event__body">
          <div class="event__title">{{ e.title }}</div>
          <div class="event__meta">
            {{ fmtLine(e.starts_at) }}<template v-if="e.location"> · {{ e.location }}</template>
          </div>
          <p v-if="e.excerpt" class="event__excerpt">{{ e.excerpt }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.event-list { padding: 32px 0; }
.event-list__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 16px; color: var(--color-ink); }
.event-list__empty { padding: 24px; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; font-family: var(--font-body); color: var(--color-fog); text-align: center; }
.event-list__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }

.event { display: flex; align-items: flex-start; gap: 16px; padding: 16px 18px; background: var(--card-bg); border: var(--card-border); box-shadow: var(--card-shadow); border-radius: var(--radius-md); }
.event__date { width: 52px; height: 52px; border-radius: 10px; background: var(--brand); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.event__day { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1; }
.event__month { font-family: var(--font-body); font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 3px; }
.event__body { flex: 1; min-width: 0; }
.event__title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.event__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 3px; }
.event__excerpt { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.55; margin: 6px 0 0; }
</style>
