<script setup lang="ts">
/**
 * Skeleton — the shimmer primitive used by every list/detail loader in the
 * CRM. One primitive keeps the animation, colours, and easing consistent
 * across the app; callers just pick `width`, `height`, and optionally
 * `variant` for a bigger radius on avatar-like blocks.
 */
withDefaults(defineProps<{
  /** Any CSS width — '70%', '140px', 'auto'. */
  width?: string
  /** Any CSS height — '12px', '2em'. Preset `heightVariant` beats this. */
  height?: string
  /** Height preset — `line` (12px) / `lg` (20px) / `xl` (32px). */
  heightVariant?: 'line' | 'lg' | 'xl'
  /** Corner rounding — `sm` (6px, default) / `md` (12px) / `pill` (999px). */
  radius?: 'sm' | 'md' | 'pill'
}>(), {
  width: '100%',
  height: undefined,
  heightVariant: 'line',
  radius: 'sm',
})

const HEIGHT_MAP = { line: '12px', lg: '20px', xl: '32px' } as const
const RADIUS_MAP = { sm: '6px', md: '12px', pill: '999px' } as const
</script>

<template>
  <span
    class="skel"
    aria-hidden="true"
    :style="{
      width,
      height: height ?? HEIGHT_MAP[heightVariant],
      borderRadius: RADIUS_MAP[radius],
    }"
  />
</template>

<style scoped>
.skel {
  display: block;
  background: linear-gradient(
    90deg,
    var(--color-hairline) 0%,
    color-mix(in oklab, var(--color-hairline) 60%, var(--color-surface)) 50%,
    var(--color-hairline) 100%
  );
  background-size: 200% 100%;
  animation: skel-shimmer 1.6s ease-in-out infinite;
}
@keyframes skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
