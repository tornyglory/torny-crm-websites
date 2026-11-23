<script setup lang="ts">
/**
 * Bistro menu block — editorial two-column layout with an opening-hours
 * strip, a "Book a table" CTA, and a list of downloadable PDF rows
 * (Lunch · Dinner · Kids · Drinks …). Downloads open in a new tab.
 *
 * Designed in Paper under "Bistro Menu · Desktop" / "Bistro Menu · Mobile"
 * on the Torny v2 board. Matches the existing editorial blocks' full-bleed
 * escape so the block paints edge-to-edge inside PageRenderer's gutter.
 */
import type { BistroMenuProps } from '../types'

withDefaults(defineProps<BistroMenuProps>(), {
  menus: () => [],
  hours: () => [],
})
</script>

<template>
  <section class="bistro">
    <div class="bistro__inner">
      <!-- Left column: editorial head + hours + booking CTA -->
      <header class="bistro__head">
        <div v-if="eyebrow" class="bistro__eyebrow">
          <span class="bistro__eyebrow-dot" />
          <span>{{ eyebrow }}</span>
        </div>
        <h2 v-if="heading" class="bistro__heading" :data-sh="headingSize">{{ heading }}</h2>
        <p v-if="description" class="bistro__desc">{{ description }}</p>

        <div v-if="hours && hours.length" class="bistro__hours">
          <div
            v-for="(h, i) in hours"
            :key="i"
            class="bistro__hour"
          >
            <div class="bistro__hour-label">{{ h.label }}</div>
            <div class="bistro__hour-value">{{ h.value }}</div>
          </div>
        </div>

        <a
          v-if="bookingLabel && bookingHref"
          :href="bookingHref"
          class="bistro__book"
        >
          <span>{{ bookingLabel }}</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3.5 7h7M7 3.5l3.5 3.5L7 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
      </header>

      <!-- Right column: menu rows -->
      <ul v-if="menus.length > 0" class="bistro__list">
        <li
          v-for="(menu, i) in menus"
          :key="i"
          class="bistro__row"
        >
          <a
            :href="menu.pdfUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="bistro__row-link"
            :aria-label="`Download ${menu.title} (PDF, opens in a new tab)`"
          >
            <div class="bistro__file" aria-hidden="true">
              <span class="bistro__file-tag">PDF</span>
              <span class="bistro__file-corner" />
            </div>
            <div class="bistro__body">
              <div class="bistro__title-row">
                <span class="bistro__title">{{ menu.title }}</span>
                <span v-if="menu.updatedLabel" class="bistro__updated">· {{ menu.updatedLabel }}</span>
              </div>
              <p v-if="menu.description" class="bistro__row-desc">{{ menu.description }}</p>
              <!-- Mobile meta row — collapses from the desktop right-edge
                   meta into a bottom strip under the description. -->
              <div class="bistro__row-meta bistro__row-meta--mobile">
                <span v-if="menu.pageCountLabel || menu.fileSizeLabel" class="bistro__size">
                  <template v-if="menu.pageCountLabel">{{ menu.pageCountLabel }}</template>
                  <template v-if="menu.pageCountLabel && menu.fileSizeLabel"> · </template>
                  <template v-if="menu.fileSizeLabel">{{ menu.fileSizeLabel }}</template>
                </span>
                <span class="bistro__download">
                  <span>Download</span>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2.5v8m0 0l-3-3m3 3l3-3M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
            <!-- Desktop meta — visible on >= 1024px, hidden on mobile. -->
            <div class="bistro__row-meta bistro__row-meta--desktop">
              <span v-if="menu.pageCountLabel || menu.fileSizeLabel" class="bistro__size">
                <template v-if="menu.pageCountLabel">{{ menu.pageCountLabel }}</template>
                <template v-if="menu.pageCountLabel && menu.fileSizeLabel"> · </template>
                <template v-if="menu.fileSizeLabel">{{ menu.fileSizeLabel }}</template>
              </span>
              <span class="bistro__download">
                <span>Download</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2.5v8m0 0l-3-3m3 3l3-3M3 12.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </div>
          </a>
        </li>
        <!-- Visual list terminator matching the top hairlines. -->
        <li class="bistro__list-terminator" aria-hidden="true" />
      </ul>

      <div v-else class="bistro__empty">
        <div class="bistro__empty-title">No menus yet</div>
        <p>Upload one or more PDFs in the block editor and give each a title, short description, page count, and file size. They'll appear here as downloadable links.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Full-bleed escape matches FaqAccordionBlock / GalleryBlock so the
   block paints edge-to-edge instead of sitting inside PageRenderer's
   gutter. Inner wrapper keeps the content on the shared 1280px column. */
