<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { directory, claims as claimsApi, ApiError, type DirectoryClub, type MyClaim } from '@torny/api-client'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const router = useRouter()
const auth = useAuthStore()
const club = useClubStore()

type Step = 1 | 2 | 3

const step = ref<Step>(1)
const query = ref('')
const results = ref<DirectoryClub[]>([])
const searchType = ref<'exact' | 'fuzzy'>('exact')
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const hasSearched = ref(false)

const selected = ref<DirectoryClub | null>(null)
const roleAtClub = ref('')
const evidence = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)
const pending = ref<MyClaim | null>(null)
const loadingMine = ref(true)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let abortCtrl: AbortController | null = null

const canSearch = computed(() => query.value.trim().length >= 2)
const canSubmitEvidence = computed(
  () => roleAtClub.value.trim().length > 0 && evidence.value.trim().length >= 20,
)

watch(query, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (abortCtrl) abortCtrl.abort()
  if (q.trim().length < 2) {
    results.value = []
    searchError.value = null
    hasSearched.value = false
    return
  }
  debounceTimer = setTimeout(runSearch, 250)
})

async function runSearch() {
  abortCtrl = new AbortController()
  isSearching.value = true
  searchError.value = null
  try {
    const result = await directory.searchClubsSmart(query.value.trim(), {
      sport: 1,
      signal: abortCtrl.signal,
    })
    results.value = result.clubs
    searchType.value = result.searchType
    hasSearched.value = true
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    searchError.value = (err as Error).message
    results.value = []
  } finally {
    isSearching.value = false
  }
}

function goToEvidence() {
  if (!selected.value) return
  step.value = 2
}

function goBackToSearch() {
  step.value = 1
}

async function submitClaim(e: Event) {
  e.preventDefault()
  if (!selected.value || !canSubmitEvidence.value) return
  submitting.value = true
  submitError.value = null
  try {
    const submitted = await claimsApi.submit({
      directoryClubId: selected.value.club_id,
      role: roleAtClub.value.trim(),
      evidence: evidence.value.trim(),
    })
    // Populate the pending-review view from the response + selected club data,
    // then let onMounted-style refresh happen on next visit via /claims/mine.
    pending.value = {
      id: submitted.id,
      directoryClubId: submitted.directoryClubId,
      clubName: selected.value.name,
      region: [selected.value.region, selected.value.state].filter(Boolean).join(', ') || 'Region unknown',
      sport: 'bowls',
      role: roleAtClub.value.trim(),
      status: 'pending',
      submittedAt: submitted.submittedAt,
      decidedAt: null,
      rejectionReason: null,
      rejectionCode: null,
    }
    step.value = 3
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = submitErrorCopy(err)
    } else {
      submitError.value = (err as Error).message
    }
  } finally {
    submitting.value = false
  }
}

function submitErrorCopy(err: ApiError): string {
  switch (err.code) {
    case 'claim_pending_exists':
      return "You've already got a pending claim for this club — check your existing claim below."
    case 'club_already_claimed':
      return 'Someone else has already claimed this club. If that\'s a mistake, get in touch with hello@torny.club.'
    case 'unknown_club':
      return "That club isn't in the Torny directory. Try another search."
    case 'evidence_too_short':
      return 'Give us a bit more evidence — at least 20 characters.'
    case 'evidence_too_long':
      return 'Trim the evidence down — keep it under 2000 characters.'
    case 'role_too_long':
      return 'Keep your role short (under 120 characters).'
    case 'rate_limited':
      return "You've submitted too many claims in the last hour. Give it a minute."
    default:
      return err.message
  }
}

function submitAnother() {
  pending.value = null
  selected.value = null
  roleAtClub.value = ''
  evidence.value = ''
  query.value = ''
  results.value = []
  hasSearched.value = false
  submitError.value = null
  step.value = 1
}

function formatSubmittedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function daysWaiting(iso: string): number {
  const d = new Date(iso).getTime()
  return Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24))
}

