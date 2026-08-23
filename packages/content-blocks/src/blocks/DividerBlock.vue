<script setup lang="ts">
import { computed } from 'vue'
import type { DividerProps } from '../types'

const props = withDefaults(defineProps<DividerProps>(), {
  variant: 'hairline',
  height: 64,
})

const spacerStyle = computed(() => ({ height: `${props.height}px` }))
</script>

<template>
  <div class="dv" :data-variant="variant">
    <div v-if="variant === 'hairline'" class="dv__line" aria-hidden="true" />

    <div v-else-if="variant === 'label'" class="dv__label-row">
      <div class="dv__line-flex" aria-hidden="true" />
      <div class="dv__label">{{ label || 'Section break' }}</div>
      <div class="dv__line-flex" aria-hidden="true" />
    </div>

    <div v-else-if="variant === 'dots'" class="dv__dots-row">
      <div class="dv__stub" aria-hidden="true" />
      <span class="dv__dot dv__dot--accent" aria-hidden="true" />
      <span class="dv__dot" aria-hidden="true" />
      <span class="dv__dot" aria-hidden="true" />
      <div class="dv__stub" aria-hidden="true" />
    </div>

    <div v-else-if="variant === 'spacer'" class="dv__spacer" :style="spacerStyle" aria-hidden="true" />
  </div>
</template>

<style scoped>
.dv {
  padding: 40px 96px;
  background: var(--color-ground);
}

.dv__line {
  height: 1px;
  background: var(--color-hairline);
}

.dv__label-row {
  display: flex;
  align-items: center;
  gap: 24px;
}
.dv__line-flex {
  flex: 1 1 0;
  height: 1px;
  background: var(--color-hairline);
}
.dv__label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: var(--color-fog);
}

.dv__dots-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.dv__stub { width: 32px; height: 1px; background: var(--color-hairline); flex-shrink: 0; }
.dv__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-mute);
  flex-shrink: 0;
}
.dv__dot--accent { background: var(--color-accent); }

.dv__spacer { width: 100%; }

@media (max-width: 639px) {
  .dv { padding: 24px 20px; }
}
</style>
