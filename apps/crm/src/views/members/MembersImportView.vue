<script setup lang="ts">
/**
 * Bulk member import wizard.
 *
 * See docs/backend-briefs/09-bulk-member-import-live.md for the API contract.
 * Preview + commit hit the real CRM API endpoints on the club the caller has
 * owner/admin access to (auth.user.clubs[0]).
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import {
  memberImports,
  ApiError,
  type PreviewResult,
  type PreviewRow,
  type CommitResult,
  type NewUserStrategy,
  type ImportResolution,
  type PreviewRowInput,
} from '@torny/api-client'

const router = useRouter()
const toast = useToast()
const auth = useAuthStore()

// Resolve club to import into. MVP: first owner/admin club the user has.
const targetClubId = computed<number | null>(() => {
  const club = auth.user?.clubs?.find((c) => c.role === 'owner' || c.role === 'admin')
  return club?.id ?? null
})
const targetClubName = computed<string>(() => {
  const club = auth.user?.clubs?.find((c) => c.role === 'owner' || c.role === 'admin')
  return club?.name ?? 'your club'
})

type WizardStep = 1 | 2 | 3 | 4 | 5
type TornyField = 'email' | 'phone' | 'firstName' | 'lastName' | 'dob' | 'membershipType'

interface ParsedRow {
  rowNumber: number
  values: string[]
}

// ── State ─────────────────────────────────────────────────────
const step = ref<WizardStep>(1)
const rawCsv = ref('')
const parsedHeaders = ref<string[]>([])
const parsedRows = ref<ParsedRow[]>([])
const parseError = ref<string | null>(null)

const MAPPING_STORAGE_KEY = 'torny.import.mapping'
const columnMapping = ref<Record<TornyField, number | null>>({
  email: null,
  phone: null,
  firstName: null,
  lastName: null,
  dob: null,
  membershipType: null,
})

const newUserStrategy = ref<NewUserStrategy>('invite')
const previewLoading = ref(false)
const previewData = ref<PreviewResult | null>(null)
const previewError = ref<string | null>(null)
const excludedRowNumbers = ref<Set<number>>(new Set())

const committing = ref(false)
const commitError = ref<string | null>(null)
const commitResult = ref<CommitResult | null>(null)

// ── CSV parsing ────────────────────────────────────────────────
function parseCsvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        out.push(cur.trim())
        cur = ''
      } else {
        cur += c
      }
    }
  }
  out.push(cur.trim())
  return out
}

function parseCsv(text: string) {
  parseError.value = null
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    parseError.value = 'CSV needs at least a header row and one data row.'
    parsedHeaders.value = []
    parsedRows.value = []
    return
  }
  const headers = parseCsvRow(lines[0]!)
  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    rows.push({ rowNumber: i + 1, values: parseCsvRow(lines[i]!) })
  }
  parsedHeaders.value = headers
  parsedRows.value = rows
  autoMap(headers)
}

function autoMap(headers: string[]) {
  const lower = headers.map((h) => h.toLowerCase())
  function find(patterns: string[]): number | null {
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i]!
      if (patterns.some((p) => h.includes(p))) return i
    }
    return null
  }
  columnMapping.value = {
    email:          find(['e-mail', 'email']),
    phone:          find(['phone', 'mobile', 'cell']),
    firstName:      find(['first name', 'firstname', 'first_name', 'given', 'fname']),
    lastName:       find(['last name', 'lastname', 'last_name', 'surname', 'family', 'lname']),
    dob:            find(['dob', 'birth', 'date of birth']),
    membershipType: find(['membership', 'member type', 'type', 'category']),
  }
}

function handlePasteChange(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value
  rawCsv.value = value
  if (value.trim()) parseCsv(value)
}

function handleFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    rawCsv.value = text
    parseCsv(text)
  }
  reader.readAsText(file)
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = reader.result as string
    rawCsv.value = text
    parseCsv(text)
  }
  reader.readAsText(file)
}

function loadSample() {
  const sample = [
    'First Name,Last Name,Email,Phone,DOB,Membership',
    'Aroha,Ngata,aroha@example.com,+64211234567,1992-03-14,Playing member',
    'Sam,Harding,sam.h@example.com,+64221111222,1985-07-30,Playing member',
    'Priya,Kaur,priya.kaur@example.com,+64275550303,1988-12-08,Social',
    'Ollie,Fraser,ollie.f@example.com,+64211119999,2012-08-03,Junior',
    'Rachel,Beale,rachel.b@example.com,+64221112222,1978-09-22,Social',
    'Toby,Vercoe,toby.v@example.com,+64275550808,1994-05-17,Playing member',
    'Nikhil,Reddy,nikhil@example.com,,,Playing member',
    'Maria,Costa,,not-a-real-phone,1990-01-01,Social',
    'Ana,Kereopa,ana@example.com,+64211119999,2011-04-11,Junior',
    'Sione,Vagana,sione@example.com,+64275550707,1972-01-30,Social',
  ].join('\n')
  rawCsv.value = sample
  parseCsv(sample)
}

// ── Step transitions ──────────────────────────────────────────
const hasParsedContent = computed(() => parsedRows.value.length > 0 && !parseError.value)
const requiredFieldsMapped = computed(
  () =>
    columnMapping.value.firstName !== null &&
    columnMapping.value.lastName !== null &&
    (columnMapping.value.email !== null || columnMapping.value.phone !== null),
)

function goToMapping() {
  if (!hasParsedContent.value) return
  step.value = 2
}
function goToStrategy() {
  if (!requiredFieldsMapped.value) return
  step.value = 3
}
async function goToPreview() {
  step.value = 4
  await runPreview()
}
function goBack(target: WizardStep) {
  step.value = target
}

// ── Row mapping ────────────────────────────────────────────────
function getMappedForApi(): PreviewRowInput[] {
  const m = columnMapping.value
  return parsedRows.value.map((r) => {
    const row: PreviewRowInput = { rowNumber: r.rowNumber }
    if (m.email !== null && r.values[m.email]) row.email = r.values[m.email]
    if (m.phone !== null && r.values[m.phone]) row.phone = r.values[m.phone]
    if (m.firstName !== null && r.values[m.firstName]) row.firstName = r.values[m.firstName]
    if (m.lastName !== null && r.values[m.lastName]) row.lastName = r.values[m.lastName]
    if (m.dob !== null && r.values[m.dob]) row.dob = r.values[m.dob]
    if (m.membershipType !== null && r.values[m.membershipType]) row.membershipType = r.values[m.membershipType]
    return row
  })
}

// ── Preview — real API ────────────────────────────────────────
async function runPreview() {
  if (!targetClubId.value) {
    previewError.value = "You don't have a club to import members into yet. Approve a claim first."
    previewLoading.value = false
    return
  }
  previewLoading.value = true
  previewData.value = null
  previewError.value = null
  excludedRowNumbers.value = new Set()

  try {
    const result = await memberImports.preview(targetClubId.value, {
      rows: getMappedForApi(),
      newUserStrategy: newUserStrategy.value,
    })
    previewData.value = result
  } catch (err) {
    previewError.value = previewErrorCopy(err)
  } finally {
    previewLoading.value = false
  }
}

function previewErrorCopy(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You don't have permission to import members into this club — admin or owner only."
    if (err.status === 400) return err.message || 'The CSV rows were rejected — check your data and try again.'
    return err.message
  }
  return (err as Error).message
}

function toggleExclude(rowNumber: number) {
  if (excludedRowNumbers.value.has(rowNumber)) {
    excludedRowNumbers.value.delete(rowNumber)
  } else {
    excludedRowNumbers.value.add(rowNumber)
  }
  // trigger reactivity on Set
  excludedRowNumbers.value = new Set(excludedRowNumbers.value)
}

const includedRows = computed(
  () => previewData.value?.rows.filter((r) => !excludedRowNumbers.value.has(r.rowNumber)) ?? [],
)

const excludedCount = computed(() => excludedRowNumbers.value.size)

// ── Commit — real API ─────────────────────────────────────────
async function commit() {
  if (!previewData.value || !targetClubId.value) return
  committing.value = true
  commitError.value = null

  // If the owner excluded rows, we need a fresh preview without them — commit
  // takes the whole importId's rows. Rebuild the preview minus excluded rows.
  if (excludedRowNumbers.value.size > 0) {
    try {
      const filtered = getMappedForApi().filter((r) => !excludedRowNumbers.value.has(r.rowNumber))
      const fresh = await memberImports.preview(targetClubId.value, {
        rows: filtered,
        newUserStrategy: newUserStrategy.value,
      })
      previewData.value = fresh
    } catch (err) {
      commitError.value = previewErrorCopy(err)
      committing.value = false
      return
    }
  }

  try {
    const result = await memberImports.commit(targetClubId.value, previewData.value.importId)
    commitResult.value = result
    step.value = 5
    const totalAdded =
      result.actualCounts.linked +
      result.actualCounts.relinked +
      result.actualCounts.invited +
      result.actualCounts.stubCreated
    if (result.replayed) {
      toast.info('This import was already applied.')
    } else {
      toast.success(`Imported ${totalAdded} member${totalAdded === 1 ? '' : 's'}.`)
    }
    if (result.actualCounts.failed > 0) {
      toast.error(`${result.actualCounts.failed} row${result.actualCounts.failed === 1 ? '' : 's'} failed — see details below.`)
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 410) {
        commitError.value = "This import has expired (1 hour limit). Upload your CSV again."
      } else if (err.status === 404) {
        commitError.value = 'This import no longer exists. Upload your CSV again.'
      } else {
        commitError.value = err.message
      }
    } else {
      commitError.value = (err as Error).message
    }
  } finally {
    committing.value = false
  }
}

function startOver() {
  step.value = 1
  rawCsv.value = ''
  parsedHeaders.value = []
  parsedRows.value = []
  parseError.value = null
  previewData.value = null
  previewError.value = null
  commitResult.value = null
  commitError.value = null
  excludedRowNumbers.value = new Set()
  columnMapping.value = { email: null, phone: null, firstName: null, lastName: null, dob: null, membershipType: null }
}

function backToMembers() {
  router.push('/crm/members')
}

// ── Field labels ─────────────────────────────────────────────
const tornyFields: { key: TornyField; label: string; required: boolean; hint?: string }[] = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName',  label: 'Last name',  required: true },
  { key: 'email',     label: 'Email',      required: false, hint: 'Email or phone required for matching' },
  { key: 'phone',     label: 'Phone',      required: false, hint: 'Email or phone required for matching' },
  { key: 'dob',       label: 'Date of birth', required: false },
  { key: 'membershipType', label: 'Membership type', required: false },
]

const resolutionMeta: Record<ImportResolution, { label: string; tone: string; hint: string }> = {
  linked:       { label: 'Link',        tone: 'ok',     hint: 'Existing Torny user, will be added to this club' },
  relinked:     { label: 'Re-link',     tone: 'ok',     hint: 'Was in this club before, will re-activate' },
  skipped:      { label: 'Skip',        tone: 'mute',   hint: 'Already a member of this club' },
  invited:      { label: 'Invite',      tone: 'accent', hint: 'New to Torny, will email an invite' },
  stub_created: { label: 'Add',         tone: 'accent', hint: 'New to Torny, no invite sent' },
  error:        { label: 'Error',       tone: 'danger', hint: '' },
}

const stepMeta: Record<WizardStep, { label: string }> = {
  1: { label: 'Upload' },
  2: { label: 'Map columns' },
  3: { label: 'Strategy' },
  4: { label: 'Preview' },
  5: { label: 'Done' },
}
</script>

<template>
  <div class="import">
    <header class="import__header">
      <div>
        <div class="import__eyebrow">Roster · Bulk import</div>
        <h1 class="import__heading">Import members from a CSV</h1>
        <p class="import__sub">Drop your spreadsheet — we'll match against existing Torny users where we can, and invite the rest.</p>
      </div>
      <button class="btn btn--ghost" @click="backToMembers">← Back to members</button>
    </header>

    <!-- Stepper -->
    <ol class="steps">
      <li v-for="(meta, key) in stepMeta" :key="key" class="steps__step" :class="{ 'is-active': step === Number(key), 'is-done': step > Number(key) }">
        <span class="steps__num">
          <svg v-if="step > Number(key)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M20 6 9 17l-5-5" /></svg>
          <span v-else>{{ key }}</span>
        </span>
        <span class="steps__label">{{ meta.label }}</span>
      </li>
    </ol>

    <!-- ═══════════ STEP 1: Upload ═══════════ -->
    <section v-if="step === 1" class="card">
      <div class="card__eyebrow">Step 1</div>
      <h2 class="card__title">Upload your CSV</h2>
      <p class="card__sub">Drop a file, paste rows below, or start with our sample to see the shape we expect.</p>

      <div class="upload" @dragover.prevent @drop="handleDrop">
        <input id="csv-file" type="file" accept=".csv,text/csv,text/plain" class="upload__input" @change="handleFileUpload" />
        <label for="csv-file" class="upload__label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div class="upload__title">Drop a CSV file here</div>
          <div class="upload__hint">or <span class="upload__link">choose a file</span></div>
        </label>
      </div>

      <div class="or">or paste rows</div>

      <textarea
        class="paste"
        rows="6"
        placeholder="First Name, Last Name, Email, Phone, DOB, Membership&#10;Aroha, Ngata, aroha@example.com, +64211234567, 1992-03-14, Playing member"
        :value="rawCsv"
        @input="handlePasteChange"
      />

      <div v-if="parseError" class="alert">{{ parseError }}</div>
      <div v-else-if="hasParsedContent" class="parsed-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5" /></svg>
        Detected {{ parsedRows.length }} rows across {{ parsedHeaders.length }} columns.
      </div>

      <div class="foot">
        <button class="btn btn--ghost" @click="loadSample">Load sample CSV</button>
        <button class="btn btn--primary" :disabled="!hasParsedContent" @click="goToMapping">
          Continue
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>
    </section>

    <!-- ═══════════ STEP 2: Map columns ═══════════ -->
    <section v-else-if="step === 2" class="card">
      <div class="card__eyebrow">Step 2</div>
      <h2 class="card__title">Map your columns</h2>
      <p class="card__sub">Match your CSV columns to Torny fields. We've auto-mapped what we could — check they look right.</p>

      <ul class="mapping">
        <li v-for="f in tornyFields" :key="f.key" class="mapping__row">
          <div class="mapping__field">
            <div class="mapping__label">
              {{ f.label }}
              <span v-if="f.required" class="mapping__required">*</span>
            </div>
            <div v-if="f.hint" class="mapping__hint">{{ f.hint }}</div>
          </div>
          <div class="mapping__arrow">→</div>
          <select v-model.number="columnMapping[f.key]" class="mapping__select">
            <option :value="null">Don't import</option>
            <option v-for="(header, i) in parsedHeaders" :key="i" :value="i">{{ header }}</option>
          </select>
        </li>
      </ul>

      <div v-if="parsedRows.length > 0" class="preview-mini">
        <div class="preview-mini__label">First 3 rows preview</div>
        <table class="preview-mini__table">
          <thead>
            <tr>
              <th v-for="f in tornyFields" :key="f.key">{{ f.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in parsedRows.slice(0, 3)" :key="r.rowNumber">
              <td v-for="f in tornyFields" :key="f.key" :class="{ 'preview-mini__unmapped': columnMapping[f.key] === null }">
                {{ columnMapping[f.key] !== null ? r.values[columnMapping[f.key]!] : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!requiredFieldsMapped" class="alert alert--warn">
        Map first name, last name, and at least one of email or phone before continuing.
      </div>

      <div class="foot">
        <button class="btn btn--ghost" @click="goBack(1)">← Back</button>
        <button class="btn btn--primary" :disabled="!requiredFieldsMapped" @click="goToStrategy">
          Continue
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>
    </section>

    <!-- ═══════════ STEP 3: Strategy ═══════════ -->
    <section v-else-if="step === 3" class="card">
      <div class="card__eyebrow">Step 3</div>
      <h2 class="card__title">What about people not yet on Torny?</h2>
      <p class="card__sub">Members who match existing Torny users get linked automatically. For the rest, pick how to bring them on.</p>

      <div class="strategy">
        <label class="strategy__option" :class="{ 'is-selected': newUserStrategy === 'invite' }">
          <input type="radio" v-model="newUserStrategy" value="invite" />
          <div class="strategy__body">
            <div class="strategy__title">Invite them by email</div>
            <p class="strategy__desc">Each new member gets an email invite to sign up. Once they accept, their profile is linked to your club. <strong>Recommended.</strong></p>
          </div>
          <div class="strategy__check">
            <svg v-if="newUserStrategy === 'invite'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
        </label>

        <label class="strategy__option" :class="{ 'is-selected': newUserStrategy === 'stub' }">
          <input type="radio" v-model="newUserStrategy" value="stub" />
          <div class="strategy__body">
            <div class="strategy__title">Add without invite</div>
            <p class="strategy__desc">Create member records now, invite them later yourself. Useful if you'll message them separately about the switch to Torny.</p>
          </div>
          <div class="strategy__check">
            <svg v-if="newUserStrategy === 'stub'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
        </label>
      </div>

      <div class="foot">
        <button class="btn btn--ghost" @click="goBack(2)">← Back</button>
        <button class="btn btn--primary" @click="goToPreview">
          Preview import
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>
    </section>

    <!-- ═══════════ STEP 4: Preview ═══════════ -->
    <section v-else-if="step === 4" class="card card--wide">
      <div class="card__eyebrow">Step 4</div>
      <h2 class="card__title">Review before you commit</h2>
      <p class="card__sub">This is what we'll do for each row. Untick any you want to skip.</p>

      <div v-if="previewLoading" class="loading">
        <div class="loading__spinner" />
        <div>Analysing {{ parsedRows.length }} rows…</div>
      </div>

      <div v-else-if="previewError" class="alert">
        {{ previewError }}
        <button class="alert__retry" @click="runPreview">Retry</button>
      </div>

      <template v-else-if="previewData">
        <div v-if="commitError" class="alert">{{ commitError }}</div>
        <div class="summary">
          <div class="summary__stat"><div class="summary__value">{{ previewData.summary.totalRows }}</div><div class="summary__label">Total rows</div></div>
          <div class="summary__stat summary__stat--ok"><div class="summary__value">{{ previewData.summary.willLink + previewData.summary.willRelink }}</div><div class="summary__label">Linked</div></div>
          <div class="summary__stat summary__stat--accent"><div class="summary__value">{{ previewData.summary.willInvite + previewData.summary.willStub }}</div><div class="summary__label">{{ newUserStrategy === 'invite' ? 'Invited' : 'Added' }}</div></div>
          <div class="summary__stat summary__stat--mute"><div class="summary__value">{{ previewData.summary.willSkip }}</div><div class="summary__label">Skipped</div></div>
          <div class="summary__stat" :class="{ 'summary__stat--danger': previewData.summary.errors > 0 }"><div class="summary__value">{{ previewData.summary.errors }}</div><div class="summary__label">Errors</div></div>
        </div>

        <table class="preview">
          <thead>
            <tr>
              <th class="preview__include"><span aria-label="Include">✓</span></th>
              <th>Row</th>
              <th>Name</th>
              <th>Email</th>
              <th>Action</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in previewData.rows"
              :key="r.rowNumber"
              :class="{ 'preview__row--excluded': excludedRowNumbers.has(r.rowNumber), 'preview__row--error': r.resolution === 'error' }"
            >
              <td class="preview__include">
                <input
                  type="checkbox"
                  :checked="!excludedRowNumbers.has(r.rowNumber)"
                  :disabled="r.resolution === 'error'"
                  @change="toggleExclude(r.rowNumber)"
                />
              </td>
              <td class="preview__num">{{ r.rowNumber }}</td>
              <td>
                <div class="preview__name">{{ r.displayName || '—' }}</div>
                <div v-if="r.existingName && r.existingName !== r.displayName" class="preview__matched">
                  → linked to <strong>{{ r.existingName }}</strong>
                </div>
              </td>
              <td class="preview__email">{{ r.email || '—' }}</td>
              <td>
                <div class="preview__resolution">
                  <span class="pill" :class="`pill--${resolutionMeta[r.resolution].tone}`">{{ resolutionMeta[r.resolution].label }}</span>
                  <span v-if="r.phoneMismatch" class="chip chip--warn">phone drift</span>
                  <span v-if="r.emailMismatch" class="chip chip--warn">email drift</span>
                </div>
              </td>
              <td class="preview__note">
                <template v-if="r.error">
                  <span>{{ r.error.message }}</span>
                  <div v-if="r.error.candidates?.length" class="candidates">
                    <div v-for="c in r.error.candidates" :key="c.userId" class="candidate">
                      <span class="candidate__name">{{ c.name }}</span>
                      <span class="candidate__via">matched by {{ c.matchedVia }}</span>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <span>{{ resolutionMeta[r.resolution].hint }}</span>
                  <div v-if="r.warnings?.length" class="warnings">
                    <span v-for="w in r.warnings" :key="w.code" class="chip chip--mute">{{ w.message }}</span>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="commit-summary">
          <div>
            You're about to import <strong>{{ includedRows.filter(r => r.resolution !== 'error').length }}</strong>
            {{ includedRows.filter(r => r.resolution !== 'error').length === 1 ? 'member' : 'members' }}
            into <strong>{{ targetClubName }}</strong>.
          </div>
          <div v-if="excludedCount > 0" class="commit-summary__note">
            {{ excludedCount }} excluded — we'll re-run preview on commit so only your selected rows apply.
          </div>
        </div>
      </template>

      <div class="foot">
        <button class="btn btn--ghost" @click="goBack(3)" :disabled="committing">← Back</button>
        <button class="btn btn--primary" :disabled="!previewData || committing" @click="commit">
          {{ committing ? 'Importing…' : 'Confirm & import' }}
          <svg v-if="!committing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      </div>
    </section>

    <!-- ═══════════ STEP 5: Success ═══════════ -->
    <section v-else-if="step === 5 && commitResult" class="card">
      <div class="done">
        <div class="done__badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <h2 class="done__title">
          {{ commitResult.actualCounts.linked + commitResult.actualCounts.relinked + commitResult.actualCounts.invited + commitResult.actualCounts.stubCreated }} members imported.
        </h2>
        <p class="done__sub">
          <template v-if="commitResult.replayed">This import had already been applied — no duplicates were created.</template>
          <template v-else-if="commitResult.actualCounts.failed > 0">
            {{ commitResult.actualCounts.failed }} row{{ commitResult.actualCounts.failed === 1 ? '' : 's' }} failed — see details below.
          </template>
          <template v-else>Your roster is up to date.</template>
        </p>
      </div>

      <div class="done-stats">
        <div class="done-stat"><div class="done-stat__value">{{ commitResult.actualCounts.linked + commitResult.actualCounts.relinked }}</div><div class="done-stat__label">Linked from Torny</div></div>
        <div class="done-stat"><div class="done-stat__value">{{ commitResult.actualCounts.invited }}</div><div class="done-stat__label">Invites emailed</div></div>
        <div class="done-stat"><div class="done-stat__value">{{ commitResult.actualCounts.stubCreated }}</div><div class="done-stat__label">Added, no invite</div></div>
        <div class="done-stat"><div class="done-stat__value">{{ commitResult.notificationsFired.emailsSent }}</div><div class="done-stat__label">Emails sent</div></div>
      </div>

      <!-- Failed row breakdown (rare — race conditions, dupe emails, etc.) -->
      <div v-if="commitResult.actualCounts.failed > 0" class="failures">
        <div class="failures__title">Rows that didn't apply</div>
        <ul class="failures__list">
          <li v-for="r in commitResult.rows.filter(row => row.failed)" :key="r.rowNumber">
            <span class="failures__row">Row {{ r.rowNumber }}</span>
            <span class="failures__reason">{{ r.message ?? 'Failed to apply' }}</span>
          </li>
        </ul>
      </div>

      <div class="foot">
        <button class="btn btn--ghost" @click="startOver">Import another CSV</button>
        <button class="btn btn--primary" @click="backToMembers">View members →</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.import { max-width: 960px; display: flex; flex-direction: column; gap: 24px; }

.import__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.import__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.import__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.import__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover:not(:disabled) { background: var(--color-surface); }
.btn--ghost:disabled { opacity: 0.5; cursor: not-allowed; }

/* Stepper */
.steps { list-style: none; padding: 0; margin: 0; display: flex; align-items: center; gap: 8px; }
.steps__step { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.steps__step:not(:last-child)::after { content: ''; display: block; width: 32px; height: 0; border-top: 1px dashed var(--color-hairline); margin: 0 4px; }
.steps__num { width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid var(--color-hairline); background: #fff; color: var(--color-fog); font-family: var(--font-body); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.steps__step.is-active .steps__num { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.steps__step.is-active .steps__label { color: var(--color-ink); }
.steps__step.is-done .steps__num { background: var(--color-feature-mint); color: #fff; border-color: var(--color-feature-mint); }
.steps__step.is-done .steps__label { color: var(--color-ink); }

/* Card */
.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; padding: 32px; display: flex; flex-direction: column; gap: 16px; }
.card--wide { max-width: none; }
.card__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.card__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: -4px 0 0; }
.card__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.55; max-width: 640px; }

