<script setup lang="ts">
/**
 * Communications — bulk email (SES).
 *
 * Composer POSTs to /clubs/{id}/members/bulk-email. The server wraps
 * every message in the club's saved email header/footer (from the
 * email-template resource) and substitutes {{tokens}} per recipient.
 * SMS + schedule + draft are backend-side non-goals for v1 and were
 * dropped from the UI.
 *
 * Recent-sends list is session-scoped (in-memory) — no history endpoint
 * shipped alongside the SES migration. Follow-up.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ApiError,
  bulkEmail as bulkEmailApi,
  emailTemplate as emailTemplateApi,
  members as membersApi,
  type BulkEmailInput,
  type BulkEmailRecipients,
  type BulkEmailResult,
  type EmailTemplate,
  type EmailVariable,
  type RosterMember,
} from '@torny/api-client'
import CrmModal from '@/components/modals/CrmModal.vue'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'

const toast = useToast()
const clubStore = useClubStore()
const route = useRoute()
const router = useRouter()

// ── Audience presets — resolve to real filters ────────────────────

interface AudienceFilter {
  status?: 'all' | 'active' | 'pending' | 'lapsed'
  role?: 'owner' | 'admin' | 'committee' | 'player'
  search?: string
}

interface AudiencePreset {
  key: 'all' | 'active_players' | 'committee' | 'admins' | 'specific'
  label: string
  hint: string
  filter?: AudienceFilter
}

const PRESETS: AudiencePreset[] = [
  { key: 'all', label: 'All members', hint: 'Everyone with an email', filter: { status: 'active' } },
  { key: 'active_players', label: 'Active players', hint: 'Active playing members', filter: { status: 'active', role: 'player' } },
  { key: 'committee', label: 'Committee', hint: 'Elected committee only', filter: { status: 'active', role: 'committee' } },
  { key: 'admins', label: 'Admins', hint: 'CRM admins + owners', filter: { status: 'active', role: 'admin' } },
]

// ── State — page-level ────────────────────────────────────────────

const composeOpen = ref(false)
const recentSends = ref<Array<{ id: number; subject: string; matched: number; sent: number; failed: number; sent_at: string }>>([])

// ── State — composer ──────────────────────────────────────────────

type WizardStep = 'recipients' | 'compose' | 'preview'
const step = ref<WizardStep>('recipients')
const STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'compose',    label: 'Compose' },
  { key: 'preview',    label: 'Preview & send' },
]
function stepIndex(k: WizardStep): number { return STEPS.findIndex(s => s.key === k) }
const activeStepIndex = computed(() => stepIndex(step.value))
function goStep(k: WizardStep) { step.value = k }
function nextStep() {
  const i = activeStepIndex.value
  if (i < STEPS.length - 1) step.value = STEPS[i + 1]!.key
}
function prevStep() {
  const i = activeStepIndex.value
  if (i > 0) step.value = STEPS[i - 1]!.key
}

const composerPreset = ref<AudiencePreset['key']>('all')
const composerSubject = ref('')
const composerBody = ref('')
const composerSending = ref(false)
const composerCount = ref<number | null>(null)
const composerCountLoading = ref(false)

// Specific-members mode (mode=ids)
const composerMemberSearch = ref('')
const composerMemberResults = ref<RosterMember[]>([])
const composerMemberSearching = ref(false)
const composerSelectedMembers = ref<RosterMember[]>([])

const previewDevice = ref<'desktop' | 'mobile'>('desktop')

// ── Modals ────────────────────────────────────────────────────────

const confirmOpen = ref(false)
const resultOpen = ref(false)
const lastResult = ref<BulkEmailResult | null>(null)

// ── Email template — for header/footer wrap + variable palette ────

const emailTemplate = ref<EmailTemplate | null>(null)

async function loadTemplate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  try {
    emailTemplate.value = await emailTemplateApi.get(cid)
  } catch {
    // Endpoint hasn't shipped yet? Use a minimal fallback so the composer
    // still functions. Preview will show naked body until template lands.
    emailTemplate.value = {
      header_html: '',
      footer_html: '',
      accent_colour: null,
      font_family: null,
      show_logo: true,
      sample_overrides: {},
      variables: FALLBACK_VARIABLES,
      updated_at: null,
    }
  }
}

const FALLBACK_VARIABLES: EmailVariable[] = [
  { key: 'club_name', token: '{{club_name}}', label: 'Club name', category: 'club', sample: 'Naenae Bowling Club' },
  { key: 'club_email', token: '{{club_email}}', label: 'Club email', category: 'club', sample: 'hello@naenaebowls.nz' },
  { key: 'recipient_name', token: '{{recipient_name}}', label: "Recipient's name", category: 'recipient', sample: 'Frances Roydon-Miller' },
  { key: 'recipient_first_name', token: '{{recipient_first_name}}', label: "Recipient's first name", category: 'recipient', sample: 'Frances' },
  { key: 'unsubscribe_url', token: '{{unsubscribe_url}}', label: 'Unsubscribe URL', category: 'auto', sample: 'https://…/unsubscribe/…' },
  { key: 'year', token: '{{year}}', label: 'Year', category: 'auto', sample: String(new Date().getFullYear()) },
]

const variables = computed<EmailVariable[]>(() => emailTemplate.value?.variables ?? FALLBACK_VARIABLES)

type Category = 'club' | 'recipient' | 'context' | 'auto'
const variablesByCategory = computed<Record<Category, EmailVariable[]>>(() => {
  const out: Record<Category, EmailVariable[]> = { club: [], recipient: [], context: [], auto: [] }
  for (const v of variables.value) {
    if (v.flavors && !v.flavors.includes('broadcast')) continue
    out[v.category].push(v)
  }
  return out
})

const clubSampleOverrides = computed<Record<string, string>>(() => {
  const c = clubStore.current
  if (!c) return {}
  const out: Record<string, string> = {}
  if (c.name) out.club_name = c.name
  if (c.logoUrl) out.club_logo_url = c.logoUrl
  return out
})

function sampleFor(v: EmailVariable): string {
  return clubSampleOverrides.value[v.key]
    ?? emailTemplate.value?.sample_overrides[v.key]
    ?? v.sample
}

function substituteTokens(html: string): string {
  return variables.value.reduce((acc, v) => {
    if (!acc.includes(v.token)) return acc
    return acc.split(v.token).join(sampleFor(v))
  }, html)
}

// ── Recipient resolution ──────────────────────────────────────────

const currentPreset = computed<AudiencePreset>(() => PRESETS.find(p => p.key === composerPreset.value) ?? PRESETS[0]!)
const isSpecificMode = computed(() => composerPreset.value === 'specific')

const recipients = computed<BulkEmailRecipients>(() => {
  if (isSpecificMode.value) {
    return { mode: 'ids', user_ids: composerSelectedMembers.value.map(m => m.user_id) }
  }
  return { mode: 'filter', filter: currentPreset.value.filter ?? {} }
})

/** How many members the recipient selection resolves to right now. */
async function refreshComposerCount() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return

  if (isSpecificMode.value) {
    composerCount.value = composerSelectedMembers.value.length
    return
  }

  composerCountLoading.value = true
  try {
    const filter = currentPreset.value.filter ?? {}
    const res = await membersApi.listRoster(cid, {
      status: filter.status ?? 'active',
      role: filter.role,
      limit: 1,
      include_invites: false,
    })
    composerCount.value = res.pagination.total_items
  } catch {
    composerCount.value = null
  } finally {
    composerCountLoading.value = false
  }
}

