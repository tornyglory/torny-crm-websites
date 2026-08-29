<script setup lang="ts">
import { tournaments, TOKEN_STORAGE_KEY, type EnterTournamentInput, type PublicTournamentDetail, type TournamentFormat } from '@torny/api-client'

const route = useRoute()
const club = useClub()

// ── Auth detection ─────────────────────────────────────────────
// SSR-safe: always guest on server, hydrates to signed-in on mount if the
// Torny session token exists in localStorage. Custom-domain club sites can't
// share cookies with torny.co.nz, so those visitors always look like guests
// unless we introduce an OAuth-style handshake (out of scope for v1).
const isSignedIn = ref(false)
onMounted(() => {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(TOKEN_STORAGE_KEY)) {
    isSignedIn.value = true
  }
})

const tournamentSlug = computed(() => (route.params.slug as string) || '')
const clubSlug = computed(() => club.value?.slug ?? '')

const { data: tournament, error, pending } = await useAsyncData<PublicTournamentDetail | null>(
  () => `tournament-${clubSlug.value}-${tournamentSlug.value}-enter`,
  async () => {
    if (!clubSlug.value || !tournamentSlug.value) return null
    try {
      return await tournaments.publicGet(clubSlug.value, tournamentSlug.value)
    } catch {
      return null
    }
  },
)

useSeoMeta({
  title: () => tournament.value ? `Enter — ${tournament.value.title}` : `Enter tournament — ${club.value?.name ?? 'Torny'}`,
})

const accent = computed(() => club.value?.brand_primary ?? '#2563EB')

// ── Roster state ───────────────────────────────────────────────

const POSITIONS_BY_FORMAT: Record<TournamentFormat, string[]> = {
  singles: ['Singles'],
  pairs: ['Skip', 'Lead'],
  triples: ['Skip', 'Second', 'Lead'],
  fours: ['Skip', 'Third', 'Second', 'Lead'],
}

interface RosterSlot {
  position: string
  filled: boolean
  name: string
  handle: string | null
  isCaptain: boolean
  method: 'torny' | 'invite' | null
  initials: string
  colorClass: 'mint' | 'accent' | 'violet' | 'tangerine'
}

const railClasses: RosterSlot['colorClass'][] = ['mint', 'accent', 'violet', 'tangerine']

const teamName = ref('')
const captainEmail = ref('')
const captainPhone = ref('')
const notifyTeamOnDrawChange = ref(true)
const notes = ref('')

const roster = ref<RosterSlot[]>([])

watchEffect(() => {
  if (!tournament.value) {
    roster.value = []
    return
  }
  const positions = POSITIONS_BY_FORMAT[tournament.value.format] ?? []
  const prefillCaptain = isSignedIn.value
  roster.value = positions.map((position, idx) => ({
    position,
    filled: idx === 0 && prefillCaptain,
    name: idx === 0 && prefillCaptain ? 'You' : '',
    handle: null,
    isCaptain: idx === 0,
    method: idx === 0 && prefillCaptain ? 'torny' : null,
    initials: idx === 0 && prefillCaptain ? 'YO' : '',
    colorClass: railClasses[idx % railClasses.length],
  }))
})

// Gate the form when a guest lands on a Torny-members-only tournament.
const isGated = computed(() => !isSignedIn.value && tournament.value?.open_to_visitors === false)

const filledCount = computed(() => roster.value.filter((r) => r.filled).length)
const isComplete = computed(() => roster.value.length > 0 && filledCount.value === roster.value.length)

// ── Format helpers ─────────────────────────────────────────────

