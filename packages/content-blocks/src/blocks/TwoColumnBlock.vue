<script setup lang="ts">
import { computed } from 'vue'
import type { TwoColumnProps } from '../types'

const props = withDefaults(defineProps<TwoColumnProps>(), {
  background: 'surface',
})

const bgClass = computed(() => (props.background === 'ground' ? 'tc--bg-ground' : 'tc--bg-surface'))

function toneClass(tone: string | undefined): string {
  return `tc__col-eyebrow--${tone ?? 'accent'}`
}
</script>

<template>
  <section class="tc" :class="bgClass">
    <div v-if="eyebrow || heading" class="tc__head">
      <div v-if="eyebrow" class="tc__eyebrow">
        <span class="tc__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>
      <h2 v-if="heading" class="tc__heading">{{ heading }}</h2>
    </div>

    <div class="tc__grid">
      <div class="tc__col">
        <div v-if="columns[0].eyebrow" class="tc__col-eyebrow" :class="toneClass(columns[0].eyebrowTone)">
          {{ columns[0].eyebrow }}
        </div>
        <h3 v-if="columns[0].heading" class="tc__col-heading">{{ columns[0].heading }}</h3>
        <p v-for="(p, i) in columns[0].bodyParagraphs" :key="`a-${i}`" class="tc__col-body">{{ p }}</p>
      </div>

      <div class="tc__divider" aria-hidden="true" />

      <div class="tc__col">
        <div v-if="columns[1].eyebrow" class="tc__col-eyebrow" :class="toneClass(columns[1].eyebrowTone)">
          {{ columns[1].eyebrow }}
        </div>
        <h3 v-if="columns[1].heading" class="tc__col-heading">{{ columns[1].heading }}</h3>
        <p v-for="(p, i) in columns[1].bodyParagraphs" :key="`b-${i}`" class="tc__col-body">{{ p }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tc {
  display: flex;
  flex-direction: column;
  gap: 48px;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
}
.tc--bg-surface { background: var(--color-surface); }
.tc--bg-ground { background: var(--color-ground); }

.tc__head { display: flex; flex-direction: column; gap: 16px; }
.tc__eyebrow {
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
.tc__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.tc__heading {
  margin: 0;
  max-width: 800px;
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-heading);
  color: var(--color-ink);
}

.tc__grid {
  display: flex;
  gap: 48px;
}
.tc__col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.tc__divider {
  align-self: stretch;
  width: 1px;
  background: var(--color-hairline);
  flex-shrink: 0;
}

.tc__col-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
}
.tc__col-eyebrow--accent { color: var(--color-accent-strong); }
.tc__col-eyebrow--amber { color: #92400E; }
.tc__col-eyebrow--mint { color: #14532D; }
.tc__col-eyebrow--violet { color: #5B21B6; }
.tc__col-eyebrow--danger { color: #991B1B; }

.tc__col-heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: 30px;
  color: var(--color-ink);
}
.tc__col-body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 160%;
  color: var(--color-graphite);
}

@media (max-width: 1023px) {
  .tc { padding: 72px 32px; gap: 32px; }
  .tc__grid { flex-direction: column; gap: 32px; }
  .tc__divider { width: 100%; height: 1px; }
  .tc__heading { font-size: 36px; }
}
@media (max-width: 639px) {
  .tc { padding: 48px 20px; }
  .tc__heading { font-size: 28px; }
}
</style>
