<script setup lang="ts">
/**
 * LogNoteModal — admin-only timestamped note on a member.
 *
 * Backend reality: `members.notes` is a single free-text field, not an
 * activity log. Each saved entry appends to that string with a date +
 * type prefix so the Notes tab can show a readable history. Once the
 * Communications brief lands with a real activity log, swap the save
 * path and keep the UI.
 */
import { nextTick, reactive, ref, watch } from 'vue'
import { members as membersApi, ApiError, type RosterMember } from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  clubId: number | null
  member: RosterMember | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const toast = useToast()

type NoteType = 'call' | 'meeting' | 'visit' | 'text' | 'general'
const TYPES: { value: NoteType; label: string }[] = [
  { value: 'call',    label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'visit',   label: 'Visit' },
  { value: 'text',    label: 'Text / WhatsApp' },
  { value: 'general', label: 'General' },
]

const state = reactive({ type: 'call' as NoteType, body: '' })
const saving = ref(false)
const textareaEl = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      state.type = 'call'
      state.body = ''
      saving.value = false
      void nextTick(() => textareaEl.value?.focus())
    }
  },
)

const TODAY_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const todayLabel = TODAY_FMT.format(new Date())

function typeLabel(value: NoteType): string {
  return TYPES.find((t) => t.value === value)?.label ?? 'General'
}

function formatEntry(): string {
  const body = state.body.trim()
  if (!body) return ''
  return `${todayLabel} · ${typeLabel(state.type)} · ${body}`
}

async function save() {
  if (saving.value) return
  const member = props.member
  const cid = props.clubId
  if (!member || cid == null) return
  const entry = formatEntry()
  if (!entry) {
    toast.info('Add a note before saving.')
    return
  }
  const prior = (member.notes ?? '').trim()
  const next = prior ? `${prior}\n\n${entry}` : entry
  saving.value = true
  try {
    await membersApi.patchMember(cid, member.user_id, { notes: next })
    toast.success('Note saved.')
    emit('saved')
    emit('close')
  } catch (err) {
    const msg = err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Could not save the note.'
    toast.error(msg)
  } finally {
    saving.value = false
  }
}

function onCmdEnter(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void save()
  }
}
</script>

<template>
  <CrmModal
    :open="open"
    :eyebrow="member ? `About · ${member.name}` : 'About member'"
    title="Log note"
    width="md"
    @close="emit('close')"
  >
    <section class="log-note__field">
      <div class="log-note__label">Type</div>
      <div class="log-note__chips">
        <button
          v-for="t in TYPES"
          :key="t.value"
          type="button"
          class="log-note__chip"
          :class="{ 'log-note__chip--active': state.type === t.value }"
          @click="state.type = t.value"
        >
          {{ t.label }}
        </button>
      </div>
    </section>

    <section class="log-note__field">
      <div class="log-note__label-row">
        <div class="log-note__label">Note</div>
        <div class="log-note__hint">Markdown supported</div>
      </div>
      <textarea
        ref="textareaEl"
        v-model="state.body"
        class="log-note__textarea"
        rows="5"
        maxlength="2000"
        :disabled="saving"
        placeholder="What did you talk about? Any follow-ups?"
        @keydown="onCmdEnter"
      />
    </section>

    <section class="log-note__field log-note__field--inline">
      <div>
        <div class="log-note__label">Date</div>
        <div class="log-note__date">Today · {{ todayLabel }}</div>
      </div>
      <div>
        <div class="log-note__label">Visibility</div>
        <div class="log-note__visibility">Internal only</div>
      </div>
    </section>

    <template #footer>
      <div class="log-note__foot-hint">
        <kbd>⌘</kbd><kbd>↵</kbd> to save
      </div>
      <button
        type="button"
        class="pill-btn pill-btn--ghost"
        :disabled="saving"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="pill-btn pill-btn--ink"
        :disabled="saving || state.body.trim().length === 0"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save note' }}
      </button>
    </template>
  </CrmModal>
</template>

<style scoped>
.log-note__field { display: flex; flex-direction: column; gap: 10px; }
.log-note__field + .log-note__field { margin-top: 20px; }
.log-note__field--inline {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}
.log-note__label-row { display: flex; justify-content: space-between; align-items: baseline; }
.log-note__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.log-note__hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-mute);
}
.log-note__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.log-note__chip {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.log-note__chip:hover { background: var(--color-surface); }
.log-note__chip--active {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}
.log-note__textarea {
  width: 100%;
  min-height: 140px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.5;
  color: var(--color-ink);
  resize: vertical;
}
.log-note__textarea:focus {
  outline: none;
  border-color: var(--color-ink);
}
.log-note__textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.log-note__date,
.log-note__visibility {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--color-hairline);
  background: var(--color-surface);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink);
}
.log-note__visibility {
  color: var(--color-fog);
  font-weight: 400;
}

.log-note__foot-hint {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.log-note__foot-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-ink);
}

.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.pill-btn:focus-visible {
  outline: 2px solid var(--color-ink);
  outline-offset: 2px;
}
.pill-btn--ghost {
  background: transparent;
  color: var(--color-ink);
}
.pill-btn--ghost:hover:not(:disabled) { background: var(--color-hairline); }
.pill-btn--ghost:disabled { color: var(--color-mute); cursor: not-allowed; }
.pill-btn--ink {
  background: var(--color-ink);
  color: #fff;
  padding: 0 22px;
}
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
/* Disabled primary stays a solid dark pill — the design never shows the
 * primary action looking washed out, so avoid blanket opacity-fading. */
.pill-btn--ink:disabled {
  background: var(--color-mute);
  color: #fff;
  cursor: not-allowed;
}
</style>
