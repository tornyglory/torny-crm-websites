<script setup lang="ts">
/**
 * Wide palette dialog for picking a block to insert. Shows a search box,
 * category filter tags, and a 4-column grid of block cards with a
 * miniature illustrative preview per block.
 *
 * Preview shapes are drawn in SVG, not real BlockRenderer renders —
 * cheap to mount, always fits the card, and never breaks when a block's
 * internals change.
 */
import { computed, defineComponent, h, nextTick, ref, watch, type VNode } from 'vue'
import type { BlockType } from '@torny/content-blocks'
import CrmModal from './modals/CrmModal.vue'

interface PaletteItem {
  type: BlockType
  label: string
  hint: string
  icon: string
  defaults: () => unknown
}

const props = defineProps<{
  open: boolean
  items: PaletteItem[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', type: BlockType): void
}>()

// ── Category tags ────────────────────────────────────────────
type Tag = 'all' | 'layout' | 'media' | 'text' | 'data' | 'cta' | 'forms' | 'utility'

const TAG_LABELS: Record<Tag, string> = {
  all: 'All',
  layout: 'Layout',
  media: 'Media',
  text: 'Text',
  data: 'Data',
  cta: 'CTAs',
  forms: 'Forms',
  utility: 'Utility',
}

const TAGS_BY_TYPE: Record<BlockType, Tag[]> = {
  hero:           ['layout', 'text'],
  richText:       ['text'],
  eventList:      ['data'],
  eventsCalendar: ['data', 'layout'],
  honourBoard:    ['data'],
  honourBoardSearch: ['data'],
  membersSearch: ['data'],
  gallery:        ['media'],
  contactForm:    ['forms'],
  membershipCta:  ['cta'],
  ctaBanner:      ['cta'],
  mediaSplit:     ['layout', 'media', 'text'],
  sectionTitle:   ['layout', 'text'],
  pullQuote:      ['text'],
  featureGrid:    ['layout', 'data'],
  faqAccordion:   ['forms', 'text'],
  fullBleedImage: ['layout', 'media'],
  timeline:       ['data'],
  twoColumn:      ['text', 'layout'],
  divider:        ['utility'],
}

const activeTag = ref<Tag>('all')
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

watch(() => props.open, (open) => {
  if (open) {
    query.value = ''
    activeTag.value = 'all'
    void nextTick(() => searchInput.value?.focus())
  }
})

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.items.filter((item) => {
    if (activeTag.value !== 'all') {
      const tags = TAGS_BY_TYPE[item.type] ?? []
      if (!tags.includes(activeTag.value)) return false
    }
    if (!q) return true
    return (
      item.label.toLowerCase().includes(q) ||
      item.hint.toLowerCase().includes(q) ||
      item.type.toLowerCase().includes(q)
    )
  })
})

const availableTags = computed<Tag[]>(() => {
  const set = new Set<Tag>(['all'])
  for (const item of props.items) {
    for (const tag of TAGS_BY_TYPE[item.type] ?? []) set.add(tag)
  }
  const order: Tag[] = ['all', 'layout', 'text', 'media', 'data', 'cta', 'forms', 'utility']
  return order.filter((t) => set.has(t))
})

function pick(type: BlockType) {
  emit('select', type)
}

