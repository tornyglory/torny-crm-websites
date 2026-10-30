<script setup lang="ts">
/**
 * TornyDatePicker — drop-in replacement for <input type="date"> that
 * matches the v2 design system. Reads + writes YYYY-MM-DD so handlers
 * don't change. Popover anchors below the pill-shaped field; click-outside
 * and Escape close it.
 *
 * Paper reference: artboard "76 · Torny Date Picker".
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    placeholder?: string
    disabled?: boolean
    /** Earliest selectable date (YYYY-MM-DD). */
    min?: string | null
    /** Latest selectable date (YYYY-MM-DD). */
    max?: string | null
    /** Hide the Clear button in the footer. */
    clearable?: boolean
  }>(),
  {
    placeholder: 'Pick a date',
    disabled: false,
    min: null,
    max: null,
    clearable: true,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

// ── Parsing + formatting ──────────────────────────────────────────
/** Parse YYYY-MM-DD to {year,month,day} without timezone drift. */
function parseIso(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}
function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function todayIso(): string {
  const now = new Date()
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

const LABEL_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
function formatLabel(iso: string | null | undefined): string {
  const p = parseIso(iso)
  if (!p) return ''
  const d = new Date(p.y, p.m - 1, p.d)
  return Number.isNaN(d.getTime()) ? '' : LABEL_FMT.format(d)
}

const displayLabel = computed(() => formatLabel(props.modelValue))

// ── Open/close ────────────────────────────────────────────────────
const open = ref(false)
const rootEl = ref<HTMLDivElement | null>(null)
const fieldEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)
/** Fixed-position coords for the teleported popover. Updated on open +
 *  window resize/scroll so it tracks the anchor if the modal scrolls. */
const panelPos = ref<{ top: number; left: number }>({ top: 0, left: 0 })

const PANEL_WIDTH = 288
const PANEL_HEIGHT = 340
const GAP = 8

function updatePanelPos() {
  const el = fieldEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Default: anchor below the field, left-aligned to it.
  let top = rect.bottom + GAP
  let left = rect.left
  // Flip above if there's not enough room below but there is above.
  if (top + PANEL_HEIGHT > vh - 8 && rect.top - PANEL_HEIGHT - GAP > 8) {
    top = rect.top - PANEL_HEIGHT - GAP
  }
  // Shift left to stay in the viewport when the field is close to the right edge.
  if (left + PANEL_WIDTH > vw - 8) {
    left = Math.max(8, vw - PANEL_WIDTH - 8)
  }
  if (left < 8) left = 8
  panelPos.value = { top, left }
}

async function openPanel() {
  if (props.disabled) return
  open.value = true
  // Snap the visible month to the selected / current / today value.
  const target = parseIso(props.modelValue) ?? parseIso(todayIso())
  if (target) {
    viewYear.value = target.y
    viewMonth.value = target.m
  }
  await nextTick()
  updatePanelPos()
}
function closePanel() { open.value = false }
function togglePanel() { if (open.value) closePanel(); else void openPanel() }

function onDocMouseDown(e: MouseEvent) {
  if (!open.value) return
  const root = rootEl.value
  const panel = panelEl.value
  const target = e.target
  if (!(target instanceof Node)) return
  const insideRoot = root?.contains(target) ?? false
  const insidePanel = panel?.contains(target) ?? false
  if (!insideRoot && !insidePanel) closePanel()
}
function onKeyDown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closePanel()
  }
}
function onWindowChange() {
  if (open.value) updatePanelPos()
}
if (typeof window !== 'undefined') {
  window.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onWindowChange)
  window.addEventListener('scroll', onWindowChange, true)
}
onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})

// ── Month view state ──────────────────────────────────────────────
const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth() + 1) // 1-indexed to match ISO

watch(
  () => props.modelValue,
  (iso) => {
    const p = parseIso(iso)
    if (!p) return
    viewYear.value = p.y
    viewMonth.value = p.m
  },
)

const MONTH_YEAR_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const monthLabel = computed(() => MONTH_YEAR_FMT.format(new Date(viewYear.value, viewMonth.value - 1, 1)))

function prevMonth() {
  if (viewMonth.value === 1) { viewMonth.value = 12; viewYear.value -= 1 }
  else { viewMonth.value -= 1 }
}
function nextMonth() {
  if (viewMonth.value === 12) { viewMonth.value = 1; viewYear.value += 1 }
  else { viewMonth.value += 1 }
}

// ── Grid build ────────────────────────────────────────────────────
interface Cell {
  key: string
  iso: string
  day: number
  inMonth: boolean
  isWeekend: boolean
  isToday: boolean
  isSelected: boolean
  isDisabled: boolean
}
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

