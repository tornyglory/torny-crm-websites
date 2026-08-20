<script setup lang="ts">
import { computed, ref } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type BlockKind =
  | 'hero'
  | 'rich_text'
  | 'gallery'
  | 'event_list'
  | 'membership_cta'
  | 'contact_form'
  | 'honour_board'
  | 'cta_banner'

interface Block {
  id: string
  kind: BlockKind
  title: string
  summary: string
  visible: boolean
}
interface Page {
  id: string
  slug: string
  title: string
  status: 'published' | 'draft'
  updatedAt: string
  blocks: Block[]
}

const pages = ref<Page[]>([
  {
    id: 'p-home',
    slug: '/',
    title: 'Home',
    status: 'published',
    updatedAt: '2h ago',
    blocks: [
      { id: 'b1', kind: 'hero', title: 'Kelburn Bowling Club', summary: 'A friendly club in the heart of Wellington.', visible: true },
      { id: 'b2', kind: 'event_list', title: 'What’s on', summary: 'Auto-pulled from your events calendar.', visible: true },
      { id: 'b3', kind: 'rich_text', title: 'About the club', summary: 'Est. 1908. Two greens, three rinks each…', visible: true },
      { id: 'b4', kind: 'membership_cta', title: 'Join us', summary: 'Membership from $140/year.', visible: true },
    ],
  },
  {
    id: 'p-events',
    slug: '/events',
    title: 'Events',
    status: 'published',
    updatedAt: 'Yesterday',
    blocks: [
      { id: 'b5', kind: 'hero', title: 'Upcoming events', summary: 'Roll-ups, tournaments, socials.', visible: true },
      { id: 'b6', kind: 'event_list', title: 'Everything upcoming', summary: 'Filters: category, month.', visible: true },
    ],
  },
  {
    id: 'p-honour',
    slug: '/honour-board',
    title: 'Honour board',
    status: 'published',
    updatedAt: '3d ago',
    blocks: [
      { id: 'b7', kind: 'hero', title: 'Honour board', summary: 'Champions and life members through the years.', visible: true },
      { id: 'b8', kind: 'honour_board', title: 'Champion of Champions', summary: '42 records, 1962–2026', visible: true },
      { id: 'b9', kind: 'honour_board', title: 'Fours champions', summary: '36 records', visible: true },
    ],
  },
  {
    id: 'p-membership',
    slug: '/membership',
    title: 'Membership',
    status: 'draft',
    updatedAt: 'Editing now',
    blocks: [
      { id: 'b10', kind: 'hero', title: 'Become a member', summary: 'Three levels: playing, social, junior.', visible: true },
      { id: 'b11', kind: 'rich_text', title: 'What you get', summary: 'Rink access, coaching, socials, …', visible: true },
      { id: 'b12', kind: 'membership_cta', title: 'Apply online', summary: 'Sends applications straight to your CRM inbox.', visible: true },
    ],
  },
  {
    id: 'p-contact',
    slug: '/contact',
    title: 'Contact',
    status: 'published',
    updatedAt: '2 weeks ago',
    blocks: [
      { id: 'b13', kind: 'hero', title: 'Get in touch', summary: 'Find us, phone us, message us.', visible: true },
      { id: 'b14', kind: 'contact_form', title: 'Enquiry form', summary: 'Goes to CRM → Enquiries.', visible: true },
    ],
  },
])

const activePageId = ref<string>(pages.value[0]!.id)
const activePage = computed<Page>(() => pages.value.find((p) => p.id === activePageId.value)!)
const selectedBlockId = ref<string | null>(activePage.value.blocks[0]?.id ?? null)
const selectedBlock = computed<Block | null>(
  () => activePage.value.blocks.find((b) => b.id === selectedBlockId.value) ?? null,
)

const previewViewport = ref<'desktop' | 'mobile'>('desktop')

interface Palette {
  kind: BlockKind
  label: string
  hint: string
}
const PALETTE: Palette[] = [
  { kind: 'hero', label: 'Hero', hint: 'Headline, sub, image or video' },
  { kind: 'rich_text', label: 'Rich text', hint: 'Body copy with formatting' },
  { kind: 'gallery', label: 'Gallery', hint: 'Photo strip or grid' },
  { kind: 'event_list', label: 'Event list', hint: 'Auto-pulled from Events' },
  { kind: 'membership_cta', label: 'Membership CTA', hint: 'Apply-to-join button' },
  { kind: 'contact_form', label: 'Contact form', hint: 'Delivers to Enquiries' },
  { kind: 'honour_board', label: 'Honour board', hint: 'Winners table' },
  { kind: 'cta_banner', label: 'CTA banner', hint: 'Full-width call to action' },
]

