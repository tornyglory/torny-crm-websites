<script setup lang="ts">
import { computed } from 'vue'
import type { SiteFooterProps } from '../types'

const props = withDefaults(defineProps<SiteFooterProps>(), {
  poweredBy: true,
})

const initials = computed(() => {
  if (props.club.initials) return props.club.initials
  return props.club.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
})

const year = new Date().getFullYear()
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__top">
      <div class="site-footer__brand-col">
        <div class="site-footer__brand">
          <span v-if="club.logoUrl" class="site-footer__logo-wrap">
            <img :src="club.logoUrl" :alt="`${club.name} logo`" class="site-footer__logo" />
          </span>
          <span v-else class="site-footer__chip">{{ initials }}</span>
          <div class="site-footer__brand-text">
            <span class="site-footer__name">{{ club.name }}</span>
            <span v-if="club.strapline" class="site-footer__strapline">{{ club.strapline }}</span>
          </div>
        </div>
        <p v-if="description" class="site-footer__description">{{ description }}</p>

        <div v-if="socials && socials.length" class="site-footer__socials">
          <a
            v-for="social in socials"
            :key="social.icon + social.href"
            :href="social.href"
            :aria-label="social.label"
            class="site-footer__social"
          >
            <svg v-if="social.icon === 'instagram'" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="14" height="14" rx="4" stroke="currentColor" stroke-width="1.3" />
              <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3" />
              <circle cx="11.5" cy="4.5" r="0.75" fill="currentColor" />
            </svg>
            <svg v-else-if="social.icon === 'facebook'" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M9.5 15V9H11.5L12 6.5H9.5V5C9.5 4.4 9.9 4 10.5 4H12V1.5C11.5 1.4 10.7 1.3 9.9 1.3C8.1 1.3 6.9 2.4 6.9 4.6V6.5H4.5V9H6.9V15H9.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            </svg>
            <svg v-else-if="social.icon === 'twitter'" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L7 8.5L2 14H3.5L7.7 9.4L11 14H14L8.7 7.1L13.6 2H12.1L8.1 6.3L5 2H2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M14 3H2C1.4 3 1 3.4 1 4V12C1 12.6 1.4 13 2 13H14C14.6 13 15 12.6 15 12V4C15 3.4 14.6 3 14 3Z" stroke="currentColor" stroke-width="1.3" />
              <path d="M1.5 3.5L8 8.5L14.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <div
        v-for="column in columns"
        :key="column.heading"
        class="site-footer__col"
      >
        <div class="site-footer__col-heading">{{ column.heading }}</div>
        <a
          v-for="link in column.links"
          :key="link.href"
          :href="link.href"
          class="site-footer__link"
        >{{ link.label }}</a>
      </div>

      <div v-if="contact" class="site-footer__col">
        <div class="site-footer__col-heading">Find us</div>
        <div v-if="contact.addressLines?.length" class="site-footer__contact-block">
          <div
            v-for="(line, i) in contact.addressLines"
            :key="i"
            :class="i === 0 ? 'site-footer__contact-primary' : 'site-footer__contact-secondary'"
          >
            {{ line }}
          </div>
        </div>
        <div v-if="contact.email || contact.phone" class="site-footer__contact-block">
          <a v-if="contact.email" :href="`mailto:${contact.email}`" class="site-footer__contact-primary">{{ contact.email }}</a>
          <a v-if="contact.phone" :href="`tel:${contact.phone.replace(/\s+/g, '')}`" class="site-footer__contact-primary">{{ contact.phone }}</a>
        </div>
        <div v-if="contact.status" class="site-footer__status">
          <span class="site-footer__status-dot" />
          <span>{{ contact.status }}</span>
        </div>
      </div>
    </div>

    <div class="site-footer__bottom">
      <div class="site-footer__legal">
        <span>© {{ year }} {{ club.name }}</span>
        <template v-if="legalLinks && legalLinks.length">
          <span class="site-footer__legal-sep" aria-hidden="true" />
          <a
            v-for="link in legalLinks"
            :key="link.href"
            :href="link.href"
            class="site-footer__legal-link"
          >{{ link.label }}</a>
        </template>
      </div>
      <div v-if="poweredBy" class="site-footer__powered">
        <span class="site-footer__powered-label">Powered by</span>
        <span class="site-footer__powered-mark">
          <span class="site-footer__powered-dot" />
          <span>Torny</span>
        </span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  background: var(--color-ink);
  color: var(--color-ground);
  font-family: var(--font-body);
}

.site-footer__top {
  display: flex;
  gap: 80px;
  padding: 80px 96px 56px;
}

.site-footer__brand-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 380px;
  flex-shrink: 0;
}

.site-footer__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.site-footer__chip,
.site-footer__logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.site-footer__logo-wrap {
  background: transparent;
  overflow: visible;
}
.site-footer__logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.site-footer__brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.site-footer__name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  color: var(--color-ground);
  line-height: 100%;
}
.site-footer__strapline {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}

.site-footer__description {
  margin: 0;
  font-size: 15px;
  line-height: 155%;
  color: rgba(255, 255, 255, 0.65);
  max-width: 340px;
}

.site-footer__socials {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.site-footer__social {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
}

.site-footer__col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}
.site-footer__col-heading {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  padding-bottom: 8px;
}
.site-footer__link {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
}

.site-footer__contact-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.site-footer__contact-block + .site-footer__contact-block {
  padding-top: 8px;
}
.site-footer__contact-primary {
  font-size: 15px;
  color: var(--color-ground);
  text-decoration: none;
}
.site-footer__contact-secondary {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
}
.site-footer__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.9);
  align-self: flex-start;
  margin-top: 8px;
}
.site-footer__status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: #22c55e;
}

.site-footer__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 96px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.site-footer__legal {
  display: flex;
  align-items: center;
  gap: 20px;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.5);
}
.site-footer__legal-sep {
  width: 3px;
  height: 3px;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.3);
}
.site-footer__legal-link {
  font-family: var(--font-body);
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  text-decoration: none;
}

.site-footer__powered {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.site-footer__powered-label {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.4);
}
.site-footer__powered-mark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-ground);
}
.site-footer__powered-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}

/* Tablet: stack contact under nav columns. */
@media (max-width: 1023px) {
  .site-footer__top {
    flex-wrap: wrap;
    gap: 40px;
    padding: 64px 32px 40px;
  }
  .site-footer__brand-col {
    width: 100%;
  }
  .site-footer__col {
    min-width: 45%;
  }
  .site-footer__bottom {
    padding: 24px 32px;
  }
}

/* Mobile: single column. */
@media (max-width: 639px) {
  .site-footer__top {
    flex-direction: column;
    padding: 48px 20px 32px;
    gap: 32px;
  }
  .site-footer__col {
    min-width: 0;
  }
  .site-footer__bottom {
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
  }
  .site-footer__legal {
    flex-wrap: wrap;
    gap: 12px;
  }
}
</style>
