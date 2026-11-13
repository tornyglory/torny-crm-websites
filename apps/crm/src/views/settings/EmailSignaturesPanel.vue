<script setup lang="ts">
/**
 * Settings → Email signatures. Two preview tiles — click either to open
 * its editor in a modal:
 *   02 · Personal signature (per-admin — stored against users.email_signature_html
 *        once brief 103 ships; localStorage-backed until then).
 *   03 · Club footer (shared — owner/admin only to edit).
 *
 * The personal-signature modal supports image upload: picking a file reads
 * it as a data URL and inserts an <img> at the cursor. Until brief 103
 * ships the data URL rides along in localStorage; once the media endpoint
 * lands the upload swaps to a hosted URL without changing the UI.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RichTextEditor } from '@torny/content-blocks'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useEmailSignatures } from '@/composables/useEmailSignatures'
import { useToast } from '@/composables/useToast'

type RteHandle = { insertText: (html: string) => boolean; focus: () => void }

const signatures = useEmailSignatures()
const toast = useToast()

// ── Personal signature ────────────────────────────────────────
const personalOpen = ref(false)
const personalDraft = ref(signatures.personal.value)
const personalDirty = computed(() => personalDraft.value !== signatures.personal.value)
const personalRte = ref<RteHandle | null>(null)
const personalFileInput = ref<HTMLInputElement | null>(null)

function openPersonal() {
  personalDraft.value = signatures.personal.value
  personalOpen.value = true
  void nextTick(() => personalRte.value?.focus())
}
function closePersonal() {
  if (personalDirty.value && !window.confirm('Discard changes to your signature?')) return
  personalOpen.value = false
}
function savePersonal() {
  signatures.savePersonal(personalDraft.value)
  personalOpen.value = false
  toast.success('Personal signature saved.')
}
function clearPersonal() {
  personalDraft.value = ''
}
function pickSignatureImage() {
  personalFileInput.value?.click()
}
function onSignatureImagePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    window.alert('Pick an image file (PNG, JPG, SVG).')
    return
  }
  if (file.size > 500 * 1024) {
    window.alert('Signature images need to be under 500 KB so inbox previews stay snappy.')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const src = String(reader.result ?? '')
    if (!src) return
    personalRte.value?.insertText(`<img src="${src}" alt="" style="max-width:160px;height:auto;border-radius:6px;" />`)
  }
  reader.readAsDataURL(file)
}

// ── Club footer ───────────────────────────────────────────────
const clubOpen = ref(false)
const clubDraft = ref(signatures.club.value)
const clubDirty = computed(() => clubDraft.value !== signatures.club.value)
const clubRte = ref<RteHandle | null>(null)

function openClub() {
  if (!signatures.isOwnerOrAdmin.value) return
  clubDraft.value = signatures.club.value
  clubOpen.value = true
  void nextTick(() => clubRte.value?.focus())
}
function closeClub() {
  if (clubDirty.value && !window.confirm('Discard changes to the club footer?')) return
  clubOpen.value = false
}
function saveClub() {
  if (!signatures.isOwnerOrAdmin.value) return
  signatures.saveClub(clubDraft.value)
  clubOpen.value = false
  toast.success('Club footer saved.')
}
function clearClub() {
  clubDraft.value = ''
}

// Sync drafts when the composable reloads for a different user/club.
watch(() => signatures.personal.value, (v) => { if (!personalOpen.value) personalDraft.value = v })
watch(() => signatures.club.value, (v) => { if (!clubOpen.value) clubDraft.value = v })

// ── Preview helpers ──────────────────────────────────────────
// The tile shows the saved HTML at a glance. Empty state sits behind
// a `.is-empty` class so we can style the tile's whole surface.
const personalSet = computed(() => signatures.personal.value.trim().length > 0)
const clubSet = computed(() => signatures.club.value.trim().length > 0)
</script>

<template>
  <div class="esig">
    <!-- 02 · Personal signature tile ─────────────────────────── -->
    <button
      type="button"
      class="esig-tile"
      :class="{ 'is-empty': !personalSet }"
      @click="openPersonal"
    >
      <header class="esig-tile__head">
        <div class="esig-tile__title">
          <span class="esig-tile__no">02</span>
          <h2>Personal signature</h2>
        </div>
        <span class="esig-badge" :class="personalSet ? 'esig-badge--ok' : 'esig-badge--muted'">
          <span class="esig-badge__dot" />
          <span>{{ personalSet ? 'Saved' : 'Not set' }}</span>
        </span>
      </header>
      <p class="esig-tile__sub">Appears under every email you send through Torny — just yours, not shared with the rest of the committee.</p>

      <div v-if="personalSet" class="esig-tile__preview" v-html="signatures.personal.value" />
      <div v-else class="esig-tile__empty">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 20h4L18 10l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          <path d="M14 6l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
        <span>Click to add your name, role, phone — and an image if you want one.</span>
      </div>

      <footer class="esig-tile__foot">
        <span class="esig-tile__cta">
          {{ personalSet ? 'Edit signature' : 'Add signature' }}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </footer>
    </button>

    <!-- 03 · Club footer tile ────────────────────────────────── -->
    <button
      type="button"
      class="esig-tile"
      :class="{ 'is-empty': !clubSet, 'is-locked': !signatures.isOwnerOrAdmin.value }"
      :disabled="!signatures.isOwnerOrAdmin.value && !clubSet"
      @click="openClub"
    >
      <header class="esig-tile__head">
        <div class="esig-tile__title">
          <span class="esig-tile__no">03</span>
          <h2>Club footer</h2>
        </div>
        <span class="esig-badge" :class="signatures.isOwnerOrAdmin.value ? (clubSet ? 'esig-badge--ok' : 'esig-badge--warn') : 'esig-badge--muted'">
          <span class="esig-badge__dot" />
          <span v-if="!signatures.isOwnerOrAdmin.value">View only</span>
          <span v-else-if="clubSet">Saved</span>
          <span v-else>Owner / admin only</span>
        </span>
      </header>
      <p class="esig-tile__sub">Runs under every member's personal signature. Club address, contact, and the one-line unsubscribe note — the same for everyone who sends from this club.</p>

      <div v-if="clubSet" class="esig-tile__preview esig-tile__preview--muted" v-html="signatures.club.value" />
      <div v-else class="esig-tile__empty">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
          <path d="M4 10h16" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <span v-if="signatures.isOwnerOrAdmin.value">Click to add your club address, contact details, and unsubscribe copy.</span>
        <span v-else>Your club owner or admin hasn't set a footer yet.</span>
      </div>

      <footer v-if="signatures.isOwnerOrAdmin.value" class="esig-tile__foot">
        <span class="esig-tile__cta">
          {{ clubSet ? 'Edit footer' : 'Add footer' }}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </footer>
    </button>

    <!-- Personal signature modal ─────────────────────────────── -->
    <CrmModal
      :open="personalOpen"
      eyebrow="Email · 02"
      title="Personal signature"
      width="lg"
      @close="closePersonal"
    >
      <p class="esig-modal__sub">Appears under every email you send through Torny — just yours, not shared with the rest of the committee.</p>

      <div class="esig-modal__toolbar">
        <button type="button" class="esig-btn esig-btn--ghost esig-btn--icon" @click="pickSignatureImage">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4" />
            <circle cx="6" cy="6.5" r="1.3" stroke="currentColor" stroke-width="1.4" />
            <path d="M2 12l3.5-3 2 2 3-3 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Upload image
        </button>
        <span class="esig-modal__toolbar-hint">PNG, JPG, or SVG under 500 KB. Lands at your cursor.</span>
        <input
          ref="personalFileInput"
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/gif,image/webp"
          class="esig-modal__file"
          @change="onSignatureImagePicked"
        />
      </div>

      <div class="esig-editor">
        <RichTextEditor
          ref="personalRte"
          v-model="personalDraft"
          size="sm"
          placeholder="Your name · role · phone"
        />
      </div>

      <div v-if="personalDraft" class="esig-preview">
        <div class="esig-preview__eyebrow">In context</div>
        <p class="esig-preview__quote">…thanks again for the roll-up on Saturday, let me know if you can make the committee catch-up Thursday.</p>
        <div class="esig-preview__divider" />
        <div class="esig-preview__body" v-html="personalDraft" />
      </div>

      <template #footer>
        <button type="button" class="esig-btn esig-btn--ghost" :disabled="!personalDraft" @click="clearPersonal">Clear</button>
        <button type="button" class="esig-btn esig-btn--outline" @click="closePersonal">Cancel</button>
        <button type="button" class="esig-btn esig-btn--primary" :disabled="!personalDirty" @click="savePersonal">Save signature</button>
      </template>
    </CrmModal>

    <!-- Club footer modal ────────────────────────────────────── -->
    <CrmModal
      :open="clubOpen"
      eyebrow="Email · 03"
      title="Club footer"
      width="lg"
      @close="closeClub"
    >
      <p class="esig-modal__sub">Runs under every member's personal signature. Club address, contact, and the one-line unsubscribe note — the same for everyone who sends from this club.</p>

      <div class="esig-editor">
        <RichTextEditor
          ref="clubRte"
          v-model="clubDraft"
          size="sm"
          hide-image
          placeholder="Club name · address · unsubscribe copy"
        />
      </div>

      <div v-if="clubDraft" class="esig-preview">
        <div class="esig-preview__eyebrow">In context</div>
        <p class="esig-preview__quote">…Nev Rodda · Secretary · 021 426 168</p>
        <div class="esig-preview__divider" />
        <div class="esig-preview__body esig-preview__body--muted" v-html="clubDraft" />
      </div>

      <template #footer>
        <button type="button" class="esig-btn esig-btn--ghost" :disabled="!clubDraft" @click="clearClub">Clear</button>
        <button type="button" class="esig-btn esig-btn--outline" @click="closeClub">Cancel</button>
        <button type="button" class="esig-btn esig-btn--primary" :disabled="!clubDirty" @click="saveClub">Save footer</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.esig {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  min-width: 0;
}
@media (max-width: 1100px) {
  .esig { grid-template-columns: 1fr; }
}

/* ── Preview tiles ─────────────────────────────────────────── */
.esig-tile {
  all: unset;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  padding: 22px 24px 16px;
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.esig-tile:hover:not(:disabled),
.esig-tile:focus-visible {
  border-color: var(--color-ink);
  box-shadow: 0 8px 24px -16px rgba(15, 23, 42, 0.18);
}
.esig-tile:active:not(:disabled) { transform: translateY(1px); }
.esig-tile:disabled { cursor: default; opacity: 0.85; }

.esig-tile__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.esig-tile__title { display: inline-flex; align-items: baseline; gap: 10px; }
.esig-tile__no {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-mute);
}
.esig-tile__title h2 {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 0;
}
.esig-tile__sub {
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.55;
}

