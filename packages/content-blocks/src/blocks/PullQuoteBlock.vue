<script setup lang="ts">
import { computed } from 'vue'
import type { PullQuoteProps } from '../types'

const props = defineProps<PullQuoteProps>()

const initials = computed(() => {
  if (props.authorInitials) return props.authorInitials
  if (!props.authorName) return ''
  return props.authorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
})
const showAuthor = computed(() => Boolean(props.authorName || props.authorRole))
</script>

<template>
  <section class="pq">
    <div class="pq__inner">
      <div class="pq__mark" aria-hidden="true">"</div>

      <blockquote class="pq__quote">{{ quote }}</blockquote>

      <div v-if="showAuthor" class="pq__author">
        <span class="pq__avatar">
          <img v-if="authorAvatarUrl" :src="authorAvatarUrl" alt="" />
          <span v-else>{{ initials }}</span>
        </span>
        <span class="pq__author-text">
          <span v-if="authorName" class="pq__author-name">{{ authorName }}</span>
          <span v-if="authorRole" class="pq__author-role">{{ authorRole }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pq {
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  background: var(--color-ink);
  color: var(--color-ground);
}

.pq__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;
  max-width: var(--container-content);
  margin: 0 auto;
  text-align: center;
}

.pq__mark {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.3em;
  line-height: 1;
  color: var(--color-accent);
}

.pq__quote {
  margin: 0;
  max-width: 1080px;
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-tight);
  line-height: 120%;
  color: var(--color-ground);
}

.pq__author {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding-top: 24px;
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}
.pq__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-pill);
  background: linear-gradient(135deg, #F5A623 0%, #E85D5D 100%);
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: var(--weight-semibold);
  overflow: hidden;
  flex-shrink: 0;
}
.pq__avatar img { width: 100%; height: 100%; object-fit: cover; }

.pq__author-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
}
.pq__author-name {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: var(--weight-semibold);
  line-height: 22px;
  color: var(--color-ground);
}
.pq__author-role {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-medium);
  letter-spacing: var(--track-label);
  line-height: 14px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

@media (max-width: 1023px) {
  .pq { padding: 72px 40px; }
  .pq__quote { font-size: 40px; }
}
@media (max-width: 639px) {
  .pq { padding: 48px 20px; }
  .pq__inner { gap: 24px; }
  .pq__quote { font-size: 28px; line-height: 130%; }
}
</style>
