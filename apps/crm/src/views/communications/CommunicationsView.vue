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
import { computed, onMounted, reactive, ref, watch } from 'vue'
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

function sampleFor(v: EmailVariable): string {
  return emailTemplate.value?.sample_overrides[v.key] ?? v.sample
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
  composeOpen.value = true
  void refreshComposerCount()
}
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

onMounted(loadTemplate)
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

    <!-- COMPOSE MODE ─────────────────────────────────────────── -->
    <template v-else>
      <header class="composer__head">
        <button class="btn btn--outline" :disabled="composerSending" @click="closeCompose">← Cancel</button>
        <div class="composer__title-wrap">
          <div class="composer__eyebrow">New campaign</div>
          <h1 class="composer__title">Compose email</h1>
        </div>
        <button
          class="btn btn--primary"
          :disabled="composerSending || composerCount === 0"
          @click="openSend"
        >
          {{ composerSending ? 'Sending…' : `Send to ${composerCount ?? '…'}` }}
        </button>
      </header>

      <div class="composer">
        <!-- Editor column -->
        <div class="composer__editor">
          <!-- Recipients -->
          <section class="ed-section">
            <div class="ed-section__head">
              <div class="ed-section__eyebrow">01 · Recipients</div>
              <div v-if="composerCountLoading" class="ed-section__count-loading">counting…</div>
              <div v-else-if="composerCount != null" class="ed-section__count">
                {{ composerCount }} {{ composerCount === 1 ? 'member' : 'members' }}
              </div>
            </div>

            <div class="presets">
              <button
                v-for="p in PRESETS"
                :key="p.key"
                type="button"
                class="preset"
                :class="{ 'is-on': composerPreset === p.key }"
                @click="composerPreset = p.key"
              >
                <span class="preset__label">{{ p.label }}</span>
                <span class="preset__hint">{{ p.hint }}</span>
              </button>
              <button
                type="button"
                class="preset preset--specific"
                :class="{ 'is-on': composerPreset === 'specific' }"
                @click="composerPreset = 'specific'"
              >
                <span class="preset__label">Specific members</span>
                <span class="preset__hint">Search + pick individuals</span>
              </button>
            </div>

            <!-- Specific-members picker -->
            <div v-if="isSpecificMode" class="picker">
              <div class="picker__input">
                <input
                  v-model="composerMemberSearch"
                  type="text"
                  placeholder="Search by name or email…"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span v-if="composerMemberSearching" class="picker__spin">…</span>
              </div>

              <ul v-if="composerMemberResults.length > 0" class="picker__results">
                <li
                  v-for="m in composerMemberResults"
                  :key="m.user_id"
                  class="picker__row"
                  :class="{ 'is-on': isSelected(m) }"
                  @click="toggleMember(m)"
                >
                  <div class="picker__row-name">{{ m.name }}</div>
                  <div class="picker__row-email">{{ m.email ?? '—' }}</div>
                  <div class="picker__row-check">{{ isSelected(m) ? '✓' : '+' }}</div>
                </li>
              </ul>
              <p v-else-if="composerMemberSearch.length >= 2 && !composerMemberSearching" class="picker__empty">
                No matches for "{{ composerMemberSearch }}".
              </p>

              <div v-if="composerSelectedMembers.length > 0" class="picker__selected">
                <div class="picker__selected-head">Selected · {{ composerSelectedMembers.length }}</div>
                <div class="picker__chips">
                  <span v-for="m in composerSelectedMembers" :key="m.user_id" class="chip">
                    {{ m.name }}
                    <button type="button" class="chip__x" @click="removeSelected(m.user_id)" aria-label="Remove">×</button>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- Subject -->
          <section class="ed-section">
            <div class="ed-section__head">
              <div class="ed-section__eyebrow">02 · Subject</div>
            </div>
            <input
              ref="subjectRef"
              v-model="composerSubject"
              type="text"
              class="ed-subject"
              placeholder="Season kick-off — Saturday"
              @focus="lastFocused = 'subject'"
            />
          </section>

          <!-- Body -->
          <section class="ed-section">
            <div class="ed-section__head">
              <div class="ed-section__eyebrow">03 · Body (HTML)</div>
              <div class="ed-section__hint">Use <code>&lt;p&gt;</code>, <code>&lt;a&gt;</code>, <code>&lt;strong&gt;</code> etc. Inline styles only.</div>
            </div>
            <textarea
              ref="bodyRef"
              v-model="composerBody"
              rows="14"
              class="ed-body"
              spellcheck="false"
              placeholder="<p>Hi {{recipient_first_name}},</p>&#10;<p>Season starts Saturday at {{club_name}}. See you there.</p>"
              @focus="lastFocused = 'body'"
            ></textarea>
          </section>

          <!-- Variables -->
          <section class="ed-section">
            <div class="ed-section__head">
              <div class="ed-section__eyebrow">04 · Variables</div>
              <div class="ed-section__hint">Click a token to insert it at the cursor. Copy button copies it.</div>
            </div>
            <div class="vars">
              <div v-for="cat in (['recipient', 'club', 'auto', 'context'] as const)" :key="cat" class="vars__group">
                <div v-if="variablesByCategory[cat].length > 0" class="vars__cat">{{ cat }}</div>
                <div class="vars__row">
                  <button
                    v-for="v in variablesByCategory[cat]"
                    :key="v.key"
                    type="button"
                    class="var"
                    :title="`${v.label} — sample: ${sampleFor(v)}`"
                    @click="insertToken(v.token)"
                    @contextmenu.prevent="copyToken(v.token)"
                  >
                    {{ v.token }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- Preview column -->
        <aside class="composer__preview">
          <div class="pv__head">
            <div class="pv__eyebrow">Preview</div>
            <div class="pv__device">
              <button type="button" :class="{ 'is-on': previewDevice === 'desktop' }" @click="previewDevice = 'desktop'">Desktop</button>
              <button type="button" :class="{ 'is-on': previewDevice === 'mobile' }" @click="previewDevice = 'mobile'">Mobile</button>
            </div>
          </div>

          <div class="pv__meta">
            <div class="pv__meta-row"><span>Subject</span><span class="pv__subject">{{ renderedSubject }}</span></div>
            <div class="pv__meta-row"><span>To</span><span>Frances Roydon-Miller &lt;frances@example.co.nz&gt;</span></div>
          </div>

          <div class="pv__shell" :style="previewShellStyle">
            <div v-if="renderedHeader" v-html="renderedHeader" />
            <div class="pv__body" v-html="renderedBody" />
            <div v-if="renderedFooter" v-html="renderedFooter" />
          </div>

          <p class="pv__note">
            Server wraps your body between the club's saved header + footer. Edit those in
            <router-link to="/settings">Settings → Email template</router-link>.
          </p>
        </aside>
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

/* ── Composer ─────────────────────────────────────────────── */
.composer__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--color-hairline); }
.composer__title-wrap { flex: 1; text-align: center; }
.composer__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.composer__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 2px 0 0; color: var(--color-ink); }

