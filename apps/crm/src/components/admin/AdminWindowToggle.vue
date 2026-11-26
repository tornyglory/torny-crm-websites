<script setup lang="ts">
/**
 * Segmented control for the trailing-window selector shared across
 * Dashboard, Accounts, and Billing. State lives in the URL (`?window=`)
 * so views are bookmarkable and the back button restores prior
 * selections — see `useAdminWindow` for the composable that reads /
 * writes the query param.
 */
import type { AdminWindow } from '@torny/api-client'

defineProps<{ modelValue: AdminWindow }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: AdminWindow): void }>()

const WINDOWS: ReadonlyArray<{ value: AdminWindow; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
]
</script>

<template>
  <div class="window-toggle" role="radiogroup" aria-label="Time window">
    <button
      v-for="w in WINDOWS"
      :key="w.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === w.value"
      class="window-toggle__btn"
      :class="{ 'window-toggle__btn--active': modelValue === w.value }"
      @click="emit('update:modelValue', w.value)"
    >{{ w.label }}</button>
  </div>
</template>

<style scoped>
.window-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 999px;
}
.window-toggle__btn {
  padding: 6px 14px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: transparent;
  color: rgba(255,255,255,0.65);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.window-toggle__btn:hover { color: #fff; }
.window-toggle__btn--active {
  background: #fff;
  color: var(--color-ink);
}
</style>
