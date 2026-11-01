<script setup lang="ts" generic="T extends string | number">
/**
 * TornyMultiSelect
 * ----------------
 * Multi-select companion to `TornySelect`. The trigger is a pill that
 * shows the filter name on the left and a count / preview on the right.
 * Opens a listbox with checkbox rows, "Clear" + "Select all" at the top.
 * `v-model` is the array of selected option values.
 *
 * Used for the audience-builder chips in SendEmailModal (Status / Tier /
 * Role / Dues), but kept generic so other filter rows can adopt it.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface Option {
  value: T
  label: string
}

const props = defineProps<{
  modelValue: T[]
  options: Option[]
  /** Pill label shown on the left of the trigger. */
  label: string
  /** Placeholder shown when nothing selected. Defaults to "All". */
  placeholder?: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: T[]): void
}>()

const open = ref(false)
const activeIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
/** Flip to right-aligned when the menu would overflow the right edge of
 *  the viewport. Mirrors the TornySelect behaviour. */
const alignRight = ref(false)

const selectedSet = computed(() => new Set(props.modelValue))

const triggerText = computed(() => {
  const n = props.modelValue.length
  if (n === 0) return props.placeholder ?? 'All'
  if (n === 1) {
    return props.options.find((o) => o.value === props.modelValue[0])?.label ?? '1 selected'
  }
  return `${n} selected`
})

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}
function close() { open.value = false }

function toggleValue(v: T) {
  const next = new Set(selectedSet.value)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  emit('update:modelValue', Array.from(next))
}
function selectAll() {
  emit('update:modelValue', props.options.map((o) => o.value))
}
function clearAll() {
  emit('update:modelValue', [])
}

function onKey(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (e.target instanceof HTMLElement && e.target.closest('[data-torny-multi-trigger]')) {
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
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const opt = props.options[activeIndex.value]
    if (opt) toggleValue(opt.value)
    return
  }
  if (e.key === 'Tab') { close() }
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
    activeIndex.value = 0
    await nextTick()
    const menu = menuRef.value?.closest<HTMLElement>('.tm-menu') ?? null
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
  <div
    ref="rootRef"
    class="tm-root"
    :class="{ 'is-open': open, 'is-disabled': disabled, 'is-active': modelValue.length > 0 }"
  >
    <button
      type="button"
      class="tm-trigger"
      data-torny-multi-trigger
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="tm-trigger__label">{{ label }}</span>
      <span class="tm-trigger__value">{{ triggerText }}</span>
      <span v-if="modelValue.length > 0" class="tm-trigger__count">{{ modelValue.length }}</span>
      <svg class="tm-trigger__chev" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <transition name="tm-fade">
      <div v-if="open" class="tm-menu" :class="{ 'tm-menu--right': alignRight }">
        <div class="tm-menu__head">
          <span class="tm-menu__title">{{ label }}</span>
          <div class="tm-menu__head-actions">
            <button
              v-if="modelValue.length < options.length"
              type="button"
              class="tm-menu__head-btn"
              @click="selectAll"
            >
              Select all
            </button>
            <button
              v-if="modelValue.length > 0"
              type="button"
              class="tm-menu__head-btn"
              @click="clearAll"
            >
              Clear
            </button>
          </div>
        </div>
        <ul ref="menuRef" class="tm-list" role="listbox" aria-multiselectable="true">
          <li
            v-for="(opt, i) in options"
            :key="String(opt.value)"
            :data-idx="i"
            class="tm-opt"
            :class="{ 'is-active': i === activeIndex, 'is-selected': selectedSet.has(opt.value) }"
            role="option"
            :aria-selected="selectedSet.has(opt.value)"
            @mouseenter="activeIndex = i"
            @click="toggleValue(opt.value)"
          >
            <span class="tm-opt__check" :class="{ 'is-on': selectedSet.has(opt.value) }" aria-hidden="true">
              <svg v-if="selectedSet.has(opt.value)" width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="tm-opt__label">{{ opt.label }}</span>
          </li>
        </ul>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tm-root { position: relative; display: inline-flex; }
.tm-root.is-disabled { opacity: 0.5; pointer-events: none; }

.tm-trigger {
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
  transition: border-color 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease;
}
.tm-trigger:hover:not(:disabled) { border-color: var(--color-mute); }
.tm-trigger:focus-visible { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.tm-root.is-open .tm-trigger { border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.tm-root.is-active .tm-trigger {
  background: var(--color-accent-soft);
  border-color: color-mix(in oklab, var(--color-accent) 40%, var(--color-hairline) 60%);
}

.tm-trigger__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.tm-root.is-active .tm-trigger__label { color: var(--color-accent-strong); }
.tm-trigger__value { font-size: 12px; font-weight: 500; }
.tm-root.is-active .tm-trigger__value { color: var(--color-accent-strong); font-weight: 600; }
.tm-trigger__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-accent-ink, #fff);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}
.tm-trigger__chev { color: var(--color-fog); transition: transform 0.14s ease; margin-left: 2px; }
.tm-root.is-open .tm-trigger__chev { transform: rotate(180deg); color: var(--color-ink); }

.tm-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: auto;
  margin-top: 6px;
  min-width: 240px;
  max-width: 320px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  box-shadow: 0 20px 44px -18px rgba(15, 23, 42, 0.28), 0 6px 12px rgba(15, 23, 42, 0.06);
  z-index: 50;
  overflow: hidden;
}
.tm-menu--right { left: auto; right: 0; }

.tm-menu__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  gap: 10px;
}
.tm-menu__title {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.tm-menu__head-actions { display: flex; gap: 10px; }
.tm-menu__head-btn {
  border: 0;
  background: transparent;
  padding: 0;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-accent);
  font-weight: 600;
  cursor: pointer;
}
.tm-menu__head-btn:hover { text-decoration: underline; }

.tm-list { list-style: none; padding: 2px 6px 8px; margin: 0; max-height: 260px; overflow-y: auto; }

.tm-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}
.tm-opt.is-active { background: var(--color-surface); }
.tm-opt.is-selected { background: var(--color-accent-soft); }
.tm-opt.is-selected.is-active { background: color-mix(in oklab, var(--color-accent-soft) 70%, var(--color-accent) 10%); }

.tm-opt__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: #fff;
  border: 1.5px solid var(--color-mute);
  color: #fff;
  flex-shrink: 0;
}
.tm-opt__check.is-on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}
.tm-opt__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  line-height: 1.3;
}

.tm-fade-enter-active, .tm-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.14s cubic-bezier(0.32, 0.72, 0, 1);
}
.tm-fade-enter-from, .tm-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
