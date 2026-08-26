<script setup lang="ts">
/**
 * Membership join form — the public-site block that lets a prospective
 * member apply to join the club. Reads tiers + settings from BlockContext
 * (published on `/site` by brief 15 + brief 36) so no separate fetch is
 * needed. Submit hits the public applications endpoint from brief 38 —
 * until the backend ships, the request will 404 and we surface a friendly
 * "submissions aren't wired up yet" error to the applicant.
 *
 * Designed in Paper — mirrors the "Join · Full page (Desktop)" artboard.
 */
import { computed, inject, isRef, ref, type Ref } from 'vue'
import { applications, ApiError } from '@torny/api-client'
import type { CreateApplicationInput } from '@torny/api-client'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type MembershipJoinFormProps,
} from '../types'

const props = withDefaults(defineProps<MembershipJoinFormProps>(), {
  eyebrow: 'MEMBERSHIP · 2026 SEASON',
  heading: 'Join the club.',
  description: "Fill in a few details and we'll be in touch within a week. Membership runs March to March. All new members get free coaching for their first season.",
  successHref: '',
  successHeadline: 'Application received.',
  showBowlsNumber: true,
  showPlayingDays: true,
  termsHref: '',
  privacyHref: '',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')
const cadence = computed<'annual' | 'monthly' | 'season'>(
  () => ctx.value?.cadence ?? 'annual',
)
const firstYearDiscount = computed<boolean>(() => ctx.value?.firstYearDiscount ?? false)
const cadenceUnit = computed(() => (
  cadence.value === 'annual' ? '/ year'
    : cadence.value === 'monthly' ? '/ month'
      : '/ season'
))

// ── Tier list — reads BlockContext, falls back to a stub trio so the
//    CRM preview looks like the real site.
interface DisplayTier {
  id: number | string
  name: string
  description: string | null
  fee: number | null
  isDefault: boolean
}
const PREVIEW_TIERS: DisplayTier[] = [
  { id: 'preview-1', name: 'Social bowler', description: 'Friday twilight roll-ups, clubhouse access, sets provided.', fee: 60, isDefault: false },
  { id: 'preview-2', name: 'Playing member', description: 'Pennant, tournaments, every roll-up, and voting rights at AGM.', fee: 140, isDefault: true },
  { id: 'preview-3', name: 'Life member', description: '10+ year members. Honorary — subs waived, honour board earned.', fee: null, isDefault: false },
]
const tiers = computed<DisplayTier[]>(() => {
  const raw = ctx.value?.membershipTiers
  if (!raw || raw.length === 0) return PREVIEW_TIERS
  return raw.map((t) => ({
    id: t.id,
    name: t.type_name,
    description: t.description ?? null,
    fee: t.fee ?? null,
    isDefault: t.is_default,
  }))
})

// ── Form state ──────────────────────────────────────────────────
const defaultTier = computed<DisplayTier | undefined>(() => tiers.value.find((t) => t.isDefault) ?? tiers.value[0])
const selectedTierId = ref<DisplayTier['id'] | null>(null)
const selectedTier = computed<DisplayTier | undefined>(() => {
  const id = selectedTierId.value ?? defaultTier.value?.id
  return tiers.value.find((t) => t.id === id) ?? defaultTier.value
})

const priceLabel = computed(() => selectedTier.value?.fee != null ? `$${selectedTier.value.fee}` : '—')
const discountedPrice = computed(() => {
  if (!firstYearDiscount.value) return null
  const fee = selectedTier.value?.fee
  if (fee == null || fee === 0) return null
  return Math.round(fee * 0.8)
})

const form = ref({
  fullName: '',
  preferredName: '',
  dob: '',
  email: '',
  mobile: '',
  street: '',
  suburb: '',
  postcode: '',
  country: 'New Zealand',
  experience: 'social' as 'never' | 'social' | 'club' | 'pennant',
  bowlsNumber: '',
  position: 'no_preference' as 'lead' | 'second' | 'third' | 'skip' | 'no_preference',
  playingDays: new Set<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'>(),
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
  note: '',
  referrer: '',
  consentTerms: false,
  consentNewsletter: false,
  consentPhoto: false,
})

const EXPERIENCE_OPTIONS: Array<{ value: typeof form.value.experience; label: string; hint: string }> = [
  { value: 'never', label: 'Never played', hint: "We'll pair you with a coach." },
  { value: 'social', label: 'Social level', hint: 'A few seasons, casual play.' },
  { value: 'club', label: 'Club level', hint: 'Regular club events.' },
  { value: 'pennant', label: 'Pennant / open', hint: 'Rep or open tournament level.' },
]

const POSITION_OPTIONS: Array<{ value: typeof form.value.position; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'second', label: 'Second' },
  { value: 'third', label: 'Third' },
  { value: 'skip', label: 'Skip' },
  { value: 'no_preference', label: 'No preference' },
]

const DAY_KEYS: Array<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function toggleDay(day: (typeof DAY_KEYS)[number]) {
  if (form.value.playingDays.has(day)) form.value.playingDays.delete(day)
  else form.value.playingDays.add(day)
  form.value.playingDays = new Set(form.value.playingDays)
}

// ── Steps sidebar — flips complete as sections are filled ──────
interface Step { key: string; label: string; complete: boolean }
const steps = computed<Step[]>(() => [
  { key: 'tier', label: 'Tier', complete: !!selectedTier.value },
  { key: 'about', label: 'About you', complete: !!form.value.fullName && !!form.value.email && !!form.value.mobile && !!form.value.dob },
  { key: 'address', label: 'Address', complete: !!form.value.street && !!form.value.suburb && !!form.value.postcode },
  { key: 'bowls', label: 'Your bowls', complete: true },
  { key: 'emergency', label: 'Emergency contact', complete: !!form.value.emergencyName && !!form.value.emergencyPhone },
  { key: 'review', label: 'Review & agree', complete: form.value.consentTerms },
])

// ── Submit ─────────────────────────────────────────────────────
const submitting = ref(false)
const submitError = ref<string | null>(null)
const submitted = ref(false)

function validate(): string | null {
  if (!selectedTier.value) return 'Choose a membership tier before submitting.'
  if (!form.value.fullName.trim()) return 'Please enter your full name.'
  if (!form.value.email.trim() || !form.value.email.includes('@')) return 'A valid email address is required.'
  if (!form.value.mobile.trim()) return 'A mobile number helps us reach you if there\'s a rain-out.'
  if (!form.value.dob) return 'Please enter your date of birth.'
  if (!form.value.street.trim() || !form.value.suburb.trim() || !form.value.postcode.trim()) return 'Please fill in your home address so we can post the handbook.'
  if (!form.value.emergencyName.trim() || !form.value.emergencyPhone.trim()) return 'Emergency contact name + phone are required.'
  if (!form.value.consentTerms) return 'Please agree to the code of conduct, bylaws, and privacy policy to submit.'
  return null
}

async function onSubmit(evt: Event) {
  evt.preventDefault()
  submitError.value = null
  const err = validate()
  if (err) { submitError.value = err; return }
  if (!clubSlug.value) {
    submitError.value = 'This preview isn\'t connected to a live club. Publish the site to enable submissions.'
    return
  }
  submitting.value = true
  try {
    const payload: CreateApplicationInput = {
      tier_id: typeof selectedTier.value?.id === 'number' ? selectedTier.value.id : null,
      full_name: form.value.fullName.trim(),
      preferred_name: form.value.preferredName.trim() || null,
      dob: form.value.dob,
      email: form.value.email.trim(),
      mobile: form.value.mobile.trim(),
      address: {
        street: form.value.street.trim(),
        suburb: form.value.suburb.trim(),
        postcode: form.value.postcode.trim(),
        country: form.value.country.trim() || null,
      },
      bowls: {
        experience: form.value.experience,
        bowls_number: form.value.bowlsNumber.trim() || null,
        position: form.value.position,
        playing_days: Array.from(form.value.playingDays),
      },
      emergency_contact: {
        name: form.value.emergencyName.trim(),
        phone: form.value.emergencyPhone.trim(),
        relationship: form.value.emergencyRelation.trim() || null,
      },
      note: form.value.note.trim() || null,
      referrer: form.value.referrer.trim() || null,
      consent: {
        terms: form.value.consentTerms,
        newsletter: form.value.consentNewsletter,
        photo: form.value.consentPhoto,
      },
    }
    await applications.create(clubSlug.value, payload)
    submitted.value = true
    if (props.successHref) window.location.href = props.successHref
  } catch (e) {
    submitError.value = joinFormErrorMessage(e)
  } finally {
    submitting.value = false
  }
}

function joinFormErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'We couldn\'t submit your application. Please try again in a moment.'
  const body = (err.body ?? {}) as { code?: string }
  switch (body.code) {
    case 'applications_closed': return 'The club isn\'t accepting new applications right now. Please check back later or email the membership secretary.'
    case 'rate_limited': return 'Too many attempts from this address. Please wait an hour and try again.'
    case 'consent_required': return 'Please tick the code-of-conduct + privacy agreement before submitting.'
    case 'bad_email': return 'That email address doesn\'t look right. Double-check and try again.'
    case 'bad_dob': return 'Please enter a valid date of birth.'
    case 'missing_required': return 'One or more required fields are empty. Fill them in and try again.'
    case 'unknown_tier': return 'The tier you picked isn\'t available — choose a different one.'
    case 'unknown_club': return 'We couldn\'t reach this club\'s inbox. Please refresh and try again.'
    default: return err.message || 'We couldn\'t submit your application. Please try again in a moment.'
  }
}
</script>

