<script setup lang="ts">
/**
 * TornyTimePicker — drop-in replacement for <input type="time"> that
 * matches the v2 design system (mirrors TornyDatePicker's pill-field +
 * teleported-popover shape).
 *
 * Reads + writes 24-hour HH:mm, same shape as the native control, so
 * callers that already combine date + time into an ISO (see
 * TournamentFormView:combineIso, TeamEditorView:submitCreate) don't
 * change. The popover shows 12-hour + AM/PM which is what admins
 * actually read; the model stays 24-hour.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    placeholder?: string
    disabled?: boolean
    clearable?: boolean
    /** Minute granularity for the popover grid. Default 5 → 12 options
     *  (00, 05, 10, …, 55) in a 4×3 grid. */
    minuteStep?: number
  }>(),
  {
    placeholder: 'Pick a time',
    disabled: false,
    clearable: true,
    minuteStep: 5,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

// ── Parsing + formatting ──────────────────────────────────────────

function parse24(value: string | null | undefined): { h: number; m: number } | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return { h, m }
}

function to24(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 24h → "12:30 PM" display. */
function formatDisplay(value: string | null | undefined): string {
  const p = parse24(value)
  if (!p) return ''
  const meridiem = p.h >= 12 ? 'PM' : 'AM'
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${h12}:${String(p.m).padStart(2, '0')} ${meridiem}`
}

const displayLabel = computed(() => formatDisplay(props.modelValue))

// ── Open/close + positioning ─────────────────────────────────────

const open = ref(false)
const rootEl = ref<HTMLDivElement | null>(null)
const fieldEl = ref<HTMLButtonElement | null>(null)
const panelEl = ref<HTMLDivElement | null>(null)
const panelPos = ref<{ top: number; left: number }>({ top: 0, left: 0 })

const PANEL_WIDTH = 272
const PANEL_HEIGHT = 380
const GAP = 8

function updatePanelPos() {
  const el = fieldEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  let top = rect.bottom + GAP
  let left = rect.left
  if (top + PANEL_HEIGHT > vh - 8 && rect.top - PANEL_HEIGHT - GAP > 8) {
    top = rect.top - PANEL_HEIGHT - GAP
  }
  if (left + PANEL_WIDTH > vw - 8) {
    left = Math.max(8, vw - PANEL_WIDTH - 8)
  }
  if (left < 8) left = 8
  panelPos.value = { top, left }
}

/** Working copy inside the popover. Users can click around without
 *  committing until they hit Set; cancel reverts. */
const draftH12 = ref(12)
const draftMinute = ref(0)
const draftMeridiem = ref<'AM' | 'PM'>('AM')

function seedDraft() {
  const current = parse24(props.modelValue) ?? { h: new Date().getHours(), m: new Date().getMinutes() }
  draftMeridiem.value = current.h >= 12 ? 'PM' : 'AM'
  draftH12.value = current.h % 12 === 0 ? 12 : current.h % 12
  // Snap minutes to the step grid so the selected cell always matches
  // one of the rendered buttons. Rounds down — users can still nudge.
  const step = Math.max(1, props.minuteStep)
  draftMinute.value = Math.floor(current.m / step) * step
}

async function openPanel() {
  if (props.disabled) return
  seedDraft()
  open.value = true
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

// ── Grid data ────────────────────────────────────────────────────

/** 12, 1, 2, …, 11 — "12 first" matches how Western clocks are read. */
const HOUR_GRID = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

const minuteGrid = computed(() => {
  const step = Math.max(1, props.minuteStep)
  const arr: number[] = []
  for (let m = 0; m < 60; m += step) arr.push(m)
  return arr
})

// ── Actions ──────────────────────────────────────────────────────

function pickHour(h12: number) {
  draftH12.value = h12
}
function pickMinute(m: number) {
  draftMinute.value = m
}
function pickMeridiem(am: 'AM' | 'PM') {
  draftMeridiem.value = am
}

function commit() {
  const h12 = draftH12.value
  const h24 = draftMeridiem.value === 'AM'
    ? (h12 === 12 ? 0 : h12)
    : (h12 === 12 ? 12 : h12 + 12)
  emit('update:modelValue', to24(h24, draftMinute.value))
  closePanel()
}

function clearValue() {
  emit('update:modelValue', null)
  closePanel()
}
</script>

<template>
  <div ref="rootEl" class="torny-tp" :class="{ 'torny-tp--disabled': disabled }">
    <button
      ref="fieldEl"
      type="button"
      class="torny-tp__field"
      :class="{ 'torny-tp__field--open': open, 'torny-tp__field--empty': !displayLabel }"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="togglePanel"
    >
      <span class="torny-tp__value">{{ displayLabel || placeholder }}</span>
      <svg class="torny-tp__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
        <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>

    <Teleport to="body">
      <transition name="torny-tp-fade">
        <div
          v-if="open"
          ref="panelEl"
          class="torny-tp__panel"
          role="dialog"
          aria-label="Pick a time"
          :style="{ top: panelPos.top + 'px', left: panelPos.left + 'px' }"
        >
          <div class="torny-tp__section">
            <div class="torny-tp__section-label">Hour</div>
            <div class="torny-tp__grid torny-tp__grid--hours">
              <button
                v-for="h in HOUR_GRID"
                :key="h"
                type="button"
                class="torny-tp__cell"
                :class="{ 'torny-tp__cell--selected': h === draftH12 }"
                :aria-pressed="h === draftH12"
                @click="pickHour(h)"
              >{{ h }}</button>
            </div>
          </div>

          <div class="torny-tp__section">
            <div class="torny-tp__section-label">Minute</div>
            <div class="torny-tp__grid torny-tp__grid--minutes">
              <button
                v-for="m in minuteGrid"
                :key="m"
                type="button"
                class="torny-tp__cell"
                :class="{ 'torny-tp__cell--selected': m === draftMinute }"
                :aria-pressed="m === draftMinute"
                @click="pickMinute(m)"
              >{{ String(m).padStart(2, '0') }}</button>
            </div>
          </div>

          <div class="torny-tp__meridiem">
            <button
              type="button"
              class="torny-tp__pill"
              :class="{ 'torny-tp__pill--selected': draftMeridiem === 'AM' }"
              :aria-pressed="draftMeridiem === 'AM'"
              @click="pickMeridiem('AM')"
            >AM</button>
            <button
              type="button"
              class="torny-tp__pill"
              :class="{ 'torny-tp__pill--selected': draftMeridiem === 'PM' }"
              :aria-pressed="draftMeridiem === 'PM'"
              @click="pickMeridiem('PM')"
            >PM</button>
          </div>

          <footer class="torny-tp__foot">
            <button
              v-if="clearable"
              type="button"
              class="torny-tp__foot-btn torny-tp__foot-btn--ghost"
              @click="clearValue"
            >Clear</button>
            <span v-else></span>
            <button
              type="button"
              class="torny-tp__foot-btn torny-tp__foot-btn--primary"
              @click="commit"
            >Set</button>
          </footer>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.torny-tp { position: relative; display: block; width: 100%; }

/* ── Field pill ──────────────────────────────────────────────── */
.torny-tp__field {
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
.torny-tp__field:hover:not(:disabled) { border-color: var(--color-ink); }
.torny-tp__field--open {
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px rgba(10, 10, 11, 0.08);
}
.torny-tp__field:disabled,
.torny-tp--disabled .torny-tp__field { opacity: 0.5; cursor: not-allowed; }

.torny-tp__value {
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
.torny-tp__field--empty .torny-tp__value {
  font-family: var(--font-body);
  font-weight: 400;
  color: var(--color-mute);
}
.torny-tp__icon {
  flex-shrink: 0;
  color: var(--color-mute);
  transition: color 0.12s ease;
}
.torny-tp__field--open .torny-tp__icon,
.torny-tp__field:hover:not(:disabled) .torny-tp__icon { color: var(--color-ink); }

/* ── Popover ────────────────────────────────────────────────── */
.torny-tp__panel {
  position: fixed;
  width: 272px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 200;
}
.torny-tp-fade-enter-active,
.torny-tp-fade-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.torny-tp-fade-enter-from,
.torny-tp-fade-leave-to { opacity: 0; transform: translateY(-4px); }

.torny-tp__section { padding: 12px 16px 8px; }
.torny-tp__section + .torny-tp__section { border-top: 1px solid var(--color-hairline); }
.torny-tp__section-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
  margin-bottom: 8px;
}
.torny-tp__grid { display: grid; gap: 4px; }
.torny-tp__grid--hours { grid-template-columns: repeat(4, 1fr); }
.torny-tp__grid--minutes { grid-template-columns: repeat(4, 1fr); }
.torny-tp__cell {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-graphite);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.torny-tp__cell:hover:not(.torny-tp__cell--selected) { background: var(--color-surface); color: var(--color-ink); }
.torny-tp__cell--selected {
  background: var(--color-ink);
  color: #fff;
  font-weight: 600;
}

.torny-tp__meridiem {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--color-hairline);
}
.torny-tp__pill {
  height: 36px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-graphite);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.torny-tp__pill:hover:not(.torny-tp__pill--selected) {
  border-color: var(--color-ink);
  color: var(--color-ink);
}
.torny-tp__pill--selected {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}

.torny-tp__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
}
.torny-tp__foot-btn {
  padding: 8px 16px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
}
.torny-tp__foot-btn--ghost {
  background: transparent;
  color: var(--color-fog);
}
.torny-tp__foot-btn--ghost:hover { color: var(--color-ink); }
.torny-tp__foot-btn--primary {
  background: var(--color-ink);
  color: #fff;
}
</style>
