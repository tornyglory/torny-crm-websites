<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { NavLink, SiteHeaderProps } from '../types'

const props = defineProps<SiteHeaderProps>()
const emit = defineEmits<{
  (e: 'toggle-drawer'): void
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

function isActive(href: string | undefined): boolean {
  if (!href) return false
  const path = props.currentPath
  if (!path) return false
  if (href === '/') return path === '/'
  return path === href || path.startsWith(href + '/')
}
function hasChildren(link: NavLink): boolean {
  return Array.isArray(link.children) && link.children.length > 0
}
function isBranchActive(link: NavLink): boolean {
  if (isActive(link.href)) return true
  return (link.children ?? []).some((c) => isActive(c.href))
}
function isExternal(link: NavLink): boolean {
  if (link.external !== undefined) return link.external
  return Boolean(link.href && /^https?:\/\//i.test(link.href))
}
function linkTarget(link: NavLink): string | undefined {
  return isExternal(link) ? '_blank' : undefined
}
function linkRel(link: NavLink): string | undefined {
  return isExternal(link) ? 'noopener' : undefined
}

// One dropdown open at a time; key by index so we don't need item ids.
const openIndex = ref<number | null>(null)
const rootRef = ref<HTMLElement | null>(null)

function toggleDropdown(i: number) {
  openIndex.value = openIndex.value === i ? null : i
}
function closeDropdown() {
  openIndex.value = null
}
function onDocClick(e: MouseEvent) {
  if (openIndex.value === null) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.site-header__item--has-children')) return
  closeDropdown()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && openIndex.value !== null) {
    e.preventDefault()
    closeDropdown()
  }
}
onMounted(() => {
  if (typeof document === 'undefined') return
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <header class="site-header">
    <a class="site-header__brand" :href="'/'">
      <span v-if="club.logoUrl" class="site-header__logo-wrap">
        <img :src="club.logoUrl" :alt="`${club.name} logo`" class="site-header__logo" />
      </span>
      <span v-else class="site-header__chip">{{ initials }}</span>
      <span class="site-header__brand-text">
        <span class="site-header__name">{{ club.name }}</span>
        <span v-if="club.strapline" class="site-header__strapline">{{ club.strapline }}</span>
      </span>
    </a>

    <nav ref="rootRef" class="site-header__nav" aria-label="Primary">
      <template v-for="(link, i) in navLinks" :key="link.label + (link.href ?? '')">
        <!-- Parent with dropdown -->
        <div
          v-if="hasChildren(link)"
          class="site-header__item site-header__item--has-children"
          :class="{ 'is-open': openIndex === i }"
        >
          <button
            type="button"
            class="site-header__link site-header__link--parent"
            :class="{ 'site-header__link--active': isBranchActive(link) }"
            :aria-expanded="openIndex === i ? 'true' : 'false'"
            :aria-haspopup="'true'"
            @click="toggleDropdown(i)"
          >
            <span>{{ link.label }}</span>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" class="site-header__chev">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div v-if="openIndex === i" class="site-header__dropdown" role="menu">
            <a
              v-for="child in link.children"
              :key="child.label + (child.href ?? '')"
              :href="child.href"
              :target="linkTarget(child)"
              :rel="linkRel(child)"
              class="site-header__dropdown-link"
              :class="{ 'is-active': isActive(child.href) }"
              role="menuitem"
              @click="closeDropdown"
            >{{ child.label }}</a>
          </div>
        </div>

        <!-- Leaf link -->
        <a
          v-else
          :href="link.href"
          :target="linkTarget(link)"
          :rel="linkRel(link)"
          class="site-header__link"
          :class="{ 'site-header__link--active': isActive(link.href) }"
        >
          {{ link.label }}
        </a>
      </template>
    </nav>

    <div class="site-header__actions">
      <a v-if="signInHref" :href="signInHref" class="site-header__sign-in">
        Members sign in
      </a>
      <a v-if="primaryCta" :href="primaryCta.href" class="site-header__cta">
        {{ primaryCta.label }}
        <span aria-hidden="true">→</span>
      </a>
      <button
        type="button"
        class="site-header__menu"
        :aria-expanded="drawerOpen ? 'true' : 'false'"
        aria-label="Open menu"
        @click="emit('toggle-drawer')"
      >
        <span class="site-header__menu-bar site-header__menu-bar--long" />
        <span class="site-header__menu-bar site-header__menu-bar--short" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 48px;
  border-bottom: 1px solid var(--color-hairline);
  background: var(--color-ground);
  font-family: var(--font-body);
}

.site-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}

.site-header__chip,
.site-header__logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.site-header__logo-wrap {
  background: transparent;
  overflow: visible;
}
.site-header__logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.site-header__brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.site-header__name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  color: var(--color-ink);
  line-height: 100%;
}
.site-header__strapline {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-fog);
}