.composer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 720px); gap: 24px; align-items: flex-start; }

/* Editor */
.composer__editor { display: flex; flex-direction: column; gap: 24px; }
.ed-section { padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; display: flex; flex-direction: column; gap: 12px; }
.ed-section__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ed-section__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.ed-section__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.ed-section__hint code { font-family: var(--font-mono); background: var(--color-surface); padding: 1px 5px; border-radius: 4px; color: var(--color-ink); }
.ed-section__count { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; padding: 3px 10px; background: var(--color-accent-soft); color: var(--color-accent-strong); border-radius: 999px; }
.ed-section__count-loading { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }

/* Presets */
.presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; text-align: left; font-family: var(--font-body); }
.preset:hover:not(.is-on) { border-color: var(--color-graphite); }
.preset.is-on { background: var(--color-ink); border-color: var(--color-ink); }
.preset__label { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.preset.is-on .preset__label { color: #fff; }
.preset__hint { font-size: 11px; color: var(--color-fog); }
.preset.is-on .preset__hint { color: rgba(255, 255, 255, 0.6); }
.preset--specific { border-style: dashed; }

/* Picker */
.picker { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; }
.picker__input { position: relative; }
.picker__input input { width: 100%; box-sizing: border-box; padding: 10px 32px 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; background: #fff; color: var(--color-ink); }
.picker__input input:focus { outline: none; border-color: var(--color-ink); }
.picker__spin { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }
.picker__results { list-style: none; padding: 0; margin: 0; background: #fff; border: 1px solid var(--color-hairline); border-radius: 8px; overflow: hidden; }
.picker__row { display: grid; grid-template-columns: 1fr 1fr 32px; gap: 8px; padding: 8px 12px; cursor: pointer; font-family: var(--font-body); font-size: 13px; }
.picker__row:hover { background: var(--color-surface); }
.picker__row.is-on { background: var(--color-accent-soft); }
.picker__row-name { color: var(--color-ink); font-weight: 500; }
.picker__row-email { color: var(--color-fog); font-family: var(--font-mono); font-size: 11px; }
.picker__row-check { text-align: right; font-family: var(--font-mono); color: var(--color-fog); }
.picker__row.is-on .picker__row-check { color: var(--color-accent-strong); font-weight: 700; }
.picker__empty { margin: 0; padding: 12px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); text-align: center; }
.picker__selected { display: flex; flex-direction: column; gap: 8px; }
.picker__selected-head { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.picker__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px 4px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); }
.chip__x { border: 0; background: transparent; color: var(--color-fog); cursor: pointer; font-size: 14px; padding: 0 4px; }
.chip__x:hover { color: var(--color-ink); }

/* Subject + body */
.ed-subject { width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 15px; color: var(--color-ink); background: #fff; }
.ed-subject:focus { outline: none; border-color: var(--color-ink); }
.ed-body { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-mono); font-size: 12px; line-height: 155%; color: var(--color-ink); background: var(--color-surface); resize: vertical; min-height: 260px; }
.ed-body:focus { outline: none; border-color: var(--color-ink); background: #fff; }

/* Variables palette */
.vars { display: flex; flex-direction: column; gap: 12px; }
.vars__group { display: flex; flex-direction: column; gap: 6px; }
.vars__cat { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.vars__row { display: flex; flex-wrap: wrap; gap: 6px; }
.var { padding: 4px 10px; background: var(--color-ink); color: #fff; border: 0; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; cursor: pointer; }
.var:hover { background: var(--color-graphite); }

/* Preview */
.composer__preview { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 12px; padding: 24px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 16px; }
.pv__head { display: flex; align-items: center; justify-content: space-between; }
.pv__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.pv__device { display: inline-flex; padding: 3px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; }
.pv__device button { padding: 5px 12px; background: transparent; border: 0; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.pv__device button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }
.pv__meta { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.pv__meta-row { display: flex; gap: 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.pv__meta-row > span:first-child { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); width: 60px; padding-top: 2px; flex-shrink: 0; }
.pv__subject { font-weight: 600; }
.pv__shell { width: 100%; margin: 0 auto; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 24px -12px rgba(15, 23, 42, 0.15); transition: max-width 200ms ease; }
.pv__body { padding: 32px; font-family: Inter, sans-serif; color: var(--color-ink); font-size: 14px; line-height: 1.55; }
.pv__body :deep(p) { margin: 0 0 12px; }
.pv__body :deep(a) { color: var(--color-accent-strong); }
.pv__note { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin: 4px 0 0; }
.pv__note a { color: var(--color-accent); text-decoration: none; }
.pv__note a:hover { text-decoration: underline; }

/* Buttons */
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
  .composer { grid-template-columns: 1fr; }
  .composer__preview { position: static; }
}
@media (max-width: 767px) {
  .composer__head { flex-wrap: wrap; }
  .composer__title-wrap { order: -1; width: 100%; text-align: left; }
  .result__stats { grid-template-columns: 1fr; }
}
</style>
