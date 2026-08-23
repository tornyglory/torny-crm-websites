<script setup lang="ts">
import { computed } from 'vue'
import type { FeatureGridProps } from '../types'

const props = withDefaults(defineProps<FeatureGridProps>(), {
  columns: 4,
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
}))
</script>

<template>
  <section class="fg">
    <div v-if="eyebrow || heading" class="fg__head">
      <div v-if="eyebrow" class="fg__eyebrow">
        <span class="fg__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>
      <h2 v-if="heading" class="fg__heading">{{ heading }}</h2>
    </div>

    <div class="fg__grid" :style="gridStyle">
      <article v-for="(item, i) in items" :key="i" class="fg__card">
        <span v-if="item.icon" class="fg__icon" :class="`fg__icon--${item.iconTone ?? 'accent'}`">
          <!-- inline SVG per icon -->
          <svg v-if="item.icon === 'target'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.5" />
            <circle cx="12" cy="12" r="1" fill="currentColor" />
          </svg>
          <svg v-else-if="item.icon === 'people'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 20C4 16.5 6.5 14 10 14H14C17.5 14 20 16.5 20 20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5" />
          </svg>
          <svg v-else-if="item.icon === 'star'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L14 9H20L15 12.5L17 19L12 15L7 19L9 12.5L4 9H10L12 3Z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          <svg v-else-if="item.icon === 'calendar'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 6H20V18H4V6Z" stroke="currentColor" stroke-width="1.5" />
            <path d="M4 10H20" stroke="currentColor" stroke-width="1.5" />
            <path d="M9 6V4M15 6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <svg v-else-if="item.icon === 'trophy'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M8 5H16V10C16 12.2 14.2 14 12 14C9.8 14 8 12.2 8 10V5Z" stroke="currentColor" stroke-width="1.5" />
            <path d="M5 5H8V8C8 8 5 8 5 6V5Z" stroke="currentColor" stroke-width="1.5" />
            <path d="M19 5H16V8C16 8 19 8 19 6V5Z" stroke="currentColor" stroke-width="1.5" />
            <path d="M12 14V17M9 20H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <svg v-else-if="item.icon === 'sparkle'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 4L13.5 10.5L20 12L13.5 13.5L12 20L10.5 13.5L4 12L10.5 10.5L12 4Z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          <svg v-else-if="item.icon === 'coffee'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 8H16V14C16 16.2 14.2 18 12 18H8C5.8 18 4 16.2 4 14V8Z" stroke="currentColor" stroke-width="1.5" />
            <path d="M16 10H18C19.1 10 20 10.9 20 12C20 13.1 19.1 14 18 14H16" stroke="currentColor" stroke-width="1.5" />
            <path d="M7 3V5M10 3V5M13 3V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
          <svg v-else-if="item.icon === 'bolt'" width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M13 3L4 14H11L10 21L20 10H13V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </span>

        <h3 class="fg__title">{{ item.title }}</h3>
        <p v-if="item.body" class="fg__body">{{ item.body }}</p>

        <a v-if="item.linkLabel && item.linkHref" :href="item.linkHref" class="fg__link">
          <span>{{ item.linkLabel }}</span>
          <span aria-hidden="true">→</span>
        </a>
      </article>
    </div>
  </section>
</template>

<style scoped>
.fg {
  padding: 96px;
  display: flex;
  flex-direction: column;
  gap: 56px;
  background: var(--color-ground);
}

.fg__head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}
.fg__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 16px;
  text-transform: uppercase;
  color: var(--color-fog);
}
.fg__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.fg__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}

.fg__grid {
  display: grid;
  gap: 24px;
}

.fg__card {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 32px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
}

.fg__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  flex-shrink: 0;
}
.fg__icon--accent { background: var(--color-accent-soft); color: var(--color-accent); }
.fg__icon--mint { background: #DCFCE7; color: var(--color-feature-mint); }
.fg__icon--tangerine { background: #FED7AA; color: var(--color-feature-tangerine); }
.fg__icon--violet { background: #EDE9FE; color: var(--color-feature-violet); }
.fg__icon--sky { background: #E0F2FE; color: #0369A1; }
.fg__icon--amber { background: #FEF3C7; color: #B45309; }

.fg__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: 28px;
  color: var(--color-ink);
}
.fg__body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 155%;
  color: var(--color-graphite);
}

.fg__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-top: 12px;
  margin-top: auto;
  border-top: 1px solid var(--color-hairline);
  align-self: flex-start;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: var(--weight-medium);
  line-height: 16px;
  color: var(--color-ink);
  text-decoration: none;
}
.fg__link > span:first-child {
  border-bottom: 1.5px solid var(--color-ink);
  padding-bottom: 2px;
}

@media (max-width: 1023px) {
  .fg { padding: 72px 40px; gap: 40px; }
  .fg__grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .fg__heading { font-size: 36px; }
}
@media (max-width: 639px) {
  .fg { padding: 48px 20px; }
  .fg__grid { grid-template-columns: 1fr !important; }
  .fg__card { padding: 24px; }
}
</style>
