<script setup lang="ts">
/**
 * Single source of truth for cents → display formatting across the
 * admin shell. All admin API fields that end in `_cents` flow through
 * this component so we don't drift between "$12,345.67 NZD" here and
 * "12,345.67 NZD" over there.
 *
 * NZD-only per brief 123 §3.4 — multi-currency is a non-goal for V1.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  cents: number | null | undefined
  /** Hide the "NZD" suffix when stacking alongside other money values
   *  in a tight layout (e.g. table cells). */
  suffix?: boolean
  /** Hide cents when the value is a whole dollar (common in rolled-up
   *  totals like "annualised_cents"). */
  roundWhole?: boolean
}>(), {
  suffix: true,
  roundWhole: false,
})

const formatted = computed(() => {
  if (props.cents == null) return '—'
  const dollars = props.cents / 100
  const fractionDigits = props.roundWhole && dollars === Math.floor(dollars) ? 0 : 2
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    currencyDisplay: props.suffix ? 'code' : 'symbol',
  }).format(dollars)
})
</script>

<template>
  <span class="money">{{ formatted }}</span>
</template>

<style scoped>
.money { font-variant-numeric: tabular-nums; }
</style>
