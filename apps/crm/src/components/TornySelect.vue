<script setup lang="ts" generic="T extends string | number">
/**
 * TornySelect
 * -----------
 * Branded replacement for `<select>` where the popup needs to look like
 * the rest of the CRM — hairline border, radius, shadow, hover state, our
 * typography. Native selects can't be styled past the trigger (browsers
 * paint the option list themselves), so this component is a listbox with
 * keyboard nav, outside-click dismiss, and ARIA for screen readers.
 *
 * Generic over the option value type so the parent keeps strict typing
 * on `v-model` — pass a string union or a numeric id.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface Option {
  value: T
  label: string
  /** Shown as a smaller secondary line under the label. Optional. */
  hint?: string
}

const props = defineProps<{
  modelValue: T
  options: Option[]
  /** Shown above the trigger (uppercase mono-ish eyebrow). Optional. */
  label?: string
  /** Placeholder shown when the current value has no matching option. */
  placeholder?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: T): void
}>()

const open = ref(false)
const activeIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
/** When the menu would overflow the right edge of the viewport, flip to
 *  right-aligned so it opens leftward instead of pushing a horizontal
 *  scrollbar. Measured on open; recomputed if options change while open. */
const alignRight = ref(false)

const selected = computed<Option | undefined>(() =>
  props.options.find((o) => o.value === props.modelValue),
)
const displayLabel = computed(() => selected.value?.label ?? props.placeholder ?? 'Select…')

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}
function close() { open.value = false }
function pick(opt: Option) {
  emit('update:modelValue', opt.value)
  close()
}

function onKey(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (e.target instanceof HTMLElement && e.target.closest('[data-torny-select-trigger]')) {
        e.preventDefault()
        open.value = true
      }
    }
    return
  }
  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % props.options.length
    scrollActiveIntoView()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + props.options.length) % props.options.length
    scrollActiveIntoView()
    return
  }
  if (e.key === 'Home') { e.preventDefault(); activeIndex.value = 0; scrollActiveIntoView(); return }
  if (e.key === 'End')  { e.preventDefault(); activeIndex.value = props.options.length - 1; scrollActiveIntoView(); return }
  if (e.key === 'Enter') {
    e.preventDefault()
    const opt = props.options[activeIndex.value]
    if (opt) pick(opt)
    return
  }
  if (e.key === 'Tab') { close(); return }
  // Type-to-jump: first option whose label begins with the typed char.
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const ch = e.key.toLowerCase()
    const idx = props.options.findIndex((o) => o.label.toLowerCase().startsWith(ch))
    if (idx !== -1) {
      activeIndex.value = idx
      scrollActiveIntoView()
    }
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    const el = menuRef.value?.querySelector<HTMLElement>(`[data-idx="${activeIndex.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (rootRef.value?.contains(target)) return
  close()
}

watch(open, async (v) => {
  if (v) {
    // Highlight the current selection on open so Enter is a no-op reselect.
    const idx = props.options.findIndex((o) => o.value === props.modelValue)
    activeIndex.value = idx >= 0 ? idx : 0
    await nextTick()
    scrollActiveIntoView()
    // Flip to right-align if the menu's natural (left-aligned) position
    // would overflow the viewport. Uses the rendered menu width so the
    // decision stays correct whatever option labels contain.
    const menu = menuRef.value
    const trig = rootRef.value
    if (menu && trig) {
      const triggerRect = trig.getBoundingClientRect()
      const menuWidth = menu.offsetWidth
      const spill = triggerRect.left + menuWidth - window.innerWidth
      alignRight.value = spill > 8
    }
    requestAnimationFrame(() => document.addEventListener('click', onDocClick))
  } else {
    document.removeEventListener('click', onDocClick)
  }
})

window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div ref="rootRef" class="ts-root" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      type="button"
      class="ts-trigger"
      data-torny-select-trigger
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span v-if="label" class="ts-trigger__eyebrow">{{ label }}</span>
      <span class="ts-trigger__value" :class="{ 'is-placeholder': !selected }">
        {{ displayLabel }}
      </span>
      <svg class="ts-trigger__chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <transition name="ts-fade">
      <ul
        v-if="open"
        ref="menuRef"
        class="ts-menu"
        :class="{ 'ts-menu--right': alignRight }"
        role="listbox"
        :aria-activedescendant="`ts-opt-${activeIndex}`"
      >
        <li
          v-for="(opt, i) in options"
          :id="`ts-opt-${i}`"
          :key="String(opt.value)"
          :data-idx="i"
          class="ts-opt"
          :class="{ 'is-active': i === activeIndex, 'is-selected': opt.value === modelValue }"
          role="option"
          :aria-selected="opt.value === modelValue"
          @mouseenter="activeIndex = i"
          @click="pick(opt)"
        >
          <span class="ts-opt__body">
            <span class="ts-opt__label">{{ opt.label }}</span>
            <span v-if="opt.hint" class="ts-opt__hint">{{ opt.hint }}</span>
          </span>
          <svg
            v-if="opt.value === modelValue"
            class="ts-opt__check"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </li>
      </ul>
    </transition>
  </div>
</template>

<style scoped>
.ts-root { position: relative; display: inline-flex; }
.ts-root.is-disabled { opacity: 0.5; pointer-events: none; }

.ts-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  min-height: 32px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-ink);
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.ts-trigger:hover:not(:disabled) { border-color: var(--color-mute); }
.ts-trigger:focus-visible { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.ts-root.is-open .ts-trigger { border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.ts-trigger__eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.ts-trigger__value { font-size: 12px; font-weight: 500; }
.ts-trigger__value.is-placeholder { color: var(--color-fog); font-weight: 400; }
.ts-trigger__chev { color: var(--color-fog); margin-left: 2px; transition: transform 0.14s ease; }
.ts-root.is-open .ts-trigger__chev { transform: rotate(180deg); color: var(--color-ink); }

.ts-menu {
  list-style: none;
  padding: 6px;
  margin: 6px 0 0;
  position: absolute;
  top: 100%;
  left: 0;
  right: auto;
  min-width: 220px;
  max-width: 320px;
  max-height: 280px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  box-shadow: 0 20px 44px -18px rgba(15, 23, 42, 0.28), 0 6px 12px rgba(15, 23, 42, 0.06);
  z-index: 50;
}

.ts-menu--right { left: auto; right: 0; }

.ts-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}
.ts-opt.is-active { background: var(--color-accent-soft); }
.ts-opt.is-selected .ts-opt__label { color: var(--color-ink); font-weight: 600; }

.ts-opt__body { display: flex; flex-direction: column; min-width: 0; }
.ts-opt__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  line-height: 1.3;
}
.ts-opt__hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  margin-top: 2px;
  line-height: 1.3;
}
.ts-opt__check { color: var(--color-accent); flex-shrink: 0; }

.ts-fade-enter-active, .ts-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.14s cubic-bezier(0.32, 0.72, 0, 1);
}
.ts-fade-enter-from, .ts-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 767px) {
  .ts-menu { min-width: 180px; }
}
</style>
