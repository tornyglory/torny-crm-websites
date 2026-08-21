<script setup lang="ts">
/**
 * CrmEmptyState — the shared "no results" / "couldn't load" panel.
 *
 * Sits inside a container (table cell, list, card) and centres its own
 * content. Emits `action` when the primary button is clicked; the parent
 * decides what "reset" / "retry" actually means.
 *
 * BEM block: `crm-empty-state`.
 */
withDefaults(
  defineProps<{
    variant?: 'empty' | 'error'
    title: string
    description?: string | null
    actionLabel?: string | null
  }>(),
  {
    variant: 'empty',
    description: null,
    actionLabel: null,
  },
)

const emit = defineEmits<{
  (e: 'action'): void
}>()

function onAction() {
  emit('action')
}
</script>

<template>
  <div class="crm-empty-state" :class="`crm-empty-state--${variant}`" role="status">
    <div class="crm-empty-state__icon">
      <!-- Magnifying glass for empty, alert triangle for error. -->
      <svg
        v-if="variant === 'empty'"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <svg
        v-else
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 3 1.5 21h21L12 3z" />
        <path d="M12 10v5" />
        <circle cx="12" cy="18" r="0.6" fill="currentColor" />
      </svg>
    </div>
    <div class="crm-empty-state__title">{{ title }}</div>
    <div v-if="description" class="crm-empty-state__desc">{{ description }}</div>
    <button
      v-if="actionLabel"
      type="button"
      class="crm-empty-state__action"
      @click="onAction"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.crm-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--color-fog);
}

.crm-empty-state__icon {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-fog);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}

.crm-empty-state--error .crm-empty-state__icon {
  background: #FEF2F2;
  color: #B91C1C;
}

.crm-empty-state__title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.01em;
}

.crm-empty-state__desc {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  max-width: 380px;
  line-height: 1.5;
}

.crm-empty-state__action {
  margin-top: 12px;
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  border: 0;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.crm-empty-state__action:hover { background: var(--color-graphite); }
</style>
