<script setup lang="ts">
import type { TimelineProps } from '../types'

defineProps<TimelineProps>()

function yearToneClass(tone: string | undefined): string {
  return `tl__year-label--${tone ?? 'default'}`
}
</script>

<template>
  <section class="tl">
    <div v-if="eyebrow || heading" class="tl__head">
      <div v-if="eyebrow" class="tl__eyebrow">
        <span class="tl__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>
      <h2 v-if="heading" class="tl__heading">{{ heading }}</h2>
    </div>

    <div class="tl__list">
      <div
        v-for="(entry, i) in entries"
        :key="i"
        class="tl__row"
        :class="{ 'tl__row--highlight': entry.highlighted }"
      >
        <div class="tl__year">
          <div class="tl__year-value">{{ entry.year }}</div>
          <div v-if="entry.yearLabel" :class="['tl__year-label', yearToneClass(entry.yearTone)]">
            <span v-if="entry.yearTone === 'accent'" class="tl__year-label-dot" />
            <span>{{ entry.yearLabel }}</span>
          </div>
        </div>

        <div class="tl__body">
          <div class="tl__title">{{ entry.title }}</div>
          <p v-if="entry.body" class="tl__desc">{{ entry.body }}</p>
        </div>

        <div v-if="entry.tag" class="tl__tag">{{ entry.tag }}</div>
        <div v-else-if="entry.avatarInitials && entry.highlighted" class="tl__avatar">{{ entry.avatarInitials }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tl {
  padding: 128px 96px;
  display: flex;
  flex-direction: column;
  gap: 56px;
  background: var(--color-ground);
}

.tl__head { display: flex; flex-direction: column; gap: 16px; }
.tl__eyebrow {
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
.tl__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.tl__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}

.tl__list {
  display: flex;
  flex-direction: column;
}
.tl__row {
  display: flex;
  gap: 40px;
  padding: 32px 0;
  border-bottom: 1px solid var(--color-hairline);
}
.tl__row:last-child { border-bottom: 0; }

.tl__row--highlight {
  background: var(--color-accent-soft);
  border: 0;
  border-radius: 20px;
  padding: 32px;
  margin: 8px 0;
}
.tl__row--highlight + .tl__row { border-top: 1px solid var(--color-hairline); }

.tl__year {
  flex-shrink: 0;
  width: 160px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tl__row--highlight .tl__year { width: 128px; }

.tl__year-value {
  font-family: var(--font-display);
  font-size: 40px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}
.tl__row--highlight .tl__year-value { color: var(--color-accent-strong); }

.tl__year-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
}
.tl__year-label--default { color: var(--color-fog); }
.tl__year-label--danger { color: var(--color-danger); }
.tl__year-label--accent { color: var(--color-accent-strong); }
.tl__year-label-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.tl__row--highlight .tl__year-label { color: var(--color-accent-strong); }

.tl__body {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tl__title {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: 30px;
  color: var(--color-ink);
}
.tl__desc {
  margin: 0;
  max-width: 720px;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 155%;
  color: var(--color-graphite);
}

.tl__tag {
  align-self: flex-start;
  margin-top: 4px;
  padding: 4px 10px;
  background: var(--color-surface);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  line-height: 12px;
  text-transform: uppercase;
  color: var(--color-graphite);
}

.tl__avatar {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-pill);
  background: linear-gradient(135deg, #F5A623 0%, #E85D5D 100%);
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: var(--weight-semibold);
  flex-shrink: 0;
}

@media (max-width: 1023px) {
  .tl { padding: 96px 40px; gap: 40px; }
  .tl__heading { font-size: 40px; }
  .tl__row { flex-wrap: wrap; gap: 20px; }
  .tl__year { width: 100%; flex-direction: row; align-items: baseline; gap: 12px; }
  .tl__row--highlight .tl__year { width: 100%; }
  .tl__year-value { font-size: 32px; }
}
@media (max-width: 639px) {
  .tl { padding: 64px 20px; }
  .tl__row { padding: 24px 0; }
  .tl__row--highlight { padding: 20px; }
  .tl__title { font-size: 20px; line-height: 26px; }
}
</style>
