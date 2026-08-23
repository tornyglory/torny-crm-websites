<script setup lang="ts">
import { computed } from 'vue'
import type { MediaSplitProps } from '../types'

const props = withDefaults(defineProps<MediaSplitProps>(), {
  mediaSide: 'left',
  background: 'ground',
})

const orderClass = computed(() => (props.mediaSide === 'right' ? 'ms--media-right' : 'ms--media-left'))
const bgClass = computed(() => (props.background === 'surface' ? 'ms--bg-surface' : 'ms--bg-ground'))
</script>

<template>
  <section class="ms" :class="[orderClass, bgClass]">
    <div class="ms__media">
      <img v-if="imageUrl" :src="imageUrl" alt="" class="ms__media-image" />
      <div v-if="topBadge" class="ms__badge" :class="`ms__badge--${topBadge.tone ?? 'ink'}`">
        <span class="ms__badge-dot" />
        <span>{{ topBadge.label }}</span>
      </div>
      <div v-if="mediaCaption" class="ms__caption">
        <span class="ms__caption-dot" />
        <span>{{ mediaCaption }}</span>
      </div>
    </div>

    <div class="ms__text">
      <div v-if="eyebrow" class="ms__eyebrow">
        <span class="ms__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>

      <h2 class="ms__heading">{{ heading }}</h2>

      <p
        v-for="(para, i) in bodyParagraphs"
        :key="i"
        class="ms__body"
      >{{ para }}</p>

      <ul v-if="checklist && checklist.length" class="ms__checklist">
        <li v-for="(item, i) in checklist" :key="i" class="ms__check">
          <span class="ms__check-dot" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 5L3.75 7.25L8.5 2.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span>{{ item }}</span>
        </li>
      </ul>

      <div v-if="primaryCta || secondaryCta || secondaryText" class="ms__ctas">
        <a v-if="primaryCta" :href="primaryCta.href" class="ms__cta-primary">
          <span>{{ primaryCta.label }}</span>
          <span aria-hidden="true">→</span>
        </a>
        <a v-if="secondaryCta" :href="secondaryCta.href" class="ms__cta-secondary">
          {{ secondaryCta.label }}
        </a>
        <span v-else-if="secondaryText" class="ms__secondary-text">{{ secondaryText }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ms {
  display: flex;
  align-items: center;
  gap: 80px;
  padding: 96px;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
}
.ms--bg-ground { background: var(--color-ground); }
.ms--bg-surface { background: var(--color-surface); }

.ms--media-right { flex-direction: row-reverse; }

.ms__media {
  position: relative;
  flex-shrink: 0;
  width: 560px;
  height: 480px;
  border-radius: 24px;
  overflow: hidden;
  background: linear-gradient(160deg, #B0E0E6 0%, #87CEEB 60%, #4A90A4 100%);
}
.ms__media-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ms__caption,
.ms__badge {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  backdrop-filter: blur(4px);
}
.ms__caption {
  bottom: 20px;
  left: 20px;
  background: rgba(10, 10, 11, 0.7);
  color: #fff;
}
.ms__caption-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: #fff;
  flex-shrink: 0;
}

.ms__badge {
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.95);
  padding: 5px 12px;
  font-size: 10px;
  line-height: 12px;
}
.ms__badge-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}
.ms__badge--green { color: #14532D; }
.ms__badge--green .ms__badge-dot { background: #16A34A; }
.ms__badge--blue { color: #1E3A8A; }
.ms__badge--blue .ms__badge-dot { background: #2563EB; }
.ms__badge--amber { color: #78350F; }
.ms__badge--amber .ms__badge-dot { background: #F59E0B; }
.ms__badge--ink { color: #fff; background: rgba(10, 10, 11, 0.7); }
.ms__badge--ink .ms__badge-dot { background: #fff; }

.ms__text {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.ms__eyebrow {
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
.ms__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}

.ms__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-heading);
  color: var(--color-ink);
}

.ms__body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 160%;
  color: var(--color-graphite);
}

.ms__checklist {
  list-style: none;
  padding: 20px 0;
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--color-hairline);
  border-bottom: 1px solid var(--color-hairline);
}
.ms__check {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 18px;
  color: var(--color-graphite);
}
.ms__check-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}

.ms__ctas {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.ms__cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  background: var(--color-ink);
  color: var(--color-ground);
  border-radius: var(--btn-radius);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-semibold);
  line-height: 18px;
  text-decoration: none;
  transition: background-color 0.15s ease;
}
.ms__cta-primary:hover { background: var(--color-graphite); }
.ms__cta-secondary {
  display: inline-flex;
  align-items: center;
  padding-bottom: 2px;
  border-bottom: 1.5px solid var(--color-ink);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-medium);
  line-height: 18px;
  color: var(--color-ink);
  text-decoration: none;
}
.ms__secondary-text {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 18px;
  color: var(--color-ink);
}

@media (max-width: 1023px) {
  .ms { flex-direction: column; padding: 64px 32px; gap: 40px; }
  .ms--media-right { flex-direction: column; }
  .ms__media { width: 100%; height: 360px; }
  .ms__heading { font-size: 36px; }
}
@media (max-width: 639px) {
  .ms { padding: 40px 20px; gap: 28px; }
  .ms__media { height: 260px; border-radius: 16px; }
  .ms__heading { font-size: 30px; }
  .ms__body { font-size: 16px; }
}
</style>
