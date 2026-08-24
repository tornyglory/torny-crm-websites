<script setup lang="ts">
import { computed, inject, isRef, type Ref } from 'vue'
import { BLOCK_CONTEXT_KEY, type BlockContext, type HonourBoardProps } from '../types'

const props = withDefaults(defineProps<HonourBoardProps>(), {
  heading: 'Champions.',
  yearsToShow: 5,
})

// PageRenderer provides BlockContext as a computed ref; the CRM preview
// may provide it as a plain object. Handle both.
const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

// Filter entries by the selected category (if any) then sort descending by year.
const filtered = computed(() => {
  const all = ctx.value?.honourEntries ?? []
  const scoped = props.categorySlug ? all.filter((e) => e.category_slug === props.categorySlug) : all
  return [...scoped].sort((a, b) => b.year - a.year)
})

const reigning = computed(() => filtered.value[0])
const recentDecade = computed(() => filtered.value.slice(1, props.yearsToShow + 1))

// Compute titles held for the reigning champion across all entries.
const reigningTitles = computed(() => {
  if (!reigning.value) return 0
  const name = reigning.value.member_name
  return filtered.value.filter((e) => e.member_name === name).length
})

const uniqueWinnersInStrip = computed(() =>
  new Set(recentDecade.value.map((e) => e.member_name)).size,
)

const awardedLabel = computed(() => {
  if (!reigning.value?.awarded_at) return null
  const d = new Date(reigning.value.awarded_at)
  const month = d.toLocaleString('en-NZ', { month: 'short' })
  const year = String(d.getFullYear()).slice(-2)
  return `${month} '${year}`
})

const categoryLabel = computed(() => reigning.value?.category_name ?? 'Champion of Champions')
</script>

<template>
  <section class="hb">
    <div class="hb__head">
      <div class="hb__head-text">
        <div v-if="eyebrow" class="hb__eyebrow">
          <span class="hb__eyebrow-dot" />
          <span>{{ eyebrow }}</span>
        </div>
        <h2 class="hb__heading">{{ heading }}</h2>
        <p v-if="description" class="hb__body">{{ description }}</p>
      </div>
      <a v-if="ctaLabel && ctaHref" :href="ctaHref" class="hb__cta">
        <span>{{ ctaLabel }}</span>
        <span aria-hidden="true">→</span>
      </a>
    </div>

    <!-- Reigning champion feature -->
    <div v-if="reigning" class="hb__feature">
      <div class="hb__avatar">
        <span>{{ reigning.initials || initialsFromName(reigning.member_name) }}</span>
        <span class="hb__avatar-pip" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L14.6 8.6L22 9.3L16.4 14L18.1 21L12 17.3L5.9 21L7.6 14L2 9.3L9.4 8.6L12 2Z"/></svg>
        </span>
      </div>
      <div class="hb__feature-body">
        <div class="hb__feature-eyebrow">
          <span class="hb__feature-eyebrow-dot" />
          <span>Reigning champion · {{ reigning.year }}</span>
        </div>
        <div class="hb__feature-name">{{ reigning.member_name }}</div>
        <div v-if="reigning.notes || categoryLabel" class="hb__feature-sub">
          {{ reigning.notes ?? categoryLabel }}
        </div>
        <div class="hb__stats">
          <div class="hb__stat">
            <div class="hb__stat-value">{{ reigningTitles }}</div>
            <div class="hb__stat-label">Titles held</div>
          </div>
          <div v-if="reigning.score" class="hb__stat-divider" aria-hidden="true" />
          <div v-if="reigning.score" class="hb__stat">
            <div class="hb__stat-value">{{ reigning.score }}</div>
            <div class="hb__stat-label">Final score</div>
          </div>
          <div v-if="awardedLabel" class="hb__stat-divider" aria-hidden="true" />
          <div v-if="awardedLabel" class="hb__stat">
            <div class="hb__stat-value">{{ awardedLabel }}</div>
            <div class="hb__stat-label">Awarded</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent decade strip -->
    <div v-if="recentDecade.length" class="hb__recent">
      <div class="hb__recent-head">
        <div class="hb__recent-title">
          <span class="hb__recent-title-text">Recent winners</span>
          <span class="hb__recent-meta">{{ recentDecade.length }} champions · {{ uniqueWinnersInStrip }} unique</span>
        </div>
      </div>
      <ol class="hb__winners">
        <li v-for="entry in recentDecade" :key="`${entry.year}-${entry.member_name}`" class="hb__winner">
          <div class="hb__winner-year">{{ entry.year }}</div>
          <div class="hb__winner-avatar">{{ entry.initials || initialsFromName(entry.member_name) }}</div>
          <div class="hb__winner-name">{{ entry.member_name }}</div>
          <div v-if="entry.score" class="hb__winner-score">{{ entry.score }}</div>
        </li>
      </ol>
    </div>

    <!-- Empty state — no entries at all -->
    <div v-if="!reigning" class="hb__empty">
      <div class="hb__empty-title">No champions yet.</div>
      <div class="hb__empty-hint">Add entries to the honour board and the reigning champion will appear here.</div>
    </div>
  </section>
