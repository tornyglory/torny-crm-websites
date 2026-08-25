<script setup lang="ts">
import { computed } from 'vue'
import type { HeroProps } from '../types'

const props = defineProps<HeroProps>()

const bodyText = computed(() => props.description || props.subheading || '')
const showStats = computed(() => (props.stats?.length ?? 0) > 0)
</script>

<template>
  <section class="hero">
    <div class="hero__split">
      <div class="hero__col hero__col--text">
        <div v-if="eyebrow" class="hero__eyebrow">
          <span class="hero__eyebrow-dot" />
          <span class="hero__eyebrow-text">{{ eyebrow }}</span>
        </div>

        <h1 class="hero__heading">{{ heading }}</h1>

        <p v-if="bodyText" class="hero__body">{{ bodyText }}</p>

        <div v-if="primaryCta || secondaryCta" class="hero__ctas">
          <a v-if="primaryCta" :href="primaryCta.href" class="hero__cta-primary">
            <span>{{ primaryCta.label }}</span>
            <span aria-hidden="true">→</span>
          </a>
          <a v-if="secondaryCta" :href="secondaryCta.href" class="hero__cta-secondary">
            {{ secondaryCta.label }}
          </a>
        </div>

        <div v-if="showStats" class="hero__stats">
          <template v-for="(stat, i) in stats" :key="i">
            <div class="hero__stat">
              <div class="hero__stat-value">{{ stat.value }}</div>
              <div class="hero__stat-label">{{ stat.label }}</div>
            </div>
            <div v-if="i < (stats?.length ?? 0) - 1" class="hero__stat-divider" aria-hidden="true" />
          </template>
        </div>
      </div>

      <div class="hero__col hero__col--media" :class="{ 'hero__col--media-empty': !imageUrl }">
        <img v-if="imageUrl" :src="imageUrl" alt="" class="hero__media-image" />
        <div v-if="mediaCaption" class="hero__media-pill">
          <span class="hero__media-pill-dot" />
          <span>{{ mediaCaption }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  background: var(--color-ground);
  border-bottom: 1px solid var(--color-hairline);
  overflow: clip;
  /* Break out of the parent .page-blocks max-width and its 40px top padding
     so the hero spans the full viewport and sits flush under the site header. */
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  margin-top: -40px;
}

.hero__split {
  display: flex;
  min-height: 640px;
  /* Same padding formula as the site nav / footer / blocks so hero
     content aligns with everything else. Outer .hero still spans 100vw
     for the full-bleed background. */
  padding-inline: max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
}

.hero__col {
  flex: 1 1 50%;
  box-sizing: border-box;
}

.hero__col--text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 32px;
  /* No left padding — text sits flush with the site content edge (aligned
     with nav "Nae Nae Bowling Club" wordmark). Right padding gives the
     media column a bit of breathing room. */
  padding: 96px 96px 96px 0;
}

.hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.hero__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.hero__eyebrow-text {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 16px;
  text-transform: uppercase;
  color: var(--color-fog);
}

.hero__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 72px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
  max-width: 528px;
}

.hero__body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 19px;
  font-weight: var(--weight-regular);
  line-height: 155%;
  color: var(--color-graphite);
  max-width: 480px;
}

.hero__ctas {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.hero__cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 26px;
  background: var(--color-ink);
  color: var(--color-ground);
  border-radius: var(--btn-radius);
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.005em;
  line-height: 18px;
  text-decoration: none;
  transition: background-color 0.15s ease;
}
.hero__cta-primary:hover {
  background: var(--color-graphite);
}
.hero__cta-secondary {
  display: inline-flex;
  align-items: center;
  padding: 16px 4px;
  border-bottom: 1.5px solid var(--color-ink);
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: var(--weight-medium);
  letter-spacing: -0.005em;
  line-height: 18px;
  color: var(--color-ink);
  text-decoration: none;
}

.hero__stats {
  display: flex;
  align-items: flex-end;
  gap: 40px;
  margin-top: 16px;
  padding-top: 40px;
  border-top: 1px solid var(--color-hairline);
}
.hero__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hero__stat-value {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}
.hero__stat-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: var(--color-fog);
}
.hero__stat-divider {
  width: 1px;
  align-self: stretch;
  background: var(--color-hairline);
  flex-shrink: 0;
}

.hero__col--media {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 32px;
  background-image: linear-gradient(160deg, #B0E0E6 0%, #87CEEB 40%, #4A90A4 100%);
  overflow: hidden;
}
.hero__col--media-empty { }
.hero__media-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}
.hero__media-pill {
  position: relative;
  z-index: 1;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(10, 10, 11, 0.7);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: #fff;
  backdrop-filter: blur(4px);
}
.hero__media-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: #fff;
  flex-shrink: 0;
}

/* Large tablet: keep split, reduce padding. */
@media (max-width: 1279px) {
  .hero__col--text { padding: 80px 56px; gap: 28px; }
  .hero__heading { font-size: 64px; }
}

/* Below 1024px: stack. Text is unreadable in a half-column with a big heading. */
@media (max-width: 1023px) {
  .hero__split { flex-direction: column; min-height: 0; }
  .hero__col { flex: 1 1 auto; }
  .hero__col--media {
    order: -1;
    min-height: 320px;
    padding: 32px;
  }
  .hero__col--text {
    padding: 64px 40px;
    gap: 28px;
  }
  .hero__heading { font-size: 64px; max-width: none; }
  .hero__body { font-size: 18px; max-width: 640px; }
}

/* Mobile: tighter padding + smaller display heading. */
@media (max-width: 639px) {
  .hero__col--media { min-height: 240px; padding: 20px; }
  .hero__col--text { padding: 40px 20px 48px; gap: 20px; }
  .hero__heading { font-size: 40px; }
  .hero__body { font-size: 16px; }
  .hero__ctas { gap: 12px; }
  .hero__cta-primary,
  .hero__cta-secondary { padding-block: 12px; }
  .hero__cta-primary { padding-inline: 20px; }
  .hero__stats { gap: 20px; padding-top: 24px; margin-top: 8px; }
  .hero__stat-value { font-size: 24px; }
}
</style>