function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`
}

function formatDayCode(iso: string | null): { day: string; month: string; weekday: string } {
  if (!iso) return { day: 'TBC', month: '', weekday: '' }
  const d = new Date(iso)
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString('en-NZ', { month: 'short' }).toUpperCase(),
    weekday: d.toLocaleDateString('en-NZ', { weekday: 'short' }).toUpperCase(),
  }
}

function formatFullDate(iso: string | null): string {
  if (!iso) return 'Dates TBC'
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatShortDate(iso: string | null): string {
  if (!iso) return 'TBC'
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatCloseTime(iso: string | null): string {
  if (!iso) return 'TBC'
  return new Date(iso).toLocaleString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '')
}

const daysUntilClose = computed(() => {
  const iso = tournament.value?.entries_close_at
  if (!iso) return null
  const daysLeft = Math.round((new Date(iso).getTime() - Date.now()) / 86400_000)
  return daysLeft
})

const closesLabel = computed(() => {
  const n = daysUntilClose.value
  if (n === null) return { value: 'TBC', suffix: '' }
  if (n < 0) return { value: 'Closed', suffix: '' }
  if (n === 0) return { value: 'today', suffix: '' }
  if (n === 1) return { value: '1 day', suffix: '' }
  return { value: `${n} days`, suffix: '' }
})

const closesUrgent = computed(() => daysUntilClose.value !== null && daysUntilClose.value >= 0 && daysUntilClose.value <= 7)

const totalCents = computed(() => tournament.value?.entry_fee_cents ?? 0)
const feeLabel = computed(() => formatMoney(totalCents.value))
const shortFeeLabel = computed(() => {
  if (totalCents.value % 100 === 0) return `$${Math.round(totalCents.value / 100)}`
  return formatMoney(totalCents.value)
})

const spotsRemaining = computed(() => tournament.value?.stats?.spots_remaining ?? 0)

// ── Submit ─────────────────────────────────────────────────────

function updateGuestName(idx: number, value: string) {
  const slot = roster.value[idx]
  if (!slot) return
  slot.name = value
  slot.filled = value.trim().length > 0
  if (slot.filled) {
    slot.initials = value
      .split(/\s+/)
      .map((s) => s[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase()
  } else {
    slot.initials = ''
  }
}

const signInHref = computed(() => {
  const next = encodeURIComponent(`/tournaments/${tournamentSlug.value}/enter`)
  return `/sign-in?next=${next}`
})

const submitting = ref(false)
const submitError = ref<string | null>(null)

async function submit() {
  if (!tournament.value) return
  submitError.value = null
  submitting.value = true
  const input: EnterTournamentInput = {
    team_name: teamName.value.trim() || null,
    roster: roster.value.filter((r) => r.filled).map((r) => ({
      position: r.position,
      name: r.name || null,
    })),
    captain_contact: captainEmail.value
      ? { email: captainEmail.value, phone: captainPhone.value || null }
      : undefined,
  }
  try {
    await tournaments.enter(tournament.value.id, input)
    await navigateTo(`/tournaments/${tournamentSlug.value}?entered=1`)
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : 'Something went wrong. Try again.'
    submitting.value = false
  }
}

const cover = computed(() => tournament.value?.cover_image_url)
const startsCode = computed(() => formatDayCode(tournament.value?.starts_at ?? null))
</script>

<template>
  <article class="enter" :style="{ '--brand': accent } as any">
    <!-- Loading / error / not found -->
    <div v-if="pending && !tournament" class="enter__loading">
      <div class="enter__loading-shell">
        <div class="enter__loading-title">Loading tournament…</div>
      </div>
    </div>

    <div v-else-if="!tournament || error" class="enter__missing">
      <div class="enter__missing-eyebrow">TOURNAMENT NOT FOUND</div>
      <h1 class="enter__missing-title">We couldn't find that tournament.</h1>
      <p class="enter__missing-sub">It may have closed, been cancelled, or the link's off. Head back to the full list.</p>
      <NuxtLink to="/tournaments" class="enter__missing-cta">Back to tournaments →</NuxtLink>
    </div>

    <template v-else>
      <!-- Tournament header strip -->
      <header class="enter__hero">
        <div class="enter__hero-inner">
          <div class="enter__breadcrumb">
            <NuxtLink to="/tournaments" class="enter__crumb">TOURNAMENTS</NuxtLink>
            <span class="enter__crumb-sep">/</span>
            <NuxtLink :to="`/tournaments/${tournamentSlug}`" class="enter__crumb">{{ tournament.title.toUpperCase() }}</NuxtLink>
            <span class="enter__crumb-sep">/</span>
            <span class="enter__crumb enter__crumb--current">ENTER A TEAM</span>
          </div>

          <div class="enter__hero-body">
            <div class="enter__hero-main">
              <div class="enter__thumb" :style="cover ? { backgroundImage: `url(${cover})` } : {}">
                <div v-if="!cover" class="enter__thumb-gradient"></div>
                <div class="enter__thumb-date">{{ startsCode.weekday }} {{ startsCode.day }} {{ startsCode.month }}</div>
              </div>
              <div class="enter__hero-text">
                <div class="enter__hero-pills">
                  <span class="enter__pill enter__pill--mint">TAKING ENTRIES</span>
                  <span class="enter__hero-eyebrow">{{ tournament.format.toUpperCase() }} · {{ tournament.category.toUpperCase() }}<template v-if="tournament.gender_scope"> · {{ tournament.gender_scope.toUpperCase() }}</template></span>
                </div>
                <h1 class="enter__hero-title">{{ tournament.title }}</h1>
                <p v-if="tournament.subtitle" class="enter__hero-desc">{{ tournament.subtitle }}</p>
              </div>
            </div>

            <div class="enter__closes">
              <div class="enter__closes-label">ENTRIES CLOSE IN</div>
              <div class="enter__closes-value" :class="{ 'enter__closes-value--urgent': closesUrgent }">{{ closesLabel.value }}</div>
              <div class="enter__closes-date">{{ formatShortDate(tournament.entries_close_at) }} · {{ formatCloseTime(tournament.entries_close_at) }}</div>
            </div>
          </div>
        </div>
      </header>

      <!-- Members-only gate (guest + open_to_visitors:false) -->
      <div v-if="isGated" class="enter__gated">
        <div class="enter__gated-inner">
          <div class="enter__gated-eyebrow">TORNY MEMBERS ONLY</div>
          <h2 class="enter__gated-title">Sign in to enter this one.</h2>
          <p class="enter__gated-sub">{{ tournament.club.name }} has restricted entries to Torny members. Sign in with your handle to see the entry form.</p>
          <div class="enter__gated-actions">
            <NuxtLink :to="signInHref" class="btn-primary">Sign in with Torny <span class="btn-primary__arrow">→</span></NuxtLink>
            <NuxtLink to="/tournaments" class="btn-secondary">Browse other tournaments</NuxtLink>
          </div>
        </div>
      </div>

      <!-- Body: form + sticky summary rail -->
      <div v-else class="enter__body">
        <div class="enter__body-inner">
          <div class="enter__form">
            <!-- Guest upsell banner -->
            <NuxtLink v-if="!isSignedIn" :to="signInHref" class="upsell">
              <div class="upsell__mark">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14V12H2V4Z" stroke="currentColor" stroke-width="1.4"/><path d="M2 4L8 9L14 4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
              </div>
              <div class="upsell__copy">
                <div class="upsell__title">Already on Torny? Sign in to speed this up.</div>
                <div class="upsell__sub">Captain and payment pre-fill from your profile, and you can add teammates by their Torny handle.</div>
              </div>
              <div class="upsell__cta">Sign in <span>→</span></div>
            </NuxtLink>

            <!-- Section 1 — Your team -->
            <section class="section">
              <div class="section__head">
                <div class="section__eyebrow">STEP 01 · YOUR TEAM</div>
                <h2 class="section__title">Who's on the mat.</h2>
                <p class="section__sub">
                  <template v-if="isSignedIn">
                    {{ roster.length === 1 ? 'You against the world.' : `${roster.length} bowlers per team` }} — add each one by their Torny handle if they're already on here, or invite them by name and email.
                  </template>
                  <template v-else>
                    {{ roster.length === 1 ? 'You against the world.' : `${roster.length} bowlers per team` }} — start with your own name, then add the rest of the squad.
                  </template>
                </p>
              </div>

              <div class="field">
                <label class="field__label" for="team-name">Team name</label>
                <input id="team-name" v-model="teamName" type="text" class="field__input" placeholder="The Green Machines" maxlength="32" />
                <div class="field__hint">Shown on the draw. 32 characters max.</div>
              </div>

              <div class="roster">
                <div v-for="(slot, idx) in roster" :key="`${slot.position}-${idx}`" class="slot" :class="`slot--${slot.colorClass}`">
                  <div class="slot__rail"></div>
                  <div class="slot__pos">
                    <div class="slot__pos-label">POS {{ String(idx + 1).padStart(2, '0') }}</div>
                    <div class="slot__pos-name">{{ slot.position }}</div>
                  </div>

                  <!-- Guest mode: plain name inputs, no handle lookup or invite -->
                  <template v-if="!isSignedIn">
                    <div class="slot__body slot__body--guest">
                      <div class="slot__avatar" :class="slot.filled ? `slot__avatar--${slot.colorClass}` : 'slot__avatar--empty'">
                        <template v-if="slot.filled">{{ slot.initials }}</template>
                        <template v-else>+</template>
                      </div>
                      <div class="slot__player">
                        <input
                          type="text"
                          class="slot__input"
                          :placeholder="slot.isCaptain ? `Your name (captain)` : `${slot.position}'s full name`"
                          :value="slot.name"
                          @input="updateGuestName(idx, ($event.target as HTMLInputElement).value)"
                        />
                        <div class="slot__player-meta">
                          <template v-if="slot.isCaptain">You're the captain — draw updates go to you.</template>
                          <template v-else>Full name — we'll email them a confirmation.</template>
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- Signed-in mode: captain prefilled, teammates via handle search -->
                  <template v-else-if="slot.filled">
                    <div class="slot__body">
                      <div class="slot__avatar" :class="`slot__avatar--${slot.colorClass}`">{{ slot.initials }}</div>
                      <div class="slot__player">
                        <div class="slot__player-name-row">
                          <div class="slot__player-name">{{ slot.name }}</div>
                          <span v-if="slot.isCaptain" class="slot__player-tag">CAPTAIN · YOU</span>
                          <span v-else class="slot__player-tag slot__player-tag--mint">CONFIRMED</span>
                        </div>
                        <div class="slot__player-meta">
                          <template v-if="slot.handle">@{{ slot.handle }} · {{ tournament.club.name }}</template>
                          <template v-else-if="slot.isCaptain">You're the captain — we'll send draw updates to you.</template>
                          <template v-else>Added manually</template>
                        </div>
                      </div>
                    </div>
                    <div class="slot__actions">
                      <button v-if="slot.isCaptain" type="button" class="btn-chip btn-chip--solid">Change captain</button>
                      <template v-else>
                        <button type="button" class="btn-chip">Swap</button>
                        <button type="button" class="btn-chip btn-chip--ghost">Remove</button>
                      </template>
                    </div>
                  </template>

                  <template v-else>
                    <div class="slot__body slot__body--empty">
                      <div class="slot__avatar slot__avatar--empty">+</div>
                      <div class="slot__player">
                        <div class="slot__player-name">Add your {{ slot.position.toLowerCase() }}</div>
                        <div class="slot__player-meta">Search by Torny handle or invite by email — they can accept later.</div>
                      </div>
                    </div>
                    <div class="slot__actions">
                      <button type="button" class="btn-chip btn-chip--solid">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                        Search handle
                      </button>
                      <button type="button" class="btn-chip">Invite by email</button>
                    </div>
                  </template>
                </div>
              </div>
            </section>

            <!-- Section 2 — Captain contact -->
            <section class="section">
              <div class="section__head">
                <div class="section__eyebrow">STEP 02 · CAPTAIN CONTACT</div>
                <h2 class="section__title">Who do we call.</h2>
                <p class="section__sub">Draw updates, weather calls, prize-giving times — all go to the captain first.</p>
              </div>

              <div class="field-grid">
                <div class="field">
                  <label class="field__label" for="captain-email">Email</label>
                  <input id="captain-email" v-model="captainEmail" type="email" class="field__input" placeholder="you@yourclub.co.nz" />
                </div>
                <div class="field">
                  <label class="field__label" for="captain-phone">Mobile</label>
                  <input id="captain-phone" v-model="captainPhone" type="tel" class="field__input" placeholder="+64 21 …" />
                </div>
              </div>

              <label class="checkbox">
                <input v-model="notifyTeamOnDrawChange" type="checkbox" class="checkbox__input" />
                <span class="checkbox__label">Text the whole team if the draw changes on the day.</span>
              </label>
            </section>

            <!-- Section 3 — Notes -->
            <section class="section">
              <div class="section__head">
                <div class="section__eyebrow">STEP 03 · NOTES <span class="section__eyebrow-muted">— OPTIONAL</span></div>
                <h2 class="section__title">Anything the organiser should know.</h2>
              </div>
              <textarea v-model="notes" class="field__textarea" rows="4" placeholder="Late arrival, dietary needs for lunch, playing colours you'd rather not wear against, whatever."></textarea>
            </section>

            <!-- Confirm bar -->
            <section class="confirm">
              <p class="confirm__legal">
                By confirming, you agree to
                <NuxtLink :to="`/tournaments/${tournamentSlug}#rules`" class="confirm__legal-link">{{ tournament.club.name }}'s tournament rules</NuxtLink>
                and to receive event-related emails from the organiser. Your team can withdraw before entries close for a full refund. Terms &amp; conditions apply.
              </p>
              <div class="confirm__row">
                <button type="button" class="btn-primary" :disabled="submitting" @click="submit">
                  {{ submitting ? 'Confirming…' : `Confirm & pay ${shortFeeLabel}` }} <span class="btn-primary__arrow">→</span>
                </button>
                <button type="button" class="btn-secondary">Save as draft</button>
                <div class="confirm__step">STEP 3 OF 3</div>
              </div>
              <div v-if="submitError" class="confirm__error">{{ submitError }}</div>
            </section>
          </div>

          <!-- Sticky summary rail -->
          <aside class="rail">
            <section class="rail__card rail__card--ink">
              <div class="rail__head">
                <div class="rail__head-label">YOUR ENTRY</div>
                <div class="rail__spots-pill">
                  <span class="rail__spots-dot"></span>
                  {{ spotsRemaining }} spots left
                </div>
              </div>

              <div class="rail__team">
                <div class="rail__team-name">{{ teamName || 'Your team' }}</div>
                <div class="rail__team-meta">{{ formatFullDate(tournament.starts_at) }} · {{ tournament.club.name }}</div>
              </div>

              <div class="rail__players">
                <div v-for="(slot, idx) in roster" :key="`preview-${idx}`" class="rail__player" :class="{ 'rail__player--pending': !slot.filled }">
                  <div class="rail__player-tick" :class="{ 'rail__player-tick--pending': !slot.filled }">
                    <svg v-if="slot.filled" width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3 5.5L6.5 2" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </div>
                  <span class="rail__player-name">
                    {{ slot.position }} — <template v-if="slot.filled">{{ slot.name }}</template><template v-else>pending</template>
                  </span>
                  <span v-if="slot.isCaptain" class="rail__player-flag">YOU</span>
                </div>
              </div>

              <div class="rail__fees">
                <div class="rail__fee-row">
                  <span class="rail__fee-label">Team entry fee</span>
                  <span class="rail__fee-value">{{ formatMoney(tournament.entry_fee_cents) }}</span>
                </div>
                <div class="rail__fee-total">
                  <span class="rail__fee-total-label">TOTAL DUE TODAY</span>
                  <span class="rail__fee-total-value">{{ shortFeeLabel }}</span>
                </div>
              </div>

              <div class="rail__actions">
                <button type="button" class="rail__cta" :disabled="submitting" @click="submit">
                  {{ submitting ? 'Confirming…' : 'Confirm & pay' }} <span>→</span>
                </button>
                <button type="button" class="rail__cta rail__cta--ghost">Save as draft</button>
              </div>

              <div class="rail__fine">
                Card is charged only when your team's confirmed. Withdraw any time before entries close on
                <span class="rail__fine-strong">{{ formatShortDate(tournament.entries_close_at) }}, {{ formatCloseTime(tournament.entries_close_at) }}</span>.
              </div>
            </section>

            <section class="rail__card rail__card--trust">
              <div class="rail__trust-head">
                <div class="rail__trust-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L2.5 4V7.5C2.5 11 5 13.5 8 14.5C11 13.5 13.5 11 13.5 7.5V4L8 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="rail__trust-title">Backed by Torny.</div>
              </div>
              <div class="rail__trust-sub">Payment held by Stripe. Full refund if the tournament's cancelled. Your card details never touch this club's systems.</div>
            </section>
          </aside>
        </div>
      </div>
    </template>
  </article>
