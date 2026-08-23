<script setup lang="ts">
import { ref } from 'vue'
import type { FaqAccordionProps } from '../types'

defineProps<FaqAccordionProps>()

// First item is open by default.
const openIndex = ref<number | null>(0)

function toggle(i: number) {
  openIndex.value = openIndex.value === i ? null : i
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
</script>

<template>
  <section class="faq">
    <div class="faq__left">
      <div v-if="eyebrow" class="faq__eyebrow">
        <span class="faq__eyebrow-dot" />
        <span>{{ eyebrow }}</span>
      </div>
      <h2 v-if="heading" class="faq__heading">{{ heading }}</h2>
      <p v-if="supportText" class="faq__support">{{ supportText }}</p>
      <a v-if="cta" :href="cta.href" class="faq__cta">
        <span>{{ cta.label }}</span>
        <span aria-hidden="true">→</span>
      </a>
    </div>

    <div class="faq__list">
      <div
        v-for="(item, i) in items"
        :key="i"
        class="faq__item"
        :class="{
          'faq__item--open': openIndex === i,
          'faq__item--closed': openIndex !== i,
        }"
      >
        <button
          type="button"
          class="faq__row"
          :aria-expanded="openIndex === i ? 'true' : 'false'"
          @click="toggle(i)"
        >
          <span class="faq__row-left">
            <span class="faq__num" :class="{ 'faq__num--active': openIndex === i }">{{ pad(i + 1) }}</span>
            <span class="faq__question">{{ item.question }}</span>
          </span>
          <span class="faq__toggle">{{ openIndex === i ? '−' : '+' }}</span>
        </button>
        <div v-if="openIndex === i" class="faq__answer">{{ item.answer }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.faq {
  display: flex;
  gap: 80px;
  padding: 96px;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  background: var(--color-surface);
}

.faq__left {
  flex-shrink: 0;
  width: 400px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.faq__eyebrow {
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
.faq__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}
.faq__heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: 44px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: var(--leading-heading);
  color: var(--color-ink);
}
.faq__support {
  margin: 0;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 155%;
  color: var(--color-fog);
}
.faq__cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  margin-top: 8px;
  padding: 12px 20px;
  background: var(--color-ink);
  color: var(--color-ground);
  border-radius: var(--btn-radius);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: var(--weight-semibold);
  line-height: 18px;
  text-decoration: none;
}
.faq__cta:hover { background: var(--color-graphite); }

.faq__list {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.faq__item {
  border-bottom: 1px solid var(--color-hairline);
}
.faq__item--open {
  margin-bottom: 12px;
  background: var(--card-bg);
  border: var(--card-border);
  box-shadow: var(--card-shadow);
  border-radius: var(--radius-md);
  padding: 0;
}

.faq__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  padding: 24px 28px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.faq__row-left {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.faq__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-fog);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  line-height: 14px;
  flex-shrink: 0;
}
.faq__num--active {
  background: var(--color-accent);
  color: var(--color-accent-ink);
}
.faq__question {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: var(--weight-semibold);
  letter-spacing: var(--track-tight);
  line-height: 24px;
  color: var(--color-ink);
}
.faq__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
}
.faq__item--open .faq__toggle {
  color: var(--color-ink);
}

.faq__answer {
  padding: 0 28px 24px 66px;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 165%;
  color: var(--color-graphite);
}

@media (max-width: 1023px) {
  .faq { flex-direction: column; padding: 64px 32px; gap: 40px; }
  .faq__left { width: 100%; }
  .faq__heading { font-size: 36px; }
}
@media (max-width: 639px) {
  .faq { padding: 48px 20px; gap: 32px; }
  .faq__heading { font-size: 28px; }
  .faq__row { padding: 20px; }
  .faq__answer { padding: 0 20px 20px 58px; }
}
</style>