const cells = computed<Cell[]>(() => {
  const y = viewYear.value
  const m = viewMonth.value
  const first = new Date(y, m - 1, 1)
  // getDay() → 0 Sun, 1 Mon, … 6 Sat. We render Monday-first weeks.
  const firstDow = (first.getDay() + 6) % 7
  const total = daysInMonth(y, m)

  const selected = parseIso(props.modelValue)
  const today = parseIso(todayIso())!
  const minParsed = parseIso(props.min)
  const maxParsed = parseIso(props.max)

  function makeCell(cellY: number, cellM: number, cellD: number, inMonth: boolean): Cell {
    const iso = toIso(cellY, cellM, cellD)
    const dow = new Date(cellY, cellM - 1, cellD).getDay()
    const isWeekend = dow === 0 || dow === 6
    const isToday = today.y === cellY && today.m === cellM && today.d === cellD
    const isSelected = !!selected && selected.y === cellY && selected.m === cellM && selected.d === cellD
    const minMs = minParsed ? Date.UTC(minParsed.y, minParsed.m - 1, minParsed.d) : null
    const maxMs = maxParsed ? Date.UTC(maxParsed.y, maxParsed.m - 1, maxParsed.d) : null
    const thisMs = Date.UTC(cellY, cellM - 1, cellD)
    const isDisabled =
      (minMs != null && thisMs < minMs) ||
      (maxMs != null && thisMs > maxMs)
    return { key: iso, iso, day: cellD, inMonth, isWeekend, isToday, isSelected, isDisabled }
  }

  const out: Cell[] = []
  // Leading days from previous month.
  if (firstDow > 0) {
    const prevY = m === 1 ? y - 1 : y
    const prevM = m === 1 ? 12 : m - 1
    const prevTotal = daysInMonth(prevY, prevM)
    for (let i = firstDow - 1; i >= 0; i--) {
      out.push(makeCell(prevY, prevM, prevTotal - i, false))
    }
  }
  // Current month.
  for (let d = 1; d <= total; d++) {
    out.push(makeCell(y, m, d, true))
  }
  // Trailing days to pad to a full 6-row grid (42 cells).
  const trailing = 42 - out.length
  if (trailing > 0) {
    const nextY = m === 12 ? y + 1 : y
    const nextM = m === 12 ? 1 : m + 1
    for (let d = 1; d <= trailing; d++) {
      out.push(makeCell(nextY, nextM, d, false))
    }
  }
  return out
})

// ── Actions ───────────────────────────────────────────────────────
function pickCell(cell: Cell) {
  if (cell.isDisabled) return
  emit('update:modelValue', cell.iso)
  closePanel()
}
function pickToday() {
  const iso = todayIso()
  emit('update:modelValue', iso)
  const p = parseIso(iso)!
  viewYear.value = p.y
  viewMonth.value = p.m
  closePanel()
}
function clearValue() {
  emit('update:modelValue', null)
  closePanel()
}
</script>

<template>
  <div ref="rootEl" class="torny-dp" :class="{ 'torny-dp--disabled': disabled }">
    <button
      ref="fieldEl"
      type="button"
      class="torny-dp__field"
      :class="{ 'torny-dp__field--open': open, 'torny-dp__field--empty': !displayLabel }"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="togglePanel"
    >
      <span class="torny-dp__value">
        {{ displayLabel || placeholder }}
      </span>
      <svg
        class="torny-dp__icon"
        width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
      >
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M2.5 6.5h11M5 2v3M11 2v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>

    <Teleport to="body">
      <transition name="torny-dp-fade">
        <div
          v-if="open"
          ref="panelEl"
          class="torny-dp__panel"
          role="dialog"
          aria-label="Pick a date"
          :style="{ top: panelPos.top + 'px', left: panelPos.left + 'px' }"
        >
        <header class="torny-dp__head">
          <div class="torny-dp__month">{{ monthLabel }}</div>
          <div class="torny-dp__nav">
            <button type="button" class="torny-dp__nav-btn" aria-label="Previous month" @click="prevMonth">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" class="torny-dp__nav-btn" aria-label="Next month" @click="nextMonth">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l6 5-6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </header>

        <div class="torny-dp__weekdays">
          <div v-for="(initial, i) in WEEKDAY_INITIALS" :key="i" class="torny-dp__weekday">{{ initial }}</div>
        </div>

        <div class="torny-dp__grid">
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="torny-dp__cell"
            :class="{
              'torny-dp__cell--out': !cell.inMonth,
              'torny-dp__cell--weekend': cell.isWeekend && cell.inMonth && !cell.isSelected,
              'torny-dp__cell--today': cell.isToday && !cell.isSelected,
              'torny-dp__cell--selected': cell.isSelected,
              'torny-dp__cell--disabled': cell.isDisabled,
            }"
            :disabled="cell.isDisabled"
            :aria-pressed="cell.isSelected"
            @click="pickCell(cell)"
          >
            {{ cell.day }}
            <span v-if="cell.isToday && !cell.isSelected" class="torny-dp__cell-dot" aria-hidden="true"></span>
            <span v-else-if="cell.isSelected" class="torny-dp__cell-dot torny-dp__cell-dot--on-ink" aria-hidden="true"></span>
          </button>
        </div>

        <footer class="torny-dp__foot">
          <button
            v-if="clearable"
            type="button"
            class="torny-dp__foot-btn torny-dp__foot-btn--ghost"
            @click="clearValue"
          >Clear</button>
          <span v-else></span>
          <button
            type="button"
            class="torny-dp__foot-btn torny-dp__foot-btn--ink"
            @click="pickToday"
          >Today</button>
        </footer>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.torny-dp { position: relative; display: block; width: 100%; }