function pickPage(id: string) {
  activePageId.value = id
  selectedBlockId.value = activePage.value.blocks[0]?.id ?? null
}
function pickBlock(id: string) {
  selectedBlockId.value = id
}
// ── Publish modal ──────────────────────────────────────────────
const publishOpen = ref(false)
const publishing = ref(false)
const includeRelated = ref(true)

const changedBlocks = computed(() => {
  // Mock — pretend "unsaved" blocks are anything hidden or on the draft page.
  return activePage.value.blocks.filter((b) => !b.visible).length + (activePage.value.status === 'draft' ? 2 : 1)
})

function openPreview() {
  toast.info(`Opening preview of ${activePage.value.slug} in a new tab…`)
}
function openPublish() {
  publishOpen.value = true
}
function closePublish() {
  if (publishing.value) return
  publishOpen.value = false
}
function confirmPublish() {
  publishing.value = true
  window.setTimeout(() => {
    publishing.value = false
    publishOpen.value = false
    activePage.value.status = 'published'
    activePage.value.updatedAt = 'just now'
    toast.success(`Published ${activePage.value.slug} · cache purged`)
  }, 800)
}

function moveBlock(idx: number, dir: -1 | 1) {
  const blocks = activePage.value.blocks
  const next = idx + dir
  if (next < 0 || next >= blocks.length) return
  const a = blocks[idx]
  const b = blocks[next]
  if (!a || !b) return
  blocks[idx] = b
  blocks[next] = a
}
function toggleVisible(b: Block) {
  b.visible = !b.visible
}
function addBlock(kind: BlockKind) {
  const meta = PALETTE.find((p) => p.kind === kind)!
  activePage.value.blocks.push({
    id: `b${Date.now()}`,
    kind,
    title: meta.label,
    summary: meta.hint,
    visible: true,
  })
}

const kindIcon: Record<BlockKind, string> = {
  hero: '☀',
  rich_text: '¶',
  gallery: '▤',
  event_list: '📅',
  membership_cta: '⚑',
  contact_form: '✉',
  honour_board: '★',
  cta_banner: '▬',
}
</script>

