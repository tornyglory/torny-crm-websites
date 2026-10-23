<script setup lang="ts">
/**
 * FullBleedMediaBlock — cinematic hero with a video (or still image) that
 * fills the entire viewport width, headline + body + two CTAs overlaid on
 * top, and a readability scrim behind the type.
 *
 * The video attributes (`autoplay muted playsinline loop`) are the
 * mobile-safe combo iOS Safari needs to let a bg video play without a
 * user gesture. If a browser blocks autoplay anyway, the `poster` frame
 * (set to `imageUrl` when provided) stays visible.
 *
 * The admin picks the content position in the editor — `centre` is the
 * dramatic default; `bottom-left` is the editorial / event-focused layout.
 */
import { computed, ref } from 'vue'
import type { FullBleedMediaProps } from '../types'

const props = withDefaults(defineProps<FullBleedMediaProps>(), {
  mediaType: 'video',
  contentPosition: 'centre',
  overlayOpacity: 0.55,
})

const videoEl = ref<HTMLVideoElement | null>(null)
const isMuted = ref(true)

const showVideo = computed(() => props.mediaType === 'video' && !!props.videoUrl)
const showImage = computed(() => !showVideo.value && !!props.imageUrl)

const overlayStyle = computed(() => ({
  background:
    props.contentPosition === 'bottom-left'
      // Heavier scrim on the left so bottom-left copy stays legible against
      // any image. Falls off to transparent on the right.
      ? `linear-gradient(90deg, rgba(10,10,11,${Math.min(0.95, props.overlayOpacity + 0.3)}) 0%, rgba(10,10,11,${props.overlayOpacity}) 35%, rgba(10,10,11,${Math.max(0.05, props.overlayOpacity - 0.35)}) 65%, rgba(10,10,11,${Math.max(0, props.overlayOpacity - 0.45)}) 100%)`
      // Soft radial for the centred layout — darker edges, slightly lifted
      // middle so the subject of the video breathes.
      : `radial-gradient(ellipse at center, rgba(10,10,11,${Math.max(0.1, props.overlayOpacity - 0.15)}) 0%, rgba(10,10,11,${props.overlayOpacity + 0.2}) 100%)`,
}))

function toggleMute() {
  const v = videoEl.value
  if (!v) return
  v.muted = !v.muted
  isMuted.value = v.muted
}
</script>

<template>
  <section
    class="fbm"
    :class="[`fbm--${contentPosition}`]"
  >
    <!-- Media layer: video wins when both are provided. Poster covers the
         gap while the video buffers (or if autoplay is blocked). -->
    <video
      v-if="showVideo"
      ref="videoEl"
      class="fbm__media"
      :src="videoUrl"
      :poster="imageUrl"
      autoplay
      muted
      playsinline
      loop
      preload="metadata"
    />
    <img
      v-else-if="showImage"
      :src="imageUrl"
      alt=""
      class="fbm__media"
    />
    <!-- Fallback gradient when neither media source is supplied — keeps the
         block legible in the editor before the admin uploads anything. -->
    <div
      v-else
      class="fbm__media fbm__media--placeholder"
      aria-hidden="true"
    />

    <div class="fbm__scrim" :style="overlayStyle" aria-hidden="true" />

    <div class="fbm__content">
      <div v-if="eyebrow" class="fbm__eyebrow">
        <span class="fbm__eyebrow-dot" aria-hidden="true" />
        {{ eyebrow }}
      </div>

      <h1 class="fbm__heading" :class="`fbm__heading--${headingSize ?? 'xl'}`">{{ heading }}</h1>

      <p v-if="body" class="fbm__body">{{ body }}</p>

      <div v-if="primaryCta || secondaryCta" class="fbm__ctas">
        <a
          v-if="primaryCta"
          :href="primaryCta.href"
          class="fbm__cta fbm__cta--primary"
        >
          {{ primaryCta.label }}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2.5 7h8M7 3.5L10.5 7 7 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
        <a
          v-if="secondaryCta"
          :href="secondaryCta.href"
          class="fbm__cta fbm__cta--secondary"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <polygon points="3,1.5 3,10.5 9.5,6" fill="currentColor" />
          </svg>
          {{ secondaryCta.label }}
        </a>
      </div>
    </div>

    <!-- Bottom-left caption — centred layout only -->
    <div
      v-if="bottomCaption && contentPosition === 'centre'"
      class="fbm__caption"
    >
      <span class="fbm__caption-tick" aria-hidden="true" />
      <span>{{ bottomCaption }}</span>
    </div>

    <!-- Unmute chip — only shown when there's actually a video playing -->
    <button
      v-if="showVideo && !hideUnmuteChip"
      type="button"
      class="fbm__unmute"
      :class="{ 'fbm__unmute--playing': !isMuted }"
      :aria-pressed="!isMuted"
      :aria-label="isMuted ? 'Unmute video' : 'Mute video'"
      @click="toggleMute"
    >
      <span class="fbm__unmute-dot" aria-hidden="true">
        <span />
      </span>
      <!-- Label hidden on mobile — the icon + status dot carry the meaning
           and the accessible name stays on the button via aria-label. -->
      <span class="fbm__unmute-label">
        {{ isMuted ? 'Tap for sound' : 'Playing · tap to mute' }}
      </span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M2 3h3l3-2v10l-3-2H2z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-if="!isMuted"
          d="M9 4a2 2 0 0 1 0 4"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </section>
</template>