// ── BlockPreview — inline SVG illustrations per block type ─────
// Every preview is drawn on a 200x120 viewBox so cards feel uniform.
const BlockPreview = defineComponent({
  name: 'BlockPreview',
  props: { type: { type: String, required: true } },
  render() {
    const t = this.type as BlockType

    const rect = (x: number, y: number, w: number, h_: number, opts: Record<string, string | number> = {}) =>
      h('rect', { x, y, width: w, height: h_, rx: 3, ...opts })
    const circle = (cx: number, cy: number, r: number, opts: Record<string, string | number> = {}) =>
      h('circle', { cx, cy, r, ...opts })
    const line = (x1: number, y1: number, x2: number, y2: number, opts: Record<string, string | number> = {}) =>
      h('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1, ...opts })

    const shell = (children: VNode[]) =>
      h('svg', { viewBox: '0 0 200 120', width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid slice' }, children)

    const surface = rect(0, 0, 200, 120, { fill: '#F5F5F2' })
    const ink = '#0A0A0B'
    const accent = '#2563EB'
    const hairline = '#E7E7E1'
    const graphite = '#6B6B72'

    switch (t) {
      case 'hero':
        return shell([
          surface,
          rect(0, 0, 118, 120, { fill: '#fff' }),
          rect(118, 0, 82, 120, { fill: 'url(#hero-grad)' }),
          h('defs', {}, [
            h('linearGradient', { id: 'hero-grad', x1: 0, y1: 0, x2: 1, y2: 1 }, [
              h('stop', { offset: 0, 'stop-color': '#B0E0E6' }),
              h('stop', { offset: 1, 'stop-color': '#4A90A4' }),
            ]),
          ]),
          circle(20, 22, 2, { fill: accent }),
          rect(26, 20, 40, 4, { fill: graphite, opacity: 0.5 }),
          rect(16, 38, 90, 10, { fill: ink }),
          rect(16, 52, 60, 6, { fill: ink }),
          rect(16, 70, 70, 3, { fill: graphite, opacity: 0.6 }),
          rect(16, 78, 60, 3, { fill: graphite, opacity: 0.6 }),
          rect(16, 92, 34, 10, { fill: ink }),
          rect(56, 96, 30, 3, { fill: ink, opacity: 0.5 }),
          rect(130, 96, 45, 8, { fill: 'rgba(10,10,11,0.7)', rx: 4 }),
        ])

      case 'richText':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          ...[24, 40, 56, 72, 88].map((y, i) =>
            rect(16, y, i === 4 ? 90 : 168, 5, { fill: ink, opacity: 0.75 })
          ),
        ])

      case 'eventList':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          // Heading + chips row
          rect(14, 10, 90, 6, { fill: ink }),
          rect(14, 22, 20, 5, { fill: ink, opacity: 0.85, rx: 2 }),
          rect(38, 22, 22, 5, { fill: graphite, opacity: 0.35, rx: 2 }),
          rect(64, 22, 22, 5, { fill: graphite, opacity: 0.35, rx: 2 }),
          // Four cards in a row with coloured top borders
          ...[
            { x: 14, from: '#F5A623' },
            { x: 62, from: '#0EA5E9' },
            { x: 110, from: '#EC4899' },
            { x: 158, from: '#7C3AED' },
          ].flatMap((c) => [
            rect(c.x, 34, 44, 72, { fill: '#fff', stroke: graphite, opacity: 0.15, rx: 3 }),
            rect(c.x, 34, 44, 2, { fill: c.from }),
            rect(c.x + 6, 42, 14, 14, { fill: ink, rx: 2 }),
            rect(c.x + 6, 62, 32, 4, { fill: ink }),
            rect(c.x + 6, 70, 24, 3, { fill: graphite, opacity: 0.6 }),
            rect(c.x + 6, 96, 20, 3, { fill: graphite, opacity: 0.4 }),
          ]),
        ])

      case 'eventsCalendar':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(16, 10, 60, 5, { fill: ink }),
          // Month grid: 5x4 cells
          ...Array.from({ length: 20 }).map((_, i) => {
            const col = i % 5
            const row = Math.floor(i / 5)
            return rect(16 + col * 22, 24 + row * 18, 20, 16, { fill: graphite, opacity: 0.08, rx: 2 })
          }),
          // Event dots
          rect(20, 30, 10, 2, { fill: accent }),
          rect(42, 48, 8, 2, { fill: '#DC2626' }),
          rect(64, 66, 12, 2, { fill: '#7C3AED' }),
          // Side highlights panel
          rect(140, 24, 44, 88, { fill: ink, opacity: 0.9, rx: 3 }),
          rect(146, 32, 30, 2, { fill: '#fff', opacity: 0.9 }),
          rect(146, 38, 24, 2, { fill: '#fff', opacity: 0.5 }),
          rect(146, 52, 30, 2, { fill: '#fff', opacity: 0.9 }),
          rect(146, 58, 20, 2, { fill: '#fff', opacity: 0.5 }),
        ])

      case 'honourBoard':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(16, 12, 80, 6, { fill: ink }),
          ...[30, 50, 70, 90].flatMap((y) => [
            rect(16, y, 22, 5, { fill: ink }),
            rect(50, y, 60, 5, { fill: graphite, opacity: 0.7 }),
            rect(140, y, 40, 5, { fill: graphite, opacity: 0.5 }),
          ]),
        ])

      case 'honourBoardSearch':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          // Search bar
          rect(16, 12, 168, 12, { fill: graphite, opacity: 0.12, rx: 3 }),
          rect(24, 16, 60, 4, { fill: graphite, opacity: 0.5 }),
          // Category rail
          rect(16, 32, 44, 74, { fill: graphite, opacity: 0.08, rx: 3 }),
          ...[38, 50, 62, 74, 86].map((y) => rect(22, y, 30, 3, { fill: graphite, opacity: 0.6 })),
          // Table
          rect(66, 32, 118, 74, { fill: graphite, opacity: 0.05, rx: 3 }),
          rect(70, 38, 30, 3, { fill: ink }),
          ...[52, 64, 76, 88, 100].map((y) => rect(70, y, 100, 3, { fill: graphite, opacity: 0.5 })),
        ])

      case 'membersSearch':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          // Heading
          rect(14, 10, 80, 6, { fill: ink }),
          // Filter chips
          rect(14, 22, 20, 5, { fill: ink, opacity: 0.85, rx: 2 }),
          rect(38, 22, 22, 5, { fill: graphite, opacity: 0.35, rx: 2 }),
          rect(64, 22, 22, 5, { fill: graphite, opacity: 0.35, rx: 2 }),
          // Member cards — 4 across
          ...[
            { x: 14, from: '#F5A623' },
            { x: 62, from: '#0EA5E9' },
            { x: 110, from: '#7C3AED' },
            { x: 158, from: '#10B981' },
          ].flatMap((c) => [
            rect(c.x, 34, 44, 72, { fill: '#fff', stroke: graphite, opacity: 0.15, rx: 3 }),
            rect(c.x, 34, 44, 2, { fill: c.from }),
            // Round avatar
            rect(c.x + 14, 44, 16, 16, { fill: c.from, rx: 8 }),
            rect(c.x + 6, 66, 32, 4, { fill: ink }),
            rect(c.x + 10, 74, 24, 3, { fill: graphite, opacity: 0.5 }),
            rect(c.x + 10, 96, 20, 4, { fill: c.from, opacity: 0.35, rx: 2 }),
          ]),
        ])

      case 'gallery':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(16, 12, 60, 6, { fill: ink }),
          rect(16, 30, 54, 70, { fill: '#B0E0E6' }),
          rect(74, 30, 54, 70, { fill: '#DCFCE7' }),
          rect(132, 30, 52, 70, { fill: '#FED7AA' }),
        ])

      case 'contactForm':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(16, 12, 60, 6, { fill: ink }),
          rect(16, 30, 168, 14, { fill: 'none', stroke: hairline }),
          rect(16, 50, 168, 14, { fill: 'none', stroke: hairline }),
          rect(16, 70, 168, 26, { fill: 'none', stroke: hairline }),
          rect(16, 102, 44, 10, { fill: ink }),
        ])

      case 'membershipCta':
        return shell([
          surface,
          rect(20, 20, 160, 80, { fill: '#DBEAFE', rx: 8 }),
          rect(32, 34, 100, 8, { fill: ink }),
          rect(32, 48, 130, 4, { fill: graphite, opacity: 0.6 }),
          rect(32, 56, 100, 4, { fill: graphite, opacity: 0.6 }),
          rect(32, 74, 50, 12, { fill: accent, rx: 6 }),
        ])

      case 'ctaBanner':
        return shell([
          surface,
          rect(10, 46, 180, 28, { fill: accent, rx: 6 }),
          rect(24, 55, 70, 5, { fill: '#fff' }),
          rect(24, 63, 40, 3, { fill: '#fff', opacity: 0.7 }),
          rect(140, 55, 40, 12, { fill: '#fff', rx: 6 }),
        ])

      case 'mediaSplit':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(10, 20, 78, 80, { fill: 'url(#ms-grad)', rx: 6 }),
          h('defs', {}, [
            h('linearGradient', { id: 'ms-grad', x1: 0, y1: 0, x2: 1, y2: 1 }, [
              h('stop', { offset: 0, 'stop-color': '#B0E0E6' }),
              h('stop', { offset: 1, 'stop-color': '#4A90A4' }),
            ]),
          ]),
          circle(100, 24, 2, { fill: accent }),
          rect(104, 22, 30, 4, { fill: graphite, opacity: 0.5 }),
          rect(100, 32, 84, 9, { fill: ink }),
          rect(100, 44, 60, 9, { fill: ink }),
          rect(100, 60, 84, 3, { fill: graphite, opacity: 0.6 }),
          rect(100, 66, 70, 3, { fill: graphite, opacity: 0.6 }),
          rect(100, 84, 32, 10, { fill: ink, rx: 5 }),
        ])

      case 'sectionTitle':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          circle(94, 30, 2, { fill: accent }),
          rect(98, 28, 30, 4, { fill: graphite, opacity: 0.5 }),
          rect(30, 44, 140, 14, { fill: ink }),
          rect(60, 62, 80, 14, { fill: ink }),
          rect(50, 88, 100, 4, { fill: graphite, opacity: 0.5 }),
          rect(70, 96, 60, 4, { fill: graphite, opacity: 0.5 }),
        ])

      case 'pullQuote':
        return shell([
          rect(0, 0, 200, 120, { fill: ink }),
          rect(96, 20, 8, 8, { fill: accent }),
          rect(28, 40, 144, 10, { fill: '#fff' }),
          rect(45, 55, 110, 10, { fill: '#fff' }),
          rect(60, 70, 80, 10, { fill: '#fff' }),
          rect(78, 92, 44, 3, { fill: '#fff', opacity: 0.4 }),
          circle(75, 100, 4, { fill: 'url(#pq-grad)' }),
          h('defs', {}, [
            h('linearGradient', { id: 'pq-grad' }, [
              h('stop', { offset: 0, 'stop-color': '#F5A623' }),
              h('stop', { offset: 1, 'stop-color': '#E85D5D' }),
            ]),
          ]),
          rect(83, 98, 30, 3, { fill: '#fff' }),
          rect(83, 104, 24, 2, { fill: '#fff', opacity: 0.5 }),
        ])

      case 'featureGrid':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(50, 10, 100, 8, { fill: ink }),
          ...[0, 1, 2, 3].flatMap((i) => [
            rect(10 + i * 46, 30, 42, 78, { fill: 'none', stroke: hairline, rx: 4 }),
            rect(14 + i * 46, 36, 12, 12, { fill: ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#EDE9FE'][i]!, rx: 3 }),
            rect(14 + i * 46, 54, 30, 4, { fill: ink }),
            rect(14 + i * 46, 62, 34, 3, { fill: graphite, opacity: 0.6 }),
            rect(14 + i * 46, 68, 24, 3, { fill: graphite, opacity: 0.6 }),
            line(14 + i * 46, 90, 44 + i * 46, 90, { stroke: hairline }),
            rect(14 + i * 46, 96, 20, 3, { fill: ink }),
          ]),
        ])

      case 'faqAccordion':
        return shell([
          surface,
          rect(10, 10, 60, 4, { fill: graphite, opacity: 0.6 }),
          rect(10, 22, 70, 9, { fill: ink }),
          rect(10, 38, 46, 4, { fill: graphite, opacity: 0.5 }),
          rect(10, 50, 30, 10, { fill: ink, rx: 4 }),
          rect(90, 10, 100, 34, { fill: '#fff', stroke: hairline, rx: 4 }),
          rect(96, 18, 8, 8, { fill: accent, rx: 2 }),
          rect(108, 22, 70, 4, { fill: ink }),
          rect(96, 32, 88, 3, { fill: graphite, opacity: 0.6 }),
          rect(96, 38, 60, 3, { fill: graphite, opacity: 0.6 }),
          rect(90, 52, 100, 18, { fill: '#fff', stroke: hairline, rx: 4 }),
          rect(108, 60, 60, 4, { fill: graphite, opacity: 0.7 }),
          rect(90, 78, 100, 18, { fill: '#fff', stroke: hairline, rx: 4 }),
          rect(108, 86, 60, 4, { fill: graphite, opacity: 0.7 }),
        ])

      case 'fullBleedImage':
        return shell([
          rect(0, 0, 200, 120, { fill: 'url(#fbi-grad)' }),
          h('defs', {}, [
            h('linearGradient', { id: 'fbi-grad', x1: 0, y1: 0, x2: 1, y2: 1 }, [
              h('stop', { offset: 0, 'stop-color': '#C05A2C' }),
              h('stop', { offset: 1, 'stop-color': '#7A2E10' }),
            ]),
          ]),
          rect(0, 0, 200, 120, { fill: 'rgba(0,0,0,0.35)' }),
          rect(10, 10, 60, 8, { fill: 'rgba(10,10,11,0.7)', rx: 4 }),
          rect(30, 48, 140, 14, { fill: '#fff' }),
          rect(70, 68, 60, 6, { fill: '#fff', opacity: 0.85 }),
          rect(80, 82, 40, 10, { fill: '#fff', rx: 5 }),
        ])

      case 'timeline':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(16, 10, 60, 5, { fill: ink }),
          ...[26, 44, 62, 82].flatMap((y, i) => [
            rect(16, y, 22, 6, { fill: i === 2 ? accent : ink }),
            rect(46, y, 60, 4, { fill: ink }),
            rect(46, y + 8, 90, 3, { fill: graphite, opacity: 0.6 }),
          ]),
          rect(10, 78, 180, 22, { fill: '#DBEAFE', rx: 4, opacity: 0.4 }),
        ])

      case 'twoColumn':
        return shell([
          surface,
          rect(16, 12, 60, 5, { fill: ink }),
          rect(16, 22, 100, 8, { fill: ink }),
          rect(16, 44, 30, 3, { fill: accent }),
          rect(16, 52, 60, 5, { fill: ink }),
          rect(16, 64, 76, 3, { fill: graphite, opacity: 0.6 }),
          rect(16, 72, 68, 3, { fill: graphite, opacity: 0.6 }),
          rect(16, 80, 76, 3, { fill: graphite, opacity: 0.6 }),
          line(100, 44, 100, 108, { stroke: hairline }),
          rect(110, 44, 30, 3, { fill: '#92400E' }),
          rect(110, 52, 60, 5, { fill: ink }),
          rect(110, 64, 76, 3, { fill: graphite, opacity: 0.6 }),
          rect(110, 72, 68, 3, { fill: graphite, opacity: 0.6 }),
          rect(110, 80, 76, 3, { fill: graphite, opacity: 0.6 }),
        ])

      case 'divider':
        return shell([
          rect(0, 0, 200, 120, { fill: '#fff' }),
          rect(60, 58, 4, 4, { fill: accent, rx: 2 }),
          rect(70, 58, 4, 4, { fill: '#A3A39B', rx: 2 }),
          rect(80, 58, 4, 4, { fill: '#A3A39B', rx: 2 }),
          rect(20, 60, 32, 1, { fill: hairline }),
          rect(148, 60, 32, 1, { fill: hairline }),
        ])

      default:
        return shell([surface])
    }
  },
})
</script>

