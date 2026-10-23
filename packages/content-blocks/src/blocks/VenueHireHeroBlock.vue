<script setup lang="ts">
/**
 * Venue-hire hero — Paper "Have your next thing at our place" design.
 * Left column: eyebrow + big display heading + description + stat pills
 * + primary/secondary CTAs. Right column: coloured feature card (photo
 * or tone gradient) with an overlay quote testimonial.
 */
import { computed, inject, isRef, type Ref } from 'vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type VenueHireHeroProps,
  type VenueTone,
} from '../types'

const props = withDefaults(defineProps<VenueHireHeroProps>(), {
  eyebrow: '',
  heading: 'Have your next thing at our place.',
  description: '',
  stats: () => [],
  primaryCta: () => ({ label: 'Check availability', href: '/venue-hire/book' }),
  secondaryCta: () => ({ label: '', href: '' }),
  cardEyebrow: '',
  cardBadge: '',
  cardTone: 'tangerine',
  cardImageUrl: '',
  testimonial: () => ({ quote: '', authorName: '' }),
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

const TONE_GRADIENTS: Record<VenueTone, string> = {
  accent:    'linear-gradient(160deg, var(--color-accent, #2563EB), var(--color-accent-strong, #1E40AF))',
  ink:       'linear-gradient(160deg, #1f2b36, #0A0A0B)',
  mint:      'linear-gradient(160deg, #22C55E, #14532D)',
  tangerine: 'linear-gradient(160deg, #F97316, #C2410C)',
  violet:    'linear-gradient(160deg, #7C3AED, #4C1D95)',
  sky:       'linear-gradient(160deg, #98D8E8, #4A90A4)',
}
const cardStyle = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  if (props.cardImageUrl) {
    out.backgroundImage = `linear-gradient(160deg, rgba(0,0,0,0.15), rgba(0,0,0,0.35)), url("${props.cardImageUrl}")`
    out.backgroundSize = 'cover'
    out.backgroundPosition = 'center'
  } else {
    out.background = TONE_GRADIENTS[props.cardTone] ?? TONE_GRADIENTS.tangerine!
  }
  return out
})

function initialsFor(name: string, initials?: string): string {
  if (initials) return initials.toUpperCase()
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
</script>

<template>
  <section class="vhh" :style="{ '--brand': brand } as any">
    <div class="vhh__grid">
      <!-- Left — editorial copy -->
      <div class="vhh__copy">
        <div v-if="props.eyebrow" class="vhh__eyebrow">
          <span class="vhh__eyebrow-dot" />
          <span>{{ props.eyebrow }}</span>
        </div>
        <h1 class="vhh__title" :class="`vhh__title--${props.headingSize ?? 'md'}`">{{ props.heading }}</h1>
        <p v-if="props.description" class="vhh__desc">{{ props.description }}</p>

        <ul v-if="props.stats && props.stats.length > 0" class="vhh__stats">
          <li v-for="(s, i) in props.stats" :key="i" class="vhh__stat">
            <span class="vhh__stat-value">{{ s.value }}</span>
            <span class="vhh__stat-label">{{ s.label }}</span>
          </li>
        </ul>

        <div class="vhh__actions">
          <a v-if="props.primaryCta.label" :href="props.primaryCta.href || '#'" class="vhh__primary">
            <span>{{ props.primaryCta.label }}</span>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
          </a>
          <a v-if="props.secondaryCta.label" :href="props.secondaryCta.href || '#'" class="vhh__secondary">
            {{ props.secondaryCta.label }}
          </a>
        </div>
      </div>

      <!-- Right — feature card -->
      <div class="vhh__card" :style="cardStyle">
        <div class="vhh__card-head">
          <div v-if="props.cardEyebrow" class="vhh__card-eyebrow">
            <span class="vhh__card-dot" />
            <span>{{ props.cardEyebrow }}</span>
          </div>
          <span v-if="props.cardBadge" class="vhh__card-badge">{{ props.cardBadge }}</span>
        </div>

        <div v-if="props.testimonial.quote" class="vhh__quote">
          <p class="vhh__quote-body">"{{ props.testimonial.quote }}"</p>
          <div class="vhh__quote-foot">
            <div class="vhh__quote-avatar">
              <img v-if="props.testimonial.authorAvatarUrl" :src="props.testimonial.authorAvatarUrl" :alt="props.testimonial.authorName" />
              <span v-else>{{ initialsFor(props.testimonial.authorName, props.testimonial.authorInitials) }}</span>
            </div>
            <div class="vhh__quote-meta">
              <div class="vhh__quote-author">{{ props.testimonial.authorName }}</div>
              <div v-if="props.testimonial.authorRole" class="vhh__quote-role">{{ props.testimonial.authorRole }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vhh {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 72px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
}

.vhh__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: stretch; min-height: 520px; }

/* Left copy */
.vhh__copy { display: flex; flex-direction: column; gap: 20px; }
.vhh__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.vhh__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); }
/* Heading scale shared with every hero block (brief: HeroHeadingSize).
   Default is 'md'; override via the editor's size picker. */
