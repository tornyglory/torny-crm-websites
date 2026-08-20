<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  value: string | number
  delta?: number
  hint?: string
  tone?: 'default' | 'accent' | 'positive' | 'warn'
}>(), {
  tone: 'default',
})
</script>

<template>
  <div class="card" :class="`card--${tone}`">
    <div class="card__label">{{ label }}</div>
    <div class="card__row">
      <div class="card__value">{{ value }}</div>
      <span v-if="delta !== undefined" class="card__delta" :class="{ 'is-down': delta < 0 }">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="10" height="10">
          <path v-if="delta >= 0" d="M12 19V5M5 12l7-7 7 7" />
          <path v-else d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        {{ Math.abs(delta).toFixed(1) }}%
      </span>
    </div>
    <div v-if="hint" class="card__hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.card { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.card--accent { background: var(--color-ink); color: #fff; border-color: transparent; }
.card--positive { background: #F0FDF4; border-color: #BBF7D0; }
.card--warn { background: #FFFBEB; border-color: #FDE68A; }

.card__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.card--accent .card__label { color: rgba(255,255,255,0.5); }
.card__row { display: flex; align-items: baseline; gap: 10px; margin-top: 10px; }
.card__value { font-family: var(--font-display); font-size: 32px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.02em; }
.card--accent .card__value { color: #fff; }
.card__delta { display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; padding: 3px 8px; background: #DCFCE7; color: #166534; border-radius: 6px; }
.card__delta.is-down { background: #FEE2E2; color: #991B1B; }
.card--accent .card__delta { background: rgba(255,255,255,0.14); color: #fff; }
.card__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 6px; }
.card--accent .card__hint { color: rgba(255,255,255,0.6); }
</style>
