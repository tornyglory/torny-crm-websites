<script setup lang="ts">
/**
 * People grid — the "committee cards" block from Paper. Editorial header
 * (eyebrow + big heading + right-aligned intro) plus a grid of curated
 * people cards with colored initials avatars, name, role, body, and
 * email. Content is owner-authored per person so it isn't tied to who's
 * actually in the roster.
 */
import { computed, inject, isRef, type Ref } from 'vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type PeopleGridPerson,
  type PeopleGridProps,
  type PeopleGridTone,
} from '../types'

const props = withDefaults(defineProps<PeopleGridProps>(), {
  eyebrow: '',
  heading: '',
  subheading: '',
  people: () => [],
  columns: 4,
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

const TONE_MAP: Record<PeopleGridTone, { bg: string; fg: string }> = {
  accent:    { bg: 'var(--color-accent, #2563EB)', fg: '#fff' },
  ink:       { bg: 'var(--color-ink, #0A0A0B)',    fg: '#fff' },
  mint:      { bg: 'var(--color-feature-mint, #16A34A)',      fg: '#fff' },
  tangerine: { bg: 'var(--color-feature-tangerine, #EA580C)', fg: '#fff' },
  violet:    { bg: 'var(--color-feature-violet, #7C3AED)',    fg: '#fff' },
  sky:       { bg: 'var(--color-sky-1, #87CEEB)',             fg: 'var(--color-ink, #0A0A0B)' },
}
const TONE_KEYS: PeopleGridTone[] = ['accent', 'ink', 'tangerine', 'mint', 'violet', 'sky']

function initialsFor(p: PeopleGridPerson): string {
  if (p.initials) return p.initials.toUpperCase()
  const parts = p.name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return `${a}${b}`.toUpperCase()
}
function toneStyle(p: PeopleGridPerson, index: number): { background: string; color: string } {
  const key = p.tone ?? TONE_KEYS[index % TONE_KEYS.length]!
  const t = TONE_MAP[key] ?? TONE_MAP.accent
  return { background: t.bg, color: t.fg }
}
</script>

<template>
  <section class="pg" :style="{ '--brand': brand } as any">
    <header class="pg__head">
      <div class="pg__head-copy">
        <div v-if="props.eyebrow" class="pg__eyebrow">
          <span class="pg__eyebrow-dot" />
          <span>{{ props.eyebrow }}</span>
        </div>
        <h2 v-if="props.heading" class="pg__title">{{ props.heading }}</h2>
      </div>
      <p v-if="props.subheading" class="pg__sub">{{ props.subheading }}</p>
    </header>

    <ul class="pg__grid" :class="`pg__grid--cols-${props.columns}`" v-if="props.people.length > 0">
      <li v-for="(p, i) in props.people" :key="p.name + i" class="pg__card">
        <div class="pg__avatar" :style="toneStyle(p, i)">
          <img v-if="p.avatarUrl" :src="p.avatarUrl" :alt="p.name" />
          <span v-else>{{ initialsFor(p) }}</span>
        </div>
        <div class="pg__name">{{ p.name }}</div>
        <div v-if="p.role" class="pg__role">{{ p.role }}</div>
        <p v-if="p.body" class="pg__body">{{ p.body }}</p>
        <div v-if="p.email" class="pg__foot">
          <a class="pg__email" :href="`mailto:${p.email}`">{{ p.email }}</a>
        </div>
      </li>
    </ul>

    <div v-else class="pg__empty">
      <div class="pg__empty-title">No people added yet</div>
      <p>Add committee members or staff in the block editor to populate this section.</p>
    </div>
  </section>
</template>

<style scoped>
.pg {
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

/* Head — editorial split. Copy on the left, sub on the right, dashed rule
   underneath. */
.pg__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; padding-bottom: 24px; border-bottom: 1px dashed var(--color-hairline); }
.pg__head-copy { display: flex; flex-direction: column; gap: 12px; max-width: 900px; }
.pg__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.pg__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.pg__title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.pg__sub { font-family: var(--font-body); font-size: 14px; line-height: 155%; color: var(--color-fog); margin: 0; max-width: 300px; text-align: right; }

/* Grid */
.pg__grid { list-style: none; padding: 0; margin: 0; display: grid; gap: 24px; }
.pg__grid--cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.pg__grid--cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pg__grid--cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }

/* Card */
.pg__card { display: flex; flex-direction: column; gap: 12px; padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.pg__avatar {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 4px;
}
.pg__avatar img { width: 100%; height: 100%; object-fit: cover; }
.pg__name { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.15; }
.pg__role { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.pg__body { font-family: var(--font-body); font-size: 14px; line-height: 155%; color: var(--color-graphite); margin: 4px 0 0; }
.pg__foot { padding-top: 16px; margin-top: auto; border-top: 1px solid var(--color-hairline); }
.pg__email { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); text-decoration: none; word-break: break-all; }
.pg__email:hover { color: var(--color-ink); text-decoration: underline; text-underline-offset: 3px; }

.pg__empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.pg__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.pg__empty p { margin: 0; }

/* Responsive */
@media (max-width: 1023px) {
  .pg { gap: 40px; }
  .pg__head { flex-direction: column; align-items: stretch; gap: 16px; }
  .pg__sub { text-align: left; max-width: none; }
  .pg__grid--cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pg__grid--cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 599px) {
  .pg__grid { grid-template-columns: 1fr !important; }
}
</style>