<template>
  <section class="jf" :style="{ '--brand': brand } as any">
    <header class="jf__head">
      <div v-if="props.eyebrow" class="jf__eyebrow">
        <span class="jf__eyebrow-dot" />
        <span>{{ props.eyebrow }}</span>
      </div>
      <h1 class="jf__title">{{ props.heading }}</h1>
      <p v-if="props.description" class="jf__sub">{{ props.description }}</p>
    </header>

    <div v-if="submitted && !props.successHref" class="jf__success">
      <div class="jf__success-eyebrow">
        <span class="jf__eyebrow-dot" />
        <span>APPLICATION RECEIVED</span>
      </div>
      <h2 class="jf__success-title">{{ props.successHeadline }}</h2>
      <p class="jf__success-body">Thanks {{ form.preferredName || form.fullName }}. The membership committee reviews new applications weekly — expect an email within seven days. If you don't hear back, email membership@ and we'll chase it up.</p>
    </div>

    <form v-else class="jf__body" @submit="onSubmit">
      <!-- Left rail — applying-as summary + progress. -->
      <aside class="jf__rail">
        <div class="jf__summary">
          <div class="jf__summary-eyebrow">
            <span class="jf__eyebrow-dot" />
            <span>APPLYING AS</span>
          </div>
          <div class="jf__summary-name">{{ selectedTier?.name ?? '—' }}</div>
          <div v-if="selectedTier?.description" class="jf__summary-desc">{{ selectedTier.description }}</div>
          <div class="jf__summary-price">
            <span class="jf__summary-fee">{{ priceLabel }}</span>
            <span class="jf__summary-unit">{{ cadenceUnit }}</span>
          </div>
          <div v-if="discountedPrice != null" class="jf__summary-discount">
            <span class="jf__eyebrow-dot" style="background: #fff;" />
            <span>First year 20% off — ${{ discountedPrice }}</span>
          </div>
        </div>

        <ol class="jf__steps">
          <div class="jf__steps-eyebrow">STEPS</div>
          <li v-for="(step, idx) in steps" :key="step.key" class="jf__step">
            <span class="jf__step-marker" :class="{ 'jf__step-marker--done': step.complete }">
              <svg v-if="step.complete" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4" /></svg>
              <template v-else>{{ idx + 1 }}</template>
            </span>
            <span class="jf__step-label" :class="{ 'jf__step-label--muted': !step.complete }">{{ step.label }}</span>
          </li>
        </ol>
      </aside>

      <!-- Right column — the actual form. -->
      <div class="jf__form">
        <!-- 01 · Tier -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">01</div>
            <div class="jf__section-copy">
              <h2>Choose your tier</h2>
              <p>Change or cancel any time. Pricing runs March to March.</p>
            </div>
          </div>
          <div class="jf__tier-grid">
            <label v-for="t in tiers" :key="t.id" class="jf__tier" :class="{ 'jf__tier--selected': (selectedTierId ?? defaultTier?.id) === t.id }">
              <input type="radio" name="tier" :value="t.id" v-model="selectedTierId" class="jf__tier-input" />
              <div class="jf__tier-head">
                <span class="jf__tier-eyebrow">{{ t.isDefault ? 'DEFAULT' : t.name.split(' ')[0]?.toUpperCase() }}</span>
                <span class="jf__radio" :class="{ 'jf__radio--on': (selectedTierId ?? defaultTier?.id) === t.id }">
                  <span v-if="(selectedTierId ?? defaultTier?.id) === t.id" class="jf__radio-dot" />
                </span>
              </div>
              <div class="jf__tier-name">{{ t.name }}</div>
              <div class="jf__tier-price">
                <template v-if="t.fee != null">
                  <span>${{ t.fee }}</span>
                  <span class="jf__tier-unit">{{ cadenceUnit }}</span>
                </template>
                <template v-else>
                  <span class="jf__tier-invited">Invited</span>
                </template>
              </div>
              <div v-if="t.description" class="jf__tier-desc">{{ t.description }}</div>
            </label>
          </div>
        </section>

        <!-- 02 · About you -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">02</div>
            <div class="jf__section-copy">
              <h2>About you</h2>
              <p>Only the membership committee sees this — we never share your details.</p>
            </div>
          </div>
          <div class="jf__fields">
            <div class="jf__row">
              <label class="jf__field">
                <span>Full name</span>
                <input v-model="form.fullName" type="text" autocomplete="name" required />
              </label>
              <label class="jf__field">
                <span>Preferred name <em>(optional)</em></span>
                <input v-model="form.preferredName" type="text" autocomplete="nickname" />
              </label>
            </div>
            <div class="jf__row">
              <label class="jf__field jf__field--narrow">
                <span>Date of birth</span>
                <input v-model="form.dob" type="date" required />
              </label>
              <label class="jf__field">
                <span>Email</span>
                <input v-model="form.email" type="email" autocomplete="email" required />
              </label>
            </div>
            <label class="jf__field jf__field--half">
              <span>Mobile</span>
              <input v-model="form.mobile" type="tel" autocomplete="tel" required />
            </label>
          </div>
        </section>

        <!-- 03 · Address -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">03</div>
            <div class="jf__section-copy">
              <h2>Home address</h2>
              <p>For AGM notices and the annual handbook.</p>
            </div>
          </div>
          <div class="jf__fields">
            <label class="jf__field">
              <span>Street address</span>
              <input v-model="form.street" type="text" autocomplete="street-address" required />
            </label>
            <div class="jf__row">
              <label class="jf__field">
                <span>Suburb / city</span>
                <input v-model="form.suburb" type="text" autocomplete="address-level2" required />
              </label>
              <label class="jf__field jf__field--narrow">
                <span>Postcode</span>
                <input v-model="form.postcode" type="text" autocomplete="postal-code" required />
              </label>
              <label class="jf__field jf__field--narrow">
                <span>Country</span>
                <input v-model="form.country" type="text" autocomplete="country-name" />
              </label>
            </div>
          </div>
        </section>

        <!-- 04 · Your bowls -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">04</div>
            <div class="jf__section-copy">
              <h2>Your bowls</h2>
              <p>So the selectors and coaches know where to slot you in. Everything here is a starting point — plenty of members change it up.</p>
            </div>
          </div>
          <div class="jf__fields">
            <div class="jf__group">
              <span class="jf__group-label">Experience</span>
              <div class="jf__exp-grid">
                <label v-for="opt in EXPERIENCE_OPTIONS" :key="opt.value" class="jf__exp" :class="{ 'jf__exp--selected': form.experience === opt.value }">
                  <input type="radio" name="experience" :value="opt.value" v-model="form.experience" class="jf__tier-input" />
                  <span class="jf__exp-title">{{ opt.label }}</span>
                  <span class="jf__exp-hint">{{ opt.hint }}</span>
                </label>
              </div>
            </div>
            <div class="jf__row jf__row--top">
              <div class="jf__group">
                <span class="jf__group-label">Preferred position</span>
                <div class="jf__chips">
                  <label v-for="opt in POSITION_OPTIONS" :key="opt.value" class="jf__chip" :class="{ 'jf__chip--on': form.position === opt.value }">
                    <input type="radio" name="position" :value="opt.value" v-model="form.position" class="jf__tier-input" />
                    {{ opt.label }}
                  </label>
                </div>
              </div>
              <label v-if="props.showBowlsNumber" class="jf__field jf__field--narrow">
                <span>Bowls NZ number <em>(optional)</em></span>
                <input v-model="form.bowlsNumber" type="text" placeholder="BNZ-000000" />
              </label>
            </div>
            <div v-if="props.showPlayingDays" class="jf__group">
              <div class="jf__group-head">
                <span class="jf__group-label">Playing days available</span>
                <span class="jf__group-hint">Pick as many as work for you</span>
              </div>
              <div class="jf__days">
                <button
                  v-for="d in DAY_KEYS"
                  :key="d"
                  type="button"
                  class="jf__day"
                  :class="{ 'jf__day--on': form.playingDays.has(d) }"
                  @click="toggleDay(d)"
                >{{ d.toUpperCase() }}</button>
              </div>
            </div>
          </div>
        </section>

        <!-- 05 · Emergency contact -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">05</div>
            <div class="jf__section-copy">
              <h2>Emergency contact</h2>
              <p>Someone we can call if you have an accident on the green. Used only in emergencies.</p>
            </div>
          </div>
          <div class="jf__fields">
            <div class="jf__row">
              <label class="jf__field">
                <span>Name</span>
                <input v-model="form.emergencyName" type="text" required />
              </label>
              <label class="jf__field">
                <span>Phone</span>
                <input v-model="form.emergencyPhone" type="tel" required />
              </label>
              <label class="jf__field jf__field--narrow">
                <span>Relationship</span>
                <input v-model="form.emergencyRelation" type="text" placeholder="Partner, family…" />
              </label>
            </div>
          </div>
        </section>

        <!-- 06 · Review & agree -->
        <section class="jf__section">
          <div class="jf__section-head">
            <div class="jf__section-no">06</div>
            <div class="jf__section-copy">
              <h2>Review &amp; agree</h2>
              <p>One last look. Add anything you want the committee to know, then submit.</p>
            </div>
          </div>
          <div class="jf__fields">
            <label class="jf__field">
              <span>Anything else the committee should know? <em>(optional)</em></span>
              <textarea v-model="form.note" rows="4" placeholder="Allergies, mobility needs, coaching aspirations, or anything else you'd like to share." />
            </label>
            <label class="jf__field jf__field--half">
              <span>How did you hear about us?</span>
              <input v-model="form.referrer" type="text" placeholder="A club member, Google, an event…" />
            </label>

            <div class="jf__consent">
              <label class="jf__consent-row">
                <input type="checkbox" v-model="form.consentTerms" />
                <span class="jf__consent-copy">
                  <span>I agree to the club's
                    <a v-if="props.termsHref" :href="props.termsHref" target="_blank" rel="noopener">code of conduct + bylaws</a>
                    <template v-else>code of conduct + bylaws</template>
                    and
                    <a v-if="props.privacyHref" :href="props.privacyHref" target="_blank" rel="noopener">privacy policy</a>
                    <template v-else>privacy policy</template>.
                  </span>
                  <span class="jf__consent-hint">You can revoke consent any time by emailing the membership secretary.</span>
                </span>
              </label>
              <label class="jf__consent-row">
                <input type="checkbox" v-model="form.consentNewsletter" />
                <span>Keep me in the loop with the monthly newsletter — roll-up dates, results, and social nights.</span>
              </label>
              <label class="jf__consent-row">
                <input type="checkbox" v-model="form.consentPhoto" />
                <span>Happy to appear in club photos, results, and the honour board.</span>
              </label>
            </div>

            <p v-if="submitError" class="jf__error">{{ submitError }}</p>

            <div class="jf__actions">
              <button type="submit" class="jf__submit" :disabled="submitting">
                <span>{{ submitting ? 'Submitting…' : 'Submit my application' }}</span>
                <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
              </button>
              <span class="jf__encrypted">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="8" width="11" height="8" rx="1.5"/><path d="M7 8V6a3 3 0 016 0v2"/></svg>
                <span>ENCRYPTED · TLS 1.3</span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </form>
  </section>
