<script setup lang="ts">
/**
 * Venue packages — Paper "Bowls for your team, delivered" design.
 * Editorial centered header + three tier cards (Team afternoon /
 * Corporate day / Full takeover). Middle card can be flagged
 * `featured` for the ink-on-white hero treatment. Optional footer
 * strip with a contact person + CTA.
 */
import { computed, inject, isRef, type Ref } from 'vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type VenuePackagesProps,
} from '../types'

const props = withDefaults(defineProps<VenuePackagesProps>(), {
  eyebrow: '',
  heading: 'Bowls for your team, delivered.',
  description: '',
  packages: () => [],
  footer: () => ({}),
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

function initialsFor(name: string, initials?: string): string {
  if (initials) return initials.toUpperCase()
  const parts = (name ?? '').trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase() || '?'
}
const hasFooter = computed(() =>
  Boolean(props.footer && (props.footer.text || props.footer.eyebrow || props.footer.ctaLabel)),
)
</script>

<template>
  <section class="vp" :style="{ '--brand': brand } as any">
    <header class="vp__head">
      <div v-if="props.eyebrow" class="vp__eyebrow">
        <span class="vp__eyebrow-dot" />
        <span>{{ props.eyebrow }}</span>
      </div>
      <h2 v-if="props.heading" class="vp__title">{{ props.heading }}</h2>
      <p v-if="props.description" class="vp__desc">{{ props.description }}</p>
    </header>

    <ul v-if="props.packages.length > 0" class="vp__grid">
      <li
        v-for="(pkg, i) in props.packages"
        :key="pkg.name + i"
        class="vp__card"
        :class="{ 'vp__card--featured': pkg.featured }"
      >
        <div class="vp__card-head">
          <span v-if="pkg.eyebrow" class="vp__card-eyebrow">
            <span class="vp__card-dot" />
            <span>{{ pkg.eyebrow }}</span>
          </span>
          <span v-if="pkg.badge" class="vp__card-badge">{{ pkg.badge }}</span>
        </div>
        <div class="vp__card-name">{{ pkg.name }}</div>

        <div v-if="pkg.price" class="vp__card-price">
          <span class="vp__card-price-value">{{ pkg.price }}</span>
          <span v-if="pkg.priceSuffix" class="vp__card-price-suffix">{{ pkg.priceSuffix }}</span>
        </div>

        <ul v-if="pkg.includes && pkg.includes.length > 0" class="vp__includes">
          <li v-for="(inc, ii) in pkg.includes" :key="ii">
            <svg class="vp__check" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4"/></svg>
            <span>{{ inc }}</span>
          </li>
        </ul>

        <p v-if="pkg.smallPrint" class="vp__small-print">{{ pkg.smallPrint }}</p>

        <a v-if="pkg.ctaLabel" :href="pkg.ctaHref || '#'" class="vp__book">
          <span>{{ pkg.ctaLabel }}</span>
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
        </a>
      </li>
    </ul>

    <div v-else class="vp__empty">
      <div class="vp__empty-title">No packages added yet</div>
      <p>Add tier packages (half day, full day, exclusive takeover) in the block editor.</p>
    </div>

    <div v-if="hasFooter" class="vp__footer">
      <div class="vp__footer-copy">
        <div v-if="props.footer.eyebrow" class="vp__footer-eyebrow">
          <span class="vp__eyebrow-dot" />
          <span>{{ props.footer.eyebrow }}</span>
        </div>
        <p v-if="props.footer.text" class="vp__footer-text">{{ props.footer.text }}</p>
      </div>
      <div class="vp__footer-actions">
        <a v-if="props.footer.ctaLabel" :href="props.footer.ctaHref || '#'" class="vp__footer-cta">
          <span>{{ props.footer.ctaLabel }}</span>
          <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
        </a>
        <div v-if="props.footer.contactName" class="vp__footer-person">
          <div class="vp__footer-avatar">
            <img v-if="props.footer.contactAvatarUrl" :src="props.footer.contactAvatarUrl" :alt="props.footer.contactName" />
            <span v-else>{{ initialsFor(props.footer.contactName, props.footer.contactInitials) }}</span>
          </div>
          <div class="vp__footer-name-block">
            <div class="vp__footer-name">{{ props.footer.contactName }}</div>
            <div v-if="props.footer.contactRole" class="vp__footer-role">{{ props.footer.contactRole }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vp {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: 56px;
}

.vp__head { display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; }
.vp__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.vp__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.vp__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; max-width: 780px; }
.vp__desc { font-family: var(--font-body); font-size: 16px; line-height: 155%; color: var(--color-fog); margin: 0; max-width: 620px; }

/* Grid */
.vp__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: stretch; }
.vp__card { display: flex; flex-direction: column; gap: 20px; padding: 32px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; }
.vp__card--featured { background: var(--color-ink); color: #fff; border-color: var(--color-ink); transform: translateY(-8px); box-shadow: 0 24px 60px -24px rgba(15, 23, 42, 0.24); }

.vp__card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.vp__card-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vp__card--featured .vp__card-eyebrow { color: rgba(255,255,255,0.7); }
.vp__card-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); }
.vp__card-badge { padding: 4px 10px; background: var(--brand); color: #fff; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }

.vp__card-name { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }

.vp__card-price { display: flex; align-items: baseline; gap: 8px; padding: 12px 0; border-top: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); }
.vp__card--featured .vp__card-price { border-color: rgba(255,255,255,0.15); }
.vp__card-price-value { font-family: var(--font-display); font-size: 44px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
.vp__card-price-suffix { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.vp__card--featured .vp__card-price-suffix { color: rgba(255,255,255,0.65); }

.vp__includes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.vp__includes li { display: flex; align-items: flex-start; gap: 10px; font-family: var(--font-body); font-size: 14px; line-height: 150%; }
.vp__check { flex-shrink: 0; margin-top: 4px; color: var(--brand); }
.vp__card--featured .vp__check { color: var(--brand); }

.vp__small-print { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: -8px 0 0; padding-top: 12px; border-top: 1px dashed var(--color-hairline); line-height: 150%; }
.vp__card--featured .vp__small-print { color: rgba(255,255,255,0.6); border-color: rgba(255,255,255,0.15); }

.vp__book { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 20px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; text-decoration: none; margin-top: auto; transition: background 120ms; }
.vp__book:hover { background: var(--color-graphite); }
.vp__card--featured .vp__book { background: #fff; color: var(--color-ink); }
.vp__card--featured .vp__book:hover { background: var(--color-surface); }

.vp__empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.vp__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.vp__empty p { margin: 0; }

/* Footer strip */
.vp__footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 32px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 20px; }
.vp__footer-copy { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.vp__footer-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.vp__footer-text { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; line-height: 150%; }
.vp__footer-actions { display: flex; align-items: center; gap: 20px; flex-shrink: 0; }
.vp__footer-cta { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--color-ink); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; }
.vp__footer-cta:hover { background: var(--color-graphite); }
.vp__footer-person { display: flex; align-items: center; gap: 10px; }
.vp__footer-avatar { width: 40px; height: 40px; border-radius: 999px; background: var(--brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
.vp__footer-avatar img { width: 100%; height: 100%; object-fit: cover; }
.vp__footer-name-block { display: flex; flex-direction: column; }
.vp__footer-name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.vp__footer-role { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }

@media (max-width: 1023px) {
  .vp__grid { grid-template-columns: 1fr; gap: 16px; }
  .vp__card--featured { transform: none; }
  .vp__footer { flex-direction: column; align-items: stretch; }
  .vp__footer-actions { flex-wrap: wrap; }
}
</style>