watch(composerPreset, () => { void refreshComposerCount() })
watch(composerSelectedMembers, () => { void refreshComposerCount() }, { deep: true })

// ── Member search (specific mode) ─────────────────────────────────

let searchAbort: AbortController | null = null
async function runMemberSearch() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  const q = composerMemberSearch.value.trim()
  if (q.length < 2) {
    composerMemberResults.value = []
    return
  }
  searchAbort?.abort()
  searchAbort = new AbortController()
  composerMemberSearching.value = true
  try {
    const res = await membersApi.listRoster(cid, {
      search: q,
      status: 'active',
      limit: 10,
      include_invites: false,
    }, { signal: searchAbort.signal })
    composerMemberResults.value = res.members
  } catch (err) {
    if (err instanceof ApiError) toast.error(err.message)
  } finally {
    composerMemberSearching.value = false
  }
}

let searchDebounce: number | null = null
watch(composerMemberSearch, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => { void runMemberSearch() }, 220)
})

function toggleMember(m: RosterMember) {
  const idx = composerSelectedMembers.value.findIndex(x => x.user_id === m.user_id)
  if (idx >= 0) composerSelectedMembers.value.splice(idx, 1)
  else composerSelectedMembers.value.push(m)
}
function isSelected(m: RosterMember): boolean {
  return composerSelectedMembers.value.some(x => x.user_id === m.user_id)
}
function removeSelected(userId: number) {
  const idx = composerSelectedMembers.value.findIndex(x => x.user_id === userId)
  if (idx >= 0) composerSelectedMembers.value.splice(idx, 1)
}

// ── Compose lifecycle ─────────────────────────────────────────────

function openCompose() {
  composerPreset.value = 'all'
  composerSubject.value = ''
  composerBody.value = ''
  composerSelectedMembers.value = []
  composerMemberSearch.value = ''
  composerMemberResults.value = []
  composerCount.value = null
  step.value = 'recipients'
  composeOpen.value = true
  void refreshComposerCount()
}

// ── Step gating ───────────────────────────────────────────────────
const canAdvanceRecipients = computed(() => {
  if (isSpecificMode.value) return composerSelectedMembers.value.length > 0
  return (composerCount.value ?? 0) > 0
})
const canAdvanceCompose = computed(() =>
  composerSubject.value.trim().length > 0 && composerBody.value.trim().length > 0,
)
const subjectLen = computed(() => composerSubject.value.trim().length)
const tokensUsed = computed(() => {
  const text = `${composerSubject.value}\n${composerBody.value}`
  return variables.value.filter(v => text.includes(v.token)).length
})
const previewRecipient = computed(() => {
  if (isSpecificMode.value && composerSelectedMembers.value.length > 0) {
    return composerSelectedMembers.value[0]!
  }
  return null
})
function closeCompose() {
  if (composerSending.value) return
  composeOpen.value = false
}

// ── Token insertion ───────────────────────────────────────────────

const bodyRef = ref<HTMLTextAreaElement | null>(null)
const subjectRef = ref<HTMLInputElement | null>(null)
type Focused = 'subject' | 'body'
const lastFocused = ref<Focused>('body')

