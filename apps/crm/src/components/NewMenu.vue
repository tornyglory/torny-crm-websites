<script setup lang="ts">
/**
 * NewMenu
 * -------
 * Popover that opens from the "+ New" button in the CRM topbar. A curated
 * list of quick-create actions across the whole app — the owner never has
 * to navigate to a section just to reach its "add" affordance. Keyboard-
 * navigable with arrow keys, dismissable with Esc / outside click, and
 * globally togglable with ⌘N (Ctrl+N on Windows/Linux).
 *
 * The routes each item points at are the same as the sidebar's — for
 * MVP the destination section carries its own create CTA. Later this
 * component can pass `{ new: '1' }` so each view can open its create
 * sheet on mount.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const router = useRouter()

interface Item {
  key: string
  label: string
  hint: string
  route: string
  icon: 'user' | 'calendar' | 'people' | 'send' | 'page' | 'inbox' | 'trophy'
  shortcut?: string
}
const ITEMS: Item[] = [
  { key: 'member', label: 'New member', hint: 'Add manually — skips the applications flow', route: '/crm/members', icon: 'user', shortcut: 'M' },
  { key: 'tournament', label: 'New tournament', hint: 'Take entries, run brackets, collect fees', route: '/crm/tournaments/new', icon: 'trophy', shortcut: 'O' },
  { key: 'event', label: 'New event', hint: 'Roll-up, social, or club fixture', route: '/crm/events', icon: 'calendar', shortcut: 'E' },
  { key: 'team', label: 'New team selection', hint: 'Rink assignments for a fixture', route: '/crm/teams/new', icon: 'people', shortcut: 'T' },
  { key: 'campaign', label: 'New campaign', hint: 'Email or SMS to members', route: '/crm/communications?compose=1', icon: 'send', shortcut: 'C' },
  { key: 'page', label: 'New page', hint: 'A public site page from blocks', route: '/crm/website', icon: 'page', shortcut: 'P' },
  { key: 'note', label: 'New enquiry note', hint: 'Log a phone-call enquiry', route: '/crm/enquiries', icon: 'inbox', shortcut: 'N' },
]

const activeIndex = ref(0)
const menuRef = ref<HTMLElement | null>(null)

const openCurrent = computed(() => props.open)

function close() {
  emit('update:open', false)
}
function toggle() {
  emit('update:open', !props.open)
}
function pick(item: Item) {
  close()
  router.push(item.route)
}

// Keyboard nav
function onKey(e: KeyboardEvent) {
  // Global ⌘N / Ctrl+N toggle when no input is focused
  const target = e.target as HTMLElement | null
  const inField = target
    && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  if ((e.key === 'n' || e.key === 'N') && (e.metaKey || e.ctrlKey) && !inField) {
    e.preventDefault()
    toggle()
    return
  }
  if (!openCurrent.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % ITEMS.length
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + ITEMS.length) % ITEMS.length
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = ITEMS[activeIndex.value]
    if (item) pick(item)
    return
  }
  // Letter-shortcut: matches first letter of any item's `shortcut`.
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const upper = e.key.toUpperCase()
    const idx = ITEMS.findIndex((i) => i.shortcut === upper)
    if (idx !== -1) {
      e.preventDefault()
      const item = ITEMS[idx]
      if (item) pick(item)
    }
  }
}

function onDocClick(e: MouseEvent) {
  if (!openCurrent.value) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('[data-newmenu-anchor]')) return
  if (target.closest('.new-menu')) return
  close()
}

// Global keydown always listens (needed for ⌘N).
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocClick)
})

watch(
  () => props.open,
  async (v) => {
    if (v) {
      activeIndex.value = 0
      await nextTick()
      requestAnimationFrame(() => document.addEventListener('click', onDocClick))
    } else {
      document.removeEventListener('click', onDocClick)
    }
  },
)
</script>

<template>
  <transition name="new-menu-fade">
    <div v-if="open" ref="menuRef" class="new-menu" role="menu" aria-label="Create">
      <div class="new-menu__eyebrow">Create</div>
      <ul class="new-menu__list">
        <li
          v-for="(item, i) in ITEMS"
          :key="item.key"
          class="new-menu__row"
          :class="{ 'is-active': i === activeIndex }"
          role="menuitem"
          @mouseenter="activeIndex = i"
          @click="pick(item)"
        >
          <span class="new-menu__icon" aria-hidden="true">
            <svg v-if="item.icon === 'user'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.6"/>
              <path d="M3.5 17c0-3 3-5 6.5-5s6.5 2 6.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else-if="item.icon === 'calendar'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="5" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M3 9h14M7 3v4M13 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else-if="item.icon === 'people'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="14" cy="8.5" r="2" stroke="currentColor" stroke-width="1.6"/>
              <path d="M2.5 16c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M12.5 15.5c0-1.6 1.2-3 2.8-3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else-if="item.icon === 'send'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M17 3L2 9l6 2 2 6 7-14z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M8 11l9-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else-if="item.icon === 'page'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M12 3v4h4M7 12h6M7 9h3M7 15h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else-if="item.icon === 'trophy'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M6 3h8v4a4 4 0 0 1-8 0V3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M3 3.5h3M14 3.5h3M7 17h6M10 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M3 4.5C3 3.7 3.7 3 4.5 3h11c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5v-11z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M3 11h4l1 2h4l1-2h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <div class="new-menu__body">
            <div class="new-menu__label">{{ item.label }}</div>
            <div class="new-menu__hint">{{ item.hint }}</div>
          </div>
          <span v-if="item.shortcut" class="new-menu__kbd">{{ item.shortcut }}</span>
        </li>
      </ul>

      <footer class="new-menu__foot">
        <span class="new-menu__foot-key">↑↓</span> navigate
        <span class="new-menu__foot-sep">·</span>
        <span class="new-menu__foot-key">⏎</span> pick
        <span class="new-menu__foot-sep">·</span>
        <span class="new-menu__foot-key">Esc</span> close
      </footer>
    </div>
  </transition>
</template>

<style scoped>
.new-menu {
  position: fixed;
  top: 68px;
  right: 20px;
  width: 320px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  box-shadow: 0 20px 44px -18px rgba(15, 23, 42, 0.28), 0 6px 12px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  z-index: 60;
}

.new-menu__eyebrow {
  padding: 12px 16px 4px;
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}

.new-menu__list {
  list-style: none;
  padding: 6px 8px 8px;
  margin: 0;
}
.new-menu__row {
  display: grid;
  grid-template-columns: 32px 1fr auto;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  align-items: center;
  transition: background-color 0.1s ease;
}
.new-menu__row.is-active { background: var(--color-accent-soft); }

.new-menu__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-graphite);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.new-menu__row.is-active .new-menu__icon {
  background: #fff;
  color: var(--color-accent-strong);
}

.new-menu__body { min-width: 0; }
.new-menu__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  line-height: 1.3;
}
.new-menu__hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  margin-top: 2px;
  line-height: 1.3;
}

.new-menu__kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  color: var(--color-fog);
  min-width: 18px;
  text-align: center;
}
.new-menu__row.is-active .new-menu__kbd {
  background: #fff;
  border-color: var(--color-hairline);
  color: var(--color-accent-strong);
}

.new-menu__foot {
  padding: 8px 14px;
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
  font-family: var(--font-body);
  font-size: 10px;
  color: var(--color-fog);
  display: flex;
  align-items: center;
  gap: 6px;
}
.new-menu__foot-key {
  font-family: var(--font-mono);
  padding: 1px 5px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid var(--color-hairline);
}
.new-menu__foot-sep { opacity: 0.5; }

.new-menu-fade-enter-active, .new-menu-fade-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.new-menu-fade-enter-from, .new-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 767px) {
  .new-menu {
    position: fixed;
    inset: auto 0 0 0;
    width: auto;
    max-width: 100%;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -20px 60px -20px rgba(15, 23, 42, 0.28);
    top: auto;
    right: 0;
  }
  .new-menu-fade-enter-from, .new-menu-fade-leave-to {
    opacity: 0;
    transform: translateY(24px);
  }
}
</style>
