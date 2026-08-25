<script setup lang="ts">
/**
 * Events highlights strip — the "What's on the greens" Paper design.
 *
 * Compact, richly styled card row for embedding on the home page or any
 * other page where the club wants to promote what's coming up without
 * the full-month calendar surface (that's `eventsCalendar`).
 *
 * Reads `BlockContext.events` (populated from `/site.events_upcoming[]`)
 * so it doesn't need to fetch — perfect on the home page where /site is
 * already in memory. Filter chips + card grid mirror the palette and
 * design language of EventsCalendarBlock.
 */
import { computed, inject, isRef, ref, type Ref } from 'vue'
import { BLOCK_CONTEXT_KEY, type BlockContext, type EventListProps } from '../types'

const props = withDefaults(defineProps<EventListProps>(), {
  eyebrow: '',
  heading: 'Upcoming events',
  description: '',
  limit: 4,
  upcomingOnly: true,
  showTypeChips: true,
  ctaLabel: 'See the full calendar',
  ctaHref: '/events',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

type EventEntry = NonNullable<BlockContext['events']>[number]

// Aligned to the events backend whitelist (brief 33 §5) + palette from
// EventsCalendarBlock so the same event renders in the same colours here.
type LiveEventType = 'tournament' | 'pennant' | 'social' | 'training' | 'other'
const TYPE_META: Record<LiveEventType, { label: string; color: string; from: string; to: string; ring: string }> = {
  tournament: { label: 'Tournament', color: '#B45309', from: '#F5A623', to: '#E85D5D', ring: '#F5A623' },
  pennant:    { label: 'Pennant',    color: '#0369A1', from: '#0EA5E9', to: '#0369A1', ring: '#38BDF8' },
  social:     { label: 'Social',     color: '#BE185D', from: '#EC4899', to: '#831843', ring: '#F472B6' },
  training:   { label: 'Training',   color: '#7C3AED', from: '#7C3AED', to: '#DB2777', ring: '#A855F7' },
  other:      { label: 'Other',      color: '#4B5563', from: '#6B7280', to: '#374151', ring: '#9CA3AF' },
}

const allEvents = computed<EventEntry[]>(() => ctx.value?.events ?? [])

const upcoming = computed<EventEntry[]>(() => {
  const now = Date.now()
  const list = props.upcomingOnly !== false
    ? allEvents.value.filter((e) => new Date(e.starts_at).getTime() >= now)
    : allEvents.value
  return [...list].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
})

const activeType = ref<'all' | LiveEventType>('all')

const typeCounts = computed<Record<LiveEventType, number>>(() => {
  const counts: Record<LiveEventType, number> = { tournament: 0, pennant: 0, social: 0, training: 0, other: 0 }
  for (const e of upcoming.value) {
    const key = ((e.event_type as LiveEventType) in counts ? e.event_type : 'other') as LiveEventType
    counts[key] += 1
  }
  return counts
})

const availableTypes = computed<LiveEventType[]>(() =>
  (Object.keys(TYPE_META) as LiveEventType[]).filter((t) => typeCounts.value[t] > 0),
)

const filtered = computed<EventEntry[]>(() => {
  const list = activeType.value === 'all'
    ? upcoming.value
    : upcoming.value.filter((e) => e.event_type === activeType.value)
  return list.slice(0, props.limit ?? 4)
})

const monthLabel = computed(() =>
  new Date().toLocaleString('en-NZ', { month: 'long', year: 'numeric' }),
)

const totalScheduled = computed(() => upcoming.value.length)

/** "Twelve events on the schedule." — spell small numbers when no description override. */
const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']
const autoDescription = computed(() => {
  const n = totalScheduled.value
  if (n === 0) return 'Nothing scheduled just yet — check back soon.'
  const label = n <= 12 ? NUMBER_WORDS[n] : String(n)
  return `${label} event${n === 1 ? '' : 's'} on the schedule.`
})

// Display helpers
const DAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
function dayOfWeek(iso: string): string {
  return DAY_ABBR[new Date(iso).getDay()] ?? ''
}
function dayNum(iso: string): string {
  return String(new Date(iso).getDate())
}
function formatTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}:00 ${ampm}`
}
function typeLabel(t: string | null | undefined): string {
  const key = (t ?? 'other') as LiveEventType
  return TYPE_META[key]?.label ?? 'Other'
}
function typePalette(t: string | null | undefined): { color: string; from: string; to: string; ring: string } {
  const key = (t ?? 'other') as LiveEventType
  return TYPE_META[key] ?? TYPE_META.other
}
function goingLabel(e: EventEntry): string {
  const count = e.rsvp_going_count ?? 0
  if (count === 0) return 'Be the first to RSVP'
  return `+${count} going`
}
</script>

<template>
  <section class="evh" :style="{ '--brand': brand } as any">
    <header class="evh__head">
      <div class="evh__head-text">
        <div class="evh__eyebrow">
          <span class="evh__eyebrow-dot" />
          <span v-if="props.eyebrow">{{ props.eyebrow }}</span>
          <span v-else>THIS MONTH · {{ monthLabel.toUpperCase() }}</span>
        </div>
        <h2 class="evh__heading">{{ props.heading }}</h2>
        <p class="evh__sub">
          {{ props.description || autoDescription }}
        </p>
      </div>
      <a v-if="props.ctaLabel && props.ctaHref" :href="props.ctaHref" class="evh__cta">
        <span>{{ props.ctaLabel }}</span>
        <span aria-hidden="true">→</span>
      </a>
    </header>

    <div v-if="props.showTypeChips !== false && upcoming.length > 0" class="evh__chips" aria-label="Filter by type">
      <button
        type="button"
        class="evh__chip"
        :class="{ 'evh__chip--active': activeType === 'all' }"
        @click="activeType = 'all'"
      >
        <span>All</span>
        <span class="evh__chip-count">{{ upcoming.length }}</span>
      </button>
      <button
        v-for="t in availableTypes"
        :key="t"
        type="button"
        class="evh__chip"
        :class="{ 'evh__chip--active': activeType === t }"
        @click="activeType = t"
      >
        <span class="evh__chip-dot" :style="{ background: TYPE_META[t].color } as any" />
        <span>{{ TYPE_META[t].label }}</span>
        <span class="evh__chip-count">{{ typeCounts[t] }}</span>
      </button>
    </div>

    <div v-if="filtered.length === 0" class="evh__empty">
      Nothing scheduled just yet — check back soon.
    </div>

    <ul v-else class="evh__grid">
      <li v-for="e in filtered" :key="e.id">
        <a
          :href="props.ctaHref ?? '/events'"
          class="ec"
          :style="{
            '--ec-from': typePalette(e.event_type).from,
            '--ec-to': typePalette(e.event_type).to,
            '--ec-ring': typePalette(e.event_type).ring,
            '--ec-hue': typePalette(e.event_type).color,
          } as any"
        >
          <div class="ec__head">
            <div class="ec__date">
              <div class="ec__dow">{{ dayOfWeek(e.starts_at) }}</div>
              <div class="ec__day">{{ dayNum(e.starts_at) }}</div>
            </div>
            <span class="ec__type">
              <span class="ec__type-dot" />
              <span>{{ typeLabel(e.event_type).toUpperCase() }}</span>
            </span>
          </div>
          <div class="ec__title">{{ e.title }}</div>
          <div class="ec__meta">
            {{ formatTime(e.starts_at) }}
            <template v-if="e.location"><span class="ec__sep">·</span>{{ e.location }}</template>
            <template v-if="e.event_type"><span class="ec__sep">·</span>{{ typeLabel(e.event_type) }}</template>
          </div>
          <div class="ec__foot">
            <span v-if="e.rsvp_going_preview && e.rsvp_going_preview.length > 0" class="ec__avatars">
              <template v-for="(p, i) in e.rsvp_going_preview" :key="i">
                <img v-if="p.avatar_url" :src="p.avatar_url" :alt="p.initials" class="ec__avatar" />
                <span v-else class="ec__avatar ec__avatar--initials" :style="{ background: typePalette(e.event_type).to } as any">{{ p.initials }}</span>
              </template>
            </span>
            <span class="ec__going">{{ goingLabel(e) }}</span>
            <span class="ec__rsvp">RSVP</span>
          </div>
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.evh {
  display: flex;
  flex-direction: column;
  gap: 28px;
  /* Match HeroBlock + HonourBoardBlock: break out of the parent
     .page-blocks max-width so the block spans the viewport. Horizontal
     padding keeps the inner content aligned with the site's reading
     rhythm and prevents cards from touching the edge on ultrawide. */
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 64px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
}

/* Head */
.evh__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
.evh__head-text { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
.evh__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.evh__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.evh__heading { font-family: var(--font-display); font-size: clamp(32px, 4vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); line-height: 1.05; }
.evh__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; line-height: 1.55; max-width: 480px; }
.evh__cta { display: inline-flex; align-items: center; gap: 10px; padding: 12px 20px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; text-decoration: none; flex-shrink: 0; }
.evh__cta:hover { background: var(--color-graphite); }

/* Chips */
.evh__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.evh__chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-graphite); cursor: pointer; }
.evh__chip:hover { background: #fff; }
.evh__chip--active { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }
.evh__chip-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.evh__chip-count { font-family: var(--font-mono); font-size: 11px; opacity: 0.65; }

/* Empty */
.evh__empty { padding: 32px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; font-family: var(--font-body); color: var(--color-fog); }

/* Grid */
.evh__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

/* Card */
.ec { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; text-decoration: none; color: inherit; transition: transform 160ms, box-shadow 160ms, border-color 160ms; overflow: hidden; }
.ec::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--ec-from, #F5A623), var(--ec-to, #E85D5D)); }
.ec:hover { transform: translateY(-2px); border-color: transparent; box-shadow: 0 10px 30px color-mix(in oklab, var(--ec-ring, var(--brand)) 22%, transparent); }

.ec__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ec__date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 52px; padding: 8px 4px; background: var(--color-ink); color: #fff; border-radius: 10px; box-shadow: 0 4px 12px color-mix(in oklab, var(--ec-ring, #F5A623) 25%, transparent); }
.ec__dow { font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.14em; opacity: 0.7; }
.ec__day { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1; margin-top: 2px; }
.ec__type { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: color-mix(in oklab, var(--ec-hue, #4B5563) 15%, #fff); color: var(--ec-hue, var(--color-graphite)); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; flex-shrink: 0; }
.ec__type-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }

.ec__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.2; margin: 4px 0 0; }
.ec__meta { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.4; }
.ec__sep { opacity: 0.5; margin: 0 5px; }

.ec__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--color-hairline); }
.ec__avatars { display: inline-flex; align-items: center; }
.ec__avatar { width: 24px; height: 24px; border-radius: 999px; border: 2px solid #fff; background: var(--color-hairline); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 9px; font-weight: 700; margin-left: -6px; overflow: hidden; box-sizing: border-box; }
.ec__avatar:first-child { margin-left: 0; }
.ec__avatar img { width: 100%; height: 100%; object-fit: cover; }
.ec__going { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-graphite); flex: 1; }
.ec__rsvp { font-family: var(--font-body); font-size: 12px; font-weight: 700; color: var(--color-ink); text-decoration: underline; text-underline-offset: 3px; }
.ec:hover .ec__rsvp { color: var(--ec-hue, var(--color-ink)); }

@media (max-width: 1023px) {
  .evh__grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .evh__grid { grid-template-columns: 1fr; }
  .evh__head { flex-direction: column; align-items: stretch; }
  .evh__cta { align-self: flex-start; }
}
</style>