<template>
  <div class="ed">
    <header class="ed__header">
      <div>
        <div class="ed__eyebrow">Website editor</div>
        <h1 class="ed__heading">{{ activePage.title }}</h1>
        <div class="ed__meta">
          <span class="mono">{{ activePage.slug }}</span>
          <span class="dot">·</span>
          <span :class="`stat-${activePage.status}`">{{ activePage.status }}</span>
          <span class="dot">·</span>
          <span>Last update: {{ activePage.updatedAt }}</span>
        </div>
      </div>
      <div class="ed__actions">
        <div class="viewport">
          <button class="vp" :class="{ 'is-active': previewViewport === 'desktop' }" @click="previewViewport = 'desktop'">Desktop</button>
          <button class="vp" :class="{ 'is-active': previewViewport === 'mobile' }" @click="previewViewport = 'mobile'">Mobile</button>
        </div>
        <button class="btn btn--outline" @click="openPreview">Preview</button>
        <button class="btn btn--primary" @click="openPublish">Publish</button>
      </div>
    </header>

    <div class="ed__grid">
      <!-- Pages tree -->
      <aside class="panel panel--pages">
        <div class="panel__head">
          <span class="panel__label">Pages</span>
          <button class="panel__add">+ New</button>
        </div>
        <ul class="tree">
          <li
            v-for="p in pages"
            :key="p.id"
            class="tree__row"
            :class="{ 'is-active': p.id === activePageId }"
            @click="pickPage(p.id)"
          >
            <div class="tree__title">{{ p.title }}</div>
            <div class="tree__slug">{{ p.slug }}</div>
            <span class="tree__status" :class="`stat-${p.status}`">{{ p.status === 'draft' ? '•' : '✓' }}</span>
          </li>
        </ul>

        <div class="panel__head panel__head--spaced">
          <span class="panel__label">Add block</span>
        </div>
        <ul class="palette">
          <li
            v-for="p in PALETTE"
            :key="p.kind"
            class="palette__row"
            @click="addBlock(p.kind)"
          >
            <span class="palette__icon">{{ kindIcon[p.kind] }}</span>
            <div class="palette__body">
              <div class="palette__label">{{ p.label }}</div>
              <div class="palette__hint">{{ p.hint }}</div>
            </div>
          </li>
        </ul>
      </aside>

      <!-- Blocks canvas -->
      <section class="panel panel--blocks">
        <div class="panel__head">
          <span class="panel__label">Blocks</span>
          <span class="mono muted">{{ activePage.blocks.length }} on this page</span>
        </div>
        <ol class="blocks">
          <li
            v-for="(b, i) in activePage.blocks"
            :key="b.id"
            class="block"
            :class="{ 'is-selected': b.id === selectedBlockId, 'is-hidden': !b.visible }"
            @click="pickBlock(b.id)"
          >
            <div class="block__handle" aria-hidden="true">
              <button class="block__nudge" :disabled="i === 0" @click.stop="moveBlock(i, -1)">↑</button>
              <button class="block__nudge" :disabled="i === activePage.blocks.length - 1" @click.stop="moveBlock(i, 1)">↓</button>
            </div>
            <div class="block__icon">{{ kindIcon[b.kind] }}</div>
            <div class="block__body">
              <div class="block__title">{{ b.title }}</div>
              <div class="block__summary">{{ b.summary }}</div>
            </div>
            <div class="block__kind">{{ b.kind.replace('_', ' ') }}</div>
            <button class="block__toggle" @click.stop="toggleVisible(b)">
              {{ b.visible ? 'Hide' : 'Show' }}
            </button>
          </li>
        </ol>
      </section>

      <!-- Inspector -->
      <aside class="panel panel--inspector">
        <div class="panel__head">
          <span class="panel__label">Inspector</span>
        </div>
        <template v-if="selectedBlock">
          <div class="insp__eyebrow">{{ selectedBlock.kind.replace('_', ' ') }}</div>
          <h3 class="insp__heading">{{ selectedBlock.title }}</h3>

          <div class="field">
            <label class="field__label">Title</label>
            <input class="field__input" v-model="selectedBlock.title" />
          </div>
          <div class="field">
            <label class="field__label">Summary / body</label>
            <textarea class="field__input" rows="4" v-model="selectedBlock.summary" />
          </div>

          <div class="field field--switch">
            <div>
              <div class="field__label">Visible</div>
              <div class="field__hint">Hidden blocks are still saved but excluded from publish.</div>
            </div>
            <button class="switch" :class="{ 'is-on': selectedBlock.visible }" @click="toggleVisible(selectedBlock)">
              <span class="switch__knob" />
            </button>
          </div>

          <div class="insp__actions">
            <button class="btn btn--danger-ghost">Delete block</button>
          </div>
        </template>
        <div v-else class="insp__empty">Select a block to edit its content.</div>
      </aside>
    </div>

    <CrmModal
      :open="publishOpen"
      eyebrow="Publish"
      :title="`Publish ${activePage.slug}`"
      width="md"
      @close="closePublish"
    >
      <p class="pub__body">
        {{ changedBlocks }} block{{ changedBlocks === 1 ? '' : 's' }} will be updated.
        Cache-purge fires immediately across the fallback subdomain and any custom hostname.
      </p>
      <div class="pub__stats">
        <div class="pub__stat">
          <div class="pub__stat-val">{{ changedBlocks }}</div>
          <div class="pub__stat-lbl">Blocks changed</div>
        </div>
        <div class="pub__stat">
          <div class="pub__stat-val">3</div>
          <div class="pub__stat-lbl">URLs to purge</div>
        </div>
        <div class="pub__stat">
          <div class="pub__stat-val">~5s</div>
          <div class="pub__stat-lbl">To go live</div>
        </div>
      </div>
      <div class="switch-row">
        <div>
          <div class="switch-row__label">Purge related pages</div>
          <div class="switch-row__hint">Recommended when a hero or nav block changes — sitemap included.</div>
        </div>
        <button type="button" class="switch" :class="{ 'is-on': includeRelated }" @click="includeRelated = !includeRelated"><span class="switch__knob" /></button>
      </div>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" :disabled="publishing" @click="closePublish">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="publishing" @click="confirmPublish">
          {{ publishing ? 'Publishing…' : 'Publish now' }}
        </button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.ed { max-width: 100%; }