.bistro {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
}
.bistro__inner {
  width: 100%;
  display: flex;
  flex-direction: row;
  gap: 96px;
  align-items: flex-start;
  justify-content: space-between;
  box-sizing: border-box;
}

/* ── Head (left column) ───────────────────────────────────────── */
.bistro__head {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 420px;
  flex-shrink: 0;
  padding-top: 6px;
}
.bistro__eyebrow {
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
.bistro__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-feature-tangerine);
  flex-shrink: 0;
}
.bistro__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(44px, 6vw, 72px);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  letter-spacing: var(--track-tight);
  color: var(--color-ink);
}
.bistro__desc {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 155%;
  color: var(--color-graphite);
  max-width: 380px;
}

/* Hours strip — mono labels + body-weight values laid out as a row. */
.bistro__hours {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--color-hairline);
  margin-top: 16px;
}
.bistro__hour {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bistro__hour-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-fog);
}
.bistro__hour-value {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-medium);
  color: var(--color-ink);
}

.bistro__book {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-ink);
  color: var(--color-ground);
  border-radius: var(--radius-pill);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-semibold);
  text-decoration: none;
  align-self: flex-start;
  transition: background-color 120ms ease;
}
.bistro__book:hover { background: var(--color-graphite); }

/* ── List (right column) ──────────────────────────────────────── */
.bistro__list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.bistro__row + .bistro__row { /* even rhythm — no gap, hairlines separate */ }

.bistro__row-link {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24px;
  padding: 28px 0;
  border-top: 1px solid var(--color-hairline);
  text-decoration: none;
  color: inherit;
  transition: background-color 120ms ease;
}
.bistro__row-link:hover .bistro__download { color: var(--color-feature-tangerine); }
.bistro__row-link:hover .bistro__title { color: var(--color-graphite); }

.bistro__file {
  position: relative;
  width: 52px;
  height: 64px;
  flex-shrink: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bistro__file-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.08em;
  color: var(--color-feature-tangerine);
}
/* Dog-ear on the top-right corner of the file-icon. Pure decoration —
   gives the chip a bit of paper personality without reaching for art. */
.bistro__file-corner {
  position: absolute;
  top: 0;
  right: 0;
  width: 12px;
  height: 12px;
  background: var(--color-hairline);
  border-bottom-left-radius: 6px;
}

.bistro__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bistro__title-row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
}
.bistro__title {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  color: var(--color-ink);
  transition: color 120ms ease;
}
.bistro__updated {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--color-feature-tangerine);
}
.bistro__row-desc {
  margin: 0;
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 150%;
  color: var(--color-fog);
}

.bistro__row-meta {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-shrink: 0;
}
.bistro__row-meta--mobile { display: none; }

.bistro__size {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-mute);
}
.bistro__download {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink);
  transition: color 120ms ease;
}

.bistro__list-terminator {
  height: 1px;
  background: var(--color-hairline);
  list-style: none;
}

.bistro__empty {
  padding: 48px 32px;
  border: 1px dashed var(--color-hairline);
  border-radius: 16px;
  text-align: center;
  font-family: var(--font-body);
  color: var(--color-fog);
  flex: 1;
  min-width: 0;
}
.bistro__empty-title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: var(--weight-bold);
  color: var(--color-ink);
  margin-bottom: 6px;
}
.bistro__empty p { margin: 0; max-width: 380px; margin-left: auto; margin-right: auto; }

/* ── Tablet ───────────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .bistro { padding: 64px 32px; }
  .bistro__inner {
    flex-direction: column;
    gap: 48px;
  }
  .bistro__head { width: 100%; }
  .bistro__heading { font-size: clamp(36px, 6vw, 56px); }
}

/* ── Mobile ───────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .bistro { padding: 56px 20px; overflow-x: hidden; }

  .bistro__inner { gap: 36px; }
  .bistro__heading { font-size: 40px; }
  .bistro__desc { font-size: 14px; }

  .bistro__hours { gap: 28px; }
  .bistro__book {
    align-self: stretch;
    justify-content: center;
    padding: 14px 20px;
  }

  .bistro__row-link {
    align-items: flex-start;
    gap: 16px;
    padding: 24px 0;
  }
  .bistro__file { width: 44px; height: 54px; }
  .bistro__file-tag { font-size: 9px; }
  .bistro__file-corner { width: 10px; height: 10px; }

  .bistro__title { font-size: 20px; }
  .bistro__updated { font-size: 9px; }
  .bistro__row-desc { font-size: 13px; }

  /* Collapse the right-edge meta into the body column so narrow screens
     don't feel cramped. */
  .bistro__row-meta--desktop { display: none; }
  .bistro__row-meta--mobile {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
  }
  .bistro__size { font-size: 10px; }
  .bistro__download { font-size: 13px; }
}
</style>
