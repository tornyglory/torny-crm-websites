<script setup lang="ts">
/**
 * Website page editor.
 *
 * Vertical-list block editor. Same shell for all 6 public pages (home,
 * about, membership, events, honour-board, contact) — the active page
 * comes from the route param `pageSlug`. Each page has its own curated
 * palette + seed layout + storage bucket, so switching pages doesn't mix
 * blocks between them.
 *
 * Backend endpoints (brief 16) not shipped yet — layouts persist to
 * localStorage under `torny.website.{clubId}.{pageSlug}` until they
 * land. The save/publish handlers already carry the right shape for the
 * eventual PATCH / POST /publish calls; swap the two functions when
 * ready.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import ImagePicker from '@/components/ImagePicker.vue'
import type {
  Block,
  BlockType,
  HeroProps,
  RichTextProps,
  EventListProps,
  HonourBoardProps,
  GalleryProps,
  ContactFormProps,
  MembershipCtaProps,
  CtaBannerProps,
} from '@torny/content-blocks'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

// ── Page slugs ────────────────────────────────────────────
type PageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
const PAGE_SLUGS: PageSlug[] = ['home', 'about', 'membership', 'events', 'honour-board', 'contact']
const PAGE_LABELS: Record<PageSlug, string> = {
  home: 'Home',
  about: 'About',
  membership: 'Membership',
  events: 'Events',
  'honour-board': 'Honour board',
  contact: 'Contact',
}
const PAGE_SUBTITLES: Record<PageSlug, string> = {
  home: 'The front door — hero, upcoming events, a nudge to join.',
  about: 'Who you are and what makes the club feel like home.',
  membership: 'Show your tiers and why someone would join.',
  events: 'What\'s coming up. Auto-pulled from the events calendar.',
  'honour-board': 'A century of results, category by category.',
  contact: 'How people reach the club — address, hours, contact form.',
}

const currentPage = computed<PageSlug>(() => {
  const s = route.params.pageSlug as string | undefined
  return s && (PAGE_SLUGS as string[]).includes(s) ? (s as PageSlug) : 'home'
})

function switchPage(slug: PageSlug): void {
  if (slug === currentPage.value) return
  router.push({ name: 'website', params: { pageSlug: slug } })
}

// ── Types + block palettes ────────────────────────────────
interface PaletteItem {
  type: BlockType
  label: string
  hint: string
  icon: string  // simple text icon for MVP
  defaults: () => Block['props']
}

const clubName = (): string => clubStore.current?.name ?? 'Your club'

const heroDefault = (heading: string, sub: string, cta1: [string, string], cta2?: [string, string]): HeroProps => ({
  heading,
  subheading: sub,
  primaryCta: { label: cta1[0], href: cta1[1] },
  ...(cta2 ? { secondaryCta: { label: cta2[0], href: cta2[1] } } : {}),
})

const PALETTES: Record<PageSlug, PaletteItem[]> = {
  home: [
    { type: 'hero', label: 'Hero', hint: 'Big heading, tagline, two CTAs', icon: '☰',
      defaults: (): HeroProps => heroDefault(clubName(), 'A friendly bowls club. New members always welcome.', ['Join us', '/membership'], ['See what\'s on', '/events']) },
    { type: 'richText', label: 'Rich text', hint: 'A block of writing', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Tell your visitors about the club — history, atmosphere, what makes you different.</p>' }) },
    { type: 'eventList', label: 'Events', hint: 'Auto-pulled from your events calendar', icon: '◧',
      defaults: (): EventListProps => ({ heading: "What's on", limit: 4, upcomingOnly: true }) },
    { type: 'gallery', label: 'Gallery', hint: 'A photo strip of the club', icon: '▨',
      defaults: (): GalleryProps => ({ heading: 'Around the club', images: [] }) },
    { type: 'membershipCta', label: 'Membership CTA', hint: 'Push people to /membership', icon: '★',
      defaults: (): MembershipCtaProps => ({ heading: 'Play with us this season', body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.', ctaLabel: 'See tiers', ctaHref: '/membership' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Have questions? Get in touch.', ctaLabel: 'Contact us', ctaHref: '/contact', tone: 'accent' }) },
  ],
  about: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('About the club', 'Our story, in short.', ['See membership', '/membership']) },
    { type: 'richText', label: 'Rich text', hint: 'History, atmosphere, values', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Founded in <strong>[year]</strong>, we\'re a community club welcoming all levels of bowler…</p>' }) },
    { type: 'gallery', label: 'Gallery', hint: 'Photos of the greens, the pavilion, the people', icon: '▨',
      defaults: (): GalleryProps => ({ heading: 'The club', images: [] }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Come down for a roll-up.', ctaLabel: 'Contact us', ctaHref: '/contact', tone: 'ink' }) },
  ],
  membership: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Membership', 'Choose the tier that fits how you play.', ['Contact us', '/contact']) },
    { type: 'richText', label: 'Rich text', hint: 'Benefits, discounts, joining process', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Every level has full clubhouse access. Discounted first year for new joiners.</p>' }) },
    { type: 'membershipCta', label: 'Membership CTA', hint: 'A join-us block with a button', icon: '★',
      defaults: (): MembershipCtaProps => ({ heading: 'Ready to join?', body: 'Send us a note and we\'ll get you sorted.', ctaLabel: 'Get in touch', ctaHref: '/contact' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Questions about a tier?', ctaLabel: 'Ask us', ctaHref: '/contact', tone: 'surface' }) },
  ],
  events: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault("What's on", 'Tournaments, roll-ups, training nights.', ['Contact us', '/contact']) },
    { type: 'richText', label: 'Rich text', hint: 'Intro / booking notes', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Everything coming up at the club. Members can RSVP directly.</p>' }) },
    { type: 'eventList', label: 'Events list', hint: 'The full upcoming feed', icon: '◧',
      defaults: (): EventListProps => ({ heading: 'Upcoming', limit: 20, upcomingOnly: true }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Want to run an event?', ctaLabel: 'Tell us more', ctaHref: '/contact', tone: 'accent' }) },
  ],
  'honour-board': [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Honour board', 'A century of results.', ['Back to the club', '/']) },
    { type: 'richText', label: 'Rich text', hint: 'Preamble', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Winners of every competition, year by year.</p>' }) },
    { type: 'honourBoard', label: 'Honour board', hint: 'Recent honour-board entries grouped by category', icon: '♛',
      defaults: (): HonourBoardProps => ({ heading: undefined, yearsToShow: 10 }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Notice something missing?', ctaLabel: 'Let us know', ctaHref: '/contact', tone: 'surface' }) },
  ],
  contact: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Contact', 'Say hello. We\'ll get back to you.', ['Directions', '#directions']) },
    { type: 'richText', label: 'Rich text', hint: 'Address, hours, notes', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>You\'ll find us at the club most afternoons. Drop a note below or email direct.</p>' }) },
    { type: 'contactForm', label: 'Contact form', hint: 'A simple message form', icon: '✉',
      defaults: (): ContactFormProps => ({ heading: 'Drop us a note', submitLabel: 'Send', successMessage: 'Thanks — we\'ll be in touch.' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Prefer to call?', ctaLabel: 'Give us a ring', ctaHref: 'tel:+', tone: 'ink' }) },
  ],
}

const BLOCK_LABEL: Record<BlockType, string> = {
  hero: 'Hero',
  richText: 'Rich text',
  eventList: 'Events',
  honourBoard: 'Honour board',
  gallery: 'Gallery',
  contactForm: 'Contact form',
  membershipCta: 'Membership CTA',
  ctaBanner: 'CTA banner',
}

// ── Seed layouts (per page) ───────────────────────────────
function newBlockId(): string {
  return `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function seed(...blocks: Array<{ type: BlockType; props: Block['props'] }>): Block[] {
  return blocks.map((b) => ({ id: newBlockId(), type: b.type, props: b.props }) as Block)
}

const SEEDS: Record<PageSlug, () => Block[]> = {
  home: () => seed(
    { type: 'hero', props: heroDefault(clubName(), 'A friendly bowls club. New members always welcome.', ['Join us', '/membership'], ['See what\'s on', '/events']) },
    { type: 'eventList', props: { heading: "What's on", limit: 4, upcomingOnly: true } satisfies EventListProps },
    { type: 'membershipCta', props: { heading: 'Play with us this season', body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.', ctaLabel: 'See tiers', ctaHref: '/membership' } satisfies MembershipCtaProps },
  ),
  about: () => seed(
    { type: 'hero', props: heroDefault('About the club', 'Our story, in short.', ['See membership', '/membership']) },
    { type: 'richText', props: { html: `<p>Founded in <strong>[year]</strong>, ${clubName()} has been a friendly place to bowl ever since. New members and visitors are always welcome — come down for a roll-up.</p>` } satisfies RichTextProps },
    { type: 'gallery', props: { heading: 'Around the club', images: [] } satisfies GalleryProps },
  ),
  membership: () => seed(
    { type: 'hero', props: heroDefault('Membership', 'Choose the tier that fits how you play.', ['Contact us', '/contact']) },
    { type: 'richText', props: { html: '<p>Every level has full clubhouse access. Discounted first year for new joiners.</p>' } satisfies RichTextProps },
    { type: 'membershipCta', props: { heading: 'Ready to join?', body: 'Send us a note and we\'ll get you sorted.', ctaLabel: 'Get in touch', ctaHref: '/contact' } satisfies MembershipCtaProps },
  ),
  events: () => seed(
    { type: 'hero', props: heroDefault("What's on", 'Tournaments, roll-ups, training nights.', ['Contact us', '/contact']) },
    { type: 'eventList', props: { heading: 'Upcoming', limit: 20, upcomingOnly: true } satisfies EventListProps },
  ),
  'honour-board': () => seed(
    { type: 'hero', props: heroDefault('Honour board', 'A century of results.', ['Back to the club', '/']) },
    { type: 'honourBoard', props: { heading: undefined, yearsToShow: 10 } satisfies HonourBoardProps },
  ),
  contact: () => seed(
    { type: 'hero', props: heroDefault('Contact', 'Say hello. We\'ll get back to you.', ['Directions', '#directions']) },
    { type: 'contactForm', props: { heading: 'Drop us a note', submitLabel: 'Send', successMessage: 'Thanks — we\'ll be in touch.' } satisfies ContactFormProps },
  ),
}

// ── Persistence (localStorage MVP) ────────────────────────
function storageKey(slug: PageSlug): string | null {
  const cid = clubStore.current?.id
  return cid ? `torny.website.${cid}.${slug}` : null
}

interface StoredLayout {
  blocks: Block[]
  draftUpdatedAt: string
  publishedAt: string | null
  publishedBlocks: Block[] | null
}

function loadFromStorage(slug: PageSlug): StoredLayout {
  const key = storageKey(slug)
  const empty: StoredLayout = { blocks: SEEDS[slug](), draftUpdatedAt: new Date().toISOString(), publishedAt: null, publishedBlocks: null }
  if (!key) return empty
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as StoredLayout
    return {
      blocks: parsed.blocks ?? SEEDS[slug](),
      draftUpdatedAt: parsed.draftUpdatedAt ?? new Date().toISOString(),
      publishedAt: parsed.publishedAt ?? null,
      publishedBlocks: parsed.publishedBlocks ?? null,
    }
  } catch {
    return empty
  }
}

const state = reactive<StoredLayout>(loadFromStorage(currentPage.value))
const selectedId = ref<string | null>(state.blocks[0]?.id ?? null)
const paletteOpen = ref<null | { after: string | null }>(null)
const saving = ref(false)
const publishing = ref(false)

// Reload when either the active club OR the active page changes.
watch([() => clubStore.current?.id, currentPage], ([, slug]) => {
  const fresh = loadFromStorage(slug)
  Object.assign(state, fresh)
  selectedId.value = state.blocks[0]?.id ?? null
  paletteOpen.value = null
})

const selectedBlock = computed<Block | null>(() => state.blocks.find((b) => b.id === selectedId.value) ?? null)

const hasUnpublishedChanges = computed(() => {
  if (!state.publishedBlocks) return state.blocks.length > 0
  return JSON.stringify(state.blocks) !== JSON.stringify(state.publishedBlocks)
})

function persist(): void {
  const key = storageKey(currentPage.value)
  if (!key) return
  state.draftUpdatedAt = new Date().toISOString()
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* localStorage full — non-fatal */
  }
}