.vhh__title { font-family: var(--font-display); font-size: var(--h, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; max-width: 528px; }
.vhh__title--sm { --h: 48px; --h-md: 44px; --h-sm: 40px; --h-xs: 32px; }
.vhh__title--md { --h: 72px; --h-md: 64px; --h-sm: 56px; --h-xs: 40px; }
.vhh__title--lg { --h: 88px; --h-md: 80px; --h-sm: 64px; --h-xs: 44px; }
.vhh__title--xl { --h: 112px; --h-md: 96px; --h-sm: 72px; --h-xs: 48px; }
.vhh__desc { font-family: var(--font-body); font-size: 19px; line-height: 155%; color: var(--color-fog); margin: 0; max-width: 480px; }

.vhh__stats { list-style: none; padding: 24px 0; margin: 0; display: flex; flex-direction: row; gap: 48px; border-top: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); }
.vhh__stat { display: flex; flex-direction: column; gap: 4px; }
.vhh__stat-value { font-family: var(--font-display); font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); }
.vhh__stat-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }

.vhh__actions { display: flex; flex-direction: row; align-items: center; gap: 20px; margin-top: 8px; }
.vhh__primary { display: inline-flex; align-items: center; gap: 10px; padding: 16px 28px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 15px; font-weight: 600; text-decoration: none; transition: background 120ms; }
.vhh__primary:hover { background: var(--color-graphite); }
.vhh__secondary { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-graphite); text-decoration: underline; text-underline-offset: 4px; }
.vhh__secondary:hover { color: var(--color-ink); }

/* Right feature card */
.vhh__card { position: relative; display: flex; flex-direction: column; justify-content: space-between; padding: 32px; border-radius: 20px; overflow: hidden; color: #fff; min-height: 480px; }
.vhh__card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.vhh__card-eyebrow { display: inline-flex; align-items: center; gap: 10px; padding: 6px 14px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #fff; }
.vhh__card-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); }
.vhh__card-badge { padding: 8px 14px; background: #fff; color: var(--color-ink); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }

.vhh__quote { display: flex; flex-direction: column; gap: 12px; padding: 20px 22px; background: rgba(10, 10, 11, 0.72); backdrop-filter: blur(8px); border-radius: 14px; align-self: flex-end; max-width: 340px; }
.vhh__quote-body { font-family: var(--font-body); font-size: 14px; line-height: 155%; color: #fff; margin: 0; }
.vhh__quote-foot { display: flex; align-items: center; gap: 12px; }
.vhh__quote-avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
.vhh__quote-avatar img { width: 100%; height: 100%; object-fit: cover; }
.vhh__quote-meta { display: flex; flex-direction: column; gap: 2px; }
.vhh__quote-author { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: #fff; }
.vhh__quote-role { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: rgba(255,255,255,0.7); text-transform: uppercase; }

@media (max-width: 1279px) {
  .vhh__title { font-size: var(--h-md, 64px); }
}

@media (max-width: 1023px) {
  .vhh__grid { grid-template-columns: 1fr; gap: 32px; }
  .vhh__title { font-size: var(--h-sm, 56px); max-width: none; }
  .vhh__desc { font-size: 18px; max-width: 640px; }
  .vhh__card { min-height: 360px; }
  .vhh__stats { flex-wrap: wrap; gap: 24px; }
}

/* ─────────────────────────────────────────────────────────────────
   Mobile (≤640px).
   See Paper mobile artboard "Venue Hire · Mobile".
   Hero stacks tightly, stats condense into a single row with thin
   dividers, actions become full-width tap targets, testimonial card
   shrinks and loses the fixed min-height. Keeps width:100vw break-out
   so block fills the viewport past PageRenderer's gutter.
───────────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .vhh { padding: 32px 20px 24px; overflow-x: hidden; }

  .vhh__grid { gap: 20px; min-height: 0; }

  .vhh__copy { gap: 14px; }
  .vhh__eyebrow { font-size: 10px; letter-spacing: 0.08em; }
  .vhh__title { font-size: var(--h-xs, 40px); letter-spacing: -0.02em; line-height: 100%; max-width: none; }
  .vhh__desc { font-size: 16px; line-height: 150%; max-width: none; }

  /* Stats row: 3 columns separated by thin dividers, scaled down */
  .vhh__stats {
    padding: 14px 0;
    gap: 0;
    justify-content: space-between;
    flex-wrap: nowrap;
  }
  .vhh__stat { flex: 1; align-items: flex-start; gap: 2px; padding: 0 10px; border-left: 1px solid var(--color-hairline); }
  .vhh__stat:first-child { padding-left: 0; border-left: 0; }
  .vhh__stat-value { font-size: 28px; letter-spacing: -0.02em; line-height: 100%; }
  .vhh__stat-label { font-size: 10px; letter-spacing: 0.08em; }

  /* Actions stack full-width */
  .vhh__actions { flex-direction: column; align-items: stretch; gap: 10px; margin-top: 4px; }
  .vhh__primary { justify-content: center; height: 52px; padding: 0 20px; font-size: 15px; }
  .vhh__secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 20px;
    background: var(--color-ground);
    color: var(--color-ink);
    border: 1px solid var(--color-hairline);
    border-radius: 999px;
    font-weight: 600;
    text-decoration: none;
  }

  /* Testimonial card: tighter padding, shorter min-height, quote wraps edge-to-edge */
  .vhh__card { padding: 20px; min-height: 0; border-radius: 16px; }
  .vhh__card-head { gap: 10px; }
  .vhh__card-eyebrow { font-size: 9px; letter-spacing: 0.08em; padding: 4px 10px; }
  .vhh__card-badge { font-size: 9px; letter-spacing: 0.08em; padding: 4px 10px; }
  .vhh__quote { max-width: none; padding: 14px 16px; gap: 10px; align-self: stretch; }
  .vhh__quote-body { font-size: 15px; line-height: 140%; font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; }
}
</style>
