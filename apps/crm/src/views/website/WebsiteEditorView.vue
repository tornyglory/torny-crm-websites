<script setup lang="ts">
/**
 * Website — Home page editor.
 *
 * Vertical-list block editor. Owner adds/reorders/deletes blocks via the
 * left column, edits the selected block's props in the right column,
 * previews in a new tab, and publishes.
 *
 * Backend endpoints (brief 16) not shipped yet — layout persists to
 * localStorage under `torny.website.{clubId}.home` until they land. The
 * save/publish handlers already carry the right shape for the eventual
 * PATCH / POST /publish calls; swap the two functions when ready.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import type {
  Block,
  BlockType,
  HeroProps,
  RichTextProps,
  EventListProps,
  GalleryProps,
  MembershipCtaProps,
  CtaBannerProps,
} from '@torny/content-blocks'

const toast = useToast()
const clubStore = useClubStore()

// ── Types + block palette curated for Home ─────────────────
interface PaletteItem {
  type: BlockType
  label: string
  hint: string
  icon: string  // simple text icon for MVP
  defaults: () => Block['props']
}

const HOME_PALETTE: PaletteItem[] = [
  {
    type: 'hero',
    label: 'Hero',
    hint: 'Big heading, tagline, two CTAs',
    icon: '☰',
    defaults: (): HeroProps => ({
      heading: clubStore.current?.name ?? 'Your club',
      subheading: 'A friendly bowls club. New members always welcome.',
      primaryCta: { label: 'Join us', href: '/membership' },
      secondaryCta: { label: 'See what\'s on', href: '/events' },
    }),
  },
  {
    type: 'richText',
    label: 'Rich text',
    hint: 'A block of writing — history, blurb, note',
    icon: '¶',
    defaults: (): RichTextProps => ({
      html: '<p>Tell your visitors about the club — history, atmosphere, what makes you different.</p>',
    }),
  },
  {
    type: 'eventList',
    label: 'Events',
    hint: 'Auto-pulled from your events calendar',
    icon: '◧',
    defaults: (): EventListProps => ({
      heading: "What's on",
      limit: 4,
      upcomingOnly: true,
    }),
  },
  {
    type: 'gallery',
    label: 'Gallery',
    hint: 'A photo strip of your club',
    icon: '▨',
    defaults: (): GalleryProps => ({
      heading: 'Around the club',
      images: [],
    }),
  },
  {
    type: 'membershipCta',
    label: 'Membership CTA',
    hint: 'A block that pushes people to /membership',
    icon: '★',
    defaults: (): MembershipCtaProps => ({
      heading: 'Play with us this season',
      body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.',
      ctaLabel: 'See tiers',
      ctaHref: '/membership',
    }),
  },
  {
    type: 'ctaBanner',
    label: 'CTA banner',
    hint: 'A slim strip with one link',
    icon: '▬',
    defaults: (): CtaBannerProps => ({
      heading: 'Have questions? Get in touch.',
      ctaLabel: 'Contact us',
      ctaHref: '/contact',
      tone: 'accent',
    }),
  },
]

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

// ── State ──────────────────────────────────────────────────
function newBlockId(): string {
  return `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function seedHomeLayout(): Block[] {
  const clubName = clubStore.current?.name ?? 'Your club'
  return [
    {
      id: newBlockId(),
      type: 'hero',
      props: {
        heading: clubName,
        subheading: 'A friendly bowls club. New members always welcome.',
        primaryCta: { label: 'Join us', href: '/membership' },
        secondaryCta: { label: 'See what\'s on', href: '/events' },
      } satisfies HeroProps,
    },
    {
      id: newBlockId(),
      type: 'eventList',
      props: { heading: "What's on", limit: 4, upcomingOnly: true } satisfies EventListProps,
    },
    {
      id: newBlockId(),
      type: 'membershipCta',
      props: {
        heading: 'Play with us this season',
        body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.',
        ctaLabel: 'See tiers',
        ctaHref: '/membership',
      } satisfies MembershipCtaProps,
    },
  ]
}

function storageKey(): string | null {
  const cid = clubStore.current?.id
  return cid ? `torny.website.${cid}.home` : null
}

interface StoredLayout {
  blocks: Block[]
  draftUpdatedAt: string
  publishedAt: string | null
  publishedBlocks: Block[] | null
}

function loadFromStorage(): StoredLayout {
  const key = storageKey()
  if (!key) return { blocks: seedHomeLayout(), draftUpdatedAt: new Date().toISOString(), publishedAt: null, publishedBlocks: null }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { blocks: seedHomeLayout(), draftUpdatedAt: new Date().toISOString(), publishedAt: null, publishedBlocks: null }
    const parsed = JSON.parse(raw) as StoredLayout
    return {
      blocks: parsed.blocks ?? seedHomeLayout(),
      draftUpdatedAt: parsed.draftUpdatedAt ?? new Date().toISOString(),
      publishedAt: parsed.publishedAt ?? null,
      publishedBlocks: parsed.publishedBlocks ?? null,
    }
  } catch {
    return { blocks: seedHomeLayout(), draftUpdatedAt: new Date().toISOString(), publishedAt: null, publishedBlocks: null }
  }
}

const state = reactive<StoredLayout>(loadFromStorage())
const selectedId = ref<string | null>(state.blocks[0]?.id ?? null)
const paletteOpen = ref<null | { after: string | null }>(null)  // null = closed; { after: 'blk-3' } = insert after that block; { after: null } = at the end
const saving = ref(false)
const publishing = ref(false)

// Reload when the active club changes.
watch(() => clubStore.current?.id, () => {
  const fresh = loadFromStorage()
  Object.assign(state, fresh)
  selectedId.value = state.blocks[0]?.id ?? null
})

const selectedBlock = computed<Block | null>(() => state.blocks.find((b) => b.id === selectedId.value) ?? null)

const hasUnpublishedChanges = computed(() => {
  if (!state.publishedBlocks) return state.blocks.length > 0
  return JSON.stringify(state.blocks) !== JSON.stringify(state.publishedBlocks)
})

// ── Persistence (localStorage MVP) ─────────────────────────
function persist(): void {
  const key = storageKey()
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
    //   await pages.patch(clubId, 'home', { layout_draft: { blocks: state.blocks } })
  }, 500)
}

watch(() => state.blocks, scheduleSave, { deep: true })

// ── Block ops ──────────────────────────────────────────────
function addBlock(type: BlockType, afterId: string | null): void {
  const palette = HOME_PALETTE.find((p) => p.type === type)
  if (!palette) return
  const block = {
    id: newBlockId(),
    type,
    props: palette.defaults(),
  } as Block
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

// ── Publish (mocked until brief 16 §2.3 lands) ─────────────
async function publish(): Promise<void> {
  if (!hasUnpublishedChanges.value) return
  publishing.value = true
  try {
    // Once brief 16 §2.3 lands:
    //   await pages.publish(clubId, 'home')
    await new Promise((r) => setTimeout(r, 600))
    state.publishedBlocks = JSON.parse(JSON.stringify(state.blocks)) as Block[]
    state.publishedAt = new Date().toISOString()
    persist()
    toast.success('Home page published.')
  } finally {
    publishing.value = false
  }
}

function preview(): void {
  const slug = clubStore.current?.slug
  if (!slug) {
    toast.info('Preview needs an active club.')
    return
  }
  // Dev — points at the club-sites local Nuxt with the tenant override.
  window.open(`http://localhost:3001/?host=${slug}.torny.club`, '_blank', 'noopener')
}

// ── Block summary (shown in the list row) ─────────────────
function blockSummary(block: Block): string {
  switch (block.type) {
    case 'hero':          return (block.props as HeroProps).heading || '(no heading)'
    case 'richText':      return stripHtml((block.props as RichTextProps).html).slice(0, 60)
    case 'eventList':     return (block.props as EventListProps).heading ?? `${(block.props as EventListProps).limit ?? 4} upcoming events`
    case 'gallery':       return `${(block.props as GalleryProps).images.length} photos`
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
        <h1 class="web__heading">Home page</h1>
        <p class="web__sub">Drag blocks to reorder, click to edit. Autosaves as you type — publish when you're ready.</p>
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
                v-for="p in HOME_PALETTE"
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
            v-for="p in HOME_PALETTE"
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
            <label class="field">
              <span class="field__label">Image URL (optional)</span>
              <input v-model="(selectedBlock!.props as HeroProps).imageUrl" type="text" placeholder="https://…" />
            </label>
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
              <div v-for="(img, ii) in (selectedBlock.props as GalleryProps).images" :key="ii" class="gallery-row">
                <input v-model="img.url" placeholder="https://…" type="text" />
                <input v-model="img.alt" placeholder="Alt text (accessibility)" type="text" />
                <button type="button" class="gallery-row__remove" @click="(selectedBlock.props as GalleryProps).images.splice(ii, 1)">×</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock.props as GalleryProps).images.push({ url: '', alt: '' })">+ Add image</button>
            </div>
          </template>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.web { max-width: 1280px; display: flex; flex-direction: column; gap: 24px; }

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

.gallery-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; margin-top: 8px; }
.gallery-row input { padding: 8px 10px; }
.gallery-row__remove { width: 28px; height: 28px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-fog); border-radius: 6px; font-size: 14px; cursor: pointer; }
.gallery-row__remove:hover { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
.gallery-add { margin-top: 10px; padding: 8px 12px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-accent); cursor: pointer; }
.gallery-add:hover { background: var(--color-accent-soft); }

@media (max-width: 1100px) {
  .web__body { grid-template-columns: 1fr; }
  .inspector { position: static; max-height: none; }
}
</style>
