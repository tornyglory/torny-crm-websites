<script setup lang="ts">
import { computed } from 'vue'
import type { SectionTitleProps } from '../types'

const props = withDefaults(defineProps<SectionTitleProps>(), {
  align: 'center',
})

const alignClass = computed(() => (props.align === 'left' ? 'st--left' : 'st--center'))
</script>

<template>
  <section class="st" :class="alignClass">
    <div class="st__inner">
      <div v-if="eyebrow" class="st__eyebrow">
        <span class="st__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>
      <h2 class="st__heading">{{ heading }}</h2>
      <p v-if="body" class="st__body">{{ body }}</p>
    </div>
  </section>
</template>

<style scoped>
.st {
  /* Same shared padding formula so content edges align with nav / footer /
     other blocks on any viewport. Outer background stays full-viewport. */
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 128px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
}

.st__inner {
  display: flex;
  flex-direction: column;
  gap: 40px;
  max-width: var(--container-content);
  margin: 0 auto;
}
.st--center .st__inner { align-items: center; text-align: center; }
.st--left .st__inner { align-items: flex-start; text-align: left; }

.st__eyebrow {
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
.st__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}

.st__heading {
  margin: 0;
  max-width: 960px;
  font-family: var(--font-display);
  font-size: 80px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}

.st__body {
  margin: 0;
  max-width: 640px;
  font-family: var(--font-body);
  font-size: 19px;
  line-height: 160%;
  color: var(--color-fog);
}

@media (max-width: 1023px) {
  .st { padding: 96px 40px; }
  .st__heading { font-size: 56px; }
  .st__body { font-size: 17px; }
}
@media (max-width: 639px) {
  .st { padding: 64px 20px; }
  .st__inner { gap: 24px; }
  .st__heading { font-size: 36px; line-height: 105%; }
  .st__body { font-size: 16px; }
}
</style>