</template>

<style scoped>
.jf {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: 72px;
}

/* Header */
.jf__head { display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; padding-bottom: 64px; border-bottom: 1px solid var(--color-hairline); }
.jf__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.jf__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.jf__title { font-family: var(--font-display); font-size: clamp(48px, 7vw, 88px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; margin: 0; }
.jf__sub { font-family: var(--font-body); font-size: 18px; line-height: 150%; color: var(--color-fog); margin: 0; max-width: 640px; }

/* Body layout — rail + form */
.jf__body { display: grid; grid-template-columns: 340px 1fr; gap: 64px; align-items: flex-start; }
.jf__rail { display: flex; flex-direction: column; gap: 24px; position: sticky; top: 32px; }

/* Summary card */
.jf__summary { display: flex; flex-direction: column; gap: 20px; padding: 28px; background: var(--color-ink); color: #fff; border-radius: 20px; }
.jf__summary-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: rgba(255,255,255,0.6); text-transform: uppercase; }
.jf__summary-name { font-family: var(--font-display); font-size: 32px; font-weight: 700; line-height: 105%; letter-spacing: -0.02em; }
.jf__summary-desc { font-family: var(--font-body); font-size: 14px; line-height: 150%; color: rgba(255,255,255,0.6); }
.jf__summary-price { display: flex; align-items: baseline; gap: 8px; }
.jf__summary-fee { font-family: var(--font-display); font-size: 56px; font-weight: 700; line-height: 100%; letter-spacing: -0.02em; }
.jf__summary-unit { font-family: var(--font-body); font-size: 14px; color: rgba(255,255,255,0.6); }
.jf__summary-discount { display: inline-flex; align-self: flex-start; align-items: center; gap: 6px; padding: 6px 12px; background: var(--brand); color: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; }

/* Steps */
.jf__steps { list-style: none; padding: 8px 4px; margin: 0; display: flex; flex-direction: column; gap: 14px; }
.jf__steps-eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.jf__step { display: flex; align-items: center; gap: 12px; }
.jf__step-marker { width: 20px; height: 20px; border-radius: 999px; background: transparent; border: 1px solid var(--color-hairline); color: var(--color-mute); font-family: var(--font-mono); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.jf__step-marker--done { background: var(--color-ink); border-color: var(--color-ink); color: #fff; }
.jf__step-label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.jf__step-label--muted { font-weight: 500; color: var(--color-fog); }

/* Form column + sections */
.jf__form { display: flex; flex-direction: column; gap: 56px; }
.jf__section { display: flex; flex-direction: column; gap: 32px; padding-top: 56px; border-top: 1px solid var(--color-hairline); }
.jf__section:first-child { padding-top: 0; border-top: 0; }
.jf__section-head { display: flex; align-items: baseline; gap: 24px; }
.jf__section-no { width: 32px; flex-shrink: 0; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-mute); text-transform: uppercase; }
.jf__section-copy { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.jf__section-copy h2 { font-family: var(--font-display); font-size: 32px; font-weight: 700; line-height: 105%; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.jf__section-copy p { font-family: var(--font-body); font-size: 15px; color: var(--color-fog); line-height: 150%; margin: 0; }

/* Tier grid */
.jf__tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding-left: 56px; }
.jf__tier { display: flex; flex-direction: column; gap: 12px; padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; cursor: pointer; transition: border-color 160ms, box-shadow 160ms, transform 160ms; }
.jf__tier:hover { border-color: var(--color-ink); transform: translateY(-1px); }
.jf__tier--selected { background: var(--color-ink); color: #fff; border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 20%, transparent); }
.jf__tier-input { position: absolute; opacity: 0; pointer-events: none; }
.jf__tier-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.jf__tier-eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.jf__tier--selected .jf__tier-eyebrow { color: rgba(255,255,255,0.6); }
.jf__radio { width: 20px; height: 20px; border-radius: 999px; border: 1px solid var(--color-hairline); background: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.jf__radio--on { background: var(--brand); border-color: var(--brand); }
.jf__radio-dot { width: 8px; height: 8px; border-radius: 999px; background: #fff; }
.jf__tier-name { font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 105%; letter-spacing: -0.02em; }
.jf__tier-price { display: flex; align-items: baseline; gap: 6px; font-family: var(--font-display); font-size: 36px; font-weight: 700; line-height: 100%; letter-spacing: -0.02em; }
.jf__tier-unit { font-family: var(--font-body); font-size: 13px; font-weight: 400; color: var(--color-fog); }
.jf__tier--selected .jf__tier-unit { color: rgba(255,255,255,0.6); }
.jf__tier-invited { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-fog); }
.jf__tier-desc { font-family: var(--font-body); font-size: 13px; line-height: 150%; color: var(--color-fog); }
.jf__tier--selected .jf__tier-desc { color: rgba(255,255,255,0.7); }

/* Field primitives */
.jf__fields { display: flex; flex-direction: column; gap: 20px; padding-left: 56px; }
.jf__row { display: flex; flex-direction: row; gap: 16px; }
.jf__row--top { align-items: flex-start; }
.jf__field { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.jf__field--narrow { flex: 0 0 200px; }
.jf__field--half { max-width: 320px; }
.jf__field > span { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.jf__field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.jf__field input, .jf__field textarea, .jf__field select {
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-ink);
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.jf__field input:focus, .jf__field textarea:focus, .jf__field select:focus { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 15%, transparent); }
.jf__field textarea { min-height: 96px; line-height: 150%; }
.jf__field input::placeholder, .jf__field textarea::placeholder { color: var(--color-mute); }

/* Groups + labels */
.jf__group { display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 0; }
.jf__group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.jf__group-label { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.jf__group-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }

/* Experience cards */
.jf__exp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.jf__exp { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 120ms, box-shadow 120ms; }
.jf__exp:hover { border-color: var(--color-ink); }
.jf__exp--selected { background: var(--color-ink); color: #fff; border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 20%, transparent); }
.jf__exp-title { font-family: var(--font-body); font-size: 14px; font-weight: 600; }
.jf__exp-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 145%; }
.jf__exp--selected .jf__exp-hint { color: rgba(255,255,255,0.65); }

/* Chip rows (position + days) */
.jf__chips { display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; }
.jf__chip { position: relative; padding: 8px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-graphite); cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; }
.jf__chip:not(.jf__chip--on):hover { border-color: var(--color-ink); color: var(--color-ink); }
.jf__chip--on { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }
.jf__chip--on:hover { background: var(--color-graphite); }

.jf__days { display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; }
.jf__day { padding: 10px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-mono); font-size: 12px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; }
.jf__day:not(.jf__day--on):hover { border-color: var(--color-ink); color: var(--color-ink); }
.jf__day--on { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.jf__day--on:hover { background: var(--color-graphite); }

/* Consent block */
.jf__consent { display: flex; flex-direction: column; gap: 14px; padding: 20px; background: var(--color-surface); border-radius: 14px; }
.jf__consent-row { display: flex; align-items: flex-start; gap: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--color-ink); line-height: 150%; cursor: pointer; }
.jf__consent-row input[type="checkbox"] { appearance: none; -webkit-appearance: none; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--color-hairline); background: #fff; flex-shrink: 0; margin-top: 1px; cursor: pointer; position: relative; }
.jf__consent-row input[type="checkbox"]:checked { background: var(--color-ink); border-color: var(--color-ink); }
.jf__consent-row input[type="checkbox"]:checked::after { content: ''; position: absolute; top: 4px; left: 7px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.jf__consent-copy { display: flex; flex-direction: column; gap: 4px; }
.jf__consent-hint { font-family: var(--font-body); font-size: 12px; font-weight: 400; color: var(--color-fog); line-height: 150%; }
.jf__consent-row a { color: var(--color-ink); text-decoration: underline; text-underline-offset: 3px; }

/* Error */
.jf__error { padding: 12px 16px; background: color-mix(in oklab, var(--color-danger, #DC2F3B) 8%, #fff); color: var(--color-danger, #DC2F3B); border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 500; margin: 0; }

/* Actions */
.jf__actions { display: flex; align-items: center; gap: 20px; padding-top: 8px; flex-wrap: wrap; }
.jf__submit { display: inline-flex; align-items: center; gap: 10px; padding: 18px 32px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: background 120ms; }
.jf__submit:hover:not(:disabled) { background: var(--color-graphite); }
.jf__submit:disabled { opacity: 0.6; cursor: not-allowed; }
.jf__encrypted { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-mute); text-transform: uppercase; }

/* Success state */
.jf__success { display: flex; flex-direction: column; gap: 16px; align-items: center; text-align: center; padding: 96px 24px; }
.jf__success-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.jf__success-title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; letter-spacing: -0.02em; margin: 0; }
.jf__success-body { font-family: var(--font-body); font-size: 16px; line-height: 150%; color: var(--color-fog); max-width: 520px; margin: 0; }

/* Responsive */
@media (max-width: 1023px) {
  .jf__body { grid-template-columns: 1fr; }
  .jf__rail { position: static; }
  .jf__tier-grid { grid-template-columns: 1fr; padding-left: 0; }
  .jf__fields { padding-left: 0; }
  .jf__section-head { flex-direction: column; gap: 8px; }
  .jf__exp-grid { grid-template-columns: repeat(2, 1fr); }
  .jf__row { flex-direction: column; }
  .jf__field--narrow { flex-basis: auto; }
}
</style>
