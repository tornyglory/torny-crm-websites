<script setup lang="ts">
/**
 * CRM Tournament form — one component drives both create and edit modes
 * (routes `tournament-new` and `tournament-edit`).
 *
 * Paper: "CRM · Create Tournament — Desktop". Sectioned card layout —
 * basics → cover & gallery → format → dates → entries → fees & prizes →
 * visibility. In create mode: POST + optional publish. In edit mode:
 * PATCH; publish button appears while the tournament is still draft.
 *
 * Backend: brief 47.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  media as mediaApi,
  tournaments as tournamentsApi,
  type CreateTournamentInput,
  type Tournament,
  type TournamentCategory,
  type TournamentFormat,
  type TournamentGenderScope,
  type TournamentPaymentMethod,
  type TournamentEntryUnit,
  type TournamentStatus,
  type UpdateTournamentInput,
} from '@torny/api-client'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

const GALLERY_MAX = 8

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()

const tournamentId = computed<number | null>(() => {
  const raw = route.params.id
  if (raw == null) return null
  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(id) ? id : null
})
const isEdit = computed(() => tournamentId.value != null)

const loading = ref(false)
const currentStatus = ref<TournamentStatus | null>(null)
const currentTitle = ref('')

interface FormState {
  title: string
  subtitle: string
  description: string
  format: TournamentFormat
  category: TournamentCategory
  gender_scope: Exclude<TournamentGenderScope, null> | ''
  starts_date: string
  starts_time: string
  ends_date: string
  entries_open_date: string
  entries_open_time: string
  entries_close_date: string
  entries_close_time: string
  entry_unit: TournamentEntryUnit
  entry_cap: number
  waitlist_enabled: boolean
  waitlist_cap: number
  open_to_visitors: boolean
  requires_bcnz: boolean
  min_age: number | null
  max_age: number | null
  entry_fee_dollars: number
  prize_pool_dollars: number | null
  prize_notes: string
  payment_method: TournamentPaymentMethod
  is_public: boolean
  sanctioned_by: string
  sanction_url: string
  cover_image_url: string
  gallery_urls: string[]
}

const form = reactive<FormState>({
  title: '',
  subtitle: '',
  description: '',
  format: 'triples',
  category: 'open',
  gender_scope: 'mixed',
  starts_date: '',
  starts_time: '09:00',
  ends_date: '',
  entries_open_date: '',
  entries_open_time: '09:00',
  entries_close_date: '',
  entries_close_time: '17:00',
  entry_unit: 'team',
  entry_cap: 24,
  waitlist_enabled: true,
  waitlist_cap: 8,
  open_to_visitors: true,
  requires_bcnz: false,
  min_age: null,
  max_age: null,
  entry_fee_dollars: 60,
  prize_pool_dollars: null,
  prize_notes: '',
  payment_method: 'on_the_day',
  is_public: true,
  sanctioned_by: '',
  sanction_url: '',
  cover_image_url: '',
  gallery_urls: [],
})

const uploadingCover = ref(false)
const uploadingGallery = ref(false)
const coverInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)

const saving = ref(false)

// ── Prefill from server (edit mode) ────────────────────────────

function splitIso(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    }
  } catch {
    return { date: '', time: '' }
  }
}

function prefill(t: Tournament) {
  const starts = splitIso(t.starts_at)
  const ends = splitIso(t.ends_at)
  const open = splitIso(t.entries_open_at)
  const close = splitIso(t.entries_close_at)
  form.title = t.title
  form.subtitle = t.subtitle ?? ''
  form.description = t.description ?? ''
  form.format = t.format
  form.category = t.category
  form.gender_scope = t.gender_scope ?? ''
  form.starts_date = starts.date
  form.starts_time = starts.time || '09:00'
  form.ends_date = ends.date
  form.entries_open_date = open.date
  form.entries_open_time = open.time || '09:00'
  form.entries_close_date = close.date
  form.entries_close_time = close.time || '17:00'
  form.entry_unit = t.entry_unit
  form.entry_cap = t.entry_cap
  form.waitlist_enabled = t.waitlist_enabled
  form.waitlist_cap = t.waitlist_cap ?? 8
  form.open_to_visitors = t.open_to_visitors
  form.requires_bcnz = t.requires_bcnz
  form.min_age = t.min_age
  form.max_age = t.max_age
  form.entry_fee_dollars = t.entry_fee_cents / 100
  form.prize_pool_dollars = t.prize_pool_cents != null ? t.prize_pool_cents / 100 : null
  form.prize_notes = t.prize_notes ?? ''
  form.payment_method = t.payment_method
  form.is_public = t.is_public
  form.sanctioned_by = t.sanctioned_by ?? ''
  form.sanction_url = t.sanction_url ?? ''
  form.cover_image_url = t.cover_image_url ?? ''
  form.gallery_urls = [...t.gallery_urls]
  currentStatus.value = t.status
  currentTitle.value = t.title
}

async function load() {
  const cid = clubStore.current?.id
  const tid = tournamentId.value
  if (!isEdit.value || typeof cid !== 'number' || tid == null) return
  loading.value = true
  try {
    const t = await tournamentsApi.get(cid, tid)
    prefill(t)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load tournament.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => clubStore.current?.id, load)
watch(tournamentId, load)

// ── Validation ──────────────────────────────────────────────────

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.title.trim()) e.title = 'Give it a title.'
  if (!form.starts_date) e.starts_date = 'Set the start date.'
  if (!form.ends_date) e.ends_date = 'Set the end date.'
  if (form.starts_date && form.ends_date && form.ends_date < form.starts_date) {
    e.ends_date = 'End must be on or after the start.'
  }
  if (!form.entries_open_date) e.entries_open_date = 'When do entries open?'
  if (!form.entries_close_date) e.entries_close_date = 'When do entries close?'
  if (
    form.entries_open_date &&
    form.entries_close_date &&
    form.entries_close_date < form.entries_open_date
  ) {
    e.entries_close_date = 'Close date must be after open date.'
  }
  if (form.entry_cap < 1) e.entry_cap = 'At least 1.'
  if (form.entry_fee_dollars < 0) e.entry_fee_dollars = 'Fee cannot be negative.'
  return e
})

const canSubmit = computed(() => Object.keys(errors.value).length === 0)

// ── Payload builder ─────────────────────────────────────────────

function combineIso(date: string, time: string): string {
  if (!date) return ''
  const t = time || '00:00'
  return new Date(`${date}T${t}:00`).toISOString()
}

function buildPayload(): CreateTournamentInput {
  return {
    title: form.title.trim(),
    format: form.format,
    category: form.category,
    starts_at: combineIso(form.starts_date, form.starts_time),
    ends_at: combineIso(form.ends_date, form.starts_time),
    entries_open_at: combineIso(form.entries_open_date, form.entries_open_time),
    entries_close_at: combineIso(form.entries_close_date, form.entries_close_time),
    entry_unit: form.entry_unit,
    entry_cap: form.entry_cap,
    entry_fee_cents: Math.round(form.entry_fee_dollars * 100),
    payment_method: form.payment_method,
    subtitle: form.subtitle.trim() || undefined,
    description: form.description.trim() || undefined,
    gender_scope: form.gender_scope || undefined,
    waitlist_enabled: form.waitlist_enabled,
    waitlist_cap: form.waitlist_enabled ? form.waitlist_cap : null,
    prize_pool_cents:
      form.prize_pool_dollars != null ? Math.round(form.prize_pool_dollars * 100) : null,
    prize_notes: form.prize_notes.trim() || undefined,
    open_to_visitors: form.open_to_visitors,
    requires_bcnz: form.requires_bcnz,
    min_age: form.min_age,
    max_age: form.max_age,
    sanctioned_by: form.sanctioned_by.trim() || undefined,
    sanction_url: form.sanction_url.trim() || undefined,
    cover_image_url: form.cover_image_url || null,
    gallery_urls: form.gallery_urls,
    is_public: form.is_public,
  }
}

// ── Image uploads ──────────────────────────────────────────────
// Tournament images are stored under the club's media until the
// backend adds a dedicated 'tournament' entity_type. content_id is a
// client-generated nonce so each image gets a unique record.

async function uploadImage(file: File, contentType: 'cover' | 'gallery'): Promise<string> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') throw new Error('No club selected.')
  // 31-bit random int — MySQL signed INT column (max 2_147_483_647).
  const contentId = Math.floor(Math.random() * 2_000_000_000) + 1
  const { uploadUrl, imageId } = await mediaApi.requestUploadUrl({
    entity_type: 'club',
    entity_id: cid,
    content_type: contentType,
    content_id: contentId,
  })
  const body = new FormData()
  body.append('file', file)
  const cf = await fetch(uploadUrl, { method: 'POST', body })
  if (!cf.ok) throw new Error(`Upload failed (${cf.status}).`)
  const confirmed = await mediaApi.confirmUpload({
    imageId,
    entity_type: 'club',
    entity_id: cid,
    content_type: contentType,
    content_id: contentId,
  })
  return confirmed.public_url
}

async function onCoverPicked(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  uploadingCover.value = true
  try {
    form.cover_image_url = await uploadImage(file, 'cover')
    toast.success('Cover uploaded.')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Cover upload failed.')
  } finally {
    uploadingCover.value = false
  }
}

async function onGalleryPicked(e: Event) {
  const target = e.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  target.value = ''
  if (files.length === 0) return
  const remaining = GALLERY_MAX - form.gallery_urls.length
  if (remaining <= 0) {
    toast.error(`Max ${GALLERY_MAX} gallery images.`)
    return
  }
  uploadingGallery.value = true
  try {
    for (const file of files.slice(0, remaining)) {
      const url = await uploadImage(file, 'gallery')
      form.gallery_urls.push(url)
    }
    toast.success('Gallery updated.')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Gallery upload failed.')
  } finally {
    uploadingGallery.value = false
  }
}

function removeCover() {
  form.cover_image_url = ''
}
function removeGalleryAt(index: number) {
  form.gallery_urls.splice(index, 1)
}
function moveGallery(index: number, direction: -1 | 1) {
  const next = index + direction
  if (next < 0 || next >= form.gallery_urls.length) return
  const arr = form.gallery_urls
  const tmp = arr[index]!
  arr[index] = arr[next]!
  arr[next] = tmp
}

async function save(publish: boolean) {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  if (!canSubmit.value) {
    toast.error('Fix the highlighted fields first.')
    return
  }
  saving.value = true
  try {
    const payload = buildPayload()
    let saved: Tournament
    if (isEdit.value && tournamentId.value != null) {
      saved = await tournamentsApi.update(
        cid,
        tournamentId.value,
        payload as UpdateTournamentInput,
      )
      if (publish && saved.status === 'draft') {
        saved = await tournamentsApi.publish(cid, saved.id)
        toast.success(`${saved.title} is live and taking entries.`)
      } else {
        toast.success(`${saved.title} updated.`)
      }
    } else {
      saved = await tournamentsApi.create(cid, payload)
      if (publish) {
        saved = await tournamentsApi.publish(cid, saved.id)
        toast.success(`${saved.title} is live and taking entries.`)
      } else {
        toast.success(`${saved.title} saved as draft.`)
      }
    }
    router.push({ name: 'tournament-detail', params: { id: saved.id } })
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not save.')
  } finally {
    saving.value = false
  }
}

function discard() {
  if (isEdit.value && tournamentId.value != null) {
    router.push({ name: 'tournament-detail', params: { id: tournamentId.value } })
  } else {
    router.push({ name: 'tournaments' })
  }
}

const canPublishFromEdit = computed(() => isEdit.value && currentStatus.value === 'draft')
const showPublishButton = computed(() => !isEdit.value || canPublishFromEdit.value)
const pageTitle = computed(() => (isEdit.value ? 'Edit tournament' : 'New tournament'))
const pageSub = computed(() =>
  isEdit.value
    ? currentStatus.value === 'draft'
      ? 'Still a draft. Edit anything, then publish when ready.'
      : 'Live tournament. Some fields freeze once entries are taken — the backend will flag anything invalid.'
    : 'Everything from the poster on the noticeboard to the entry fee & waitlist. Save as you go — nothing is public until you publish.',
)
const primaryLabel = computed(() => {
  if (saving.value) return 'Saving…'
  if (isEdit.value) return canPublishFromEdit.value ? 'Save & publish' : 'Save changes'
  return 'Publish tournament'
})
const secondaryLabel = computed(() => (isEdit.value ? 'Save' : 'Save as draft'))

// ── UI helpers ─────────────────────────────────────────────────

const FORMATS: Array<{ value: TournamentFormat; label: string; digit: string }> = [
  { value: 'singles', label: 'Singles', digit: '1' },
  { value: 'pairs', label: 'Pairs', digit: '2' },
  { value: 'triples', label: 'Triples', digit: '3' },
  { value: 'fours', label: 'Fours', digit: '4' },
]

const CATEGORIES: Array<{ value: TournamentCategory; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'championship', label: 'Championship' },
  { value: 'junior', label: 'Junior' },
  { value: 'veterans', label: 'Veterans' },
  { value: 'social', label: 'Social' },
]

const descLen = computed(() => form.description.length)
</script>

<template>
  <div class="ct">
    <header class="ct__head">
      <div class="crumb">
        <RouterLink :to="{ name: 'tournaments' }">Tournaments</RouterLink>
        <span class="crumb__sep">›</span>
        <RouterLink
          v-if="isEdit && tournamentId != null"
          :to="{ name: 'tournament-detail', params: { id: tournamentId } }"
        >{{ currentTitle || 'Tournament' }}</RouterLink>
        <span v-if="isEdit" class="crumb__sep">›</span>
        <span>{{ isEdit ? 'Edit' : 'New tournament' }}</span>
      </div>
      <div class="ct__title-row">
        <div class="ct__title-wrap">
          <h1 class="ct__title">{{ pageTitle }}</h1>
          <p class="ct__sub">{{ pageSub }}</p>
          <span v-if="isEdit && currentStatus" class="ct__status" :class="`ct__status--${currentStatus}`">
            <span class="ct__status-dot"></span>{{ currentStatus.replace('_', ' ') }}
          </span>
        </div>
        <div class="ct__actions">
          <button type="button" class="ghost-link" @click="discard" :disabled="saving">{{ isEdit ? 'Cancel' : 'Discard' }}</button>
          <button v-if="!isEdit || !canPublishFromEdit" type="button" class="btn-secondary" @click="save(false)" :disabled="saving">{{ secondaryLabel }}</button>
          <button v-if="showPublishButton" type="button" class="btn-primary" @click="save(true)" :disabled="saving || !canSubmit">
            {{ primaryLabel }}
          </button>
        </div>
      </div>
    </header>

    <div class="ct__body">
      <!-- 01 Basics -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--accent">01</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--accent">BASICS</div>
            <h2 class="card__title">What are you running?</h2>
            <p class="card__sub">Title, tagline, cover. This is what shows up on the poster.</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ct-title">Tournament title</label>
          <input
            id="ct-title"
            v-model="form.title"
            type="text"
            class="input"
            :class="{ 'input--error': errors.title }"
            placeholder="e.g. Summer Classic Triples"
          />
          <div v-if="errors.title" class="field__error">{{ errors.title }}</div>
        </div>
        <div class="field">
          <label class="field__label" for="ct-subtitle">Subtitle <span class="field__opt">optional</span></label>
          <input
            id="ct-subtitle"
            v-model="form.subtitle"
            type="text"
            class="input"
            placeholder='e.g. "Our biggest summer event — cash prizes"'
          />
        </div>
        <div class="field">
          <label class="field__label" for="ct-desc">Description</label>
          <textarea
            id="ct-desc"
            v-model="form.description"
            class="input input--textarea"
            rows="4"
            maxlength="500"
            placeholder="Format, catering, what to bring."
          ></textarea>
          <div class="field__count">{{ descLen }} / 500</div>
        </div>
      </section>

      <!-- 02 Cover & Gallery -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--accent">02</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--accent">COVER &amp; GALLERY</div>
            <h2 class="card__title">Show it off.</h2>
            <p class="card__sub">One hero cover for the poster + up to {{ GALLERY_MAX }} more for the tournament page. Drag arrows to reorder.</p>
          </div>
          <div class="upload-count">
            <span class="upload-count__dot"></span>
            {{ (form.cover_image_url ? 1 : 0) + form.gallery_urls.length }} / {{ GALLERY_MAX + 1 }} uploaded
          </div>
        </div>
        <input ref="coverInput" type="file" accept="image/*" class="hidden" @change="onCoverPicked" />
        <input ref="galleryInput" type="file" accept="image/*" multiple class="hidden" @change="onGalleryPicked" />
        <div class="field">
          <div class="field__label-row">
            <label class="field__label">Cover image <span class="field__opt">shows on the tournament card, poster and web listing</span></label>
            <span class="field__hint-mono">RECOMMENDED 1600 × 900</span>
          </div>
          <div v-if="form.cover_image_url" class="cover-slot cover-slot--filled" :style="{ backgroundImage: `url(${form.cover_image_url})` }">
            <span class="cover-badge">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4L11 4.5L8.5 7L9 10.5L6 8.75L3 10.5L3.5 7L1 4.5L4.5 4L6 1Z" fill="#fff"/></svg>
              COVER
            </span>
            <div class="cover-actions">
              <button type="button" class="cover-icon" :disabled="uploadingCover" @click="coverInput?.click()" aria-label="Replace cover">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L11 5L5 11H3V9L9 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
              </button>
              <button type="button" class="cover-icon" @click="removeCover" aria-label="Remove cover">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="cover-slot cover-slot--empty"
            :disabled="uploadingCover"
            @click="coverInput?.click()"
          >
            <div class="cover-slot__icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 4H16V13L12.5 9.5L9 13L7 11L4 14V4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </div>
            <div class="cover-slot__title">{{ uploadingCover ? 'Uploading…' : 'Drop cover or click to upload' }}</div>
            <div class="cover-slot__sub">JPG, PNG or WebP · up to 10 MB</div>
          </button>
        </div>
        <div class="field">
          <div class="field__label-row">
            <label class="field__label">Gallery <span class="field__opt">up to {{ GALLERY_MAX }} images — shown on the public tournament page</span></label>
            <button
              type="button"
              class="btn-pill"
              :disabled="uploadingGallery || form.gallery_urls.length >= GALLERY_MAX"
              @click="galleryInput?.click()"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1V9M1 5H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              {{ uploadingGallery ? 'Uploading…' : 'Add more' }}
            </button>
          </div>
          <div class="gallery-grid">
            <div
              v-for="(url, i) in form.gallery_urls"
              :key="url"
              class="gallery-tile"
              :style="{ backgroundImage: `url(${url})` }"
            >
              <span class="gallery-tile__num">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="gallery-tile__actions">
                <button type="button" class="gallery-icon" :disabled="i === 0" @click="moveGallery(i, -1)" aria-label="Move left">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M6.5 2L2.5 5L6.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
                <button type="button" class="gallery-icon" :disabled="i === form.gallery_urls.length - 1" @click="moveGallery(i, 1)" aria-label="Move right">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7.5 5L3.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
                <button type="button" class="gallery-icon" @click="removeGalleryAt(i)" aria-label="Remove">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
            <button
              v-if="form.gallery_urls.length < GALLERY_MAX"
              type="button"
              class="gallery-add"
              :disabled="uploadingGallery"
              @click="galleryInput?.click()"
            >
              <div class="gallery-add__plus">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              </div>
              <span class="gallery-add__label">Drop or upload</span>
            </button>
          </div>
          <div class="gallery-hint">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 4.5V7.5M7 9V9.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            JPG, PNG or WebP · 10 MB per image · landscape orientation looks best.
          </div>
        </div>
      </section>

      <!-- 03 Format & Category -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--mint">03</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--mint">FORMAT &amp; CATEGORY</div>
            <h2 class="card__title">Who's playing what?</h2>
            <p class="card__sub">Bowls format and category affect who can enter and what rules apply.</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label">Format</label>
          <div class="format-grid">
            <button
              v-for="f in FORMATS"
              :key="f.value"
              type="button"
              class="format-tile"
              :class="{ 'is-on': form.format === f.value }"
              @click="form.format = f.value"
            >
              <div class="format-tile__digit">{{ f.digit }}</div>
              <div class="format-tile__label">{{ f.label }}</div>
            </button>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-category">Category</label>
            <select id="ct-category" v-model="form.category" class="input">
              <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="ct-gender">Gender <span class="field__opt">optional</span></label>
            <select id="ct-gender" v-model="form.gender_scope" class="input">
              <option value="mixed">Mixed</option>
              <option value="mens">Men's</option>
              <option value="womens">Women's</option>
              <option value="">Not specified</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 04 Dates -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--violet">04</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--violet">DATES</div>
            <h2 class="card__title">When is it happening?</h2>
            <p class="card__sub">Set play dates and the window entrants can join. Waitlist auto-promotes until entries close.</p>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-start-date">Start date</label>
            <input
              id="ct-start-date"
              v-model="form.starts_date"
              type="date"
              class="input"
              :class="{ 'input--error': errors.starts_date }"
            />
            <div v-if="errors.starts_date" class="field__error">{{ errors.starts_date }}</div>
          </div>
          <div class="field">
            <label class="field__label" for="ct-end-date">End date</label>
            <input
              id="ct-end-date"
              v-model="form.ends_date"
              type="date"
              class="input"
              :class="{ 'input--error': errors.ends_date }"
            />
            <div v-if="errors.ends_date" class="field__error">{{ errors.ends_date }}</div>
          </div>
          <div class="field">
            <label class="field__label" for="ct-start-time">Start time</label>
            <input id="ct-start-time" v-model="form.starts_time" type="time" class="input" />
          </div>
        </div>
        <div class="divider"></div>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-open-date">Entries open</label>
            <div class="field-inner">
              <input
                id="ct-open-date"
                v-model="form.entries_open_date"
                type="date"
                class="input"
                :class="{ 'input--error': errors.entries_open_date }"
              />
              <input v-model="form.entries_open_time" type="time" class="input input--time" />
            </div>
            <div v-if="errors.entries_open_date" class="field__error">{{ errors.entries_open_date }}</div>
          </div>
          <div class="field">
            <label class="field__label" for="ct-close-date">Entries close</label>
            <div class="field-inner">
              <input
                id="ct-close-date"
                v-model="form.entries_close_date"
                type="date"
                class="input"
                :class="{ 'input--error': errors.entries_close_date }"
              />
              <input v-model="form.entries_close_time" type="time" class="input input--time" />
            </div>
            <div v-if="errors.entries_close_date" class="field__error">{{ errors.entries_close_date }}</div>
          </div>
        </div>
        <div class="hint">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 5V8.5M8 11V11.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <span><strong>Close entries 1–3 days before play</strong> to give yourself time to build the draw. We'll email you a reminder the day before.</span>
        </div>
      </section>

      <!-- 05 Entries -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--tangerine">05</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--tangerine">ENTRIES</div>
            <h2 class="card__title">How many can play?</h2>
            <p class="card__sub">Cap, waitlist, and who's allowed to enter.</p>
          </div>
        </div>
        <div class="field">
          <label class="field__label">Entrants sign up as</label>
          <div class="radio-grid">
            <button
              type="button"
              class="radio-card"
              :class="{ 'is-on': form.entry_unit === 'team' }"
              @click="form.entry_unit = 'team'"
            >
              <div class="radio-dot" :class="{ 'is-on': form.entry_unit === 'team' }"></div>
              <div class="radio-card__body">
                <div class="radio-card__title">Full team</div>
                <div class="radio-card__sub">Captain enters all players at once</div>
              </div>
            </button>
            <button
              type="button"
              class="radio-card"
              :class="{ 'is-on': form.entry_unit === 'player' }"
              @click="form.entry_unit = 'player'"
            >
              <div class="radio-dot" :class="{ 'is-on': form.entry_unit === 'player' }"></div>
              <div class="radio-card__body">
                <div class="radio-card__title">Individual player</div>
                <div class="radio-card__sub">Club drafts teams from the entrant pool</div>
              </div>
            </button>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-cap">Max {{ form.entry_unit === 'team' ? 'teams' : 'players' }}</label>
            <input
              id="ct-cap"
              v-model.number="form.entry_cap"
              type="number"
              min="1"
              class="input"
              :class="{ 'input--error': errors.entry_cap }"
            />
          </div>
          <div class="field">
            <label class="field__label" for="ct-waitlist-cap">Waitlist cap</label>
            <input
              id="ct-waitlist-cap"
              v-model.number="form.waitlist_cap"
              type="number"
              min="0"
              class="input"
              :disabled="!form.waitlist_enabled"
            />
          </div>
          <div class="field">
            <label class="field__label">Age range <span class="field__opt">optional</span></label>
            <div class="field-inner">
              <input
                v-model.number="form.min_age"
                type="number"
                min="0"
                class="input"
                placeholder="Min"
              />
              <input
                v-model.number="form.max_age"
                type="number"
                min="0"
                class="input"
                placeholder="Max"
              />
            </div>
          </div>
        </div>
        <label class="toggle-row">
          <div class="toggle-row__text">
            <div class="toggle-row__title">Open to visitors</div>
            <div class="toggle-row__sub">Players from other clubs can enter</div>
          </div>
          <input v-model="form.open_to_visitors" type="checkbox" class="toggle" />
        </label>
        <label class="toggle-row">
          <div class="toggle-row__text">
            <div class="toggle-row__title">Require Bowls NZ number</div>
            <div class="toggle-row__sub">Entrants must supply a valid BCNZ number</div>
          </div>
          <input v-model="form.requires_bcnz" type="checkbox" class="toggle" />
        </label>
        <label class="toggle-row">
          <div class="toggle-row__text">
            <div class="toggle-row__title">Enable waitlist</div>
            <div class="toggle-row__sub">Auto-promote when a paid entry drops out</div>
          </div>
          <input v-model="form.waitlist_enabled" type="checkbox" class="toggle" />
        </label>
      </section>

      <!-- 06 Fees & Prizes -->
      <section class="card">
        <div class="card__head">
          <div class="badge badge--mint">06</div>
          <div class="card__head-body">
            <div class="card__eyebrow eyebrow--mint">FEES &amp; PRIZES</div>
            <h2 class="card__title">What's the entry fee?</h2>
            <p class="card__sub">Set the fee, choose how it's paid, and add a prize purse if you're running one.</p>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-fee">Entry fee <span class="field__opt">per {{ form.entry_unit }}</span></label>
            <div class="input-money">
              <span class="input-money__prefix">NZ$</span>
              <input
                id="ct-fee"
                v-model.number="form.entry_fee_dollars"
                type="number"
                min="0"
                step="0.5"
                class="input"
                :class="{ 'input--error': errors.entry_fee_dollars }"
              />
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="ct-prize">Prize pool <span class="field__opt">optional</span></label>
            <div class="input-money">
              <span class="input-money__prefix">NZ$</span>
              <input
                id="ct-prize"
                v-model.number="form.prize_pool_dollars"
                type="number"
                min="0"
                step="1"
                class="input"
                placeholder="0"
              />
            </div>
          </div>
        </div>
        <div class="field">
          <label class="field__label">How are entrants paying?</label>
          <div class="pay-list">
            <button
              type="button"
              class="pay-row pay-row--disabled"
              disabled
            >
              <div class="radio-dot"></div>
              <div class="pay-row__body">
                <div class="pay-row__title-line">
                  <span class="pay-row__title">Card payment at entry</span>
                  <span class="pay-row__badge pay-row__badge--soon">COMING SOON</span>
                </div>
                <div class="pay-row__sub">Stripe-backed. Lands with brief 47 Phase 2.</div>
              </div>
              <div class="pay-row__cards">
                <span class="chip-mono">VISA</span>
                <span class="chip-mono">MC</span>
              </div>
            </button>
            <button
              type="button"
              class="pay-row"
              :class="{ 'is-on': form.payment_method === 'on_the_day' }"
              @click="form.payment_method = 'on_the_day'"
            >
              <div class="radio-dot" :class="{ 'is-on': form.payment_method === 'on_the_day' }"></div>
              <div class="pay-row__body">
                <div class="pay-row__title">Pay on the day</div>
                <div class="pay-row__sub">Entry confirmed, cash / eftpos collected at rego desk</div>
              </div>
            </button>
            <button
              type="button"
              class="pay-row"
              :class="{ 'is-on': form.payment_method === 'club_transfer' }"
              @click="form.payment_method = 'club_transfer'"
            >
              <div class="radio-dot" :class="{ 'is-on': form.payment_method === 'club_transfer' }"></div>
              <div class="pay-row__body">
                <div class="pay-row__title">Direct debit to club account</div>
                <div class="pay-row__sub">Entries pending until club marks paid</div>
              </div>
            </button>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ct-prize-notes">Prize breakdown <span class="field__opt">optional</span></label>
          <textarea
            id="ct-prize-notes"
            v-model="form.prize_notes"
            class="input input--textarea"
            rows="2"
            placeholder="e.g. 1st: $400 · 2nd: $250 · 3rd: $150"
          ></textarea>
        </div>
      </section>

      <!-- 07 Visibility -->
      <section class="card">
        <div class="card__head">
          <div class="badge">07</div>
          <div class="card__head-body">
            <div class="card__eyebrow">VISIBILITY &amp; SANCTIONING</div>
            <h2 class="card__title">Where does it show up?</h2>
            <p class="card__sub">Public listing and any governing body who's sanctioned this event.</p>
          </div>
        </div>
        <label class="toggle-row">
          <div class="toggle-row__text">
            <div class="toggle-row__title">Listed on the public tournament finder</div>
            <div class="toggle-row__sub">Anyone can find and enter — recommended for open events</div>
          </div>
          <input v-model="form.is_public" type="checkbox" class="toggle" />
        </label>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="ct-sanction-by">Sanctioned by <span class="field__opt">optional</span></label>
            <input
              id="ct-sanction-by"
              v-model="form.sanctioned_by"
              type="text"
              class="input"
              placeholder="e.g. Bowls Auckland"
            />
          </div>
          <div class="field field--wide">
            <label class="field__label" for="ct-sanction-url">Sanction URL <span class="field__opt">optional</span></label>
            <input
              id="ct-sanction-url"
              v-model="form.sanction_url"
              type="url"
              class="input"
              placeholder="https://…"
            />
          </div>
        </div>
      </section>

      <div class="footer-actions">
        <button type="button" class="ghost-link" @click="discard" :disabled="saving">{{ isEdit ? 'Cancel' : 'Discard' }}</button>
        <div class="footer-actions__cta">
          <button v-if="!isEdit || !canPublishFromEdit" type="button" class="btn-secondary" @click="save(false)" :disabled="saving">{{ secondaryLabel }}</button>
          <button v-if="showPublishButton" type="button" class="btn-primary" @click="save(true)" :disabled="saving || !canSubmit">
            {{ primaryLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ct { max-width: 900px; }

.crumb { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-bottom: 12px; }
.crumb a { color: var(--color-fog); text-decoration: none; }
.crumb a:hover { color: var(--color-ink); }
.crumb__sep { opacity: 0.5; }

.ct__title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; margin-bottom: 32px; }
.ct__title-wrap { max-width: 620px; }
.ct__title { font-family: var(--font-display); font-weight: 700; font-size: 36px; color: var(--color-ink); letter-spacing: -0.03em; line-height: 105%; margin: 0 0 6px; }
.ct__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); line-height: 150%; margin: 0; }
.ct__status { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 4px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
.ct__status-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.ct__status--draft { background: var(--color-surface); color: var(--color-fog); }
.ct__status--published { background: color-mix(in srgb, var(--color-feature-mint) 12%, transparent); color: var(--color-feature-mint); }
.ct__status--entries_closed { background: color-mix(in srgb, var(--color-feature-violet) 12%, transparent); color: var(--color-feature-violet); }
.ct__status--in_progress { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent-strong); }
.ct__status--complete { background: var(--color-surface); color: var(--color-fog); }
.ct__status--cancelled { background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); color: var(--color-feature-tangerine); }

.ct__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ghost-link { padding: 10px 16px; background: transparent; border: 0; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; white-space: nowrap; }
.ghost-link:hover { color: var(--color-ink); }
.btn-secondary { padding: 10px 18px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); cursor: pointer; white-space: nowrap; }
.btn-primary { padding: 10px 18px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn-primary:disabled, .btn-secondary:disabled, .ghost-link:disabled { opacity: 0.5; cursor: not-allowed; }

.ct__body { display: flex; flex-direction: column; gap: 24px; }

.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 28px 32px; display: flex; flex-direction: column; gap: 24px; }
.card__head { display: flex; align-items: flex-start; gap: 16px; }
.card__head-body { display: flex; flex-direction: column; gap: 4px; }
.card__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 600; }
.card__title { font-family: var(--font-display); font-weight: 700; font-size: 22px; color: var(--color-ink); letter-spacing: -0.02em; margin: 0; }
.card__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); line-height: 150%; margin: 0; }

.badge { width: 32px; height: 32px; border-radius: 8px; background: var(--color-surface); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--color-fog); flex-shrink: 0; }
.badge--accent { background: color-mix(in srgb, var(--color-accent) 14%, transparent); color: var(--color-accent-strong); }
.eyebrow--accent { color: var(--color-accent); }
.badge--mint { background: color-mix(in srgb, var(--color-feature-mint) 12%, transparent); color: var(--color-feature-mint); }
.eyebrow--mint { color: var(--color-feature-mint); }
.badge--violet { background: color-mix(in srgb, var(--color-feature-violet) 12%, transparent); color: var(--color-feature-violet); }
.eyebrow--violet { color: var(--color-feature-violet); }
.badge--tangerine { background: color-mix(in srgb, var(--color-feature-tangerine) 12%, transparent); color: var(--color-feature-tangerine); }
.eyebrow--tangerine { color: var(--color-feature-tangerine); }

.field { display: flex; flex-direction: column; gap: 6px; }
.field-row { display: flex; gap: 12px; }
.field-row .field { flex: 1; }
.field--wide { flex: 1.6; }
.field-inner { display: flex; gap: 8px; }
.field__label { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-graphite); }
.field__opt { color: var(--color-mute); font-weight: 400; }
.field__error { font-family: var(--font-body); font-size: 11px; color: var(--color-danger); }
.field__count { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); letter-spacing: 0.08em; text-align: right; margin-top: -2px; }

.input { padding: 12px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); font-weight: 500; outline: 0; width: 100%; box-sizing: border-box; }
.input:focus { border-color: var(--color-ink); }
.input--textarea { resize: vertical; min-height: 88px; line-height: 150%; }
.input--time { max-width: 120px; }
.input--error { border-color: var(--color-danger); }
.input:disabled { background: var(--color-surface); color: var(--color-mute); }

.input-money { display: flex; align-items: center; gap: 6px; padding-left: 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.input-money .input { border: 0; padding-left: 4px; }
.input-money__prefix { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); font-weight: 500; }

.divider { height: 1px; background: var(--color-hairline); }

/* Cover & gallery */
.hidden { display: none; }
.card__head .upload-count { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--color-surface); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; color: var(--color-feature-mint); font-weight: 600; letter-spacing: 0.12em; }
.upload-count__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-feature-mint); }

