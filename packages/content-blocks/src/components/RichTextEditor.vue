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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
    /** Optional file uploader — when provided, the image modal shows an
     *  Upload option alongside the "paste URL" fallback. Must resolve to
     *  a public https:// URL the email client can fetch. */
    uploadImage?: (file: File) => Promise<string>
  }>(),
  {
    placeholder: 'Write…',
    size: 'md',
    hideImage: false,
    uploadImage: undefined,
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

// ── Link modal ────────────────────────────────────────────────

const linkOpen = ref(false)
const linkUrl = ref('')
const linkText = ref('')
const linkHasSelection = ref(false)
const linkIsExisting = ref(false)
const linkUrlInput = ref<HTMLInputElement | null>(null)

function insertLink() {
  const e = editor.value
  if (!e) return
  const current = (e.getAttributes('link').href as string | undefined) ?? ''
  linkUrl.value = current || 'https://'
  linkText.value = ''
  const { from, to } = e.state.selection
  linkHasSelection.value = from !== to
  linkIsExisting.value = Boolean(current)
  linkOpen.value = true
  void nextTick(() => {
    linkUrlInput.value?.focus()
    linkUrlInput.value?.select()
  })
}

function confirmLink() {
  const url = linkUrl.value.trim()
  const e = editor.value
  if (!e) return
  if (!url || url === 'https://') {
    // Empty → treat as "remove link".
    e.chain().focus().unsetLink().run()
    linkOpen.value = false
    return
  }
  if (!linkHasSelection.value && !linkIsExisting.value) {
    const label = linkText.value.trim() || url
    const safeHref = url.replace(/"/g, '&quot;')
    const safeLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    e.chain().focus().insertContent(`<a href="${safeHref}" target="_blank" rel="noopener">${safeLabel}</a>`).run()
  } else {
    e.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
  linkOpen.value = false
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
  linkOpen.value = false
}

// ── Image modal ────────────────────────────────────────────────

const imageOpen = ref(false)
const imageMode = ref<'upload' | 'url'>('upload')
const imageUrl = ref('')
const imageFile = ref<File | null>(null)
const imageFilePreview = ref<string | null>(null)
const imageUploading = ref(false)
const imageError = ref<string | null>(null)
const imageFileInput = ref<HTMLInputElement | null>(null)
const imageUrlInput = ref<HTMLInputElement | null>(null)

const imageCanUpload = computed(() => typeof props.uploadImage === 'function')

function insertImage() {
  imageMode.value = imageCanUpload.value ? 'upload' : 'url'
  imageUrl.value = ''
  imageFile.value = null
  imageFilePreview.value = null
  imageError.value = null
  imageOpen.value = true
  void nextTick(() => {
    if (imageMode.value === 'url') {
      imageUrlInput.value?.focus()
    }
  })
}

function onImageFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  if (!f) {
    imageFile.value = null
    imageFilePreview.value = null
    return
  }
  if (!f.type.startsWith('image/')) {
    imageError.value = 'That file isn’t an image.'
    return
  }
  if (f.size > 10 * 1024 * 1024) {
    imageError.value = 'Image must be under 10 MB.'
    return
  }
  imageError.value = null
  imageFile.value = f
  // Revoke an old preview before creating a new one — keeps memory tidy
  // when the user swaps files before inserting.
  if (imageFilePreview.value) URL.revokeObjectURL(imageFilePreview.value)
  imageFilePreview.value = URL.createObjectURL(f)
}

function clearImageSelection() {
  if (imageFilePreview.value) URL.revokeObjectURL(imageFilePreview.value)
  imageFile.value = null
  imageFilePreview.value = null
  if (imageFileInput.value) imageFileInput.value.value = ''
}

function switchImageMode(mode: 'upload' | 'url') {
  imageMode.value = mode
  imageError.value = null
  if (mode === 'url') {
    void nextTick(() => imageUrlInput.value?.focus())
  }
}

async function confirmImage() {
  imageError.value = null
  const e = editor.value
  if (!e) return
  if (imageMode.value === 'upload') {
    const f = imageFile.value
    const upload = props.uploadImage
    if (!f || !upload) {
      imageError.value = 'Pick an image first.'
      return
    }
    imageUploading.value = true
    try {
      const url = await upload(f)
      e.chain().focus().setImage({ src: url }).run()
      clearImageSelection()
      imageOpen.value = false
    } catch (err) {
      imageError.value = err instanceof Error ? err.message : 'Upload failed.'
    } finally {
      imageUploading.value = false
    }
  } else {
    const url = imageUrl.value.trim()
    if (!/^https:\/\//i.test(url)) {
      imageError.value = 'Image URLs must start with https://'
      return
    }
    e.chain().focus().setImage({ src: url }).run()
    imageOpen.value = false
  }
}

function cancelImage() {
  clearImageSelection()
  imageOpen.value = false
}

onBeforeUnmount(() => {
  if (imageFilePreview.value) URL.revokeObjectURL(imageFilePreview.value)
})

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

    <!-- Link modal — matches the CRM's CrmModal grammar (dark overlay,
         white card, pill buttons) but is isolated to this package. -->
    <teleport to="body">
      <div
        v-if="linkOpen"
        class="rte-modal__overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Insert link"
        @click.self="linkOpen = false"
      >
        <div class="rte-modal">
          <header class="rte-modal__head">
            <div class="rte-modal__eyebrow">Format</div>
            <h3 class="rte-modal__title">{{ linkIsExisting ? 'Edit link' : 'Insert link' }}</h3>
          </header>
          <div class="rte-modal__body">
            <label class="rte-modal__field">
              <span class="rte-modal__label">URL</span>
              <input
                ref="linkUrlInput"
                v-model="linkUrl"
                type="url"
                class="rte-modal__input"
                placeholder="https://"
                @keydown.enter.prevent="confirmLink"
              />
            </label>
            <label v-if="!linkHasSelection && !linkIsExisting" class="rte-modal__field">
              <span class="rte-modal__label">Link text <span class="rte-modal__hint">optional</span></span>
              <input
                v-model="linkText"
                type="text"
                class="rte-modal__input"
                placeholder="Visible text (defaults to the URL)"
                @keydown.enter.prevent="confirmLink"
              />
            </label>
          </div>
          <footer class="rte-modal__foot">
            <button
              v-if="linkIsExisting"
              type="button"
              class="rte-modal__link-remove"
              @click="removeLink"
            >Remove link</button>
            <button type="button" class="rte-modal__btn rte-modal__btn--ghost" @click="linkOpen = false">Cancel</button>
            <button type="button" class="rte-modal__btn rte-modal__btn--ink" @click="confirmLink">
              {{ linkIsExisting ? 'Save' : 'Insert' }}
            </button>
          </footer>
        </div>
      </div>
    </teleport>

    <!-- Image modal — upload (when wired) or paste URL. The upload tab
         only renders when the host passed an `uploadImage` prop. -->
    <teleport to="body">
      <div
        v-if="imageOpen"
        class="rte-modal__overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Insert image"
        @click.self="cancelImage"
      >
        <div class="rte-modal rte-modal--image">
          <header class="rte-modal__head">
            <div class="rte-modal__eyebrow">Media</div>
            <h3 class="rte-modal__title">Insert image</h3>
          </header>

          <div v-if="imageCanUpload" class="rte-modal__tabs" role="tablist">
            <button
              type="button"
              class="rte-modal__tab"
              :class="{ 'is-active': imageMode === 'upload' }"
              role="tab"
              @click="switchImageMode('upload')"
            >Upload</button>
            <button
              type="button"
              class="rte-modal__tab"
              :class="{ 'is-active': imageMode === 'url' }"
              role="tab"
              @click="switchImageMode('url')"
            >Paste URL</button>
          </div>

          <div class="rte-modal__body">
            <template v-if="imageMode === 'upload'">
              <input
                ref="imageFileInput"
                type="file"
                accept="image/*"
                class="rte-modal__file-input"
                @change="onImageFile"
              />
              <div
                v-if="!imageFile"
                class="rte-modal__dropzone"
                @click="imageFileInput?.click()"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <circle cx="9" cy="10" r="1.6" stroke="currentColor" stroke-width="1.6" />
                  <path d="M4 17l5-5 4 4 3-3 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <div class="rte-modal__dropzone-title">Choose an image</div>
                <div class="rte-modal__dropzone-hint">PNG, JPG or GIF · up to 10 MB</div>
              </div>
              <div v-else class="rte-modal__preview">
                <img :src="imageFilePreview ?? ''" alt="" />
                <div class="rte-modal__preview-meta">
                  <div class="rte-modal__preview-name">{{ imageFile.name }}</div>
                  <button type="button" class="rte-modal__preview-change" @click="clearImageSelection">Change</button>
                </div>
              </div>
            </template>

            <template v-else>
              <label class="rte-modal__field">
                <span class="rte-modal__label">Image URL</span>
                <input
                  ref="imageUrlInput"
                  v-model="imageUrl"
                  type="url"
                  class="rte-modal__input"
                  placeholder="https://"
                  @keydown.enter.prevent="confirmImage"
                />
                <span class="rte-modal__hint rte-modal__hint--block">
                  Must start with https:// so the image renders in email clients.
                </span>
              </label>
            </template>

            <div v-if="imageError" class="rte-modal__error">{{ imageError }}</div>
          </div>

          <footer class="rte-modal__foot">
            <button type="button" class="rte-modal__btn rte-modal__btn--ghost" :disabled="imageUploading" @click="cancelImage">Cancel</button>
            <button
              type="button"
              class="rte-modal__btn rte-modal__btn--ink"
              :disabled="imageUploading || (imageMode === 'upload' && !imageFile) || (imageMode === 'url' && !imageUrl.trim())"
              @click="confirmImage"
            >
              {{ imageUploading ? 'Uploading…' : 'Insert' }}
            </button>
          </footer>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.rte {
  display: flex;
  flex-direction: column;
  background: #ffffff;
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

<!-- Modal styles teleport to <body>, so `scoped` would strip them off.
     Keep them in a plain style block, prefixed with `.rte-modal` so they
     don't leak elsewhere. -->
<style>
.rte-modal__overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 11, 0.56);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
  animation: rte-modal-fade 120ms ease-out;
}
@keyframes rte-modal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.rte-modal {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(10, 10, 11, 0.24);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: rte-modal-pop 140ms ease-out;
}
.rte-modal--image { max-width: 480px; }
@keyframes rte-modal-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.rte-modal__head { padding: 20px 24px 12px; }
.rte-modal__eyebrow {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-fog, #a3a39b);
  margin-bottom: 4px;
}
.rte-modal__title {
  margin: 0;
  font-family: var(--font-display, 'Space Grotesk'), sans-serif;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink, #0a0a0b);
}