</template>

<style scoped>
.enter { display: flex; flex-direction: column; background: var(--color-ground, #FFFFFF); color: var(--color-ink, #0A0A0B); }

/* ── Loading + missing states ────────────────────────────────── */
.enter__loading, .enter__missing { padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)); }
.enter__loading-title { font-family: var(--font-body); color: var(--color-fog); font-size: 15px; }
.enter__missing-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; margin-bottom: 12px; }
.enter__missing-title { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; margin: 0 0 12px; color: var(--color-ink); }
.enter__missing-sub { font-family: var(--font-body); font-size: 15px; color: var(--color-fog); line-height: 1.55; margin: 0 0 24px; max-width: 480px; }
.enter__missing-cta { display: inline-flex; padding: 12px 20px; background: var(--color-ink); color: white; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; text-decoration: none; }

/* ── Hero strip ──────────────────────────────────────────────── */
.enter__hero { border-bottom: 1px solid var(--color-hairline); }
.enter__hero-inner { padding: 40px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 48px; display: flex; flex-direction: column; gap: 28px; box-sizing: border-box; }
.enter__breadcrumb { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 600; flex-wrap: wrap; }
.enter__crumb { color: var(--color-fog); text-decoration: none; }
.enter__crumb--current { color: var(--color-ink); }
.enter__crumb-sep { color: var(--color-mute); }

