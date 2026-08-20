<script setup lang="ts">
withDefaults(defineProps<{
  backTo?: string
  skipTo?: string
  continueLabel?: string
  disabled?: boolean
}>(), {
  continueLabel: 'Continue',
  disabled: false,
})

defineEmits<{ (e: 'continue'): void }>()
</script>

<template>
  <footer class="wiz-foot">
    <RouterLink v-if="backTo" :to="{ name: backTo }" class="wiz-foot__back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
      Back
    </RouterLink>
    <span v-else />
    <div class="wiz-foot__right">
      <RouterLink v-if="skipTo" :to="{ name: skipTo }" class="wiz-foot__skip">Skip for now</RouterLink>
      <button type="button" class="wiz-foot__continue" :disabled="disabled" @click="$emit('continue')">
        {{ continueLabel }}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.wiz-foot { display: flex; align-items: center; justify-content: space-between; padding-top: 24px; margin-top: 40px; border-top: 1px solid var(--color-hairline); gap: 12px; flex-wrap: wrap; }
.wiz-foot__back { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-graphite); cursor: pointer; text-decoration: none; }
.wiz-foot__back:hover { background: #fff; color: var(--color-ink); }
.wiz-foot__right { display: inline-flex; align-items: center; gap: 20px; }
.wiz-foot__skip { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-decoration: none; }
.wiz-foot__skip:hover { color: var(--color-ink); }
.wiz-foot__continue { display: inline-flex; align-items: center; gap: 8px; padding: 14px 24px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease; }
.wiz-foot__continue:hover:not(:disabled) { background: var(--color-graphite); }
.wiz-foot__continue:disabled { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 640px) {
  .wiz-foot { padding-top: 20px; margin-top: 28px; }
  .wiz-foot__right { flex: 1; justify-content: flex-end; gap: 12px; }
  .wiz-foot__continue { flex: 1; justify-content: center; padding: 13px 18px; }
  .wiz-foot__skip { display: none; }
}
</style>
