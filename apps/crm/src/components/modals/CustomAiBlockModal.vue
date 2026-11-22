<script setup lang="ts">
/**
 * CustomAiBlockModal — editor for the `customAi` block type.
 *
 * Tabs:
 *  · Prompt   — natural-language input + "Generate" button that calls
 *               the Gemini proxy (packages/api-client → ai.generateBlock).
 *               Returned HTML/CSS/JS populate the other tabs.
 *  · HTML     — plain textarea; CodeMirror can slot in later.
 *  · CSS      — same.
 *  · JS       — hidden behind the `allowJs` toggle; empty string clears.
 *  · Preview  — mounts a real CustomAiBlock so the admin can see the
 *               result before saving. Same scoping rules apply.
 *
 * Save is explicit — the modal keeps a draft and only mutates the
 * caller's props via emit('save') when the admin clicks Save.
 */
import { computed, ref, watch } from 'vue'
import { ApiError, ai, type AiNearbyBlock, type GenerateBlockErrorCode, type GenerateBlockRateLimit } from '@torny/api-client'
import { CustomAiBlock, type CustomAiProps, type CustomAiPromptEntry } from '@torny/content-blocks'
import CrmModal from '@/components/modals/CrmModal.vue'
import CrmSpinner from '@/components/CrmSpinner.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  /** The block id we're editing — becomes the CSS scope key. */
  blockId: string
  /** The club this generation is scoped to. Brief 113 §5.5 — rate limit
   *  is per-user not per-club, but the endpoint is keyed on club id for
   *  auth so we pass the current club. */
  clubId: number | null
  /** Current props of the block being edited. */
  value: CustomAiProps
  /** Brand context + nearby block summaries, forwarded to Gemini. */
  brand?: {
    club_name?: string | null
    accent_color?: string | null
    ink_color?: string | null
    surface_color?: string | null
    heading_font?: string | null
    body_font?: string | null
  }
  nearbyBlocks?: AiNearbyBlock[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', next: CustomAiProps): void
}>()

const toast = useToast()

type Tab = 'prompt' | 'html' | 'css' | 'js' | 'preview'
const activeTab = ref<Tab>('prompt')
const TAB_LABELS: Record<Tab, string> = {
  prompt: 'Prompt',
  html: 'HTML',
  css: 'CSS',
  js: 'JS',
  preview: 'Preview',
}
function tabLabel(t: Tab): string { return TAB_LABELS[t] }

// ── Per-field length caps ───────────────────────────────────
// Backend treats block props as opaque JSON (brief 113 §3) and
// backstops the overall page at 500 KB. We enforce per-field limits
// in the modal so an admin pasting a huge blob sees a clear counter
// turn red before they hit Save, instead of a mangled save at 51
// blocks. Numbers match the caps originally proposed in brief 113 §2.
const LIMITS = { html: 50_000, css: 20_000, js: 5_000 } as const
const htmlLen = computed(() => (draft.value.html ?? '').length)
const cssLen = computed(() => (draft.value.css ?? '').length)
const jsLen = computed(() => (draft.value.js ?? '').length)
const htmlOver = computed(() => htmlLen.value > LIMITS.html)
const cssOver = computed(() => cssLen.value > LIMITS.css)
const jsOver = computed(() => jsLen.value > LIMITS.js)
const anyOver = computed(() => htmlOver.value || cssOver.value || jsOver.value)

/** Space-separated label listing which fields are over, for the
 *  save-footer warning. */
const overFieldsLabel = computed(() => {
  const bits: string[] = []
  if (htmlOver.value) bits.push('HTML')
  if (cssOver.value) bits.push('CSS')
  if (jsOver.value) bits.push('JS')
  return bits.join(' · ')
})

// ── Draft ────────────────────────────────────────────────────
const draft = ref<CustomAiProps>({ ...props.value })
const prompt = ref('')
const generating = ref(false)
const lastError = ref<string | null>(null)

/** When the modal opens, seed the draft from the current props and
 *  default the active tab: new empty blocks start on Prompt, filled
 *  blocks start on Preview so the admin lands on "here's what you
 *  already have". */
watch(() => props.open, (open) => {
  if (!open) return
  draft.value = { ...props.value }
  prompt.value = ''
  lastError.value = null
  activeTab.value = draft.value.html?.trim() ? 'preview' : 'prompt'
})