/* Upload */
.upload { position: relative; padding: 32px 24px; background: var(--color-surface); border: 2px dashed var(--color-hairline); border-radius: 14px; text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.upload:hover { border-color: var(--color-accent); background: var(--color-accent-soft); }
.upload__input { position: absolute; opacity: 0; width: 100%; height: 100%; top: 0; left: 0; cursor: pointer; }
.upload__label { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--color-graphite); cursor: pointer; }
.upload__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); margin-top: 4px; }
.upload__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.upload__link { color: var(--color-accent); font-weight: 600; }

.or { text-align: center; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); margin: 4px 0; }

.paste { width: 100%; padding: 14px; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--color-ink); background: #fff; resize: vertical; box-sizing: border-box; }
.paste:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.parsed-hint { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #DCFCE7; color: #14532D; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; align-self: flex-start; }

.alert { padding: 12px 14px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.alert--warn { background: #FEF3C7; color: #92400E; }
.alert__retry { padding: 6px 12px; background: #fff; color: #991B1B; border: 1px solid #FCA5A5; border-radius: 8px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.alert__retry:hover { background: #FEE2E2; }

/* Preview row extras */
.preview__name { font-weight: 500; }
.preview__matched { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.preview__matched strong { color: var(--color-ink); font-weight: 600; }
.preview__resolution { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
.chip--warn { background: #FEF3C7; color: #92400E; }
.chip--mute { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }

.candidates { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.candidate { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fff; border: 1px solid #FECACA; border-radius: 8px; font-size: 12px; }
.candidate__name { font-weight: 600; color: var(--color-ink); }
.candidate__via { color: var(--color-fog); font-size: 11px; }

.warnings { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }

.commit-summary__note { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 6px; font-style: italic; }

.failures { padding: 14px 16px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; margin-top: 4px; }
.failures__title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #991B1B; margin-bottom: 8px; }
.failures__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.failures__list li { display: flex; gap: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.failures__row { font-family: var(--font-mono); font-size: 11px; color: #991B1B; font-weight: 600; min-width: 60px; }
.failures__reason { color: var(--color-graphite); }

/* Mapping */
.mapping { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.mapping__row { display: grid; grid-template-columns: 1fr auto 1.2fr; align-items: center; gap: 14px; padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; }
.mapping__field { min-width: 0; }
.mapping__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.mapping__required { color: var(--color-danger); margin-left: 4px; }
.mapping__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.mapping__arrow { font-family: var(--font-body); font-size: 14px; color: var(--color-mute); }
.mapping__select { padding: 8px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.mapping__select:focus { outline: none; border-color: var(--color-accent); }

.preview-mini { margin-top: 12px; }
.preview-mini__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.preview-mini__table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; overflow: hidden; }
.preview-mini__table th { text-align: left; padding: 10px 12px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; color: var(--color-fog); text-transform: uppercase; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.preview-mini__table td { padding: 10px 12px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.preview-mini__table tbody tr:last-child td { border-bottom: none; }
.preview-mini__unmapped { color: var(--color-mute); font-style: italic; }

/* Strategy */
.strategy { display: flex; flex-direction: column; gap: 10px; }
.strategy__option { display: grid; grid-template-columns: 20px 1fr auto; gap: 14px; align-items: flex-start; padding: 16px 18px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; cursor: pointer; transition: border-color 0.12s ease; }
.strategy__option:hover { border-color: var(--color-mute); }
.strategy__option.is-selected { border-color: var(--color-ink); background: var(--color-surface); }
.strategy__option input[type="radio"] { margin-top: 3px; accent-color: var(--color-ink); }
.strategy__body { min-width: 0; }
.strategy__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.strategy__desc { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 4px 0 0; line-height: 1.55; }
.strategy__desc strong { color: var(--color-accent); font-weight: 700; }
.strategy__check { width: 22px; height: 22px; border-radius: 999px; background: transparent; color: var(--color-ink); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.strategy__option.is-selected .strategy__check { background: var(--color-ink); color: #fff; }

/* Preview step */
.summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.summary__stat { background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px 16px; }
.summary__stat--ok { background: #F0FDF4; border-color: #BBF7D0; }
.summary__stat--ok .summary__value { color: #14532D; }
.summary__stat--accent { background: var(--color-accent-soft); border-color: #BFDBFE; }
.summary__stat--accent .summary__value { color: var(--color-accent); }
.summary__stat--mute { background: var(--color-surface); }
.summary__stat--danger { background: #FEF2F2; border-color: #FECACA; }
.summary__stat--danger .summary__value { color: #991B1B; }
.summary__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); line-height: 1.15; }
.summary__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; margin-top: 4px; }

.preview { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; overflow: hidden; }
.preview th { text-align: left; padding: 10px 12px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; color: var(--color-fog); text-transform: uppercase; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.preview td { padding: 10px 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.preview tbody tr:last-child td { border-bottom: none; }
.preview__include { width: 40px; text-align: center; }
.preview__include input[type="checkbox"] { accent-color: var(--color-ink); width: 15px; height: 15px; }
.preview__num { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); width: 40px; }
.preview__email { font-family: var(--font-mono); font-size: 12px; color: var(--color-graphite); }
.preview__note { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.preview__row--excluded td { opacity: 0.4; }
.preview__row--error td { background: #FEF2F2; }
.preview__row--error .preview__note { color: #991B1B; font-weight: 500; }

.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.pill--ok       { background: #DCFCE7; color: #14532D; }
.pill--accent   { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--mute     { background: var(--color-surface); color: var(--color-fog); border: 1px solid var(--color-hairline); }
.pill--danger   { background: #FEE2E2; color: #991B1B; }

.commit-summary { padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; }
.commit-summary strong { color: var(--color-ink); font-weight: 700; }

/* Loading */
.loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.loading__spinner { width: 32px; height: 32px; border: 3px solid var(--color-hairline); border-top-color: var(--color-accent); border-radius: 999px; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Success step */
.done { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 4px 0 12px; }
.done__badge { width: 56px; height: 56px; border-radius: 999px; background: var(--color-feature-mint); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.done__title { font-family: var(--font-display); font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 4px 0 0; }
.done__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.done-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.done-stat { background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; padding: 14px 16px; }
.done-stat__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); }
.done-stat__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; margin-top: 4px; }

.foot { display: flex; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--color-hairline); margin-top: 8px; }

@media (max-width: 900px) {
  .summary { grid-template-columns: repeat(3, 1fr); }
  .done-stats { grid-template-columns: repeat(2, 1fr); }
  .card { padding: 24px 20px; }
  .steps__step:not(:last-child)::after { width: 16px; }
  .steps__label { display: none; }
  .steps__step.is-active .steps__label { display: inline; }
  .mapping__row { grid-template-columns: 1fr; }
  .mapping__arrow { display: none; }
  .preview-mini__table { font-size: 11px; }
  .preview { display: block; overflow-x: auto; }
}
</style>
