<script setup lang="ts">
/**
 * Sponsors block — editorial head over a 4-up grid of logo tiles.
 *
 * Designed in Paper under "Sponsors · Desktop" + "Sponsors · Mobile" on
 * the Torny v2 board. Matches the existing editorial blocks' full-bleed
 * escape so the block paints edge-to-edge inside PageRenderer's gutter.
 *
 * Tiles that carry an `href` render as anchors and open in a new tab;
 * tile without an href renders as a plain div so clubs can list sponsors
 * who don't want their site linked.
 */
import type { SponsorsProps } from '../types'

withDefaults(defineProps<SponsorsProps>(), {
  sponsors: () => [],
})
</script>

<template>
  <section class="sponsors">
    <div class="sponsors__inner">
      <header class="sponsors__head">
        <div class="sponsors__head-copy">
          <div v-if="eyebrow" class="sponsors__eyebrow">
            <span class="sponsors__eyebrow-dot" />
            <span>{{ eyebrow }}</span>
          </div>
          <h2 v-if="heading" class="sponsors__heading" :data-sh="headingSize">{{ heading }}</h2>
          <p v-if="description" class="sponsors__desc">{{ description }}</p>
        </div>
        <a
          v-if="ctaLabel && ctaHref"
          :href="ctaHref"
          class="sponsors__cta"
        >
          <span>{{ ctaLabel }}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 6h6M6 3l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
      </header>

      <ul v-if="sponsors.length > 0" class="sponsors__grid">
        <li
          v-for="(s, i) in sponsors"
          :key="i"
          class="sponsors__cell"
        >
          <component
            :is="s.href ? 'a' : 'div'"
            v-bind="s.href ? { href: s.href, target: '_blank', rel: 'noopener noreferrer' } : {}"
            class="sponsors__tile"
            :class="{ 'sponsors__tile--interactive': s.href }"
            :aria-label="s.href ? `${s.name} — opens in a new tab` : undefined"
          >
            <span v-if="s.tier" class="sponsors__tier">{{ s.tier }}</span>
            <div class="sponsors__body">
              <img
                v-if="s.logoUrl"
                :src="s.logoUrl"
                :alt="`${s.name} logo`"
                class="sponsors__logo"
                loading="lazy"
              />
              <template v-else>
                <div class="sponsors__name">{{ s.name }}</div>
                <div v-if="s.caption" class="sponsors__caption">{{ s.caption }}</div>
              </template>
            </div>
          </component>
        </li>
      </ul>

      <div v-else class="sponsors__empty">
        <div class="sponsors__empty-title">No sponsors yet</div>
        <p>Add sponsors in the block editor — each tile takes a logo, business name, optional tier pill, and optional link to their site.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Full-bleed escape — matches the sibling editorial blocks. */
.sponsors {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
}
.sponsors__inner {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 48px;
  box-sizing: border-box;
}

/* ── Head ─────────────────────────────────────────────────────── */
.sponsors__head {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
  gap: 48px;
  padding-bottom: 48px;
  border-bottom: 1px solid var(--color-hairline);
}
.sponsors__head-copy {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 640px;
}
.sponsors__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-fog);
}
.sponsors__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.sponsors__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(40px, 5vw, 64px);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: var(--track-tight);
  color: var(--color-ink);
}
.sponsors__desc {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 155%;
  color: var(--color-graphite);
  max-width: 560px;
}
.sponsors__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-ink);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink);
  text-decoration: none;
  flex-shrink: 0;
  white-space: nowrap;
  transition: opacity 120ms ease;
}
.sponsors__cta:hover { opacity: 0.72; }

/* ── Grid ─────────────────────────────────────────────────────── */
.sponsors__grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
.sponsors__cell {
  min-width: 0;
}

.sponsors__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 200px;
  padding: 32px;
  box-sizing: border-box;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: transform 160ms ease, border-color 160ms ease;
}
.sponsors__tile--interactive { cursor: pointer; }
.sponsors__tile--interactive:hover {
  transform: translateY(-2px);
  border-color: var(--color-ink);
}
.sponsors__tile--interactive:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}

.sponsors__tier {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 8px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-ink);
}

.sponsors__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  max-width: 100%;
}
.sponsors__logo {
  display: block;
  max-width: 100%;
  max-height: 100px;
  object-fit: contain;
}
.sponsors__name {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: var(--weight-bold);
  color: var(--color-ink);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-tight);
  text-align: center;
}
.sponsors__caption {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-fog);
}

.sponsors__empty {
  padding: 48px 32px;
  border: 1px dashed var(--color-hairline);
  border-radius: 16px;
  text-align: center;
  font-family: var(--font-body);
  color: var(--color-fog);
}
.sponsors__empty-title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: var(--weight-bold);
  color: var(--color-ink);
  margin-bottom: 6px;
}
.sponsors__empty p { margin: 0; max-width: 380px; margin-left: auto; margin-right: auto; }

/* ── Tablet ───────────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .sponsors { padding: 72px 32px; }
  .sponsors__inner { gap: 36px; }
  .sponsors__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 24px;
    padding-bottom: 36px;
  }
  .sponsors__heading { font-size: clamp(32px, 5vw, 48px); }
  .sponsors__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .sponsors__tile { height: 170px; padding: 24px; }
  .sponsors__name { font-size: 20px; }
}

/* ── Mobile ───────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .sponsors { padding: 56px 20px; overflow-x: hidden; }
  .sponsors__inner { gap: 28px; }
  .sponsors__heading { font-size: 40px; }
  .sponsors__desc { font-size: 14px; }

  .sponsors__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .sponsors__tile { height: 140px; padding: 20px; }
  .sponsors__tier {
    top: 8px;
    left: 8px;
    padding: 3px 7px;
    font-size: 8px;
  }
  .sponsors__logo { max-height: 72px; }
  .sponsors__name { font-size: 16px; }
  .sponsors__caption { font-size: 9px; }
}
</style>