function insertToken(token: string) {
  const target = lastFocused.value === 'subject' ? subjectRef.value : bodyRef.value
  const modelSetter = lastFocused.value === 'subject'
    ? (v: string) => { composerSubject.value = v }
    : (v: string) => { composerBody.value = v }
  const currentValue = lastFocused.value === 'subject' ? composerSubject.value : composerBody.value

  if (!target) {
    modelSetter(currentValue + token)
    return
  }
  const start = target.selectionStart ?? currentValue.length
  const end = target.selectionEnd ?? currentValue.length
  const next = currentValue.slice(0, start) + token + currentValue.slice(end)
  modelSetter(next)
  requestAnimationFrame(() => {
    target.focus()
    const caret = start + token.length
    if ('setSelectionRange' in target) target.setSelectionRange(caret, caret)
  })
}
function copyToken(token: string) {
  navigator.clipboard?.writeText(token)
  toast.success(`Copied ${token}`)
}

// ── Send ──────────────────────────────────────────────────────────

function openSend() {
  if (!composerSubject.value.trim()) { toast.error('Give it a subject.'); return }
  if (!composerBody.value.trim()) { toast.error('Add some body text.'); return }
  if (isSpecificMode.value && composerSelectedMembers.value.length === 0) {
    toast.error('Pick at least one member.')
    return
  }
  confirmOpen.value = true
}

async function confirmSend() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  composerSending.value = true
  try {
    const input: BulkEmailInput = {
      subject: composerSubject.value.trim(),
      body_html: composerBody.value.trim(),
      recipients: recipients.value,
    }
    const res = await bulkEmailApi.send(cid, input)
    lastResult.value = res
    recentSends.value.unshift({
      id: res.batch_id,
      subject: input.subject,
      matched: res.matched,
      sent: res.sent_count,
      failed: res.failed_count,
      sent_at: new Date().toISOString(),
    })
    confirmOpen.value = false
    composeOpen.value = false
    resultOpen.value = true
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as { code?: string }) : {}
    if (body.code === 'missing_subject') toast.error('Add a subject and try again.')
    else if (body.code === 'missing_body') toast.error('Add body text and try again.')
    else if (body.code === 'no_recipients') toast.error('No recipients matched.')
    else toast.error(err instanceof ApiError ? err.message : 'Send failed.')
  } finally {
    composerSending.value = false
  }
}

// ── Preview render ────────────────────────────────────────────────

const renderedSubject = computed(() => substituteTokens(composerSubject.value || '(no subject)'))
const renderedHeader = computed(() => substituteTokens(emailTemplate.value?.header_html ?? ''))
const renderedFooter = computed(() => substituteTokens(emailTemplate.value?.footer_html ?? ''))
const renderedBody = computed(() => substituteTokens(composerBody.value || ''))

const previewShellStyle = computed(() => (
  previewDevice.value === 'mobile'
    ? { maxWidth: '380px' }
    : { maxWidth: '640px' }
))

// ── Formatting ────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-NZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ── Mount ─────────────────────────────────────────────────────────

onMounted(() => {
  void loadTemplate()
  // Dashboard's "Send bulk email" button navigates here with ?compose=1
  // to drop straight into the composer. Consume the flag so a manual
  // reload doesn't keep reopening it.
  if (route.query.compose === '1') {
    openCompose()
    void router.replace({ query: { ...route.query, compose: undefined } })
  }
})
watch(() => clubStore.current?.id, loadTemplate)
</script>