.site-header__nav {
  display: flex;
  align-items: center;
  gap: 32px;
}
.site-header__item {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.site-header__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: 15px;
  font-weight: var(--weight-regular);
  letter-spacing: -0.005em;
  color: var(--color-graphite);
  text-decoration: none;
  cursor: pointer;
}
.site-header__link:hover { color: var(--color-ink); }
.site-header__link--active {
  color: var(--color-ink);
  font-weight: var(--weight-medium);
}
.site-header__link--parent { padding-right: 2px; }
.site-header__chev {
  transition: transform 0.15s ease;
  color: var(--color-fog);
}
.site-header__item.is-open .site-header__chev {
  transform: rotate(180deg);
  color: var(--color-ink);
}

/* Dropdown panel */
.site-header__dropdown {
  position: absolute;
  top: calc(100% + 12px);
  left: -12px;
  min-width: 220px;
  padding: 8px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  box-shadow: 0 12px 32px -12px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 30;
}
.site-header__dropdown::before {
  /* Bridge the visual gap so hover-crossing to the dropdown doesn't lose click focus. */
  content: '';
  position: absolute;
  top: -12px;
  left: 0;
  right: 0;
  height: 12px;
}
.site-header__dropdown-link {
  padding: 8px 12px;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-regular);
  color: var(--color-graphite);
  text-decoration: none;
  white-space: nowrap;
}
.site-header__dropdown-link:hover {
  background: var(--color-surface);
  color: var(--color-ink);
}
.site-header__dropdown-link.is-active {
  background: var(--color-surface);
  color: var(--color-ink);
  font-weight: var(--weight-medium);
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.site-header__sign-in {
  font-size: 15px;
  font-weight: var(--weight-medium);
  letter-spacing: -0.005em;
  color: var(--color-graphite);
  text-decoration: none;
}

.site-header__cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-ink);
  color: var(--color-ground);
  font-size: 14px;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.005em;
  border-radius: var(--radius-pill);
  text-decoration: none;
}

.site-header__menu {
  display: none;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 5px;
  width: 40px;
  height: 40px;
  padding: 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  background: var(--color-ground);
  cursor: pointer;
}
.site-header__menu-bar {
  display: block;
  height: 1.5px;
  background: var(--color-ink);
  border-radius: var(--radius-pill);
}
.site-header__menu-bar--long {
  width: 16px;
}
.site-header__menu-bar--short {
  width: 12px;
}

/* Below 1200px (tablet + mobile): hide desktop nav + sign-in + CTA, show
   hamburger. 6 nav links + sign-in + CTA + brand won't fit comfortably
   below ~1200px, and a hamburger reads better on tablets anyway. */
@media (max-width: 1199px) {
  .site-header {
    padding: 20px 32px;
  }
  .site-header__nav,
  .site-header__sign-in,
  .site-header__cta {
    display: none;
  }
  .site-header__menu {
    display: flex;
  }
}

/* Phone: tighten padding + logo. */
@media (max-width: 639px) {
  .site-header {
    padding: 16px 20px;
  }
  .site-header__chip,
  .site-header__logo-wrap {
    width: 32px;
    height: 32px;
    font-size: 10px;
  }
  .site-header__name {
    font-size: 15px;
  }
  .site-header__strapline {
    display: none;
  }
}
</style>