// Debounced autosave on any change to the layout.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saving.value = true
  saveTimer = setTimeout(() => {
    persist()
    saving.value = false
    // Once brief 16 §2.2 lands, replace persist() with:
    //   await pages.patch(clubId, currentPage.value, { layout_draft: { blocks: state.blocks } })
  }, 500)
}

watch(() => state.blocks, scheduleSave, { deep: true })

// ── Block ops ─────────────────────────────────────────────
function addBlock(type: BlockType, afterId: string | null): void {
  const palette = PALETTES[currentPage.value].find((p) => p.type === type)
  if (!palette) return
  const block = { id: newBlockId(), type, props: palette.defaults() } as Block
  const idx = afterId ? state.blocks.findIndex((b) => b.id === afterId) : -1
  if (idx === -1) state.blocks.push(block)
  else state.blocks.splice(idx + 1, 0, block)
  selectedId.value = block.id
  paletteOpen.value = null
}

function removeBlock(id: string): void {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  state.blocks.splice(idx, 1)
  if (selectedId.value === id) selectedId.value = state.blocks[Math.max(0, idx - 1)]?.id ?? null
}

function moveBlock(id: string, dir: -1 | 1): void {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  const target = idx + dir
  if (target < 0 || target >= state.blocks.length) return
  const [block] = state.blocks.splice(idx, 1) as [Block]
  state.blocks.splice(target, 0, block)
}