</template>

<style scoped>
.hb {
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 96px 0;
}

/* Header */
.hb__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
}
.hb__head-text { display: flex; flex-direction: column; gap: 20px; max-width: 720px; min-width: 0; }
.hb__eyebrow {
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
.hb__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.hb__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: var(--color-ink);
}
.hb__body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 160%;
  color: var(--color-graphite);
}
.hb__cta {
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
  flex-shrink: 0;
}
.hb__cta:hover { background: var(--color-graphite); }

/* Reigning champion feature */
.hb__feature {
  display: flex;
  align-items: center;
  gap: 48px;
  padding: 48px;
  background: var(--color-ink);
  border-radius: var(--radius-lg);
  color: var(--color-ground);
}

.hb__avatar {
  position: relative;
  width: 200px;
  height: 200px;
  border-radius: var(--radius-pill);
  background-image: linear-gradient(160deg, #F5A623 0%, #E85D5D 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: var(--weight-bold);
  letter-spacing: var(--track-tight);
  color: #fff;
}
.hb__avatar-pip {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  border: 4px solid var(--color-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hb__feature-body { display: flex; flex-direction: column; gap: 12px; flex: 1 1 0; min-width: 0; }
.hb__feature-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
}
.hb__feature-eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.hb__feature-name {
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  color: #fff;
}
.hb__feature-sub {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 22px;
  color: rgba(255, 255, 255, 0.7);
}

.hb__stats {
  display: flex;
  align-items: flex-end;
  gap: 32px;
  margin-top: 12px;
}
.hb__stat { display: flex; flex-direction: column; gap: 6px; }
.hb__stat-value {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: 100%;
  color: #fff;
}
.hb__stat-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 12px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}
.hb__stat-divider { width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.15); }

/* Recent decade strip */
.hb__recent { display: flex; flex-direction: column; gap: 20px; }
.hb__recent-head { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; }
.hb__recent-title { display: flex; align-items: baseline; gap: 12px; }
.hb__recent-title-text {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-heading);
  color: var(--color-ink);
}
.hb__recent-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: var(--color-fog);
}

.hb__winners {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}
.hb__winner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 20px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  text-align: center;
}
.hb__winner-year {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: var(--color-fog);
}
.hb__winner-avatar {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-pill);
  background-image: linear-gradient(160deg, #F5A623 0%, #E85D5D 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: var(--weight-bold);
  letter-spacing: var(--track-tight);
  color: #fff;
  flex-shrink: 0;
}
.hb__winner-name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: var(--weight-semibold);
  letter-spacing: -0.01em;
  line-height: 22px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.hb__winner-score {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: 0.05em;
  color: var(--color-fog);
}

.hb__empty {
  padding: 48px;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  text-align: center;
}
.hb__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: var(--weight-semibold); color: var(--color-ink); }
.hb__empty-hint { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-top: 4px; }

/* Responsive */
@media (max-width: 1023px) {
  .hb__feature { flex-direction: column; padding: 32px; gap: 32px; text-align: center; align-items: center; }
  .hb__avatar { width: 160px; height: 160px; font-size: 52px; }
  .hb__feature-name { font-size: 40px; }
  .hb__stats { justify-content: center; flex-wrap: wrap; }
  .hb__winners { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 639px) {
  .hb { gap: 24px; padding: 48px 0; }
  .hb__head { flex-direction: column; align-items: flex-start; }
  .hb__heading { font-size: 40px; }
  .hb__feature { padding: 24px; gap: 20px; }
  .hb__avatar { width: 128px; height: 128px; font-size: 40px; }
  .hb__feature-name { font-size: 32px; }
  .hb__stats { gap: 20px; }
  .hb__stat-value { font-size: 28px; }
  .hb__winners { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hb__recent-head { flex-direction: column; align-items: flex-start; gap: 8px; }
  .hb__recent-title-text { font-size: 24px; }
}
</style>