const dirty = computed(() => {
  return draft.value.html !== props.value.html
    || draft.value.css !== props.value.css
    || (draft.value.js ?? '') !== (props.value.js ?? '')
    || !!draft.value.allowJs !== !!props.value.allowJs
    || (draft.value.aiNotes ?? '') !== (props.value.aiNotes ?? '')
})

function requestClose() {
  if (dirty.value && !window.confirm('Discard changes to this block?')) return
  emit('close')
}

function save() {
  emit('save', { ...draft.value })
}

// ── Generate ────────────────────────────────────────────────
async function generate() {
  const text = prompt.value.trim()
  if (!text) {
    lastError.value = 'Write what you want the block to do first.'
    return
  }
  if (props.clubId == null) {
    lastError.value = 'Pick a club first — the AI generator is scoped per club.'
    return
  }
  generating.value = true
  lastError.value = null
  try {
    const iteration = draft.value.html?.trim()
      ? {
          prev_html: draft.value.html,
          prev_css: draft.value.css,
          prev_js: draft.value.js ?? null,
        }
      : null
    const result = await ai.generateBlock(props.clubId, {
      prompt: text,
      brand: props.brand,
      nearby_blocks: props.nearbyBlocks,
      iteration,
      allow_js: !!draft.value.allowJs,
    })
    const history: CustomAiPromptEntry[] = [
      ...(draft.value.promptHistory ?? []),
      { at: new Date().toISOString(), prompt: text, model: 'gemini-2.5-flash' },
    ].slice(-10)
    draft.value = {
      ...draft.value,
      html: result.html,
      css: result.css,
      js: result.js,
      aiNotes: result.notes,
      promptHistory: history,
    }
    prompt.value = ''
    activeTab.value = 'preview'
    toast.success('Block generated.')
  } catch (err) {
    // Map brief 113 §5.3 codes to human copy. Everything else falls
    // through to the server message.
    if (err instanceof ApiError) {
      const code = err.code as GenerateBlockErrorCode | undefined
      if (code === 'rate_limited') {
        const rl = err.body as GenerateBlockRateLimit | undefined
        const used = rl?.used ?? '?'
        const limit = rl?.limit ?? 20
        lastError.value = `You've used ${used}/${limit} generations in the last hour. Try again shortly.`
      } else if (code === 'prompt_too_long') {
        lastError.value = 'That prompt is too long — keep it under 4,000 characters.'
      } else if (code === 'gemini_failed' || code === 'gemini_bad_shape' || code === 'gemini_empty') {
        lastError.value = 'The AI couldn\'t generate a block this time — try rephrasing.'
      } else if (err.status === 401) {
        lastError.value = 'Your session has expired. Refresh and sign in again.'
      } else if (err.status === 403) {
        lastError.value = "You don't have permission to use the AI generator for this club."
      } else {
        lastError.value = err.message || 'Generation failed.'
      }
    } else {
      lastError.value = 'Generation failed — check your connection and try again.'
    }
  } finally {
    generating.value = false
  }
}

// Clearing the JS field when the admin turns the toggle off — avoids
// leaving an orphan script that fires the moment they flip it back on.
function onAllowJsToggle(allow: boolean) {
  draft.value = {
    ...draft.value,
    allowJs: allow,
    js: allow ? draft.value.js : null,
  }
}
</script>