// ── Publish (mocked until brief 16 §2.3 lands) ────────────
async function publish(): Promise<void> {
  if (!hasUnpublishedChanges.value) return
  publishing.value = true
  try {
    // Once brief 16 §2.3 lands:
    //   await pages.publish(clubId, currentPage.value)
    await new Promise((r) => setTimeout(r, 600))
    state.publishedBlocks = JSON.parse(JSON.stringify(state.blocks)) as Block[]
    state.publishedAt = new Date().toISOString()
    persist()
    toast.success(`${PAGE_LABELS[currentPage.value]} page published.`)
  } finally {
    publishing.value = false
  }
}

const PREVIEW_PATHS: Record<PageSlug, string> = {
  home: '/',
  about: '/about',
  membership: '/membership',
  events: '/events',
  'honour-board': '/honour-board',
  contact: '/contact',
}

function preview(): void {
  const slug = clubStore.current?.slug
  if (!slug) {
    toast.info('Preview needs an active club.')
    return
  }
  const path = PREVIEW_PATHS[currentPage.value]
  window.open(`http://localhost:3001${path}?host=${slug}.torny.club`, '_blank', 'noopener')
}

// ── Block summary (shown in the list row) ─────────────────
function blockSummary(block: Block): string {
  switch (block.type) {
    case 'hero':          return (block.props as HeroProps).heading || '(no heading)'
    case 'richText':      return stripHtml((block.props as RichTextProps).html).slice(0, 60)
    case 'eventList':     return (block.props as EventListProps).heading ?? `${(block.props as EventListProps).limit ?? 4} upcoming events`
    case 'honourBoard':   return (block.props as HonourBoardProps).heading || `Honour board — last ${(block.props as HonourBoardProps).yearsToShow ?? 10} years`
    case 'gallery':       return `${(block.props as GalleryProps).images.length} photos`
    case 'contactForm':   return (block.props as ContactFormProps).heading || 'Contact form'
    case 'membershipCta': return (block.props as MembershipCtaProps).heading || '(no heading)'
    case 'ctaBanner':     return (block.props as CtaBannerProps).heading || '(no heading)'
    default:              return ''
  }
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const lastSavedLabel = computed(() => {
  if (saving.value) return 'Saving…'
  const then = new Date(state.draftUpdatedAt).getTime()
  const ago = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (ago < 5) return 'Saved'
  if (ago < 60) return `Saved ${ago}s ago`
  if (ago < 3600) return `Saved ${Math.round(ago / 60)}m ago`
  return `Saved ${Math.round(ago / 3600)}h ago`
})
</script>

<template>
  <div class="web">
    <header class="web__header">
      <div>
        <div class="web__eyebrow">Website</div>
        <h1 class="web__heading">{{ PAGE_LABELS[currentPage] }} page</h1>
        <p class="web__sub">{{ PAGE_SUBTITLES[currentPage] }}</p>
      </div>
      <div class="web__actions">
        <span class="web__save-hint">{{ lastSavedLabel }}</span>
        <button class="btn btn--outline" @click="preview">Preview →</button>
        <button
          class="btn btn--primary"
          :disabled="!hasUnpublishedChanges || publishing"
          @click="publish"
        >
          {{ publishing ? 'Publishing…' : hasUnpublishedChanges ? 'Publish changes' : 'Published' }}
        </button>
      </div>
    </header>

    <nav class="page-tabs" aria-label="Website pages">
      <button
        v-for="slug in PAGE_SLUGS"
        :key="slug"
        type="button"
        class="page-tab"
        :class="{ 'page-tab--active': currentPage === slug }"
        @click="switchPage(slug)"
      >{{ PAGE_LABELS[slug] }}</button>
    </nav>

    <div class="web__body">
      <!-- Block list -->
      <section class="list">
        <div v-if="state.blocks.length === 0" class="empty">
          <div class="empty__title">Empty page.</div>
          <div class="empty__hint">Add your first block below to get started.</div>
        </div>

        <template v-for="(block, i) in state.blocks" :key="block.id">
          <!-- Insert-here slot above every block -->
          <div class="inserter" :class="{ 'inserter--open': paletteOpen?.after === (state.blocks[i - 1]?.id ?? null) && i === 0 }">
            <button v-if="i === 0" type="button" class="inserter__btn" @click="paletteOpen = { after: null }">+ Add block</button>
          </div>

          <!-- Block card -->
          <article
            class="block"
            :class="{ 'block--selected': selectedId === block.id }"
            @click="selectedId = block.id"
          >
            <div class="block__handle">
              <button type="button" class="block__arrow" :disabled="i === 0" @click.stop="moveBlock(block.id, -1)" aria-label="Move up">▲</button>
              <button type="button" class="block__arrow" :disabled="i === state.blocks.length - 1" @click.stop="moveBlock(block.id, 1)" aria-label="Move down">▼</button>
            </div>
            <div class="block__body">
              <div class="block__type">{{ BLOCK_LABEL[block.type] }}</div>
              <div class="block__summary">{{ blockSummary(block) }}</div>
            </div>
            <button type="button" class="block__delete" @click.stop="removeBlock(block.id)" aria-label="Delete">×</button>
          </article>

          <!-- Insert-here slot below every block -->
          <div class="inserter" :class="{ 'inserter--open': paletteOpen?.after === block.id }">
            <button type="button" class="inserter__btn" @click="paletteOpen = { after: block.id }">+ Add block</button>
            <div v-if="paletteOpen?.after === block.id" class="palette" @click.stop>
              <button
                v-for="p in PALETTES[currentPage]"
                :key="p.type"
                type="button"
                class="palette__item"
                @click="addBlock(p.type, block.id)"
              >
                <span class="palette__icon">{{ p.icon }}</span>
                <span class="palette__label">
                  <span class="palette__name">{{ p.label }}</span>
                  <span class="palette__hint">{{ p.hint }}</span>
                </span>
              </button>
            </div>
          </div>
        </template>

        <!-- Palette when the page is empty (opened above the first row) -->
        <div v-if="paletteOpen && paletteOpen.after === null && state.blocks.length === 0" class="palette palette--top" @click.stop>
          <button
            v-for="p in PALETTES[currentPage]"
            :key="p.type"
            type="button"
            class="palette__item"
            @click="addBlock(p.type, null)"
          >
            <span class="palette__icon">{{ p.icon }}</span>
            <span class="palette__label">
              <span class="palette__name">{{ p.label }}</span>
              <span class="palette__hint">{{ p.hint }}</span>
            </span>
          </button>
        </div>
      </section>

      <!-- Inspector -->
      <aside class="inspector">
        <div v-if="!selectedBlock" class="inspector__empty">
          <div class="inspector__empty-title">Nothing selected</div>
          <div class="inspector__empty-hint">Click a block on the left to edit its content.</div>
        </div>

        <template v-else>
          <div class="inspector__head">
            <div class="inspector__label">Editing</div>
            <div class="inspector__title">{{ BLOCK_LABEL[selectedBlock.type] }}</div>
          </div>

          <!-- Hero -->
          <template v-if="selectedBlock.type === 'hero'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock!.props as HeroProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Subheading</span>
              <textarea v-model="(selectedBlock!.props as HeroProps).subheading" rows="2" />
            </label>
            <div class="field">
              <ImagePicker
                v-model="(selectedBlock!.props as HeroProps).imageUrl"
                label="Background image (optional)"
                content-type="banner"
                aspect="16 / 9"
                hint="Sits behind the hero heading. PNG or JPG, under 10 MB."
              />
            </div>
            <div class="field__group">
              <div class="field__group-title">Primary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as HeroProps).primaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).primaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as HeroProps).primaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as HeroProps).primaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).primaryCta = { label: (selectedBlock!.props as HeroProps).primaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" placeholder="/membership" />
              </label>
            </div>
            <div class="field__group">
              <div class="field__group-title">Secondary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as HeroProps).secondaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).secondaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as HeroProps).secondaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as HeroProps).secondaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).secondaryCta = { label: (selectedBlock!.props as HeroProps).secondaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" placeholder="/events" />
              </label>
            </div>
          </template>

          <!-- Rich text -->
          <template v-else-if="selectedBlock.type === 'richText'">
            <label class="field">
              <span class="field__label">HTML</span>
              <textarea v-model="(selectedBlock.props as RichTextProps).html" rows="8" class="field__mono" />
              <span class="field__hint">Rich text editor coming — for now, paste HTML. Basic tags only.</span>
            </label>
          </template>

          <!-- Event list -->
          <template v-else-if="selectedBlock.type === 'eventList'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as EventListProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Limit (max events shown)</span>
              <input v-model.number="(selectedBlock.props as EventListProps).limit" type="number" min="1" max="20" />
            </label>
            <label class="switch-row">
              <div>
                <div class="switch-row__label">Upcoming only</div>
                <div class="switch-row__hint">Hide past events even if the calendar has them.</div>
              </div>
              <button
                type="button"
                class="switch"
                :class="{ 'is-on': (selectedBlock.props as EventListProps).upcomingOnly !== false }"
                @click="(selectedBlock.props as EventListProps).upcomingOnly = !(selectedBlock.props as EventListProps).upcomingOnly"
              ><span class="switch__knob" /></button>
            </label>
          </template>

          <!-- Honour board -->
          <template v-else-if="selectedBlock.type === 'honourBoard'">
            <label class="field">
              <span class="field__label">Heading (optional)</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).heading" type="text" placeholder="Leave blank for no heading" />
            </label>
            <label class="field">
              <span class="field__label">Category slug (optional)</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).categorySlug" type="text" placeholder="e.g. mens-singles — leave blank for all" />
              <span class="field__hint">Show entries from one category only. Leave blank to group all categories.</span>
            </label>
            <label class="field">
              <span class="field__label">Years to show</span>
              <input v-model.number="(selectedBlock.props as HonourBoardProps).yearsToShow" type="number" min="1" max="100" />
            </label>
          </template>

          <!-- Contact form -->
          <template v-else-if="selectedBlock.type === 'contactForm'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as ContactFormProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Submit button label</span>
              <input v-model="(selectedBlock.props as ContactFormProps).submitLabel" type="text" placeholder="Send" />
            </label>
            <label class="field">
              <span class="field__label">Success message</span>
              <textarea v-model="(selectedBlock.props as ContactFormProps).successMessage" rows="2" placeholder="Thanks — we'll be in touch." />
            </label>
          </template>

          <!-- Membership CTA -->
          <template v-else-if="selectedBlock.type === 'membershipCta'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Body</span>
              <textarea v-model="(selectedBlock.props as MembershipCtaProps).body" rows="3" />
            </label>
            <label class="field">
              <span class="field__label">Button label</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).ctaLabel" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Button link</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).ctaHref" type="text" placeholder="/membership" />
            </label>
          </template>

          <!-- CTA banner -->
          <template v-else-if="selectedBlock.type === 'ctaBanner'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Body (optional)</span>
              <textarea v-model="(selectedBlock.props as CtaBannerProps).body" rows="2" />
            </label>
            <label class="field">
              <span class="field__label">Button label</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).ctaLabel" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Button link</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).ctaHref" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Tone</span>
              <select v-model="(selectedBlock.props as CtaBannerProps).tone">
                <option value="accent">Accent</option>
                <option value="ink">Ink (dark)</option>
                <option value="surface">Surface (light)</option>
              </select>
            </label>
          </template>

          <!-- Gallery -->
          <template v-else-if="selectedBlock.type === 'gallery'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as GalleryProps).heading" type="text" />
            </label>
            <div class="field">
              <span class="field__label">Images ({{ (selectedBlock.props as GalleryProps).images.length }})</span>
              <div v-for="(img, ii) in (selectedBlock.props as GalleryProps).images" :key="ii" class="gallery-item">
                <ImagePicker v-model="img.url" content-type="gallery" aspect="4 / 3" />
                <input v-model="img.alt" placeholder="Alt text (for screen readers)" type="text" class="gallery-item__alt" />
                <button type="button" class="gallery-item__remove" @click="(selectedBlock!.props as GalleryProps).images.splice(ii, 1)">Remove</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock!.props as GalleryProps).images.push({ url: '', alt: '' })">+ Add image</button>
            </div>
          </template>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.web { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }

