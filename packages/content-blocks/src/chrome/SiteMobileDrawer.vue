<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import type { NavLink, SiteChromeClub } from '../types'

interface Props {
  open: boolean
  club: SiteChromeClub
  navLinks: NavLink[]
  currentPath?: string
  sectionLabel?: string
  signInHref?: string
  primaryCta?: { label: string; href: string }
}

const props = withDefaults(defineProps<Props>(), {
  sectionLabel: 'Explore',
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const initials = computed(() => {
  if (props.club.initials) return props.club.initials
  return props.club.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
})

function isActive(href: string) {
  const path = props.currentPath
  if (!path) return false
  if (href === '/') return path === '/'
  return path === href || path.startsWith(href + '/')
}

// Lock body scroll while open; close on Escape.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKey)
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  },
)
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Transition name="drawer">
    <div
      v-if="open"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
    >
      <div class="drawer__topbar">
        <a class="drawer__brand" :href="'/'" @click="emit('close')">
          <span v-if="club.logoUrl" class="drawer__logo-wrap">
            <img :src="club.logoUrl" :alt="`${club.name} logo`" class="drawer__logo" />
          </span>
          <span v-else class="drawer__chip">{{ initials }}</span>
          <span class="drawer__name">{{ club.name }}</span>
        </a>
        <button
          type="button"
          class="drawer__close"
          aria-label="Close menu"
          @click="emit('close')"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M1 1L13 13M13 1L1 13"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <nav class="drawer__body" aria-label="Primary">
        <div class="drawer__section-label">{{ sectionLabel }}</div>
        <a
          v-for="link in navLinks"
          :key="link.href"
          :href="link.href"
          class="drawer__link"
          :class="{ 'drawer__link--active': isActive(link.href) }"
          @click="emit('close')"
        >
          <span class="drawer__link-label">{{ link.label }}</span>
          <span v-if="link.badge" class="drawer__badge">{{ link.badge }}</span>
          <span v-else class="drawer__arrow" aria-hidden="true">↗</span>
        </a>
      </nav>

      <div v-if="primaryCta || signInHref" class="drawer__footer">
        <a v-if="primaryCta" :href="primaryCta.href" class="drawer__cta">
          {{ primaryCta.label }}
        </a>
        <a v-if="signInHref" :href="signInHref" class="drawer__sign-in">
          Members sign in
        </a>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--color-ground);
  font-family: var(--font-body);
}

.drawer__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-hairline);
}
.drawer__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.drawer__chip,
.drawer__logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.drawer__logo-wrap {
  background: transparent;
  overflow: hidden;
}
.drawer__logo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.drawer__name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  color: var(--color-ink);
}

.drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: var(--color-ink);
  color: var(--color-ground);
  cursor: pointer;
}

.drawer__body {
  display: flex;
  flex-direction: column;
  padding: 24px 20px 32px;
  gap: 4px;
  overflow-y: auto;
}
.drawer__section-label {
  padding: 12px 4px 8px;
  font-family: var(--font-mono);
  font-size: var(--text-label);
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-fog);
}
.drawer__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px;
  border-radius: var(--radius-md);
  color: var(--color-graphite);
  text-decoration: none;
}
.drawer__link--active {
  background: var(--color-surface);
  color: var(--color-ink);
}
.drawer__link-label {
  font-family: var(--font-display);
  font-size: var(--text-title-sm);
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-tight);
}
.drawer__link--active .drawer__link-label {
  font-weight: var(--weight-semibold);
}
.drawer__arrow {
  font-size: 14px;
  color: var(--color-mute);
}
.drawer__link--active .drawer__arrow {
  color: var(--color-fog);
}
.drawer__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: var(--radius-pill);
}

.drawer__footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 20px;
  margin-top: auto;
  border-top: 1px solid var(--color-hairline);
}
.drawer__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  background: var(--color-ink);
  color: var(--color-ground);
  font-size: 15px;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.005em;
  border-radius: var(--radius-pill);
  text-decoration: none;
}
.drawer__sign-in {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 14px 24px;
  color: var(--color-ink);
  font-size: 14px;
  font-weight: var(--weight-medium);
  letter-spacing: -0.005em;
  text-decoration: none;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
