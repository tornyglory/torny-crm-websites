<script setup lang="ts">
/**
 * Dashboard + Billing metric tile — big number, label, optional
 * subtitle, optional loading skeleton. Backend's Phase 1 trend arrays
 * are empty so no sparkline area is rendered yet; Phase 2 will add it.
 */
withDefaults(defineProps<{
  label: string
  /** Primary display — expected to already be formatted (AdminMoney
   *  slot content, a count, a rate string). Use a slot for richer
   *  content (e.g. embedding an AdminMoney). */
  value?: string | number
  /** Subtitle under the big number — context, denominator, source. */
  subtitle?: string
  /** Tone hint — accent for revenue, warn for past-due, muted for
   *  deferred-Phase-2 placeholders. */
  tone?: 'default' | 'accent' | 'warn' | 'muted'
  loading?: boolean
}>(), {
  tone: 'default',
  loading: false,
})
</script>

<template>
  <div class="metric-card" :class="`metric-card--${tone}`">
    <div class="metric-card__label">{{ label }}</div>
    <div v-if="loading" class="metric-card__skeleton" />
    <div v-else class="metric-card__value">
      <slot>{{ value }}</slot>
    </div>
    <div v-if="subtitle && !loading" class="metric-card__subtitle">{{ subtitle }}</div>
  </div>
</template>

<style scoped>
.metric-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  min-height: 108px;
}
.metric-card__label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
}
.metric-card__value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
  line-height: 1;
}
.metric-card__subtitle {
  font-family: var(--font-body);
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  line-height: 1.4;
}
.metric-card__skeleton {
  width: 60%;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.12), rgba(255,255,255,0.06));
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.metric-card--accent { border-color: color-mix(in oklab, var(--color-accent) 45%, transparent); }
.metric-card--accent .metric-card__value { color: color-mix(in oklab, var(--color-accent) 85%, #fff); }
.metric-card--warn { border-color: #d14e4e55; }
.metric-card--warn .metric-card__value { color: #ff7a7a; }
.metric-card--muted .metric-card__value { color: rgba(255,255,255,0.5); }
</style>