function waitingLabel(iso: string): string {
  const days = daysWaiting(iso)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

onMounted(async () => {
  loadingMine.value = true
  try {
    const rows = await claimsApi.mine()
    // Seamless-landing case: a first-time claimant returning after their
    // claim was approved. We refresh the session and push them into the CRM.
    // Skip when they already have club access — that means they clicked
    // "Claim another club" from inside the CRM sidebar and want to file a
    // fresh claim, not get bounced back to the dashboard they came from.
    const hasExistingAccess = (auth.user?.clubs ?? []).length > 0
    const approved = rows.find((c) => c.status === 'approved')
    if (approved && !hasExistingAccess) {
      await auth.refresh()
      club.syncFromUserClubs(auth.user?.clubs)
      router.replace('/crm/dashboard')
      return
    }
    // Pending claim → jump to step 3. Otherwise stay on step 1 (user may want
    // to submit a fresh claim after a rejection).
    const p = rows.find((c) => c.status === 'pending')
    if (p) {
      pending.value = p
      step.value = 3
    }
  } catch (err) {
    // 401 means the guard failed; router already handles it. Anything else,
    // proceed with the empty wizard — user can still try to submit.
    if (!(err instanceof ApiError) || err.status !== 401) {
      console.error('Failed to load /claims/mine', err)
    }
  } finally {
    loadingMine.value = false
  }
})

function initials(club: DirectoryClub) {
  return club.name.split(/\s+/).map(w => w[0]).slice(0, 3).join('').toUpperCase()
}

function location(club: DirectoryClub): string {
  return [club.address, club.region, club.state].filter(Boolean).join(', ')
}

// Colour bucket per club — hashed from club_id so each row has a stable colour.
const avatarPalette = [
  'var(--color-accent)',
  'var(--color-feature-mint)',
  'var(--color-feature-tangerine)',
  'var(--color-feature-violet)',
  'var(--color-graphite)',
]
function avatarColour(club: DirectoryClub): string {
  const i = Math.abs(club.club_id) % avatarPalette.length
  return avatarPalette[i]!
}

function foundedYear(club: DirectoryClub): string | null {
  const match = (club.description ?? '').match(/(?:est(?:ablished)?\.?\s+)(\d{4})/i)
  if (match) return match[1]!
  if (club.created) return new Date(club.created).getFullYear().toString()
  return null
}

const stepMeta: Record<Step, { label: string; sublabel: string }> = {
  1: { label: 'Find your club', sublabel: 'Which club are you claiming?' },
  2: { label: 'Upload evidence', sublabel: 'Prove you should own this club.' },
  3: { label: 'Await review', sublabel: "We'll be in touch by email." },
}

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (abortCtrl) abortCtrl.abort()
})
</script>

