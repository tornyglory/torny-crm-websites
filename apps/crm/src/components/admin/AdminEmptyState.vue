<script setup lang="ts">
/**
 * Shared empty / deferred state across the admin shell. Three flavours:
 *   - "no-results" (filter returned nothing)
 *   - "deferred" (feature waiting on backend Phase 2/3 — surface the
 *     wait + its brief reference so admins know why)
 *   - "error" (fetch failed — surface retry)
 */
withDefaults(defineProps<{
  tone?: 'no-results' | 'deferred' | 'error'
  title: string
  detail?: string
  /** Reference brief / phase for `deferred` tone — rendered as a small
   *  monospace chip for engineers viewing the admin. */
  waitsOn?: string
}>(), {
  tone: 'no-results',
})

defineEmits<{ (e: 'retry'): void }>()
</script>

<template>
  <div class="empty" :class="`empty--${tone}`">
    <div class="empty__title">{{ title }}</div>
    <div v-if="detail" class="empty__detail">{{ detail }}</div>
    <div v-if="waitsOn" class="empty__waits-on">Waits on <code>{{ waitsOn }}</code></div>
    <button
      v-if="tone === 'error'"
      type="button"
      class="empty__retry"
      @click="$emit('retry')"
    >Retry</button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  background: var(--color-ground);
  border: 1px dashed var(--color-hairline);
  border-radius: 14px;
  text-align: center;
}
.empty__title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-ink);
}
.empty__detail {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-graphite);
  max-width: 44ch;
  line-height: 1.5;
}
.empty__waits-on {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  margin-top: 4px;
}
.empty__waits-on code {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 6px;
  background: var(--color-surface);
  border-radius: 4px;
  color: var(--color-graphite);
}
.empty__retry {
  margin-top: 8px;
  padding: 8px 18px;
  background: var(--color-ink);
  color: #fff;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.empty--error { border-color: color-mix(in oklab, var(--color-danger) 35%, transparent); border-style: solid; background: color-mix(in oklab, var(--color-danger) 3%, var(--color-ground)); }
.empty--deferred { border-style: solid; border-color: var(--color-hairline); }
</style>
