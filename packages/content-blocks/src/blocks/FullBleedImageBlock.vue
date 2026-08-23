<script setup lang="ts">
import { computed } from 'vue'
import type { FullBleedImageProps } from '../types'

const props = withDefaults(defineProps<FullBleedImageProps>(), {
  overlayOpacity: 0.35,
})

const overlayStyle = computed(() => ({
  background: `rgba(10, 10, 11, ${props.overlayOpacity})`,
}))
</script>

<template>
  <section class="fbi">
    <img v-if="imageUrl" :src="imageUrl" alt="" class="fbi__image" />
    <div class="fbi__overlay" :style="overlayStyle" />

    <div v-if="topBadge" class="fbi__top-badge" :class="`fbi__top-badge--${topBadge.tone ?? 'green'}`">
      <span class="fbi__badge-dot" />
      <span>{{ topBadge.label }}</span>
    </div>

    <div class="fbi__body">
      <div v-if="eyebrow" class="fbi__eyebrow">{{ eyebrow }}</div>
      <h2 class="fbi__heading">{{ heading }}</h2>
      <p v-if="subheading" class="fbi__sub">{{ subheading }}</p>
      <a v-if="cta" :href="cta.href" class="fbi__cta">
        <span>{{ cta.label }}</span>
        <span aria-hidden="true">→</span>
      </a>
    </div>

    <div v-if="bottomCaption" class="fbi__bottom-caption">{{ bottomCaption }}</div>
  </section>
</template>

<style scoped>
.fbi {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  min-height: 720px;
  padding: 96px 32px;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  overflow: hidden;
  color: #fff;
  background: linear-gradient(160deg, #C05A2C 0%, #9B3F1C 45%, #7A2E10 100%);
}
.fbi__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}
.fbi__overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.fbi__eyebrow,
.fbi__heading,
.fbi__sub,
.fbi__cta {
  position: relative;
  z-index: 2;
}

.fbi__top-badge,
.fbi__bottom-caption {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  background: rgba(10, 10, 11, 0.7);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  backdrop-filter: blur(4px);
}
.fbi__top-badge { top: 32px; left: 32px; }
.fbi__bottom-caption { bottom: 32px; left: 32px; }

.fbi__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.fbi__top-badge--green .fbi__badge-dot { background: #16A34A; }
.fbi__top-badge--blue .fbi__badge-dot { background: #2563EB; }
.fbi__top-badge--amber .fbi__badge-dot { background: #FDB94E; }

.fbi__body {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  text-align: center;
}

.fbi__eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
}

.fbi__heading {
  margin: 0;
  max-width: 1000px;
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: #fff;
}

.fbi__sub {
  margin: 0;
  max-width: 680px;
  font-family: var(--font-body);
  font-size: 18px;
  line-height: 155%;
  color: rgba(255, 255, 255, 0.85);
}

.fbi__cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 16px 26px;
  background: var(--color-ground);
  color: var(--color-ink);
  border-radius: var(--radius-pill);
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: var(--weight-semibold);
  line-height: 18px;
  text-decoration: none;
  margin-top: 8px;
}

@media (max-width: 1023px) {
  .fbi { min-height: 560px; padding: 72px 32px; }
  .fbi__heading { font-size: 56px; }
}
@media (max-width: 639px) {
  .fbi { min-height: 460px; padding: 56px 20px; }
  .fbi__body { gap: 20px; }
  .fbi__heading { font-size: 36px; }
  .fbi__sub { font-size: 16px; }
  .fbi__top-badge, .fbi__bottom-caption { top: auto; bottom: 20px; left: 20px; }
  .fbi__top-badge { top: 20px; bottom: auto; }
}
</style>
