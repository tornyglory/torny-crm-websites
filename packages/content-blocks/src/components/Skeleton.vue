<script setup lang="ts">
/**
 * Skeleton — the shimmer primitive used inside the public content blocks.
 * Same design as apps/crm/src/components/Skeleton.vue (kept separate so the
 * content-blocks package doesn't depend on the CRM app). One primitive keeps
 * the animation, colours and easing consistent across every skeleton state.
 */
withDefaults(defineProps<{
  /** Any CSS width — '70%', '140px', 'auto'. */
  width?: string
  /** Any CSS height — '12px', '2em'. `heightVariant` beats this. */
  height?: string
  /** Height preset — `line` (12px) / `lg` (22px) / `xl` (36px). */
  heightVariant?: 'line' | 'lg' | 'xl'
  /** Corner rounding — `sm` (6px, default) / `md` (12px) / `lg` (16px) / `pill` (999px). */
  radius?: 'sm' | 'md' | 'lg' | 'pill'
  /** Slower shimmer for backgrounds that should feel calmer. */
  slow?: boolean
}>(), {
  width: '100%',
  height: undefined,
  heightVariant: 'line',
  radius: 'sm',
  slow: false,
})

const HEIGHT_MAP = { line: '12px', lg: '22px', xl: '36px' } as const
const RADIUS_MAP = { sm: '6px', md: '12px', lg: '16px', pill: '999px' } as const
</script>

<template>
  <span
    class="skel"
    :class="{ 'skel--slow': slow }"
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
    color-mix(in oklab, var(--color-hairline, #E5E7EB) 100%, transparent) 0%,
    color-mix(in oklab, var(--color-hairline, #E5E7EB) 55%, var(--color-surface, #F3F4F6)) 50%,
    color-mix(in oklab, var(--color-hairline, #E5E7EB) 100%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: skel-shimmer 1.6s ease-in-out infinite;
}
.skel--slow { animation-duration: 2.6s; }
@keyframes skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