<template>
  <div class="cx">
    <!-- LIST MODE ─────────────────────────────────────────────── -->
    <template v-if="!composeOpen">
      <header class="cx__header">
        <div>
          <div class="cx__eyebrow">Communications</div>
          <h1 class="cx__heading">Email your members</h1>
          <p class="cx__sub">Broadcasts wrapped in your saved header + footer. SMS and scheduling coming later.</p>
        </div>
        <button class="btn btn--primary" @click="openCompose">+ New campaign</button>
      </header>

      <div v-if="recentSends.length === 0" class="empty">
        <div class="empty__eyebrow">Recent sends</div>
        <p class="empty__body">Nothing sent yet in this session. Hit <b>New campaign</b> to compose the first one.</p>
        <p class="empty__hint">Batch history from earlier sessions isn't wired yet — a delivery-log endpoint is on the roadmap.</p>
      </div>

      <section v-else class="sends">
        <div class="sends__head">
          <div class="sends__eyebrow">Sent this session</div>
        </div>
        <ul class="sends__list">
          <li v-for="s in recentSends" :key="s.id" class="send">
            <div class="send__left">
              <h3 class="send__subject">{{ s.subject }}</h3>
              <div class="send__meta">
                <span class="send__pill send__pill--sent">{{ s.sent }} sent</span>
                <span v-if="s.failed > 0" class="send__pill send__pill--fail">{{ s.failed }} failed</span>
                <span class="send__dot">·</span>
                <span class="send__matched">{{ s.matched }} matched</span>
              </div>
            </div>
            <div class="send__right">
              <div class="send__time">{{ fmtTime(s.sent_at) }}</div>
              <div class="send__id">Batch #{{ s.id }}</div>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <!-- COMPOSE WIZARD ────────────────────────────────────────── -->
    <template v-else>
      <div class="wz">
        <!-- Topbar -->
        <header class="wz__topbar">
          <button
            type="button"
            class="wz__cancel"
            :disabled="composerSending"
            @click="closeCompose"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Cancel
          </button>
          <div class="wz__eyebrow">New campaign</div>
          <div class="wz__autosave">Draft kept locally</div>
        </header>

        <!-- Progress rail -->
        <nav class="wz__progress" aria-label="Compose steps">
          <template v-for="(s, i) in STEPS" :key="s.key">
            <button
              type="button"
              class="wz-step"
              :class="{
                'wz-step--done': i < activeStepIndex,
                'wz-step--active': i === activeStepIndex,
              }"
              @click="i <= activeStepIndex ? goStep(s.key) : null"
            >
              <span class="wz-step__dot">
                <template v-if="i < activeStepIndex">✓</template>
                <template v-else>{{ i + 1 }}</template>
              </span>
              <span class="wz-step__label">{{ s.label }}</span>
            </button>
            <span v-if="i < STEPS.length - 1" class="wz-step__sep" aria-hidden="true"></span>
          </template>
        </nav>

        <!-- Step canvas -->
        <main class="wz__canvas">
          <!-- ─── Step 1 · Recipients ──────────────────────── -->
          <section v-if="step === 'recipients'" class="wz-step1">
            <div class="wz-hero">
              <div class="wz-hero__eyebrow">Step 1 of 3</div>
              <h1 class="wz-hero__title">Who are you emailing?</h1>
              <p class="wz-hero__sub">Pick a group, slice the roster with filters, or hand-pick individuals. We'll show the exact count once you've chosen.</p>
            </div>

            <div class="wz-tiles">
              <button
                v-for="p in PRESETS"
                :key="p.key"
                type="button"
                class="wz-tile"
                :class="{ 'wz-tile--active': composerPreset === p.key }"
                @click="composerPreset = p.key"
              >
                <div class="wz-tile__row">
                  <span class="wz-tile__eyebrow">{{ p.hint }}</span>
                  <span v-if="composerPreset === p.key" class="wz-tile__check">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 4L6 11l-3-3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </span>
                </div>
                <div class="wz-tile__label">{{ p.label }}</div>
                <div class="wz-tile__meta">
                  <template v-if="composerPreset === p.key && composerCountLoading">counting…</template>
                  <template v-else-if="composerPreset === p.key && composerCount != null">
                    <span class="wz-tile__count">{{ composerCount }} member{{ composerCount === 1 ? '' : 's' }}</span>
                  </template>
                  <template v-else>Select to count</template>
                </div>
              </button>
            </div>

            <!-- Hand-pick row -->
            <button
              type="button"
              class="wz-handpick"
              :class="{ 'wz-handpick--active': composerPreset === 'specific' }"
              @click="composerPreset = 'specific'"
            >
              <div class="wz-handpick__text">
                <div class="wz-handpick__title">Hand-pick specific members</div>
                <div class="wz-handpick__hint">Search by name, email, or phone. Combine with filters later.</div>
              </div>
              <span class="wz-handpick__chip">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                {{ composerPreset === 'specific' ? 'Picking…' : 'Search roster' }}
              </span>
            </button>

            <!-- Specific-members picker (unchanged logic, re-skinned) -->
            <div v-if="isSpecificMode" class="wz-picker">
              <div class="wz-picker__input">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                <input
                  v-model="composerMemberSearch"
                  type="text"
                  placeholder="Search by name or email…"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span v-if="composerMemberSearching" class="wz-picker__spin">…</span>
              </div>

              <ul v-if="composerMemberResults.length > 0" class="wz-picker__results">
                <li
                  v-for="m in composerMemberResults"
                  :key="m.user_id"
                  class="wz-picker__row"
                  :class="{ 'wz-picker__row--on': isSelected(m) }"
                  @click="toggleMember(m)"
                >
                  <div class="wz-picker__row-main">
                    <div class="wz-picker__row-name">{{ m.name }}</div>
                    <div class="wz-picker__row-email">{{ m.email ?? '—' }}</div>
                  </div>
                  <div class="wz-picker__row-check">{{ isSelected(m) ? '✓' : '+' }}</div>
                </li>
              </ul>
              <p v-else-if="composerMemberSearch.length >= 2 && !composerMemberSearching" class="wz-picker__empty">
                No matches for "{{ composerMemberSearch }}".
              </p>

              <div v-if="composerSelectedMembers.length > 0" class="wz-picker__selected">
                <div class="wz-picker__selected-head">Selected · {{ composerSelectedMembers.length }}</div>
                <div class="wz-picker__chips">
                  <span v-for="m in composerSelectedMembers" :key="m.user_id" class="wz-chip">
                    {{ m.name }}
                    <button type="button" class="wz-chip__x" @click.stop="removeSelected(m.user_id)" aria-label="Remove">×</button>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- ─── Step 2 · Compose ───────────────────────────── -->
          <section v-else-if="step === 'compose'" class="wz-step2">
            <div class="wz-hero">
              <div class="wz-hero__eyebrow">
                Step 2 of 3 · {{ composerCount ?? '…' }} recipient{{ composerCount === 1 ? '' : 's' }}
              </div>
              <h1 class="wz-hero__title">Write the email.</h1>
              <p class="wz-hero__sub">
                Tokens like <code class="wz-hero__token">&#123;&#123;recipient_first_name&#125;&#125;</code> get swapped per member when the email goes out.
              </p>
            </div>

            <div class="wz-editor">
              <div class="wz-editor__row">
                <span class="wz-editor__label">Subject</span>
                <input
                  ref="subjectRef"
                  v-model="composerSubject"
                  type="text"
                  class="wz-editor__input"
                  placeholder="Season kick-off — Saturday at 2pm"
                  @focus="lastFocused = 'subject'"
                />
                <span class="wz-editor__counter">{{ subjectLen }} / 200</span>
              </div>

              <div class="wz-editor__row wz-editor__row--muted">
                <span class="wz-editor__label">From</span>
                <span class="wz-editor__from">{{ clubStore.current?.name ?? 'Your club' }}</span>
                <span class="wz-editor__from-aside">· replies land in your saved reply-to</span>
              </div>

              <div class="wz-editor__vars">
                <span class="wz-editor__vars-label">Insert</span>
                <button
                  v-for="v in (variablesByCategory.recipient ?? []).slice(0, 3)"
                  :key="v.key"
                  type="button"
                  class="wz-var"
                  :title="`${v.label} — sample: ${sampleFor(v)}`"
                  @click="insertToken(v.token)"
                >{{ v.token.replace(/[{}]/g, '') }}</button>
                <button
                  v-for="v in (variablesByCategory.club ?? []).slice(0, 2)"
                  :key="v.key"
                  type="button"
                  class="wz-var"
                  :title="`${v.label} — sample: ${sampleFor(v)}`"
                  @click="insertToken(v.token)"
                >{{ v.token.replace(/[{}]/g, '') }}</button>
                <button
                  v-for="v in (variablesByCategory.auto ?? []).slice(0, 1)"
                  :key="v.key"
                  type="button"
                  class="wz-var"
                  :title="`${v.label} — sample: ${sampleFor(v)}`"
                  @click="insertToken(v.token)"
                >{{ v.token.replace(/[{}]/g, '') }}</button>
              </div>

              <textarea
                ref="bodyRef"
                v-model="composerBody"
                rows="14"
                class="wz-editor__body"
                spellcheck="false"
                placeholder="<p>Hi {{recipient_first_name}},</p>&#10;<p>Season starts Saturday at {{club_name}}. See you there.</p>"
                @focus="lastFocused = 'body'"
              ></textarea>
            </div>
          </section>

          <!-- ─── Step 3 · Preview & send ─────────────────────── -->
          <section v-else-if="step === 'preview'" class="wz-step3">
            <div class="wz-hero wz-hero--preview">
              <div class="wz-hero__left">
                <div class="wz-hero__eyebrow">Step 3 of 3</div>
                <h1 class="wz-hero__title">Looks good?</h1>
                <p class="wz-hero__sub">Previewing with the first recipient's tokens. Jump back to any step to fix things — your draft is kept.</p>
              </div>
              <div class="wz-device">
                <button type="button" :class="{ 'is-on': previewDevice === 'desktop' }" @click="previewDevice = 'desktop'">Desktop</button>
                <button type="button" :class="{ 'is-on': previewDevice === 'mobile' }" @click="previewDevice = 'mobile'">Mobile</button>
              </div>
            </div>

            <div class="wz-preview-grid">
              <div class="wz-preview">
                <header class="wz-preview__head">
                  <div class="wz-preview__meta">
                    <span class="wz-preview__meta-label">From</span>
                    <span class="wz-preview__meta-value">{{ clubStore.current?.name ?? 'Your club' }} &lt;noreply@torny.com&gt;</span>
                  </div>
                  <div class="wz-preview__meta">
                    <span class="wz-preview__meta-label">To</span>
                    <span class="wz-preview__meta-value">
                      <template v-if="previewRecipient">{{ previewRecipient.name }} &lt;{{ previewRecipient.email ?? '—' }}&gt;</template>
                      <template v-else>Frances Roydon-Miller &lt;frances@example.co.nz&gt;</template>
                    </span>
                  </div>
                  <div class="wz-preview__meta">
                    <span class="wz-preview__meta-label">Subject</span>
                    <span class="wz-preview__meta-value wz-preview__meta-value--bold">{{ renderedSubject }}</span>
                  </div>
                </header>
                <div class="wz-preview__body" :style="previewShellStyle">
                  <div v-if="renderedHeader" v-html="renderedHeader" />
                  <div class="wz-preview__content" v-html="renderedBody" />
                  <div v-if="renderedFooter" v-html="renderedFooter" />
                </div>
              </div>

              <aside class="wz-rail">
                <div class="wz-rail__card">
                  <div class="wz-rail__eyebrow">At a glance</div>
                  <div class="wz-rail__row">
                    <span>Recipients</span>
                    <span class="wz-rail__num">{{ composerCount ?? '—' }}</span>
                  </div>
                  <div class="wz-rail__row">
                    <span>Subject length</span>
                    <span class="wz-rail__num">{{ subjectLen }}&nbsp;ch</span>
                  </div>
                  <div class="wz-rail__row">
                    <span>Tokens used</span>
                    <span class="wz-rail__num">{{ tokensUsed }}</span>
                  </div>
                </div>
                <div class="wz-rail__card wz-rail__card--ink">
                  <div class="wz-rail__eyebrow wz-rail__eyebrow--on-ink">Schedule</div>
                  <div class="wz-rail__send-now">Send now</div>
                  <div class="wz-rail__send-hint">Fires immediately on confirm. Scheduling arrives in a follow-up.</div>
                </div>
              </aside>
            </div>
          </section>
        </main>

        <!-- Footer nav -->
        <footer class="wz__footer">
          <button
            type="button"
            class="wz__nav wz__nav--ghost"
            :disabled="composerSending"
            @click="step === 'recipients' ? closeCompose() : prevStep()"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <template v-if="step === 'recipients'">Cancel</template>
            <template v-else-if="step === 'compose'">Back · Recipients</template>
            <template v-else>Back · Edit copy</template>
          </button>

          <div class="wz__status">
            <template v-if="step === 'recipients'">
              <span class="wz__status-label">Selected</span>
              <span class="wz__status-num">{{ composerCount ?? 0 }} recipient{{ composerCount === 1 ? '' : 's' }}</span>
            </template>
            <template v-else-if="step === 'compose'">
              <span class="wz__status-label">Draft</span>
              <span class="wz__status-num">{{ subjectLen > 0 || composerBody.length > 0 ? 'In progress' : 'Empty' }}</span>
            </template>
            <template v-else>
              <span class="wz__status-label">Ready</span>
              <span class="wz__status-num">{{ composerCount ?? 0 }} recipient{{ composerCount === 1 ? '' : 's' }}</span>
            </template>
          </div>

          <button
            v-if="step !== 'preview'"
            type="button"
            class="wz__nav wz__nav--ink"
            :disabled="step === 'recipients' ? !canAdvanceRecipients : !canAdvanceCompose"
            @click="nextStep"
          >
            <template v-if="step === 'recipients'">Next · Compose</template>
            <template v-else>Next · Preview</template>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l6 5-6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button
            v-else
            type="button"
            class="wz__nav wz__nav--ink"
            :disabled="composerSending || composerCount === 0"
            @click="openSend"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8l12-6-4 14-3-6-5-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            {{ composerSending ? 'Sending…' : `Send to ${composerCount ?? '…'}` }}
          </button>
        </footer>
      </div>

    </template>

    <!-- Confirm send modal -->
    <CrmModal
      :open="confirmOpen"
      eyebrow="Send campaign"
      :title="`Send to ${composerCount ?? 0} ${composerCount === 1 ? 'member' : 'members'}?`"
      width="sm"
      @close="confirmOpen = false"
    >
      <p class="confirm__body">This sends immediately to everyone in your recipient selection. There's no unsend.</p>
      <p class="confirm__hint">Your saved header + footer wrap the email automatically.</p>
      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" :disabled="composerSending" @click="confirmOpen = false">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="composerSending" @click="confirmSend">
          {{ composerSending ? 'Sending…' : 'Send now' }}
        </button>
      </template>
    </CrmModal>

    <!-- Result modal -->
    <CrmModal
      :open="resultOpen"
      eyebrow="Batch complete"
      :title="lastResult ? `Batch #${lastResult.batch_id} — ${lastResult.sent_count} sent` : 'Batch complete'"
      width="md"
      @close="resultOpen = false"
    >
      <div v-if="lastResult" class="result">
        <div class="result__stats">
          <div class="result__stat"><div class="result__val">{{ lastResult.matched }}</div><div class="result__lbl">Matched</div></div>
          <div class="result__stat result__stat--sent"><div class="result__val">{{ lastResult.sent_count }}</div><div class="result__lbl">Sent</div></div>
          <div class="result__stat result__stat--fail"><div class="result__val">{{ lastResult.failed_count }}</div><div class="result__lbl">Failed</div></div>
        </div>

        <div v-if="lastResult.failed.length > 0" class="result__failed">
          <div class="result__failed-head">Failed recipients</div>
          <ul class="result__failed-list">
            <li v-for="f in lastResult.failed" :key="f.user_id" class="result__failed-row">
              <div class="result__failed-email">{{ f.email }}</div>
              <div class="result__failed-reason">{{ f.reason }}</div>
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <button type="button" class="modal-btn modal-btn--primary" @click="resultOpen = false">Done</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.cx { max-width: 1440px; }

