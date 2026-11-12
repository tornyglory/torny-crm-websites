<script setup lang="ts">
/**
 * Settings → Email signatures. Two cards:
 * 01 · Personal signature (per-admin — stored against users.email_signature_html
 *      once brief 103 ships; localStorage-backed until then via useEmailSignatures).
 * 02 · Club footer (shared — owner/admin only to edit).
 *
 * Preview strip under each editor shows how the sig will read in context
 * (a sample sign-off above, the saved sig below) so the admin isn't
 * guessing at render.
 */
import { ref, watch } from 'vue'
import { RichTextEditor } from '@torny/content-blocks'
import { useEmailSignatures } from '@/composables/useEmailSignatures'
import { useToast } from '@/composables/useToast'

const signatures = useEmailSignatures()
const toast = useToast()

const personalDraft = ref(signatures.personal.value)
const clubDraft = ref(signatures.club.value)

watch(() => signatures.personal.value, (v) => { personalDraft.value = v })
watch(() => signatures.club.value, (v) => { clubDraft.value = v })

const personalDirty = ref(false)
const clubDirty = ref(false)
watch(personalDraft, (v) => { personalDirty.value = v !== signatures.personal.value })
watch(clubDraft, (v) => { clubDirty.value = v !== signatures.club.value })

function savePersonal() {
  signatures.savePersonal(personalDraft.value)
  personalDirty.value = false
  toast.success('Personal signature saved.')
}
function clearPersonal() {
  personalDraft.value = ''
}
function saveClub() {
  if (!signatures.isOwnerOrAdmin.value) return
  signatures.saveClub(clubDraft.value)
  clubDirty.value = false
  toast.success('Club footer saved.')
}
function clearClub() {
  if (!signatures.isOwnerOrAdmin.value) return
  clubDraft.value = ''
}
</script>

<template>
  <div class="esig">
    <!-- 01 · Personal signature ─────────────────────────────── -->
    <section class="esig-card">
      <header class="esig-card__head">
        <div class="esig-card__title">
          <span class="esig-card__no">01</span>
          <h2>Personal signature</h2>
        </div>
        <span class="esig-badge esig-badge--ok">
          <span class="esig-badge__dot" />
          <span v-if="signatures.personal.value && !personalDirty">Saved</span>
          <span v-else-if="personalDirty">Unsaved</span>
          <span v-else>Not set</span>
        </span>
      </header>
      <p class="esig-card__sub">Appears under every email you send through Torny — just yours, not shared with the rest of the committee.</p>

      <div class="esig-editor">
        <RichTextEditor
          v-model="personalDraft"
          size="sm"
          hide-image
          placeholder="Your name · role · phone"
        />
      </div>

      <div class="esig-preview" v-if="personalDraft">
        <div class="esig-preview__eyebrow">In context</div>
        <p class="esig-preview__quote">…thanks again for the roll-up on Saturday, let me know if you can make the committee catch-up Thursday.</p>
        <div class="esig-preview__divider" />
        <div class="esig-preview__body" v-html="personalDraft" />
      </div>

      <footer class="esig-card__foot">
        <span class="esig-card__meta">Saved locally in this session · syncs to Torny when brief 103 ships</span>
        <div class="esig-card__actions">
          <button
            type="button"
            class="esig-btn esig-btn--ghost"
            :disabled="!personalDraft"
            @click="clearPersonal"
          >Clear</button>
          <button
            type="button"
            class="esig-btn esig-btn--primary"
            :disabled="!personalDirty"
            @click="savePersonal"
          >Save signature</button>
        </div>
      </footer>
    </section>

    <!-- 02 · Club footer ─────────────────────────────────────── -->
    <section class="esig-card">
      <header class="esig-card__head">
        <div class="esig-card__title">
          <span class="esig-card__no">02</span>
          <h2>Club footer</h2>
        </div>
        <span class="esig-badge" :class="signatures.isOwnerOrAdmin.value ? 'esig-badge--warn' : 'esig-badge--muted'">
          <span class="esig-badge__dot" />
          <span>{{ signatures.isOwnerOrAdmin.value ? 'Owner / admin only' : 'View only' }}</span>
        </span>
      </header>
      <p class="esig-card__sub">Runs under every member's personal signature. Club address, contact, and the one-line unsubscribe note — the same for everyone who sends from this club.</p>

      <div class="esig-editor" :class="{ 'is-readonly': !signatures.isOwnerOrAdmin.value }">
        <RichTextEditor
          v-if="signatures.isOwnerOrAdmin.value"
          v-model="clubDraft"
          size="sm"
          hide-image
          placeholder="Club name · address · unsubscribe copy"
        />
        <div v-else class="esig-readonly" v-html="clubDraft || '<em>No club footer saved.</em>'" />
      </div>

      <div class="esig-preview" v-if="clubDraft">
        <div class="esig-preview__eyebrow">In context</div>
        <p class="esig-preview__quote">…Nev Rodda · Secretary · 021 426 168</p>
        <div class="esig-preview__divider" />
        <div class="esig-preview__body esig-preview__body--muted" v-html="clubDraft" />
      </div>

      <footer v-if="signatures.isOwnerOrAdmin.value" class="esig-card__foot">
        <span class="esig-card__meta">Saved locally in this session · syncs to Torny when brief 103 ships</span>
        <div class="esig-card__actions">
          <button
            type="button"
            class="esig-btn esig-btn--ghost"
            :disabled="!clubDraft"
            @click="clearClub"
          >Clear</button>
          <button
            type="button"
            class="esig-btn esig-btn--primary"
            :disabled="!clubDirty"
            @click="saveClub"
          >Save footer</button>
        </div>
      </footer>
    </section>
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

.esig-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  overflow: hidden;
}

.esig-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 8px;
}
.esig-card__title { display: inline-flex; align-items: baseline; gap: 10px; }
.esig-card__no {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-mute);
}
.esig-card__title h2 {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 0;
}
.esig-card__sub {
  margin: 0 24px 16px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.55;
}

/* Badges on the top-right of each card. */
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

/* Editor wrapper — rounded 10px, hairline border, hairline-tinted toolbar. */
.esig-editor {
  margin: 0 24px 20px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  overflow: hidden;
}
.esig-editor.is-readonly { background: var(--color-surface); }
.esig-readonly {
  padding: 14px 16px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-fog);
}
.esig-readonly :deep(p) { margin: 0 0 4px; }

/* Preview strip under each editor. */
.esig-preview {
  margin: 0 24px 16px;
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
.esig-preview__body--muted { font-size: 12px; color: var(--color-fog); }

/* Card footer with save/clear actions. */
.esig-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid var(--color-hairline);
  background: #FAFAF7;
}
.esig-card__meta {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.esig-card__actions { display: inline-flex; align-items: center; gap: 10px; }

.esig-btn {
  padding: 8px 16px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 0;
  transition: background 120ms ease, color 120ms ease;
}
.esig-btn--ghost {
  background: transparent;
  color: var(--color-fog);
}
.esig-btn--ghost:hover:not(:disabled) { color: var(--color-ink); text-decoration: underline; }
.esig-btn--ghost:disabled { opacity: 0.4; cursor: not-allowed; }
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
