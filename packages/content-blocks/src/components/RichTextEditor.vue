<script setup lang="ts">
/**
 * RichTextEditor — TipTap-based WYSIWYG for email composition and other
 * rich-text surfaces inside the CRM. Output is HTML (via v-model), which
 * is the shape SES wants and the shape the existing RichTextBlock
 * renders via v-html.
 *
 * Toolbar follows the Paper design: Bold / Italic / Underline (format) ·
 * H2 / Bulleted / Numbered (block) · Link / Image (insertions). The
 * `size` prop swaps between the full modal toolbar (`md`) and the
 * compact Settings-card strip (`sm`).
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    /** `md` = full composer toolbar. `sm` = compact signature-card strip. */
    size?: 'md' | 'sm'
    /** Hides the image button in the toolbar when image uploads haven't
     *  been wired up on the host surface yet. */
    hideImage?: boolean
  }>(),
  {
    placeholder: 'Write…',
    size: 'md',
    hideImage: false,
  },
)
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({
      // We render our own underline via the Underline extension because
      // StarterKit doesn't include it.
      heading: { levels: [2, 3] },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener', target: '_blank' },
      // The backend sanitiser is the final trust boundary; here we just
      // enforce the two attributes every email link needs.
    }),
    Image.configure({
      HTMLAttributes: { style: 'max-width: 100%; height: auto; border-radius: 10px;' },
    }),
    Placeholder.configure({ placeholder: () => props.placeholder }),
  ],
  onUpdate({ editor: e }) {
    const html = e.getHTML()
    emit('update:modelValue', html)
  },
})

// External v-model updates (e.g. parent replaces the whole value) sync
// back into the editor without re-triggering onUpdate.
watch(
  () => props.modelValue,
  (next) => {
    if (!editor.value) return
    if (editor.value.getHTML() === next) return
    editor.value.commands.setContent(next, { emitUpdate: false })
  },
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})

// ── Toolbar helpers ──────────────────────────────────────────

function toggleBold() { editor.value?.chain().focus().toggleBold().run() }
function toggleItalic() { editor.value?.chain().focus().toggleItalic().run() }
function toggleUnderline() { editor.value?.chain().focus().toggleUnderline().run() }
function toggleH2() { editor.value?.chain().focus().toggleHeading({ level: 2 }).run() }
function toggleBulletList() { editor.value?.chain().focus().toggleBulletList().run() }
function toggleOrderedList() { editor.value?.chain().focus().toggleOrderedList().run() }

function insertLink() {
  const current = editor.value?.getAttributes('link').href as string | undefined
  const input = window.prompt('Link URL', current ?? 'https://')
  if (input == null) return
  const trimmed = input.trim()
  if (!trimmed) {
    editor.value?.chain().focus().unsetLink().run()
    return
  }
  editor.value?.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
}

function insertImage() {
  // Phase 1: URL-only insertion. Image paste/upload integration ships
  // once the media endpoint wiring lands (brief 103 §6).
  const url = window.prompt('Image URL (https://)')
  if (!url) return
  const trimmed = url.trim()
  if (!/^https:\/\//.test(trimmed)) {
    window.alert('Image URLs must start with https:// so the image survives the email render.')
    return
  }
  editor.value?.chain().focus().setImage({ src: trimmed }).run()
}

const isBold = computed(() => editor.value?.isActive('bold') ?? false)
const isItalic = computed(() => editor.value?.isActive('italic') ?? false)
const isUnderline = computed(() => editor.value?.isActive('underline') ?? false)
const isH2 = computed(() => editor.value?.isActive('heading', { level: 2 }) ?? false)
const isUL = computed(() => editor.value?.isActive('bulletList') ?? false)
const isOL = computed(() => editor.value?.isActive('orderedList') ?? false)
const isLink = computed(() => editor.value?.isActive('link') ?? false)

/** Exposed to parents so a sibling control (e.g. "Insert field" for
 *  merge tokens) can push text into the editor at the current cursor
 *  position. Returns true when the insert happened. */
function insertText(text: string): boolean {
  const e = editor.value
  if (!e) return false
  e.chain().focus().insertContent(text).run()
  return true
}

/** Programmatic focus — the parent modal can call this when it opens. */
function focus(): void {
  editor.value?.commands.focus()
}

defineExpose({ insertText, focus })
</script>