.web__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.web__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.web__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.web__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; max-width: 600px; }
.web__actions { display: flex; gap: 10px; align-items: center; }
.web__save-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-right: 6px; }

.btn { padding: 9px 16px; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; white-space: nowrap; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover { background: var(--color-surface); }

/* Page tabs */
.page-tabs { display: flex; gap: 4px; padding: 4px; background: var(--color-surface); border-radius: 12px; align-self: flex-start; flex-wrap: wrap; }
.page-tab { padding: 8px 14px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; white-space: nowrap; transition: color 0.12s ease, background-color 0.12s ease; }
.page-tab:hover { color: var(--color-ink); }
.page-tab--active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }

/* Two-column layout */
.web__body { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; }

/* Block list */
.list { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.empty { padding: 48px 32px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* Inserter between blocks */
.inserter { display: flex; justify-content: center; padding: 4px 0; position: relative; }
.inserter__btn { padding: 4px 12px; background: transparent; border: 1px dashed transparent; border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); cursor: pointer; opacity: 0; transition: opacity 0.15s ease; }
.list:hover .inserter__btn { opacity: 1; }
.inserter__btn:hover { border-color: var(--color-accent); color: var(--color-accent); background: #fff; opacity: 1; }
.inserter--open .inserter__btn { opacity: 1; background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

/* Palette popover */
.palette { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 10; margin-top: 6px; padding: 8px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 2px; min-width: 300px; }
.palette--top { position: static; transform: none; margin: 12px auto 0; }
.palette__item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: transparent; border: 0; border-radius: 8px; text-align: left; cursor: pointer; font-family: var(--font-body); }
.palette__item:hover { background: var(--color-surface); }
.palette__icon { width: 28px; height: 28px; border-radius: 6px; background: var(--color-surface); display: inline-flex; align-items: center; justify-content: center; font-size: 14px; color: var(--color-ink); flex-shrink: 0; }
.palette__label { display: flex; flex-direction: column; }
.palette__name { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.palette__hint { font-size: 11px; color: var(--color-fog); }

/* Block card */
.block { display: flex; align-items: stretch; gap: 12px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.block:hover { border-color: var(--color-mute); }
.block--selected { border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ink) 8%, transparent); }
.block__handle { display: flex; flex-direction: column; gap: 2px; }
.block__arrow { width: 22px; height: 22px; border: 1px solid var(--color-hairline); background: #fff; border-radius: 6px; font-size: 10px; color: var(--color-fog); cursor: pointer; }
.block__arrow:hover:not(:disabled) { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.block__arrow:disabled { opacity: 0.3; cursor: not-allowed; }
.block__body { flex: 1; min-width: 0; }
.block__type { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.block__summary { font-family: var(--font-display); font-size: 15px; font-weight: 500; color: var(--color-ink); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.block__delete { width: 28px; height: 28px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-fog); border-radius: 8px; font-size: 16px; cursor: pointer; align-self: center; flex-shrink: 0; }
.block__delete:hover { background: var(--color-danger); border-color: var(--color-danger); color: #fff; }

/* Inspector */
.inspector { padding: 20px 22px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 20px; display: flex; flex-direction: column; gap: 14px; max-height: calc(100vh - 60px); overflow-y: auto; }
.inspector__empty { text-align: center; padding: 20px 0; color: var(--color-fog); }
.inspector__empty-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.inspector__empty-hint { font-family: var(--font-body); font-size: 12px; margin-top: 4px; }

.inspector__head { padding-bottom: 12px; border-bottom: 1px solid var(--color-hairline); }
.inspector__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.inspector__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-top: 4px; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field textarea, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field textarea { line-height: 1.5; }
.field__mono { font-family: var(--font-mono); font-size: 12px; }
.field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.field__group { padding: 12px 14px; background: var(--color-surface); border-radius: 10px; display: flex; flex-direction: column; gap: 10px; }
.field__group-title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }

.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; max-width: 220px; }
.switch { width: 34px; height: 20px; padding: 2px; background: var(--color-hairline); border: 0; border-radius: 999px; cursor: pointer; display: flex; justify-content: flex-start; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); justify-content: flex-end; }
.switch__knob { width: 16px; height: 16px; border-radius: 999px; background: #fff; }

.gallery-item { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; margin-top: 8px; }
.gallery-item__alt { padding: 8px 10px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); background: #fff; }
.gallery-item__alt:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.gallery-item__remove { align-self: flex-start; background: transparent; border: 0; padding: 0; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-danger); cursor: pointer; }
.gallery-item__remove:hover { text-decoration: underline; }
.gallery-add { margin-top: 10px; padding: 8px 12px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-accent); cursor: pointer; }
.gallery-add:hover { background: var(--color-accent-soft); }

@media (max-width: 1100px) {
  .web__body { grid-template-columns: 1fr; }
  .inspector { position: static; max-height: none; }
}
</style>