<template>
  <CrmModal
    :open="open"
    width="xl"
    eyebrow="Custom · AI block"
    title="Edit block"
    @close="requestClose"
  >
    <!-- Tabs -->
    <div class="cai__tabs" role="tablist">
      <button
        v-for="t in (['prompt','html','css','js','preview'] as Tab[])"
        :key="t"
        type="button"
        class="cai__tab"
        :class="{ 'is-active': activeTab === t }"
        :disabled="t === 'js' && !draft.allowJs"
        role="tab"
        :aria-selected="activeTab === t"
        @click="activeTab = t"
      >{{ tabLabel(t) }}</button>
    </div>

    <!-- Prompt tab -->
    <div v-if="activeTab === 'prompt'" class="cai__panel">
      <p class="cai__sub">Describe what you want the block to be. Reference colours, moods, examples. If a block is already here, this adjusts it — leave empty and start fresh any time.</p>

      <textarea
        v-model="prompt"
        class="cai__prompt"
        rows="6"
        :disabled="generating"
        placeholder="e.g. A hero section with a bowls image on the right and a 'Join the club' button on the left. Use the club's accent colour for the button."
      />

      <div class="cai__row">
        <label class="cai__toggle">
          <input
            type="checkbox"
            :checked="!!draft.allowJs"
            @change="onAllowJsToggle(($event.target as HTMLInputElement).checked)"
          />
          <span>Allow custom JavaScript</span>
          <span class="cai__toggle-hint">Off by default. Only enable if you need interactive behaviour — custom JS is the biggest site-breakage risk.</span>
        </label>
      </div>

      <div v-if="lastError" class="cai__error">{{ lastError }}</div>

      <div class="cai__actions">
        <button
          type="button"
          class="cai-btn cai-btn--generate"
          :disabled="generating || !prompt.trim()"
          @click="generate"
        >
          <CrmSpinner v-if="generating" size="sm" label="Generating" />
          <span v-else class="cai__sparkle" aria-hidden="true">✦</span>
          <span>{{ generating ? 'Generating…' : (draft.html?.trim() ? 'Regenerate with tweaks' : 'Generate with AI') }}</span>
        </button>
        <span class="cai__meta">Powered by Gemini 2.5 Flash</span>
      </div>

      <div v-if="draft.aiNotes" class="cai__notes">
        <div class="cai__notes-label">Last AI note</div>
        <p>{{ draft.aiNotes }}</p>
      </div>

      <div v-if="draft.promptHistory && draft.promptHistory.length > 0" class="cai__history">
        <div class="cai__notes-label">History</div>
        <ul>
          <li v-for="(h, i) in [...draft.promptHistory].reverse().slice(0, 5)" :key="i">
            <span class="cai__history-prompt">{{ h.prompt }}</span>
            <span class="cai__history-at">{{ new Date(h.at).toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- Code tabs -->
    <div v-else-if="activeTab === 'html'" class="cai__panel">
      <textarea v-model="draft.html" class="cai__code" rows="18" spellcheck="false" />
      <div class="cai__meta-row">
        <span class="cai__sub cai__sub--muted">Only the block's markup. No &lt;script&gt; or &lt;style&gt; tags — those are stripped at render time.</span>
        <span class="cai__counter" :class="{ 'is-over': htmlOver }">{{ htmlLen.toLocaleString() }} / {{ LIMITS.html.toLocaleString() }}</span>
      </div>
    </div>
    <div v-else-if="activeTab === 'css'" class="cai__panel">
      <textarea v-model="draft.css" class="cai__code" rows="18" spellcheck="false" />
      <div class="cai__meta-row">
        <span class="cai__sub cai__sub--muted">Plain class selectors. The renderer prefixes every rule with the block's scope attribute so styles can't leak.</span>
        <span class="cai__counter" :class="{ 'is-over': cssOver }">{{ cssLen.toLocaleString() }} / {{ LIMITS.css.toLocaleString() }}</span>
      </div>
    </div>
    <div v-else-if="activeTab === 'js'" class="cai__panel">
      <textarea
        :value="draft.js ?? ''"
        class="cai__code"
        rows="18"
        spellcheck="false"
        @input="draft.js = ($event.target as HTMLTextAreaElement).value"
      />
      <div class="cai__meta-row">
        <span class="cai__sub cai__sub--muted">Runs client-side only. The function receives `root` — the block's wrapper element — as its only argument. Return a teardown function to clean up on unmount.</span>
        <span class="cai__counter" :class="{ 'is-over': jsOver }">{{ jsLen.toLocaleString() }} / {{ LIMITS.js.toLocaleString() }}</span>
      </div>
    </div>

    <!-- Preview tab -->
    <div v-else-if="activeTab === 'preview'" class="cai__panel cai__preview-wrap">
      <div v-if="!draft.html?.trim()" class="cai__preview-empty">Nothing to preview yet — generate or paste some HTML.</div>
      <div v-else class="cai__preview">
        <CustomAiBlock
          :block-id="blockId"
          :html="draft.html"
          :css="draft.css"
          :js="draft.js"
          :allow-js="draft.allowJs"
        />
      </div>
    </div>

    <template #footer>
      <span v-if="anyOver" class="cai__footer-warn">{{ overFieldsLabel }} over the limit — trim before saving.</span>
      <button type="button" class="cai-btn cai-btn--outline" @click="requestClose">Cancel</button>
      <button
        type="button"
        class="cai-btn cai-btn--ink"
        :disabled="!dirty || anyOver"
        @click="save"
      >Save block</button>
    </template>
  </CrmModal>
</template>

<style scoped>
.cai__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-hairline);
  margin: -4px 0 16px;
}
.cai__tab {
  padding: 8px 14px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-fog);
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 120ms ease, border-color 120ms ease;
}
.cai__tab:hover:not(:disabled) { color: var(--color-ink); }
.cai__tab.is-active {
  color: var(--color-ink);
  border-bottom-color: var(--color-ink);
}
.cai__tab:disabled { opacity: 0.35; cursor: not-allowed; }