/* Preview surface shows the live-saved HTML. Capped height so an
 * oversized signature can't blow the tile out. */
.esig-tile__preview {
  background: #FAFAF7;
  border-radius: 10px;
  padding: 14px 16px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-graphite);
  max-height: 160px;
  overflow: hidden;
  position: relative;
}
.esig-tile__preview::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 36px;
  background: linear-gradient(to bottom, transparent, #FAFAF7);
  pointer-events: none;
}
.esig-tile__preview :deep(p) { margin: 0 0 4px; }
.esig-tile__preview :deep(p:last-child) { margin-bottom: 0; }
.esig-tile__preview :deep(a) { color: var(--color-accent, #2563eb); text-decoration: underline; }
.esig-tile__preview :deep(img) { max-width: 160px; height: auto; border-radius: 6px; }
.esig-tile__preview--muted { color: var(--color-fog); font-size: 12px; }

.esig-tile__empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: #FAFAF7;
  border-radius: 10px;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
}
.esig-tile__empty svg { flex-shrink: 0; color: var(--color-mute); }

.esig-tile__foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}
.esig-tile__cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
}

/* ── Badges ────────────────────────────────────────────────── */
.esig-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.esig-badge__dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
}
.esig-badge--ok { background: #DCFCE7; color: #166534; }
.esig-badge--warn { background: #FFF1E7; color: #C2410C; }
.esig-badge--muted { background: var(--color-surface); color: var(--color-fog); }

/* ── Modal ─────────────────────────────────────────────────── */
.esig-modal__sub {
  margin: 0 0 16px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.55;
}

.esig-modal__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  margin-bottom: 12px;
}
.esig-modal__toolbar-hint {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.esig-modal__file { display: none; }

.esig-editor {
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  overflow: hidden;
}

/* Preview strip inside the modal. */
.esig-preview {
  margin-top: 16px;
  padding: 14px 16px;
  background: #FAFAF7;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.esig-preview__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.esig-preview__quote {
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-mute);
  font-style: italic;
}
.esig-preview__divider { height: 1px; background: var(--color-hairline); }
.esig-preview__body {
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-graphite);
}
.esig-preview__body :deep(p) { margin: 0 0 4px; }
.esig-preview__body :deep(p:last-child) { margin-bottom: 0; }
.esig-preview__body :deep(a) { color: var(--color-accent, #2563eb); text-decoration: underline; }
.esig-preview__body :deep(img) { max-width: 160px; height: auto; border-radius: 6px; }
.esig-preview__body--muted { font-size: 12px; color: var(--color-fog); }

/* ── Buttons (shared with the modal footer) ────────────────── */
.esig-btn {
  padding: 8px 16px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.esig-btn--icon {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.esig-btn--ghost {
  background: transparent;
  color: var(--color-fog);
}
.esig-btn--ghost:hover:not(:disabled) { color: var(--color-ink); }
.esig-btn--ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.esig-btn--outline {
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
}
.esig-btn--outline:hover { border-color: var(--color-ink); }
.esig-btn--primary {
  background: var(--color-ink);
  color: #fff;
}
.esig-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.esig-btn--primary:disabled {
  background: var(--color-mute);
  color: #fff;
  cursor: not-allowed;
}
</style>