/* ── Field pill ──────────────────────────────────────────────── */
.torny-dp__field {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 44px;
  padding: 0 14px 0 18px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.torny-dp__field:hover:not(:disabled) { border-color: var(--color-ink); }
.torny-dp__field--open {
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px rgba(10, 10, 11, 0.08);
}
.torny-dp__field:disabled,
.torny-dp--disabled .torny-dp__field { opacity: 0.5; cursor: not-allowed; }

.torny-dp__value {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.torny-dp__field--empty .torny-dp__value {
  font-family: var(--font-body);
  font-weight: 400;
  color: var(--color-mute);
}
.torny-dp__icon {
  flex-shrink: 0;
  color: var(--color-mute);
  transition: color 0.12s ease;
}
.torny-dp__field--open .torny-dp__icon,
.torny-dp__field:hover:not(:disabled) .torny-dp__icon { color: var(--color-ink); }

/* ── Popover ───────────────────────────────────────────────────
 * Teleported to <body> so it escapes every ancestor overflow:hidden
 * on modals / scroll containers. Positioned via `position: fixed`
 * (coords computed in JS) so it tracks the viewport, not the scroll
 * parent. */
.torny-dp__panel {
  position: fixed;
  width: 288px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 200;
}
.torny-dp-fade-enter-active,
.torny-dp-fade-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.torny-dp-fade-enter-from,
.torny-dp-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.torny-dp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.torny-dp__month {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
}
.torny-dp__nav { display: inline-flex; align-items: center; gap: 4px; }
.torny-dp__nav-btn {
  width: 28px; height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 0;
  background: var(--color-surface);
  color: var(--color-ink);
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.torny-dp__nav-btn:hover { background: var(--color-ink); color: #fff; }

.torny-dp__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 36px);
  justify-content: center;
  padding: 4px 10px 8px;
  gap: 0;
}
.torny-dp__weekday {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-fog);
  letter-spacing: 0.08em;
}

.torny-dp__grid {
  display: grid;
  grid-template-columns: repeat(7, 36px);
  justify-content: center;
  padding: 0 10px 12px;
  gap: 2px;
}
.torny-dp__cell {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.torny-dp__cell:hover:not(:disabled):not(.torny-dp__cell--selected) {
  background: var(--color-surface);
  color: var(--color-ink);
}
.torny-dp__cell--out       { color: var(--color-mute); }
.torny-dp__cell--weekend   { color: var(--color-fog); }
.torny-dp__cell--selected  { background: var(--color-ink); color: #fff; font-weight: 600; }
.torny-dp__cell--selected:hover { background: var(--color-ink); color: #fff; }
.torny-dp__cell--disabled  { color: var(--color-mute); cursor: not-allowed; }
.torny-dp__cell--disabled:hover { background: transparent; }

.torny-dp__cell-dot {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-ink);
}
.torny-dp__cell-dot--on-ink { background: #fff; }

.torny-dp__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
}
.torny-dp__foot-btn {
  background: none;
  border: 0;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
}
.torny-dp__foot-btn--ghost { color: var(--color-fog); }
.torny-dp__foot-btn--ghost:hover { color: var(--color-ink); }
.torny-dp__foot-btn--ink { color: var(--color-ink); }
.torny-dp__foot-btn--ink:hover { opacity: 0.7; }
</style>
