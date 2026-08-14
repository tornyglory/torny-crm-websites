<script setup lang="ts">
import type { RichTextProps } from '../types'
defineProps<RichTextProps>()
</script>

<template>
  <div class="rich-text" v-html="html" />
</template>

<style scoped>
.rich-text { font-family: var(--font-body); font-size: 16px; line-height: 1.65; color: var(--color-ink); max-width: 68ch; }
.rich-text :deep(h2) { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 32px 0 12px; }
.rich-text :deep(h3) { font-family: var(--font-display); font-size: 20px; font-weight: 600; margin: 24px 0 8px; }
.rich-text :deep(p) { margin: 0 0 16px; }
.rich-text :deep(a) { color: var(--color-accent); text-decoration: underline; }
.rich-text :deep(ul), .rich-text :deep(ol) { padding-left: 24px; margin: 0 0 16px; }
</style>
