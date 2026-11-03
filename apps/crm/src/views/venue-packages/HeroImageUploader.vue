<script setup lang="ts">
/**
 * Hero image uploader — venue package heroes (brief 73 §9).
 *
 * Three-state uploader:
 *   - empty: shows the drop zone + "choose file" button
 *   - uploading: shows a spinner + progress hint
 *   - uploaded: shows the hero preview + remove / replace buttons
 *
 * Composes `media.uploadVenuePackageHero` from the api-client:
 *   request upload-url → POST to Cloudflare → confirm.
 *
 * Parent passes `packageId` + the current `modelValue` (hero URL from
 * the server). On successful upload emits `update:modelValue` with the
 * new `public_url` so the parent can PATCH the venue-package row.
 *
 * Does NOT PATCH the venue-package row itself — stays composable.
 */
import { computed, ref } from 'vue'
import { media as mediaApi, ApiError } from '@torny/api-client'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  packageId: number | null
  modelValue: string | null
  alt: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', url: string | null): void
  (e: 'update:alt', alt: string | null): void
}>()

const toast = useToast()
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** Create-mode: no packageId yet. We can't request an upload URL
 *  without a row id (the backend keys the signed URL to the entity).
 *  Parent gates uploads until save by passing `disabled: true`. */
const uploadsDisabled = computed(() => props.disabled || props.packageId == null)

function pickFile(): void {
  if (uploadsDisabled.value) return
  fileInput.value?.click()
}

async function onFileChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''  // reset so the same file can be re-chosen after a remove
  if (!file || props.packageId == null) return

  // Size + mime early-reject so we don't hit Cloudflare with garbage.
  const MAX_BYTES = 10 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    toast.error('Image is larger than 10 MB — pick a smaller file.')
    return
  }
  if (!/^image\//.test(file.type)) {
    toast.error('That file isn\'t an image.')
    return
  }

  uploading.value = true
  try {
    const confirmed = await mediaApi.uploadVenuePackageHero(props.packageId, file)
    emit('update:modelValue', confirmed.public_url)
    toast.success('Hero uploaded.')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not upload image.')
  } finally {
    uploading.value = false
  }
}

function removeHero(): void {
  if (uploadsDisabled.value) return
  emit('update:modelValue', null)
  emit('update:alt', null)
}

function onAltInput(e: Event): void {
  emit('update:alt', (e.target as HTMLInputElement).value || null)
}
</script>

<template>
  <div class="hu" :class="{ 'hu--empty': !modelValue, 'hu--disabled': uploadsDisabled }">
    <div v-if="modelValue" class="hu__preview">
      <img :src="modelValue" :alt="alt ?? ''" class="hu__img" />
      <div class="hu__overlay">
        <button type="button" class="hu__btn" :disabled="uploadsDisabled || uploading" @click="pickFile">
          {{ uploading ? 'Uploading…' : 'Replace' }}
        </button>
        <button type="button" class="hu__btn hu__btn--ghost" :disabled="uploadsDisabled || uploading" @click="removeHero">
          Remove
        </button>
      </div>
    </div>

    <button
      v-else
      type="button"
      class="hu__dropzone"
      :disabled="uploadsDisabled || uploading"
      @click="pickFile"
      :aria-label="uploadsDisabled ? 'Save the package first, then add a hero image' : 'Choose a hero image'"
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M4 20V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="10" cy="12" r="2" stroke="currentColor" stroke-width="1.6"/>
        <path d="M4 18l5-5 4 4 3-3 8 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="hu__dropzone-label">
        {{ uploading ? 'Uploading…' : uploadsDisabled ? 'Save the package to add a hero' : 'Click to upload a hero image' }}
      </div>
      <div v-if="!uploadsDisabled && !uploading" class="hu__dropzone-hint">JPG or PNG · up to 10 MB</div>
    </button>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hu__file-input"
      @change="onFileChosen"
    />

    <label v-if="modelValue" class="hu__alt">
      <span class="hu__alt-label">Alt text (for accessibility)</span>
      <input
        type="text"
        :value="alt ?? ''"
        maxlength="200"
        placeholder="e.g. The clubhouse interior, long tables set for a wedding"
        @input="onAltInput"
      />
    </label>
  </div>
</template>

<style scoped>
.hu { display: flex; flex-direction: column; gap: 10px; }

.hu__preview { position: relative; border-radius: 12px; overflow: hidden; background: var(--color-surface); aspect-ratio: 16 / 9; }
.hu__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hu__overlay { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: flex-end; gap: 6px; padding: 10px; opacity: 0; transition: opacity 0.14s ease; background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent 60%); }
.hu__preview:hover .hu__overlay { opacity: 1; }

.hu__dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; aspect-ratio: 16 / 9; width: 100%; border: 2px dashed var(--color-hairline); border-radius: 12px; background: var(--color-surface); color: var(--color-fog); font-family: var(--font-body); cursor: pointer; transition: border-color 0.14s ease, background 0.14s ease; }
.hu__dropzone:hover:not(:disabled) { border-color: var(--color-accent); background: var(--color-accent-soft); color: var(--color-accent); }
.hu__dropzone:disabled { cursor: not-allowed; opacity: 0.7; }
.hu__dropzone-label { font-size: 14px; font-weight: 600; }
.hu__dropzone-hint { font-size: 12px; color: var(--color-fog); }

.hu__file-input { display: none; }

.hu__btn { padding: 7px 14px; border-radius: 999px; border: 0; background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.hu__btn:hover:not(:disabled) { background: var(--color-surface); }
.hu__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hu__btn--ghost { background: transparent; color: #fff; border: 1px solid rgba(255, 255, 255, 0.4); }
.hu__btn--ghost:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }

.hu__alt { display: flex; flex-direction: column; gap: 4px; }
.hu__alt-label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.hu__alt input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.hu__alt input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
</style>