.rte-modal__tabs {
  display: flex;
  gap: 4px;
  padding: 0 24px;
  border-bottom: 1px solid var(--color-hairline, #e7e7e1);
}
.rte-modal__tab {
  position: relative;
  padding: 10px 14px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-fog, #a3a39b);
  transition: color 120ms ease;
}
.rte-modal__tab:hover { color: var(--color-ink, #0a0a0b); }
.rte-modal__tab.is-active {
  color: var(--color-ink, #0a0a0b);
  font-weight: 600;
}
.rte-modal__tab.is-active::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 2px;
  background: var(--color-ink, #0a0a0b);
  border-radius: 2px;
}

.rte-modal__body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rte-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rte-modal__label {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog, #a3a39b);
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
.rte-modal__hint {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--color-mute, #c4c4bb);
}
.rte-modal__hint--block { display: block; margin-top: 4px; }
.rte-modal__input {
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline, #e7e7e1);
  background: #fff;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 14px;
  color: var(--color-ink, #0a0a0b);
  box-sizing: border-box;
}
.rte-modal__input:focus {
  outline: none;
  border-color: var(--color-ink, #0a0a0b);
}

.rte-modal__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.rte-modal__dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1.5px dashed var(--color-hairline, #e7e7e1);
  border-radius: 12px;
  background: var(--color-surface, #fafaf7);
  color: var(--color-fog, #a3a39b);
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.rte-modal__dropzone:hover {
  border-color: var(--color-ink, #0a0a0b);
  color: var(--color-ink, #0a0a0b);
  background: #fff;
}
.rte-modal__dropzone-title {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink, #0a0a0b);
}
.rte-modal__dropzone-hint {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 12px;
  color: var(--color-fog, #a3a39b);
}

.rte-modal__preview {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--color-hairline, #e7e7e1);
  border-radius: 12px;
  background: #fff;
}
.rte-modal__preview img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}
.rte-modal__preview-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rte-modal__preview-name {
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink, #0a0a0b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rte-modal__preview-change {
  align-self: flex-start;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent, #2563eb);
  cursor: pointer;
}
.rte-modal__preview-change:hover { text-decoration: underline; }

.rte-modal__error {
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  color: #b91c1c;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 12px;
}

.rte-modal__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--color-hairline, #e7e7e1);
}
.rte-modal__link-remove {
  margin-right: auto;
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #b91c1c;
  cursor: pointer;
}
.rte-modal__link-remove:hover { text-decoration: underline; }
.rte-modal__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body, 'Inter'), sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}
.rte-modal__btn:focus-visible {
  outline: 2px solid var(--color-ink, #0a0a0b);
  outline-offset: 2px;
}
.rte-modal__btn--ghost {
  background: transparent;
  color: var(--color-ink, #0a0a0b);
}
.rte-modal__btn--ghost:hover:not(:disabled) { background: var(--color-hairline, #e7e7e1); }
.rte-modal__btn--ghost:disabled { color: var(--color-mute, #c4c4bb); cursor: not-allowed; }
.rte-modal__btn--ink {
  background: var(--color-ink, #0a0a0b);
  color: #fff;
  padding: 0 22px;
}
.rte-modal__btn--ink:hover:not(:disabled) { background: var(--color-graphite, #2e2e33); }
.rte-modal__btn--ink:disabled {
  background: var(--color-mute, #c4c4bb);
  color: #fff;
  cursor: not-allowed;
}
</style>