.cai__panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cai__sub {
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
  line-height: 1.55;
}
.cai__sub--muted { color: var(--color-mute); }

/* Row under each code textarea — hint on the left, char counter on
 * the right. The counter flips red when the field is over its cap. */
.cai__meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cai__counter {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-mute);
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.cai__counter.is-over {
  color: var(--color-danger, #DC2F3B);
}

.cai__footer-warn {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-danger, #DC2F3B);
  margin-right: auto;
}

.cai__prompt {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  resize: vertical;
  min-height: 140px;
}
.cai__prompt:focus { outline: 2px solid var(--color-ink); outline-offset: -2px; }

.cai__code {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  line-height: 1.55;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--color-hairline);
  background: var(--color-surface);
  resize: vertical;
  min-height: 360px;
  white-space: pre;
  overflow: auto;
}
.cai__code:focus { outline: 2px solid var(--color-ink); outline-offset: -2px; }

.cai__row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  background: var(--color-surface);
  border-radius: 10px;
}
.cai__toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 2px 10px;
  align-items: center;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
}
.cai__toggle input {
  grid-row: 1 / 3;
  width: 16px;
  height: 16px;
  margin: 0;
}
.cai__toggle-hint {
  grid-column: 2;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-fog);
  line-height: 1.5;
}

.cai__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 4px;
}
.cai__sparkle {
  font-size: 14px;
  line-height: 1;
  /* Warm highlight that stays legible on the dark pill. */
  color: #FFD47A;
}
.cai__meta {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-mute);
}

/* ── Buttons ────────────────────────────────────────────────── */
/* Local pill buttons — the global `.btn` styles live in the editor
 * view's non-scoped CSS so they don't reach through this modal's
 * `scoped` boundary. Mirrors the shared CRM button voice: pill radius,
 * ink primary, hairline outline. */
.cai-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 18px;
  min-height: 36px;
  border-radius: 999px;
  border: 0;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 160ms ease, transform 120ms ease;
}
.cai-btn:disabled { cursor: not-allowed; }

.cai-btn--ink {
  background: var(--color-ink);
  color: #fff;
}
.cai-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.cai-btn--ink:disabled {
  background: var(--color-mute);
  color: #fff;
}

.cai-btn--outline {
  background: #fff;
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
}
.cai-btn--outline:hover:not(:disabled) { border-color: var(--color-ink); }
.cai-btn--outline:disabled { opacity: 0.5; }

/* Generate pill — ink base with a subtle accent-tinted glow so it
 * reads as the AI-powered action without shouting. */
.cai-btn--generate {
  background: var(--color-ink);
  color: #fff;
  padding: 10px 20px;
  box-shadow: 0 0 0 1px rgba(255, 212, 122, 0.08) inset, 0 6px 18px -8px rgba(10, 10, 11, 0.4);
}
.cai-btn--generate:hover:not(:disabled) {
  background: var(--color-graphite);
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgba(255, 212, 122, 0.14) inset, 0 10px 24px -10px rgba(10, 10, 11, 0.5);
}
.cai-btn--generate:disabled {
  background: var(--color-mute);
  color: #fff;
  box-shadow: none;
}
.cai-btn--generate:disabled .cai__sparkle { color: rgba(255, 255, 255, 0.5); }

.cai__error {
  padding: 10px 14px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #991B1B;
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 13px;
}

.cai__notes,
.cai__history {
  padding: 14px 16px;
  background: var(--color-surface);
  border-radius: 10px;
}
.cai__notes p { margin: 6px 0 0; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); line-height: 1.55; }
.cai__notes-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.cai__history ul {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cai__history li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-ink);
}
.cai__history-at { color: var(--color-fog); white-space: nowrap; font-size: 11px; }
.cai__history-prompt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 440px;
}

.cai__preview-wrap { min-height: 360px; }
.cai__preview {
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  padding: 0;
  background: #fff;
  overflow: hidden;
  /* Reset inherited CRM typography so the preview matches the public
   *  site context more closely. */
  color: var(--color-ink);
}
.cai__preview-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-fog);
  font-family: var(--font-body);
  font-size: 13px;
  background: var(--color-surface);
  border-radius: 10px;
}
</style>
