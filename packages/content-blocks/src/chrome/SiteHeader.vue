<script setup lang="ts">
import { computed } from 'vue'
import type { SiteHeaderProps } from '../types'

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

function isActive(href: string) {
  const path = props.currentPath
  if (!path) return false
  if (href === '/') return path === '/'
  return path === href || path.startsWith(href + '/')
}
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

    <nav class="site-header__nav" aria-label="Primary">
      <a
        v-for="link in navLinks"
        :key="link.href"
        :href="link.href"
        class="site-header__link"
        :class="{ 'site-header__link--active': isActive(link.href) }"
      >
        {{ link.label }}
      </a>
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
  overflow: hidden;
}
.site-header__logo {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
.site-header__link {
  font-size: 15px;
  font-weight: var(--weight-regular);
  letter-spacing: -0.005em;
  color: var(--color-graphite);
  text-decoration: none;
}
.site-header__link--active {
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