/* ── List mode ─────────────────────────────────────────────── */
.cx__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.cx__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.cx__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.cx__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.empty { padding: 48px 40px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 16px; text-align: center; }
.empty__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 12px; }
.empty__body { font-family: var(--font-body); font-size: 15px; color: var(--color-ink); margin: 0 0 8px; }
.empty__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }

.sends { }
.sends__head { margin-bottom: 12px; }
.sends__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.sends__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.send { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.send__subject { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; margin: 0 0 6px; color: var(--color-ink); }
.send__meta { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.send__pill { padding: 2px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; }
.send__pill--sent { background: #DCFCE7; color: #166534; }
.send__pill--fail { background: #FEE2E2; color: #B91C1C; }
.send__dot { opacity: 0.5; }
.send__right { text-align: right; flex-shrink: 0; }
.send__time { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); }
.send__id { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); letter-spacing: 0.08em; margin-top: 2px; }

/* ── Compose wizard ───────────────────────────────────────── */
.wz { display: flex; flex-direction: column; min-height: calc(100vh - 60px); background: var(--color-surface); margin: -24px -24px 0; border: 1px solid var(--color-hairline); border-radius: 16px 16px 0 0; overflow: hidden; }

/* Topbar */
.wz__topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 32px; background: #fff; border-bottom: 1px solid var(--color-hairline); }
.wz__cancel { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 12px; font-weight: 500; cursor: pointer; transition: border-color 0.12s ease, background 0.12s ease; }
.wz__cancel:hover:not(:disabled) { border-color: var(--color-ink); background: var(--color-surface); }
.wz__cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.wz__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wz__autosave { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* Progress rail */
.wz__progress { display: flex; align-items: flex-start; justify-content: center; gap: 0; padding: 24px 32px 0; background: var(--color-surface); }
.wz-step { display: flex; flex-direction: column; align-items: center; gap: 8px; background: transparent; border: 0; padding: 0; cursor: pointer; }
.wz-step:disabled { cursor: default; }
.wz-step__dot { width: 28px; height: 28px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid var(--color-hairline); color: var(--color-fog); font-family: var(--font-body); font-size: 12px; font-weight: 600; }
.wz-step__label { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); }
.wz-step--active .wz-step__dot { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.wz-step--active .wz-step__label { color: var(--color-ink); font-weight: 600; }
.wz-step--done .wz-step__dot { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.wz-step--done .wz-step__label { color: var(--color-fog); font-weight: 500; }
.wz-step__sep { width: 120px; height: 1px; background: var(--color-hairline); margin: 14px 20px 0; align-self: flex-start; }

/* Canvas */
.wz__canvas { flex: 1; padding: 48px 32px 32px; display: flex; flex-direction: column; align-items: center; gap: 28px; background: var(--color-surface); }
.wz-step1,
.wz-step2,
.wz-step3 { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 24px; }

/* Hero per step */
.wz-hero { display: flex; flex-direction: column; gap: 10px; max-width: 800px; width: 100%; }
.wz-hero--preview { flex-direction: row; align-items: flex-end; justify-content: space-between; gap: 24px; max-width: 1104px; }
.wz-hero__left { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.wz-hero__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wz-hero__title { font-family: var(--font-display); font-size: 44px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.05; color: var(--color-ink); margin: 0; }
.wz-hero__sub { font-family: var(--font-body); font-size: 16px; line-height: 1.5; color: var(--color-fog); margin: 0; max-width: 520px; }
.wz-hero__token { font-family: var(--font-mono); font-size: 13px; background: var(--color-surface); padding: 1px 6px; border-radius: 4px; color: var(--color-ink); border: 1px solid var(--color-hairline); }

/* Device toggle on step 3 */
.wz-device { display: inline-flex; padding: 3px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; }
.wz-device button { padding: 5px 14px; background: transparent; border: 0; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); }
.wz-device button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }

/* Step 1 — tiles */
.wz-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 800px; width: 100%; }
.wz-tile { display: flex; flex-direction: column; gap: 10px; padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; color: var(--color-ink); cursor: pointer; text-align: left; transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease; }
.wz-tile:hover { border-color: var(--color-ink); background: var(--color-surface); }
.wz-tile--active { background: var(--color-ink); border-color: var(--color-ink); color: #fff; }
.wz-tile--active:hover { background: var(--color-ink); color: #fff; }
.wz-tile__row { display: flex; align-items: center; justify-content: space-between; }
.wz-tile__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wz-tile--active .wz-tile__eyebrow { color: rgba(255, 255, 255, 0.6); }
.wz-tile__check { width: 24px; height: 24px; border-radius: 999px; background: #fff; color: var(--color-ink); display: inline-flex; align-items: center; justify-content: center; }
.wz-tile__label { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.wz-tile__meta { display: flex; align-items: baseline; gap: 6px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wz-tile--active .wz-tile__meta { color: rgba(255, 255, 255, 0.6); }
.wz-tile__count { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--color-ink); letter-spacing: 0.02em; }
.wz-tile--active .wz-tile__count { color: #fff; }

/* Hand-pick row */
.wz-handpick { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 800px; width: 100%; padding: 18px 24px; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 16px; text-align: left; cursor: pointer; color: var(--color-ink); transition: border-color 0.12s ease, background 0.12s ease; }
.wz-handpick:hover { border-color: var(--color-ink); background: var(--color-surface); }
.wz-handpick--active { background: var(--color-ink); color: #fff; border-color: var(--color-ink); border-style: solid; }
.wz-handpick--active:hover { background: var(--color-ink); color: #fff; }
.wz-handpick__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wz-handpick__title { font-family: var(--font-body); font-size: 14px; font-weight: 600; }
.wz-handpick__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wz-handpick--active .wz-handpick__hint { color: rgba(255, 255, 255, 0.6); }
.wz-handpick__chip { display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; height: 34px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-ink); font-family: var(--font-body); font-size: 13px; font-weight: 600; flex-shrink: 0; }
.wz-handpick--active .wz-handpick__chip { background: #fff; color: var(--color-ink); }

/* Picker */
.wz-picker { max-width: 800px; width: 100%; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.wz-picker__input { position: relative; display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px 0 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; color: var(--color-fog); }
.wz-picker__input:focus-within { border-color: var(--color-ink); color: var(--color-ink); background: #fff; }
.wz-picker__input input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); }
.wz-picker__spin { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }
.wz-picker__results { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; border: 1px solid var(--color-hairline); border-radius: 12px; overflow: hidden; }
.wz-picker__row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; cursor: pointer; transition: background 0.12s ease; }
.wz-picker__row + .wz-picker__row { border-top: 1px solid var(--color-hairline); }
.wz-picker__row:hover { background: var(--color-surface); }
.wz-picker__row--on { background: var(--color-surface); }
.wz-picker__row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wz-picker__row-name { font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); }
.wz-picker__row-email { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.wz-picker__row-check { width: 24px; height: 24px; border-radius: 999px; background: var(--color-surface); color: var(--color-fog); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; }
.wz-picker__row--on .wz-picker__row-check { background: var(--color-ink); color: #fff; }
.wz-picker__empty { margin: 0; padding: 24px; text-align: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wz-picker__selected { display: flex; flex-direction: column; gap: 8px; }
.wz-picker__selected-head { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.wz-picker__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.wz-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 12px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); }
.wz-chip__x { border: 0; background: transparent; color: var(--color-fog); cursor: pointer; font-size: 14px; padding: 0 4px; line-height: 1; }
.wz-chip__x:hover { color: var(--color-ink); }

/* Step 2 — editor card */
.wz-editor { max-width: 800px; width: 100%; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.wz-editor__row { display: flex; align-items: center; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--color-hairline); }
.wz-editor__row--muted { background: var(--color-surface); padding: 14px 24px; }
.wz-editor__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); width: 60px; flex-shrink: 0; }
.wz-editor__input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-family: var(--font-display); font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: var(--color-ink); }
.wz-editor__input::placeholder { color: var(--color-mute); font-weight: 400; }
.wz-editor__counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-mute); flex-shrink: 0; }
.wz-editor__from { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.wz-editor__from-aside { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.wz-editor__vars { display: flex; align-items: center; gap: 8px; padding: 12px 24px; border-bottom: 1px solid var(--color-hairline); flex-wrap: wrap; }
.wz-editor__vars-label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-right: 4px; }
.wz-var { display: inline-flex; align-items: center; padding: 4px 10px; border: 1px solid var(--color-hairline); border-radius: 999px; background: var(--color-surface); color: var(--color-ink); font-family: var(--font-mono); font-size: 11px; font-weight: 500; cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease; }
.wz-var:hover { border-color: var(--color-ink); background: #fff; }
.wz-editor__body { width: 100%; box-sizing: border-box; padding: 24px; border: 0; outline: none; background: #fff; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--color-ink); resize: vertical; min-height: 320px; }

/* Step 3 — preview + rail */
.wz-preview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; max-width: 1104px; width: 100%; }
.wz-preview { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
.wz-preview__head { display: flex; flex-direction: column; gap: 6px; padding: 18px 24px; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.wz-preview__meta { display: flex; align-items: baseline; gap: 10px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.wz-preview__meta-label { width: 60px; flex-shrink: 0; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-mute); }
.wz-preview__meta-value { color: var(--color-ink); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wz-preview__meta-value--bold { font-weight: 600; }
.wz-preview__body { padding: 32px; background: #fff; margin: 0 auto; transition: max-width 200ms ease; }
.wz-preview__content { font-family: Inter, sans-serif; color: var(--color-ink); font-size: 14px; line-height: 1.6; }
.wz-preview__content :deep(p) { margin: 0 0 12px; }
.wz-preview__content :deep(a) { color: var(--color-accent-strong); }

.wz-rail { display: flex; flex-direction: column; gap: 14px; }
.wz-rail__card { padding: 18px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; display: flex; flex-direction: column; gap: 10px; }
.wz-rail__card--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.wz-rail__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wz-rail__eyebrow--on-ink { color: rgba(255, 255, 255, 0.6); }
.wz-rail__row { display: flex; align-items: baseline; justify-content: space-between; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.wz-rail__num { font-family: var(--font-mono); font-weight: 600; color: var(--color-ink); }
.wz-rail__send-now { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
.wz-rail__send-hint { font-family: var(--font-body); font-size: 12px; color: rgba(255, 255, 255, 0.65); }

/* Footer nav */
.wz__footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 32px; background: #fff; border-top: 1px solid var(--color-hairline); }
.wz__nav { display: inline-flex; align-items: center; gap: 6px; padding: 0 18px; height: 38px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.wz__nav--ghost { background: #fff; color: var(--color-ink); border-color: var(--color-hairline); }
.wz__nav--ghost:hover:not(:disabled) { border-color: var(--color-ink); background: var(--color-surface); }
.wz__nav--ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.wz__nav--ink { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.wz__nav--ink:hover:not(:disabled) { background: var(--color-graphite); border-color: var(--color-graphite); }
.wz__nav--ink:disabled { background: var(--color-mute); border-color: var(--color-mute); cursor: not-allowed; }
.wz__status { display: flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.wz__status-label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.wz__status-num { font-family: var(--font-mono); font-weight: 600; color: var(--color-ink); letter-spacing: 0.02em; }

/* Buttons (list mode + legacy) */
.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }

/* Modal contents */
.confirm__body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0 0 8px; }
.confirm__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

/* Result modal */
.result { display: flex; flex-direction: column; gap: 20px; }
.result__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.result__stat { padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.result__val { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.result__lbl { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-top: 2px; }
.result__stat--sent .result__val { color: #166534; }
.result__stat--fail .result__val { color: #B91C1C; }
.result__failed { display: flex; flex-direction: column; gap: 8px; }
.result__failed-head { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.result__failed-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.result__failed-row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; font-family: var(--font-body); font-size: 12px; }
.result__failed-email { color: var(--color-ink); font-weight: 500; }
.result__failed-reason { color: #B91C1C; font-family: var(--font-mono); font-size: 11px; text-align: right; flex: 1; }

@media (max-width: 1023px) {
  .wz-preview-grid { grid-template-columns: 1fr; }
  .wz-hero--preview { flex-direction: column; align-items: flex-start; }
  .wz-step__sep { width: 48px; margin: 14px 10px 0; }
}
@media (max-width: 767px) {
  .wz__canvas { padding: 32px 20px 24px; }
  .wz__topbar { padding: 12px 20px; flex-wrap: wrap; }
  .wz__footer { padding: 12px 20px; flex-wrap: wrap; gap: 10px; }
  .wz__progress { padding: 20px 20px 0; }
  .wz__status { display: none; }
  .wz-tiles { grid-template-columns: 1fr; }
  .wz-hero__title { font-size: 32px; }
  .result__stats { grid-template-columns: 1fr; }
}
</style>
