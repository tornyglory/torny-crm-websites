<script setup lang="ts">
/**
 * CrmSpinner — small circular loading indicator. Inherits `currentColor`
 * for the leading arc so it picks up the surrounding text colour.
 *
 * BEM block: `crm-spinner`.
 */
withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg'
    /** Accessible label; screen readers announce it, hidden visually. */
    label?: string
  }>(),
  { size: 'md', label: 'Loading' },
)
</script>

<template>
  <span
    class="crm-spinner"
    :class="`crm-spinner--${size}`"
    role="status"
  >
    <span class="crm-spinner__sr">{{ label }}</span>
  </span>
</template>

<style scoped>
.crm-spinner {
  display: inline-block;
  border-radius: 999px;
  border-style: solid;
  border-color: var(--color-hairline);
  border-top-color: currentColor;
  animation: crm-spinner-spin 0.8s linear infinite;
  vertical-align: middle;
}
.crm-spinner--sm { width: 12px; height: 12px; border-width: 1.5px; }
.crm-spinner--md { width: 16px; height: 16px; border-width: 2px; }
.crm-spinner--lg { width: 24px; height: 24px; border-width: 3px; }

.crm-spinner__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@keyframes crm-spinner-spin {
  to { transform: rotate(360deg); }
}
</style>