.enter__hero-body { display: flex; gap: 40px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; }
.enter__hero-main { display: flex; gap: 24px; align-items: flex-end; flex: 1; min-width: 0; }
.enter__thumb { width: 140px; height: 140px; border-radius: 16px; flex-shrink: 0; position: relative; overflow: hidden; background-size: cover; background-position: center; background-color: #eee; }
.enter__thumb-gradient { position: absolute; inset: 0; background: linear-gradient(155deg, #7C3AED 0%, #2563EB 45%, #16A34A 100%); }
.enter__thumb-date { position: absolute; bottom: 12px; left: 12px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; color: rgba(255,255,255,0.9); font-weight: 700; z-index: 1; }

.enter__hero-text { display: flex; flex-direction: column; gap: 12px; min-width: 0; flex: 1; }
.enter__hero-pills { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.enter__pill { padding: 4px 10px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; font-weight: 700; }
.enter__pill--mint { background: rgba(22,163,74,0.14); color: #16A34A; }
.enter__hero-eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.enter__hero-title { font-family: var(--font-display); font-weight: 700; font-size: clamp(36px, 5vw, 56px); letter-spacing: -0.03em; line-height: 1; margin: 0; color: var(--color-ink); }
.enter__hero-desc { font-family: var(--font-body); font-size: 15px; color: var(--color-fog); line-height: 1.5; margin: 0; max-width: 520px; }

.enter__closes { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.enter__closes-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.enter__closes-value { font-family: var(--font-display); font-weight: 700; font-size: 44px; letter-spacing: -0.03em; color: var(--color-ink); line-height: 1; }
.enter__closes-value--urgent { color: #EA580C; }
.enter__closes-date { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* ── Body layout ─────────────────────────────────────────────── */
.enter__body-inner { padding: 56px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 96px; display: flex; gap: 40px; align-items: flex-start; box-sizing: border-box; }
.enter__form { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 40px; }
.rail { width: 380px; flex-shrink: 0; position: sticky; top: 24px; display: flex; flex-direction: column; gap: 16px; }

/* ── Guest upsell banner ────────────────────────────────────── */
.upsell { display: flex; align-items: center; gap: 16px; padding: 18px 22px; background: color-mix(in oklab, var(--brand) 8%, white); border: 1px solid color-mix(in oklab, var(--brand) 20%, var(--color-hairline)); border-radius: 14px; text-decoration: none; color: inherit; transition: background-color 0.15s ease; }
.upsell:hover { background: color-mix(in oklab, var(--brand) 12%, white); }
.upsell__mark { width: 40px; height: 40px; border-radius: 999px; background: var(--brand); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.upsell__copy { flex: 1; min-width: 0; }
.upsell__title { font-family: var(--font-display); font-weight: 700; font-size: 15px; letter-spacing: -0.01em; color: var(--color-ink); }
.upsell__sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; line-height: 1.5; }
.upsell__cta { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--brand); flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; }

/* ── Members-only gate ──────────────────────────────────────── */
.enter__gated { padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)); display: flex; justify-content: center; }
.enter__gated-inner { max-width: 520px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.enter__gated-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.enter__gated-title { font-family: var(--font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; margin: 0; color: var(--color-ink); }
.enter__gated-sub { font-family: var(--font-body); font-size: 15px; color: var(--color-fog); line-height: 1.55; margin: 0; }
.enter__gated-actions { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
.enter__gated-actions .btn-primary, .enter__gated-actions .btn-secondary { text-decoration: none; }

/* ── Section head ────────────────────────────────────────────── */
.section { display: flex; flex-direction: column; gap: 24px; }
.section__head { display: flex; flex-direction: column; gap: 8px; }
.section__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.section__eyebrow-muted { color: var(--color-mute); }
.section__title { font-family: var(--font-display); font-weight: 700; font-size: 32px; letter-spacing: -0.02em; line-height: 1.05; margin: 0; color: var(--color-ink); }
.section__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); line-height: 1.5; margin: 0; max-width: 520px; }

/* ── Fields ──────────────────────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: 8px; }
.field__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.field__input { padding: 14px 18px; background: white; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 15px; color: var(--color-ink); outline: none; }
.field__input:focus { border-color: var(--color-ink); }
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.field__textarea { padding: 16px 18px; background: white; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); resize: vertical; line-height: 1.5; outline: none; }
.field__textarea:focus { border-color: var(--color-ink); }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.checkbox { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.checkbox__input { width: 18px; height: 18px; accent-color: var(--color-ink); flex-shrink: 0; }
.checkbox__label { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 500; }

/* ── Roster ──────────────────────────────────────────────────── */
.roster { display: flex; flex-direction: column; gap: 12px; }
.slot { display: flex; align-items: stretch; background: white; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.slot__rail { width: 4px; flex-shrink: 0; }
.slot--mint .slot__rail { background: #16A34A; }
.slot--accent .slot__rail { background: var(--brand, #2563EB); }
.slot--violet .slot__rail { background: #7C3AED; }
.slot--tangerine .slot__rail { background: #EA580C; }

.slot__pos { width: 88px; padding: 20px 16px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; flex-shrink: 0; border-right: 1px solid var(--color-hairline); }
.slot__pos-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.slot__pos-name { font-family: var(--font-display); font-weight: 700; font-size: 20px; letter-spacing: -0.02em; color: var(--color-ink); line-height: 1; white-space: nowrap; }

.slot__body { flex: 1; padding: 18px 20px; display: flex; align-items: center; gap: 16px; min-width: 0; }
.slot__body--guest { padding: 14px 20px; }
.slot__input { width: 100%; padding: 8px 12px; background: transparent; border: 0; border-bottom: 1.5px solid var(--color-hairline); font-family: var(--font-display); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; color: var(--color-ink); outline: none; box-sizing: border-box; }
.slot__input::placeholder { color: var(--color-mute); font-weight: 500; }
.slot__input:focus { border-bottom-color: var(--color-ink); }
.slot__avatar { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-family: var(--font-display); font-weight: 700; font-size: 15px; flex-shrink: 0; }
.slot__avatar--mint { background: linear-gradient(135deg, #16A34A 0%, #0F5132 100%); }
.slot__avatar--accent { background: linear-gradient(135deg, #2563EB 0%, #7C3AED 100%); }
.slot__avatar--violet { background: linear-gradient(135deg, #7C3AED 0%, #2563EB 100%); }
.slot__avatar--tangerine { background: linear-gradient(135deg, #EA580C 0%, #DC2F3B 100%); }
.slot__avatar--empty { background: #F5F5F2; border: 1.5px dashed var(--color-mute); color: var(--color-mute); font-size: 20px; }

.slot__player { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.slot__player-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.slot__player-name { font-family: var(--font-display); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; color: var(--color-ink); }
.slot__player-tag { padding: 2px 8px; background: var(--color-surface); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.slot__player-tag--mint { background: rgba(22,163,74,0.14); color: #16A34A; }
.slot__player-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

.slot__actions { padding: 18px 20px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.btn-chip { padding: 8px 14px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.btn-chip:hover { border-color: var(--color-ink); color: var(--color-ink); }
.btn-chip--solid { background: var(--color-ink); color: white; border-color: var(--color-ink); font-weight: 600; }
.btn-chip--solid:hover { color: white; }
.btn-chip--ghost { border-color: transparent; color: var(--color-fog); }

/* ── Confirm bar ─────────────────────────────────────────────── */
.confirm { display: flex; flex-direction: column; gap: 16px; padding-top: 24px; border-top: 1px solid var(--color-hairline); }
.confirm__legal { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; margin: 0; max-width: 620px; }
.confirm__legal-link { color: var(--color-ink); font-weight: 500; text-decoration: underline; }
.confirm__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.confirm__step { margin-left: auto; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700; }
.confirm__error { padding: 12px 16px; background: rgba(220,47,59,0.08); border: 1px solid rgba(220,47,59,0.24); border-radius: 12px; font-family: var(--font-body); font-size: 13px; color: #DC2F3B; }

.btn-primary { padding: 14px 26px; background: var(--color-ink); border: 0; border-radius: 999px; font-family: var(--font-body); font-weight: 700; font-size: 14px; color: white; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.btn-primary__arrow { font-size: 16px; }
.btn-secondary { padding: 14px 22px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-weight: 600; font-size: 13px; color: var(--color-graphite); cursor: pointer; }

/* ── Sticky summary rail ────────────────────────────────────── */
.rail__card { border-radius: 20px; padding: 28px 26px; display: flex; flex-direction: column; gap: 24px; }
.rail__card--ink { background: var(--color-ink); color: white; }
.rail__card--trust { background: white; border: 1px solid var(--color-hairline); padding: 20px 22px; gap: 12px; }

.rail__head { display: flex; align-items: center; justify-content: space-between; }
.rail__head-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); font-weight: 700; }
.rail__spots-pill { padding: 4px 10px; background: rgba(22,163,74,0.18); border: 1px solid rgba(22,163,74,0.32); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; color: #86EFAC; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; text-transform: uppercase; }
.rail__spots-dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }

.rail__team { display: flex; flex-direction: column; gap: 6px; }
.rail__team-name { font-family: var(--font-display); font-weight: 700; font-size: 26px; letter-spacing: -0.02em; color: white; line-height: 1.05; }
.rail__team-meta { font-family: var(--font-body); font-size: 12px; color: rgba(255,255,255,0.6); }

.rail__players { display: flex; flex-direction: column; gap: 6px; padding: 14px 0; border-top: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1); }
.rail__player { display: flex; align-items: center; gap: 10px; }
.rail__player--pending { opacity: 0.55; }
.rail__player-tick { width: 16px; height: 16px; border-radius: 999px; background: #16A34A; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rail__player-tick--pending { background: transparent; border: 1.5px dashed rgba(255,255,255,0.4); box-sizing: border-box; }
.rail__player-name { font-family: var(--font-body); font-size: 13px; color: white; font-weight: 500; flex: 1; }
.rail__player-flag { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); font-weight: 600; }

.rail__fees { display: flex; flex-direction: column; gap: 10px; }
.rail__fee-row { display: flex; justify-content: space-between; align-items: baseline; }
.rail__fee-label { font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.7); }
.rail__fee-value { font-family: var(--font-display); font-weight: 600; font-size: 14px; color: white; }
.rail__fee-total { display: flex; justify-content: space-between; align-items: baseline; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); }
.rail__fee-total-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); font-weight: 700; }
.rail__fee-total-value { font-family: var(--font-display); font-weight: 700; font-size: 32px; letter-spacing: -0.02em; color: white; line-height: 1; }

.rail__actions { display: flex; flex-direction: column; gap: 10px; }
.rail__cta { padding: 16px 22px; background: white; color: var(--color-ink); border: 0; border-radius: 999px; font-family: var(--font-body); font-weight: 700; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
.rail__cta:disabled { opacity: 0.7; cursor: default; }
.rail__cta--ghost { background: transparent; border: 1px solid rgba(255,255,255,0.2); color: white; font-weight: 600; font-size: 13px; padding: 12px 22px; }

.rail__fine { font-family: var(--font-body); font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.5; }
.rail__fine-strong { color: rgba(255,255,255,0.8); font-weight: 500; }

.rail__trust-head { display: flex; align-items: center; gap: 10px; }
.rail__trust-icon { width: 28px; height: 28px; border-radius: 999px; background: var(--color-surface); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--color-ink); }
.rail__trust-title { font-family: var(--font-display); font-weight: 700; font-size: 15px; letter-spacing: -0.01em; color: var(--color-ink); }
.rail__trust-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; }

@media (max-width: 1023px) {
  .enter__body-inner { flex-direction: column; gap: 32px; }
  .rail { width: 100%; position: static; }
  .enter__hero-body { gap: 24px; }
  .enter__closes { align-items: flex-start; }
  .field-grid { grid-template-columns: 1fr; }
  .slot { flex-wrap: wrap; }
  .slot__actions { padding: 0 20px 18px; }
}
</style>