<template>
  <CrmModal
    :open="open"
    width="xl"
    eyebrow="Add block"
    title="Pick a block"
    @close="emit('close')"
  >
    <div class="bp__controls">
      <div class="bp__search">
        <svg class="bp__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6" />
          <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          placeholder="Search blocks…"
          class="bp__search-input"
        />
        <button v-if="query" type="button" class="bp__clear" aria-label="Clear search" @click="query = ''">×</button>
      </div>

      <div class="bp__tags" role="tablist" aria-label="Filter by category">
        <button
          v-for="tag in availableTags"
          :key="tag"
          type="button"
          class="bp__tag"
          :class="{ 'bp__tag--active': activeTag === tag }"
          @click="activeTag = tag"
        >{{ TAG_LABELS[tag] }}</button>
      </div>
    </div>

    <div v-if="filteredItems.length === 0" class="bp__empty">
      <div class="bp__empty-title">Nothing matched.</div>
      <div class="bp__empty-hint">Try a different tag or clear the search.</div>
    </div>

    <div v-else class="bp__grid">
      <button
        v-for="item in filteredItems"
        :key="item.type"
        type="button"
        class="bp__card"
        @click="pick(item.type)"
      >
        <div class="bp__preview">
          <BlockPreview :type="item.type" />
        </div>
        <div class="bp__meta">
          <div class="bp__label">{{ item.label }}</div>
          <div class="bp__hint">{{ item.hint }}</div>
        </div>
      </button>
    </div>
  </CrmModal>