<template>
  <div class="rte" :class="`rte--${size}`">
    <div class="rte__toolbar" role="toolbar">
      <button
        type="button"
        class="rte__btn rte__btn--text"
        :class="{ 'is-active': isBold }"
        aria-label="Bold"
        @click="toggleBold"
      >B</button>
      <button
        type="button"
        class="rte__btn rte__btn--text rte__btn--italic"
        :class="{ 'is-active': isItalic }"
        aria-label="Italic"
        @click="toggleItalic"
      >I</button>
      <button
        type="button"
        class="rte__btn rte__btn--text rte__btn--underline"
        :class="{ 'is-active': isUnderline }"
        aria-label="Underline"
        @click="toggleUnderline"
      >U</button>

      <span v-if="size === 'md'" class="rte__divider" aria-hidden="true" />

      <button
        v-if="size === 'md'"
        type="button"
        class="rte__btn rte__btn--text rte__btn--h"
        :class="{ 'is-active': isH2 }"
        aria-label="Heading"
        @click="toggleH2"
      >H2</button>
      <button
        v-if="size === 'md'"
        type="button"
        class="rte__btn"
        :class="{ 'is-active': isUL }"
        aria-label="Bulleted list"
        @click="toggleBulletList"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="2.5" cy="4" r="1" fill="currentColor" />
          <circle cx="2.5" cy="8" r="1" fill="currentColor" />
          <circle cx="2.5" cy="12" r="1" fill="currentColor" />
          <path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        v-if="size === 'md'"
        type="button"
        class="rte__btn"
        :class="{ 'is-active': isOL }"
        aria-label="Numbered list"
        @click="toggleOrderedList"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <text x="0" y="5.5" font-family="Inter" font-size="4.5" font-weight="700" fill="currentColor">1.</text>
          <text x="0" y="9.5" font-family="Inter" font-size="4.5" font-weight="700" fill="currentColor">2.</text>
          <text x="0" y="13.5" font-family="Inter" font-size="4.5" font-weight="700" fill="currentColor">3.</text>
          <path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>

      <span class="rte__divider" aria-hidden="true" />

      <button
        type="button"
        class="rte__btn"
        :class="{ 'is-active': isLink }"
        aria-label="Insert link"
        @click="insertLink"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6.5 10a2.5 2.5 0 010-3.5l2-2a2.5 2.5 0 013.5 3.5l-1 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <path d="M9.5 6a2.5 2.5 0 010 3.5l-2 2a2.5 2.5 0 01-3.5-3.5l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
      <button
        v-if="!hideImage"
        type="button"
        class="rte__btn"
        aria-label="Insert image"
        @click="insertImage"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4" />
          <circle cx="6" cy="6.5" r="1.3" stroke="currentColor" stroke-width="1.4" />
          <path d="M2 12l3.5-3 2 2 3-3 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <EditorContent :editor="editor" class="rte__content" />
  </div>
</template>

<style scoped>
.rte {
  display: flex;
  flex-direction: column;
  background: var(--color-surface, #ffffff);
}

/* ── Toolbar ────────────────────────────────────────────────── */
.rte__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: #fafaf7;
  border-bottom: 1px solid var(--color-hairline, #e7e7e1);
}
.rte--md .rte__toolbar { padding: 10px 2px; background: transparent; border-bottom: 0; }
.rte--sm .rte__toolbar { padding: 6px 8px; }

.rte__btn {
  width: 30px;
  height: 30px;
  border: 0;
  background: transparent;
  color: var(--color-graphite, #2e2e33);
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease, color 120ms ease;
}
.rte--sm .rte__btn { width: 26px; height: 26px; border-radius: 6px; font-size: 12px; }
.rte__btn:hover { background: color-mix(in srgb, var(--color-ink, #0a0a0b) 6%, transparent); color: var(--color-ink, #0a0a0b); }
.rte__btn.is-active { background: var(--color-surface-sand, #f5f5f2); color: var(--color-ink, #0a0a0b); font-weight: 700; }
.rte__btn--text { font-weight: 700; }
.rte__btn--italic { font-style: italic; font-weight: 500; }
.rte__btn--underline { text-decoration: underline; font-weight: 500; }
.rte__btn--h { font-family: var(--font-display, 'Space Grotesk'), sans-serif; font-size: 11px; font-weight: 700; letter-spacing: -0.02em; }

.rte__divider {
  width: 1px;
  height: 18px;
  background: var(--color-hairline, #e7e7e1);
  margin: 0 6px;
  flex-shrink: 0;
}

/* ── Editor surface ────────────────────────────────────────── */
.rte__content {
  flex: 1;
  min-height: 160px;
  padding: 16px 2px;
}
.rte--sm .rte__content { padding: 14px 16px; min-height: 100px; }

.rte__content :deep(.ProseMirror) {
  outline: none;
  min-height: inherit;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 16px;
  line-height: 1.65;
  color: var(--color-ink, #0a0a0b);
}
.rte--sm .rte__content :deep(.ProseMirror) { font-size: 14px; line-height: 1.6; }

.rte__content :deep(.ProseMirror p) { margin: 0 0 14px; }
.rte__content :deep(.ProseMirror p:last-child) { margin-bottom: 0; }
.rte__content :deep(.ProseMirror h2) {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 24px 0 10px;
}
.rte__content :deep(.ProseMirror h3) {
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 17px;
  font-weight: 600;
  margin: 18px 0 8px;
}
.rte__content :deep(.ProseMirror a) {
  color: var(--color-primary, #2563eb);
  text-decoration: underline;
}
.rte__content :deep(.ProseMirror ul),
.rte__content :deep(.ProseMirror ol) { padding-left: 22px; margin: 0 0 14px; }
.rte__content :deep(.ProseMirror li) { margin: 2px 0; }
.rte__content :deep(.ProseMirror img) {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 8px 0;
}

/* Placeholder (shown when first paragraph is empty). */
.rte__content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-fog, #a3a39b);
  pointer-events: none;
  height: 0;
}
</style>