<template>
  <div class="claim">
    <div class="claim__inner">
      <!-- Wizard steps -->
      <ol class="steps">
        <li class="step" :class="{ 'is-active': step === 1, 'is-done': step > 1 }">
          <span class="step__circle">
            <svg v-if="step > 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M20 6 9 17l-5-5" /></svg>
            <span v-else>1</span>
          </span>
          <span class="step__label">Find your club</span>
        </li>
        <li class="step" :class="{ 'is-active': step === 2, 'is-done': step > 2 }">
          <span class="step__circle">
            <svg v-if="step > 2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M20 6 9 17l-5-5" /></svg>
            <span v-else>2</span>
          </span>
          <span class="step__label">Upload evidence</span>
        </li>
        <li class="step" :class="{ 'is-active': step === 3 }">
          <span class="step__circle"><span>3</span></span>
          <span class="step__label">Await review</span>
        </li>
      </ol>

      <!-- STEP 1: Search + Select -->
      <template v-if="step === 1">
        <div class="head">
          <div class="head__eyebrow">Claim a club · Step 1</div>
          <h1 class="head__heading">{{ stepMeta[1].sublabel }}</h1>
          <p class="head__sub">
            Search the Torny directory — 142 clubs seeded from Bowls NZ and district records.
            If yours isn't here, we'll add it for you.
          </p>
        </div>

        <div class="search">
          <svg class="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            v-model="query"
            class="search__input"
            placeholder="Start typing your club name…"
            autocomplete="off"
            autofocus
          />
          <span v-if="isSearching" class="search__spinner" aria-label="Searching" />
          <span v-else-if="results.length" class="search__pill">
            {{ results.length }} {{ results.length === 1 ? 'match' : 'matches' }}
          </span>
        </div>

        <div v-if="searchError" class="alert">{{ searchError }}</div>

        <div v-if="canSearch && hasSearched" class="results">
          <div v-if="searchType === 'fuzzy' && results.length" class="results__label">
            No exact match — did you mean…?
          </div>

          <ul v-if="results.length" class="results__list">
            <li
              v-for="club in results"
              :key="club.club_id"
              class="club"
              :class="{ 'is-selected': selected?.club_id === club.club_id }"
              @click="selected = club"
            >
              <div class="club__avatar" :style="{ background: avatarColour(club) }">
                <span>{{ initials(club) }}</span>
              </div>
              <div class="club__body">
                <div class="club__name">{{ club.name }}</div>
                <div class="club__meta">
                  <span v-if="location(club)">{{ location(club) }}</span>
                  <span v-if="foundedYear(club)" class="club__sep">·</span>
                  <span v-if="foundedYear(club)">Est. {{ foundedYear(club) }}</span>
                  <span v-if="club.similarity_score !== undefined" class="club__sep">·</span>
                  <span v-if="club.similarity_score !== undefined" class="club__score">{{ club.similarity_score }}% match</span>
                </div>
              </div>
              <div class="radio" :class="{ 'is-on': selected?.club_id === club.club_id }">
                <span v-if="selected?.club_id === club.club_id" class="radio__label">Selected</span>
                <span class="radio__dot" />
              </div>
            </li>
          </ul>

          <div v-else class="empty">
            <div class="empty__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
              </svg>
            </div>
            <div class="empty__body">
              <div class="empty__heading">No clubs matched "{{ query }}"</div>
              <p class="empty__text">
                Register a new club — we'll verify it against Bowls NZ and add it to the directory within one working day.
              </p>
            </div>
            <a href="mailto:hello@torny.club?subject=Register new club" class="empty__cta">
              Register new club
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </a>
          </div>
        </div>

        <div v-if="hasSearched && results.length" class="add-cta">
          <div class="add-cta__icon">+</div>
          <div class="add-cta__body">
            <div class="add-cta__heading">Can't find your club?</div>
            <p class="add-cta__text">Register a new club — we'll verify it against Bowls NZ and add it to the directory within one working day.</p>
          </div>
          <a href="mailto:hello@torny.club?subject=Register new club" class="add-cta__btn">
            Register new club
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </a>
        </div>

        <div class="foot">
          <p class="foot__terms">
            By claiming a club you agree to Torny's admin terms. A Torny admin will verify your role in one working day.
          </p>
          <button class="foot__cta" :disabled="!selected" @click="goToEvidence">
            <span>Continue{{ selected ? ` with ${selected.name}` : '' }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </button>
        </div>
      </template>

      <!-- STEP 2: Evidence -->
      <form v-else-if="step === 2 && selected" class="evidence" @submit="submitClaim">
        <div class="head">
          <div class="head__eyebrow">Claim a club · Step 2</div>
          <h1 class="head__heading">{{ stepMeta[2].sublabel }}</h1>
          <p class="head__sub">A Torny admin reviews every claim — usually within a working day.</p>
        </div>

        <div class="picked">
          <div class="club__avatar club__avatar--lg" :style="{ background: avatarColour(selected) }">
            <span>{{ initials(selected) }}</span>
          </div>
          <div class="picked__body">
            <div class="picked__name">{{ selected.name }}</div>
            <div class="picked__meta">{{ location(selected) || 'Location unknown' }}</div>
          </div>
          <button type="button" class="picked__change" @click="goBackToSearch">Change club</button>
        </div>

        <label class="field">
          <span class="field__label">Your role at the club</span>
          <input
            v-model="roleAtClub"
            type="text"
            required
            placeholder="e.g. Secretary, President, Club Manager"
            class="field__input"
          />
          <span class="field__hint">Whatever committee position or admin title fits — free text.</span>
        </label>

        <label class="field">
          <span class="field__label">Why should we assign this club to you?</span>
          <textarea
            v-model="evidence"
            rows="5"
            required
            placeholder="e.g. I'm the current secretary of Naenae Bowling. Committee minutes attached below."
            class="field__textarea"
          />
          <span class="field__hint">Min 20 characters. Include how long you've been at the club and any evidence links (Google Drive, meeting minutes, etc.).</span>
        </label>

        <div v-if="submitError" class="alert">{{ submitError }}</div>

        <div class="foot">
          <button type="button" class="foot__ghost" @click="goBackToSearch">Back</button>
          <button type="submit" class="foot__cta" :disabled="submitting || !canSubmitEvidence">
            <span>{{ submitting ? 'Submitting…' : 'Submit claim for review' }}</span>
            <svg v-if="!submitting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </button>
        </div>
      </form>

      <!-- STEP 3: Submitted / pending review -->
      <div v-else-if="step === 3 && pending" class="pending">
        <div class="pending__hero">
          <div class="pending__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div class="pending__hero-body">
            <div class="head__eyebrow">Under review</div>
            <h1 class="pending__heading">Your claim is in.</h1>
            <p class="pending__sub">
              A Torny admin usually reviews claims within one working day. We'll email you the moment it's decided.
            </p>
          </div>
        </div>

        <!-- Timeline -->
        <div class="timeline">
          <div class="timeline__step timeline__step--done">
            <div class="timeline__dot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <div class="timeline__body">
              <div class="timeline__label">Submitted</div>
              <div class="timeline__time">{{ waitingLabel(pending.submittedAt) }}</div>
            </div>
          </div>
          <div class="timeline__step timeline__step--active">
            <div class="timeline__dot"><span class="timeline__spinner" /></div>
            <div class="timeline__body">
              <div class="timeline__label">Under review</div>
              <div class="timeline__time">Waiting on a Torny admin</div>
            </div>
          </div>
          <div class="timeline__step">
            <div class="timeline__dot" />
            <div class="timeline__body">
              <div class="timeline__label">Decision</div>
              <div class="timeline__time">Usually within 1 working day</div>
            </div>
          </div>
        </div>

        <!-- Summary card -->
        <div class="summary">
          <div class="summary__title">Claim summary</div>
          <dl class="summary__list">
            <div class="summary__row"><dt>Club</dt><dd>{{ pending.clubName }}</dd></div>
            <div class="summary__row"><dt>Region</dt><dd>{{ pending.region }}</dd></div>
            <div class="summary__row"><dt>Your role</dt><dd>{{ pending.role }}</dd></div>
            <div class="summary__row"><dt>Submitted</dt><dd>{{ formatSubmittedAt(pending.submittedAt) }}</dd></div>
          </dl>
        </div>

        <!-- Next steps -->
        <div class="next">
          <div class="next__title">What happens next</div>
          <ul class="next__list">
            <li><span class="next__num">1</span> A Torny platform admin reviews your evidence.</li>
            <li><span class="next__num">2</span> If approved, you get an email with a link straight into your club's CRM.</li>
            <li><span class="next__num">3</span> If we need more info, you'll get an email asking for it — you can re-submit.</li>
          </ul>
        </div>

        <div class="foot">
          <button type="button" class="foot__ghost" @click="submitAnother">Submit a different claim</button>
          <RouterLink to="/" class="foot__cta">Back to sign in</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.claim { flex: 1; background: var(--color-surface); padding: 40px 24px 64px; }
.claim__inner {
  max-width: 720px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 20px;
  padding: 40px 48px 32px;
  box-shadow: var(--shadow-sm);
}

/* Wizard */
.steps { list-style: none; padding: 0; margin: 0 0 40px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.step { display: flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; position: relative; }
.step:not(:last-child)::after { content: ''; display: block; width: 60px; height: 0; border-top: 1px dashed var(--color-hairline); margin: 0 6px; }
.step__circle { width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid var(--color-hairline); background: #fff; color: var(--color-fog); font-family: var(--font-body); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.step.is-active .step__circle { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.step.is-active .step__label { color: var(--color-ink); }
.step.is-done .step__circle { background: var(--color-feature-mint); color: #fff; border-color: var(--color-feature-mint); }
.step.is-done .step__label { color: var(--color-ink); }

/* Section head */
.head { text-align: left; margin-bottom: 28px; }
.head__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; margin-bottom: 12px; }
.head__heading { font-family: var(--font-display); font-size: clamp(30px, 3.4vw, 38px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; color: var(--color-ink); margin: 0 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.6; max-width: 560px; }

/* Search */
.search { position: relative; display: flex; align-items: center; margin-bottom: 8px; }
.search__icon { position: absolute; left: 16px; color: var(--color-fog); pointer-events: none; }
.search__input { width: 100%; padding: 14px 90px 14px 44px; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 15px; color: var(--color-ink); background: #fff; }
.search__input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.search__spinner { position: absolute; right: 16px; width: 16px; height: 16px; border: 2px solid var(--color-hairline); border-top-color: var(--color-accent); border-radius: 999px; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.search__pill { position: absolute; right: 12px; padding: 4px 10px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 500; color: var(--color-fog); }

/* Results */
.results { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.results__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; }
.results__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }

.club {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 16px 14px 14px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 100ms, background 100ms;
}
.club:hover { border-color: var(--color-accent); }
.club.is-selected { border-color: var(--color-ink); }
.club__avatar {
  width: 48px; height: 48px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  font-family: var(--font-display); font-size: 13px; font-weight: 700;
  overflow: hidden;
  flex-shrink: 0;
}
.club__avatar img { width: 100%; height: 100%; object-fit: cover; }
.club__avatar--lg { width: 64px; height: 64px; border-radius: 14px; font-size: 18px; }
.club__body { flex: 1; min-width: 0; }
.club__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.club__meta { display: flex; gap: 8px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; flex-wrap: wrap; }
.club__sep { opacity: 0.5; }
.club__score { color: var(--color-accent); font-weight: 600; }

.radio { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.radio__dot { width: 20px; height: 20px; border-radius: 999px; border: 2px solid var(--color-hairline); background: #fff; position: relative; }
.radio.is-on .radio__dot { border-color: var(--color-ink); background: var(--color-ink); }
.radio.is-on .radio__dot::after { content: ''; position: absolute; inset: 4px; background: #fff; border-radius: 999px; }
.radio__label { font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink); }

/* Add-club callout */
.add-cta {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  margin-top: 12px;
}
.add-cta__icon {
  width: 44px; height: 44px; border-radius: 10px;
  background: #fff; border: 1px solid var(--color-hairline);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-size: 20px; font-weight: 500; color: var(--color-fog);
  flex-shrink: 0;
}
.add-cta__body { flex: 1; min-width: 0; }
.add-cta__heading { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.add-cta__text { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); margin: 4px 0 0; line-height: 1.5; }
.add-cta__btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  font-family: var(--font-body); font-size: 12px; font-weight: 600; color: var(--color-ink);
  text-decoration: none;
  flex-shrink: 0;
}

/* Empty */
.empty { display: flex; align-items: center; gap: 16px; padding: 20px; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__icon { width: 40px; height: 40px; border-radius: 999px; background: #fff; border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; color: var(--color-fog); flex-shrink: 0; }
.empty__body { flex: 1; min-width: 0; }
.empty__heading { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.empty__text { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); margin: 4px 0 0; }
.empty__cta { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; background: var(--color-ink); color: #fff; border-radius: 10px; font-family: var(--font-body); font-size: 12px; font-weight: 600; text-decoration: none; flex-shrink: 0; }

.alert { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 8px 0 0; }

/* Foot bar */
.foot { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 24px; margin-top: 28px; border-top: 1px solid var(--color-hairline); }
.foot__terms { flex: 1; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; max-width: 380px; line-height: 1.5; }
.foot__cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  background: var(--color-ink); color: #fff;
  border: none; border-radius: 12px;
  font-family: var(--font-body); font-size: 14px; font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.foot__cta:disabled { opacity: 0.4; cursor: default; }
.foot__ghost { padding: 12px 18px; background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 500; cursor: pointer; }

/* Evidence step */
.evidence { display: flex; flex-direction: column; gap: 20px; }
.picked { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--color-accent-soft); border-radius: 14px; }
.picked__body { flex: 1; min-width: 0; }
.picked__name { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); }
.picked__meta { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 2px; }
.picked__change { background: transparent; border: none; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }

.field { display: flex; flex-direction: column; gap: 8px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; }
.field__textarea { padding: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; resize: vertical; min-height: 120px; }
.field__textarea:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* Pending review — Step 3 */
.pending { display: flex; flex-direction: column; gap: 24px; }

.pending__hero { display: flex; align-items: flex-start; gap: 20px; padding: 24px; background: linear-gradient(135deg, #ECFDF5 0%, #fff 100%); border: 1px solid #A7F3D0; border-radius: 16px; }
.pending__badge { width: 52px; height: 52px; border-radius: 999px; background: var(--color-feature-mint); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pending__hero-body { flex: 1; min-width: 0; }
.pending__heading { font-family: var(--font-display); font-size: clamp(28px, 3.2vw, 34px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; color: var(--color-ink); margin: 8px 0 8px; }
.pending__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; line-height: 1.55; }

/* Timeline */
.timeline { display: flex; flex-direction: column; gap: 4px; padding: 20px 22px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.timeline__step { display: flex; align-items: center; gap: 14px; padding: 6px 0; position: relative; }
.timeline__step:not(:last-child)::after { content: ''; position: absolute; left: 11px; top: 30px; bottom: -4px; width: 2px; background: var(--color-hairline); }
.timeline__step--done:not(:last-child)::after { background: var(--color-feature-mint); }
.timeline__dot { width: 22px; height: 22px; border-radius: 999px; background: #fff; border: 2px solid var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; color: transparent; flex-shrink: 0; z-index: 1; }
.timeline__step--done .timeline__dot { background: var(--color-feature-mint); border-color: var(--color-feature-mint); color: #fff; }
.timeline__step--active .timeline__dot { border-color: var(--color-accent); background: #fff; }
.timeline__spinner { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1); } }
.timeline__body { flex: 1; min-width: 0; }
.timeline__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.timeline__step:not(.timeline__step--done):not(.timeline__step--active) .timeline__label { color: var(--color-fog); }
.timeline__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }

/* Summary card */
.summary { padding: 20px 22px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 14px; }
.summary__title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 12px; }
.summary__list { display: flex; flex-direction: column; margin: 0; }
.summary__row { display: grid; grid-template-columns: 100px 1fr; gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-hairline); align-items: baseline; }
.summary__row:first-child { border-top: 0; padding-top: 0; }
.summary__row:last-child { padding-bottom: 0; }
.summary__row dt { font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); margin: 0; }
.summary__row dd { font-family: var(--font-body); font-size: 14px; color: var(--color-ink); margin: 0; word-break: break-word; }

/* Next steps */
.next { padding: 20px 22px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.next__title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 12px; }
.next__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.next__list li { display: flex; align-items: flex-start; gap: 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.55; }
.next__num { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 11px; font-weight: 700; color: var(--color-graphite); flex-shrink: 0; }
</style>
