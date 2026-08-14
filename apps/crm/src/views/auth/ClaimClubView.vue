<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { directory, type DirectoryClub } from '@torny/api-client'

type Step = 1 | 2 | 3

const step = ref<Step>(1)
const query = ref('')
const results = ref<DirectoryClub[]>([])
const searchType = ref<'exact' | 'fuzzy'>('exact')
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const hasSearched = ref(false)

const selected = ref<DirectoryClub | null>(null)
const evidence = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let abortCtrl: AbortController | null = null

const canSearch = computed(() => query.value.trim().length >= 2)

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
  if (!selected.value) return
  submitting.value = true
  submitError.value = null
  try {
    // TODO: POST /create-claim on the SAM API once user auth is real.
    await new Promise(resolve => setTimeout(resolve, 600))
    step.value = 3
  } catch (err) {
    submitError.value = (err as Error).message
  } finally {
    submitting.value = false
  }
}

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
                <img v-if="club.avatar" :src="club.avatar" :alt="club.name" />
                <span v-else>{{ initials(club) }}</span>
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
            <img v-if="selected.avatar" :src="selected.avatar" :alt="selected.name" />
            <span v-else>{{ initials(selected) }}</span>
          </div>
          <div class="picked__body">
            <div class="picked__name">{{ selected.name }}</div>
            <div class="picked__meta">{{ location(selected) || 'Location unknown' }}</div>
          </div>
          <button type="button" class="picked__change" @click="goBackToSearch">Change club</button>
        </div>

        <label class="field">
          <span class="field__label">Why should we assign this club to you?</span>
          <textarea
            v-model="evidence"
            rows="5"
            required
            placeholder="e.g. I'm the current secretary of Naenae Bowling. Committee minutes attached below."
            class="field__textarea"
          />
          <span class="field__hint">Include your role, how long you've been at the club, and any evidence links.</span>
        </label>

        <div v-if="submitError" class="alert">{{ submitError }}</div>

        <div class="foot">
          <button type="button" class="foot__ghost" @click="goBackToSearch">Back</button>
          <button type="submit" class="foot__cta" :disabled="submitting || !evidence.trim()">
            <span>{{ submitting ? 'Submitting…' : 'Submit claim for review' }}</span>
            <svg v-if="!submitting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          </button>
        </div>
      </form>

      <!-- STEP 3: Submitted -->
      <div v-else-if="step === 3 && selected" class="submitted">
        <div class="submitted__badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div class="head__eyebrow">Claim a club · Step 3</div>
        <h1 class="head__heading">We got it.</h1>
        <p class="head__sub">
          Your claim for <strong>{{ selected.name }}</strong> has been submitted.
          A Torny admin usually gets to these within a working day — we'll notify you by email.
        </p>
        <RouterLink to="/" class="foot__cta submitted__cta">Back to sign in</RouterLink>
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

/* Submitted */
.submitted { text-align: center; padding: 12px 0; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.submitted__badge { width: 64px; height: 64px; border-radius: 999px; background: var(--color-feature-mint); color: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
.submitted__cta { margin-top: 8px; }
</style>