.ed__header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--color-hairline); }
.ed__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.ed__heading { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.ed__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.ed__meta .dot { opacity: 0.5; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.muted { color: var(--color-mute); }
.stat-published { color: #166534; text-transform: capitalize; }
.stat-draft { color: #92400E; text-transform: capitalize; }

.ed__actions { display: flex; gap: 8px; align-items: center; }
.viewport { display: flex; padding: 3px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.vp { padding: 6px 14px; background: transparent; border: 0; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); }
.vp.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--danger-ghost { background: transparent; color: var(--color-danger); border: 1px solid rgba(220,47,59,0.35); }

.ed__grid { display: grid; grid-template-columns: 280px minmax(0, 1fr) 320px; gap: 12px; align-items: start; }

.panel { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 16px; }
.panel__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel__head--spaced { margin-top: 20px; }
.panel__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.panel__add { background: transparent; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }

.tree { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.tree__row { padding: 10px 12px; border-radius: 8px; cursor: pointer; display: grid; grid-template-columns: 1fr auto; align-items: center; }
.tree__row:hover { background: var(--color-surface); }
.tree__row.is-active { background: var(--color-accent-soft); }
.tree__title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.tree__slug { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); grid-column: 1; }
.tree__status { grid-column: 2; grid-row: 1 / span 2; font-family: var(--font-mono); font-size: 12px; }

.palette { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.palette__row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; border: 1px dashed var(--color-hairline); }
.palette__row:hover { background: var(--color-surface); border-color: var(--color-mute); }
.palette__icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: var(--color-surface); border-radius: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--color-graphite); }
.palette__label { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }
.palette__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 1px; }

.blocks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.block { display: grid; grid-template-columns: auto auto 1fr auto auto; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; }
.block:hover { border-color: var(--color-mute); }
.block.is-selected { border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-hairline); }
.block.is-hidden { opacity: 0.55; }
.block__handle { display: flex; flex-direction: column; gap: 2px; }
.block__nudge { width: 22px; height: 20px; padding: 0; background: transparent; border: 1px solid var(--color-hairline); border-radius: 5px; color: var(--color-graphite); cursor: pointer; font-size: 10px; line-height: 1; }
.block__nudge:disabled { opacity: 0.4; cursor: not-allowed; }
.block__icon { width: 32px; height: 32px; background: var(--color-surface); border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 14px; }
.block__title { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.block__summary { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.block__kind { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); text-transform: uppercase; letter-spacing: 0.08em; }
.block__toggle { background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; padding: 5px 12px; font-family: var(--font-body); font-size: 11px; color: var(--color-graphite); cursor: pointer; }
.block__toggle:hover { border-color: var(--color-ink); color: var(--color-ink); }

.panel--inspector { position: sticky; top: 24px; }
.insp__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.insp__heading { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 16px; color: var(--color-ink); }
.field { margin-bottom: 14px; }
.field__label { display: block; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 6px; }
.field__input { width: 100%; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field__input:focus { outline: none; border-color: var(--color-ink); }
.field--switch { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--color-hairline); border-bottom: 1px solid var(--color-hairline); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 4px; text-transform: none; letter-spacing: 0; font-weight: 400; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }

.insp__actions { margin-top: 20px; }
.insp__empty { padding: 20px 0; text-align: center; font-family: var(--font-body); font-size: 12px; color: var(--color-mute); }

/* Publish modal */
.pub__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0 0 16px; }
.pub__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
.pub__stat { padding: 14px; background: var(--color-surface); border-radius: 10px; }
.pub__stat-val { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; }
.pub__stat-lbl { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-top: 4px; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); margin-top: 12px; }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

@media (max-width: 1100px) {
  .ed__grid { grid-template-columns: 240px 1fr; }
  .panel--inspector { grid-column: 1 / -1; position: static; }
}
@media (max-width: 767px) {
  .ed__grid { grid-template-columns: 1fr; }
  .panel--inspector { position: static; }
  .pub__stats { grid-template-columns: 1fr; }
}
</style>