.field__label-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.field__hint-mono { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); letter-spacing: 0.1em; }

.btn-pill { padding: 6px 12px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-ink); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.btn-pill:disabled { opacity: 0.5; cursor: not-allowed; }

.cover-slot { position: relative; width: 100%; height: 260px; border-radius: 12px; overflow: hidden; background-color: var(--color-surface); background-size: cover; background-position: center; display: flex; align-items: flex-end; padding: 20px; box-sizing: border-box; border: 0; cursor: pointer; }
.cover-slot--empty { flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--color-mute); background: var(--color-surface); color: var(--color-fog); }
.cover-slot--empty:disabled { opacity: 0.7; cursor: wait; }
.cover-slot__icon { width: 40px; height: 40px; border-radius: 999px; background: #fff; border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; color: var(--color-ink); }
.cover-slot__title { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.cover-slot__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.cover-slot--filled { background-color: var(--color-ink); }

.cover-badge { position: absolute; top: 16px; left: 16px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; background: rgba(10,10,11,0.72); border-radius: 999px; font-family: var(--font-mono); font-size: 10px; color: #fff; font-weight: 600; letter-spacing: 0.12em; }
.cover-actions { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }
.cover-icon { width: 32px; height: 32px; border-radius: 999px; background: rgba(255,255,255,0.9); border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--color-ink); }
.cover-icon:disabled { opacity: 0.5; cursor: wait; }

.gallery-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.gallery-tile { position: relative; width: 145px; height: 110px; border-radius: 10px; overflow: hidden; background-color: var(--color-surface); background-size: cover; background-position: center; flex-shrink: 0; }
.gallery-tile__num { position: absolute; top: 6px; left: 6px; padding: 3px 6px; background: rgba(10,10,11,0.72); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; color: #fff; letter-spacing: 0.1em; font-weight: 600; }
.gallery-tile__actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
.gallery-icon { width: 22px; height: 22px; border-radius: 999px; background: rgba(10,10,11,0.72); border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; padding: 0; }
.gallery-icon:disabled { opacity: 0.4; cursor: not-allowed; }

.gallery-add { width: 145px; height: 110px; border-radius: 10px; background: var(--color-surface); border: 1px dashed var(--color-mute); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; cursor: pointer; flex-shrink: 0; color: var(--color-ink); }
.gallery-add:disabled { opacity: 0.5; cursor: wait; }
.gallery-add__plus { width: 32px; height: 32px; border-radius: 999px; background: #fff; border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; }
.gallery-add__label { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); font-weight: 500; }

.gallery-hint { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; font-family: var(--font-body); font-size: 11px; color: var(--color-fog); line-height: 150%; margin-top: 8px; }


.hint { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: color-mix(in srgb, var(--color-accent) 6%, transparent); color: var(--color-accent-strong); border-radius: 10px; font-family: var(--font-body); font-size: 12px; line-height: 150%; }
.hint strong { font-weight: 600; }

.format-grid { display: flex; gap: 8px; }
.format-tile { flex: 1; padding: 14px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; }
.format-tile__digit { font-family: var(--font-display); font-weight: 700; font-size: 20px; color: var(--color-ink); }
.format-tile__label { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); font-weight: 500; }
.format-tile.is-on { background: var(--color-ink); border-color: var(--color-ink); }
.format-tile.is-on .format-tile__digit { color: #fff; }
.format-tile.is-on .format-tile__label { color: #fff; font-weight: 600; }

.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; background: var(--color-surface); border-radius: 10px; cursor: pointer; }
.toggle-row__text { display: flex; flex-direction: column; gap: 2px; }
.toggle-row__title { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 500; }
.toggle-row__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.toggle { appearance: none; width: 36px; height: 20px; background: var(--color-hairline); border-radius: 999px; position: relative; cursor: pointer; transition: background 0.15s; flex-shrink: 0; }
.toggle::before { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 999px; transition: transform 0.15s; }
.toggle:checked { background: var(--color-ink); }
.toggle:checked::before { transform: translateX(16px); }

.radio-grid { display: flex; gap: 8px; }
.radio-card { flex: 1; padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; text-align: left; }
.radio-card.is-on { background: var(--color-ink); border-color: var(--color-ink); color: #fff; }
.radio-card__body { display: flex; flex-direction: column; gap: 2px; }
.radio-card__title { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; }
.radio-card__sub { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.radio-card.is-on .radio-card__title { color: #fff; }
.radio-card.is-on .radio-card__sub { color: rgba(255,255,255,0.6); }
.radio-dot { width: 20px; height: 20px; border-radius: 999px; border: 2px solid var(--color-hairline); background: #fff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.radio-dot.is-on { border-color: var(--color-ink); }
.radio-dot.is-on::after { content: ''; width: 8px; height: 8px; border-radius: 999px; background: var(--color-ink); }
.radio-card.is-on .radio-dot { border-color: #fff; background: #fff; }
.radio-card.is-on .radio-dot::after { background: var(--color-ink); }

.pay-list { display: flex; flex-direction: column; gap: 6px; }
.pay-row { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; text-align: left; }
.pay-row.is-on { border-color: var(--color-ink); }
.pay-row__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.pay-row__title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pay-row__title { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; }
.pay-row__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.pay-row__badge { padding: 2px 6px; background: color-mix(in srgb, var(--color-feature-mint) 14%, transparent); color: var(--color-feature-mint); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; font-weight: 600; }
.pay-row__badge--soon { background: var(--color-surface); color: var(--color-fog); }
.pay-row--disabled { cursor: not-allowed; opacity: 0.6; }
.pay-row__cards { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.chip-mono { padding: 4px 8px; background: var(--color-surface); border-radius: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; color: var(--color-ink); }

.footer-actions { display: flex; align-items: center; justify-content: space-between; padding: 20px 0 32px; }
.footer-actions__cta { display: flex; gap: 8px; }
</style>
