<script setup lang="ts">
/**
 * Reusable PDF picker — the file-upload sibling of ImagePicker.
 *
 * Block-scoped only (brief 118). Pass `pageSlug` + `blockId` + the
 * admin's active club, and uploads go through the block-pdfs API:
 * upload-url → PUT to R2 → confirm. Emits both `update:modelValue`
 * (public URL) and `update:pdfId` (row id) so the parent can track
 * ownership for later DELETE on replace.
 *
 * Also emits `update:fileSize` with the server-reported byte count so
 * parent inspectors can seed admin-facing size labels (e.g. BistroMenu's
 * `fileSizeLabel: "320 KB"`) without round-tripping the PDF.
 *
 * v-modelled on the URL string. Empty string / null / undefined = no file.
 */
import { computed, ref } from 'vue'
import {
  blockPdfs,
  ApiError,
  type PageSlug,
} from '@torny/api-client'
import { useClubStore } from '@/stores/club'

const props = withDefaults(defineProps<{
  modelValue: string | null | undefined
  /** Row id from the block-pdfs API. Needed to DELETE the old row on replace. */
  pdfId?: number | null
  pageSlug: PageSlug
  blockId: string
  /** Optional title saved with the PDF on confirm. */
  title?: string
  maxSizeMb?: number
  label?: string
  hint?: string
}>(), {
  pdfId: null,
  title: '',
  maxSizeMb: 10,
  label: '',
  hint: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:pdfId': [value: number | null]
  /** Server-reported file size in bytes. Zero when cleared. */
  'update:fileSize': [bytes: number]
  /** Server-reported original filename. Empty string when cleared. */
  'update:filename': [name: string]
}>()

const clubStore = useClubStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const error = ref<string | null>(null)

/** Cache the last-uploaded filename + size so the preview card can show
 *  them without another server round-trip. When the component mounts
 *  with a pre-existing modelValue (admin reopened the editor), we don't
 *  know the filename; fall back to the URL's basename. */
const cachedFilename = ref<string | null>(null)
const cachedSizeBytes = ref<number | null>(null)

const displayFilename = computed<string | null>(() => {
  if (cachedFilename.value) return cachedFilename.value
  const url = props.modelValue ?? ''
  if (!url) return null
  try {
    const path = new URL(url).pathname
    const last = path.split('/').pop() ?? ''
    return last || url
  } catch {
    return url
  }
})

const displaySize = computed<string | null>(() => {
  const bytes = cachedSizeBytes.value
  if (bytes === null) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
})

const hasFile = computed(() => Boolean(props.modelValue))

function openPicker() {
  if (uploading.value) return
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return

  error.value = null

  if (file.type !== 'application/pdf') {
    error.value = 'Please pick a PDF.'
    return
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    error.value = `Keep it under ${props.maxSizeMb} MB.`
    return
  }

  const clubId = clubStore.current?.id
  if (clubId == null || typeof clubId !== 'number') {
    error.value = 'No active club — refresh and try again.'
    return
  }

  uploading.value = true

  try {
    const prevId = props.pdfId
    const confirmed = await blockPdfs.upload(
      clubId,
      props.pageSlug,
      props.blockId,
      file,
      { title: props.title || undefined },
    )
    if (prevId != null) {
      // Fire-and-forget — a failed delete here isn't user-facing.
      blockPdfs
        .remove(clubId, props.pageSlug, props.blockId, prevId)
        .catch(() => { /* ignore */ })
    }
    cachedFilename.value = confirmed.original_filename
    cachedSizeBytes.value = confirmed.file_size_bytes
    emit('update:modelValue', confirmed.public_url)
    emit('update:pdfId', confirmed.id)
    emit('update:fileSize', confirmed.file_size_bytes)
    emit('update:filename', confirmed.original_filename)
  } catch (err) {
    if (err instanceof ApiError) {
      error.value = err.code === 'too_many_pdfs'
        ? 'This block already has 20 PDFs — remove one first.'
        : err.code === 'pdf_too_large'
          ? `Keep it under ${props.maxSizeMb} MB.`
          : err.code === 'pdf_mime_invalid'
            ? 'The server rejected that file — only PDFs are accepted.'
            : err.status === 403
              ? "You don't have permission to upload PDFs for this club."
              : (err.message || 'Upload failed')
    } else {
      error.value = err instanceof Error ? err.message : 'Upload failed'
    }
  } finally {
    uploading.value = false
  }
}

async function remove() {
  if (uploading.value) return
  const clubId = clubStore.current?.id
  const prevId = props.pdfId

  cachedFilename.value = null
  cachedSizeBytes.value = null
  error.value = null

  emit('update:modelValue', '')
  emit('update:pdfId', null)
  emit('update:fileSize', 0)
  emit('update:filename', '')

  if (typeof clubId === 'number' && prevId != null) {
    try {
      await blockPdfs.remove(clubId, props.pageSlug, props.blockId, prevId)
    } catch { /* ignore */ }
  }
}
</script>

<template>
  <div class="pdf-picker">
    <div v-if="label" class="pdf-picker__label">{{ label }}</div>

    <button
      v-if="!hasFile"
      type="button"
      class="pdf-picker__frame pdf-picker__frame--empty"
      :class="{ 'pdf-picker__frame--busy': uploading }"
      :disabled="uploading"
      @click="openPicker"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" aria-hidden="true">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
      <span>Choose PDF</span>
      <span v-if="uploading" class="pdf-picker__spinner" aria-label="Uploading" />
    </button>

    <div
      v-else
      class="pdf-picker__frame pdf-picker__frame--filled"
      :class="{ 'pdf-picker__frame--busy': uploading }"
    >
      <div class="pdf-picker__icon" aria-hidden="true">
        <span class="pdf-picker__tag">PDF</span>
      </div>
      <div class="pdf-picker__meta">
        <a
          :href="modelValue!"
          target="_blank"
          rel="noopener noreferrer"
          class="pdf-picker__filename"
        >{{ displayFilename ?? 'PDF file' }}</a>
        <div class="pdf-picker__size">
          <span v-if="displaySize">{{ displaySize }}</span>
          <span v-else class="pdf-picker__size--muted">Opens in a new tab</span>
        </div>
      </div>
      <span v-if="uploading" class="pdf-picker__spinner" aria-label="Uploading" />
    </div>

    <input ref="fileInput" type="file" accept="application/pdf" hidden @change="onFile" />

    <div class="pdf-picker__actions">
      <button type="button" class="pdf-picker__btn" :disabled="uploading" @click="openPicker">
        {{ uploading ? 'Uploading…' : hasFile ? 'Replace' : 'Choose file' }}
      </button>
      <button v-if="hasFile && !uploading" type="button" class="pdf-picker__remove" @click="remove">Remove</button>
    </div>

    <div v-if="hint && !error" class="pdf-picker__hint">{{ hint }}</div>
    <div v-if="error" class="pdf-picker__error" role="alert">{{ error }}</div>
  </div>
</template>

<style scoped>
.pdf-picker { display: flex; flex-direction: column; gap: 8px; }
.pdf-picker__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }

.pdf-picker__frame {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px dashed var(--color-hairline);
  border-radius: 10px;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
.pdf-picker__frame--empty {
  justify-content: center;
  padding: 22px 16px;
  font-weight: 600;
}
.pdf-picker__frame--empty:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 6%, var(--color-surface));
}
.pdf-picker__frame--filled {
  border-style: solid;
  cursor: default;
}
.pdf-picker__frame--busy { cursor: wait; }

.pdf-picker__icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 46px;
  flex-shrink: 0;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
}
.pdf-picker__tag {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-feature-tangerine, #EA580C);
}

.pdf-picker__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pdf-picker__filename {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pdf-picker__filename:hover { text-decoration: underline; }
.pdf-picker__size {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.pdf-picker__size--muted { color: var(--color-mute); }

.pdf-picker__spinner {
  margin-left: auto;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-hairline);
  border-top-color: var(--color-ink);
  border-radius: 999px;
  animation: pdfp-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes pdfp-spin { to { transform: rotate(360deg); } }

.pdf-picker__actions { display: flex; align-items: center; gap: 10px; }
.pdf-picker__btn {
  padding: 7px 14px;
  background: var(--color-ink);
  color: #fff;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.pdf-picker__btn:hover:not(:disabled) { background: var(--color-graphite); }
.pdf-picker__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pdf-picker__remove {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-danger);
  cursor: pointer;
}
.pdf-picker__remove:hover { text-decoration: underline; }

.pdf-picker__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.pdf-picker__error {
  padding: 8px 10px;
  background: #FEE2E2;
  color: #991B1B;
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 12px;
}
</style>