</template>

<style scoped>
.bp__controls {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* Bleed over the modal body padding so scrolling content can't peek through
     above/beside the sticky header. */
  padding: 20px 24px;
  margin: -20px -24px 20px;
  border-bottom: 1px solid var(--color-hairline);
  background: #fff;
}

.bp__search {
  position: relative;
  display: flex;
  align-items: center;
}
.bp__search-icon {
  position: absolute;
  left: 12px;
  color: var(--color-fog);
  pointer-events: none;
}
.bp__search-input {
  width: 100%;
  padding: 12px 40px 12px 40px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-ink);
  outline: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.bp__search-input:focus {
  background: #fff;
  border-color: var(--color-ink);
}
.bp__search-input::placeholder { color: var(--color-fog); }

.bp__clear {
  position: absolute;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-fog);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.bp__clear:hover { background: var(--color-surface); color: var(--color-ink); }

.bp__tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bp__tag {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}
.bp__tag:hover { color: var(--color-ink); border-color: var(--color-ink); }
.bp__tag--active {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}

.bp__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 1023px) {
  .bp__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .bp__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.bp__card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.bp__card:hover {
  border-color: var(--color-ink);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
}
.bp__card:active { transform: translateY(0); }

.bp__preview {
  aspect-ratio: 5 / 3;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
}

.bp__meta { display: flex; flex-direction: column; gap: 2px; padding: 0 2px 2px; }
.bp__label {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
.bp__hint {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 145%;
  color: var(--color-fog);
}

.bp__empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-fog);
}
.bp__empty-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.bp__empty-hint { font-family: var(--font-body); font-size: 13px; margin-top: 4px; }
</style>