<style scoped>
.fbm {
  position: relative;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  min-height: 720px;
  display: flex;
  overflow: hidden;
  background: #0A0A0B;
  color: #fff;
}
/* Centred layout — flexbox centres the content block both axes. */
.fbm--centre {
  align-items: center;
  justify-content: center;
  text-align: center;
  /* Horizontal padding mirrors PageRenderer's container formula so hero
     copy aligns with every block below (1280px column, 48px min gutter). */
  padding: 120px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
}
/* Bottom-left layout — content anchors to lower-left. */
.fbm--bottom-left {
  align-items: flex-end;
  justify-content: flex-start;
  text-align: left;
  padding: 120px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 96px;
}

.fbm__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  pointer-events: none;
}
.fbm__media--placeholder {
  background: radial-gradient(circle at 70% 30%, #1E40AF 0%, #0F172A 55%, #050812 100%);
}

.fbm__scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.fbm__content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1100px;
}
.fbm--centre .fbm__content { align-items: center; }
.fbm--bottom-left .fbm__content {
  align-items: flex-start;
  max-width: 820px;
  gap: 22px;
}

.fbm__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.fbm__eyebrow-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-sky-1, #87CEEB);
}

.fbm__heading {
  font-family: var(--font-display);
  /* Shared HeroHeadingSize scale — modifier class sets the stops. */
  font-size: var(--h, 112px);
  font-weight: 500;
  color: #fff;
  letter-spacing: -0.04em;
  line-height: 95%;
  margin: 0;
}
.fbm__heading--sm { --h: 48px; --h-md: 44px; --h-sm: 40px; --h-xs: 32px; }
.fbm__heading--md { --h: 72px; --h-md: 64px; --h-sm: 56px; --h-xs: 40px; }
.fbm__heading--lg { --h: 88px; --h-md: 80px; --h-sm: 64px; --h-xs: 44px; }
.fbm__heading--xl { --h: 112px; --h-md: 96px; --h-sm: 72px; --h-xs: 48px; }
/* Bottom-left layout dials the headline down one step so the body isn't
 * crushed against the viewport edge. */
.fbm--bottom-left .fbm__heading { letter-spacing: -0.035em; }
.fbm--bottom-left .fbm__heading--xl { --h: 88px; --h-md: 80px; --h-sm: 64px; --h-xs: 44px; }
.fbm--bottom-left .fbm__heading--lg { --h: 72px; --h-md: 64px; --h-sm: 56px; --h-xs: 40px; }

.fbm__body {
  font-family: var(--font-body);
  font-size: 18px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.5;
  margin: 0;
  max-width: 580px;
}
.fbm--bottom-left .fbm__body {
  font-size: 17px;
  max-width: 520px;
}

.fbm__ctas {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.fbm__cta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 26px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.fbm__cta--primary {
  background: #fff;
  color: #0A0A0B;
}
.fbm__cta--primary:hover {
  background: var(--color-surface, #F5F5F2);
  transform: translateY(-1px);
}
.fbm__cta--secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(8px);
  font-weight: 500;
  padding: 0 24px;
}
.fbm__cta--secondary:hover {
  background: rgba(255, 255, 255, 0.14);
}

.fbm__caption {
  position: absolute;
  left: 48px;
  bottom: 36px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.fbm__caption-tick {
  width: 36px;
  height: 1px;
  background: rgba(255, 255, 255, 0.4);
}

.fbm__unmute {
  position: absolute;
  /* Match the container formula so the chip's right edge aligns with
     the right edge of the hero copy and every block below. */
  right: max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  bottom: 32px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(10, 10, 11, 0.55);
  backdrop-filter: blur(10px);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.fbm__unmute:hover { background: rgba(10, 10, 11, 0.75); color: #fff; }
.fbm--bottom-left .fbm__unmute { bottom: auto; top: 100px; }
.fbm__unmute-dot {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #DC2F3B;
}
.fbm__unmute-dot > span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #fff;
}
.fbm__unmute--playing .fbm__unmute-dot { background: var(--color-success, #2E5D3C); }

/* Stepped heading scale — mirrors HeroBlock / VenueHireHero breakpoints
 * so every hero on the site steps at the same viewport thresholds. */
@media (max-width: 1279px) { .fbm__heading { font-size: var(--h-md, 96px); } }
@media (max-width: 1023px) { .fbm__heading { font-size: var(--h-sm, 72px); } }

@media (max-width: 768px) {
  .fbm__heading { font-size: var(--h-xs, 48px); }
  .fbm { min-height: 620px; }
  .fbm--centre { padding: 96px 20px; }
  .fbm--bottom-left { padding: 96px 20px 72px; }
  .fbm__content { gap: 18px; }
  .fbm__body { font-size: 15px; }
  .fbm__ctas { flex-direction: column; align-items: stretch; width: 100%; gap: 10px; }
  .fbm__cta { justify-content: center; height: 48px; padding: 0 22px; font-size: 14px; }
  .fbm__caption { left: 20px; bottom: 20px; }
  /* Compact icon-only button on mobile — the headline is tight against
     the top of the hero and the full chip was crowding the eyebrow. */
  .fbm__unmute {
    right: 12px;
    bottom: 16px;
    gap: 0;
    padding: 0;
    width: 32px;
    height: 32px;
    justify-content: center;
    border-radius: 999px;
  }
  .fbm--bottom-left .fbm__unmute { top: 72px; }
  .fbm__unmute-label { display: none; }
  .fbm__unmute-dot { width: 10px; height: 10px; position: absolute; top: 2px; right: 2px; }
  .fbm__unmute-dot > span { width: 4px; height: 4px; }
  .fbm__unmute svg { width: 14px; height: 14px; }
}
</style>
