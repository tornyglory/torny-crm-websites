<script setup lang="ts">
/**
 * CrmSkeleton — a shimmering placeholder block. Compose several to
 * approximate the shape of the row that's still loading.
 *
 *   <CrmSkeleton shape="circle" width="36px" height="36px" />
 *   <CrmSkeleton shape="text" width="60%" />
 *   <CrmSkeleton width="80px" height="14px" radius="999px" />
 *
 * Consumers wrapping several skeletons in a container should set
 * `aria-busy="true"` on the container so assistive tech announces the
 * loading state once, not per skeleton.
 *
 * BEM block: `crm-skeleton`.
 */
withDefaults(
  defineProps<{
    shape?: 'block' | 'circle' | 'text'
    width?: string
    height?: string
    /** CSS border-radius override. `circle` and `text` set sensible defaults. */
    radius?: string
  }>(),
  { shape: 'block' },
)
</script>

<template>
  <span
    class="crm-skeleton"
    :class="`crm-skeleton--${shape}`"
    :style="{ width, height, borderRadius: radius }"
    aria-hidden="true"
  />
</template>

<style scoped>
.crm-skeleton {
  display: inline-block;
  background: linear-gradient(
    90deg,
    var(--color-surface) 0%,
    var(--color-hairline) 50%,
    var(--color-surface) 100%
  );
  background-size: 200% 100%;
  animation: crm-skeleton-shimmer 1.2s ease-in-out infinite;
  border-radius: 6px;
  vertical-align: middle;
}
.crm-skeleton--circle { border-radius: 999px; }
.crm-skeleton--text { height: 12px; border-radius: 4px; }

@keyframes crm-skeleton-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
