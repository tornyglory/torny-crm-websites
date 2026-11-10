<script setup lang="ts">
/**
 * torny.co/signup — 4-step signup wizard (brief 88).
 *
 *   ?step=1 → Account (name, email, password)
 *   ?step=2 → Organisation (name, slug w/ live check, type, country, tz)
 *   ?step=3 → Plan picker (Starter / Pro, Pro preselected by type)
 *   ?step=4 → Payment → calls POST /public/signup → redirects to Stripe
 *
 * Stripe success_url lands on /signup/welcome. Cancel lands back here
 * on ?step=4 with the admin already signed in — so they can resume
 * billing from Settings → Billing without re-typing anything.
 */
import { ApiError, auth, AuthError, clubOnboarding } from '@torny/api-client'

/** Minimal "looks like an email" check — server is the source of truth. */
function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
import type { OrgType, PlanKey, SubdomainCheckResult } from '@torny/api-client'

const route = useRoute()
const router = useRouter()
const form = useSignupWizard()

useSeoMeta({
  title: 'Start Your Free Trial — Torny OS',
  description: '30-day free trial. No setup fee. Cancel any time.',
})

// ── Step routing ────────────────────────────────────────────────
const currentStep = computed<1 | 2 | 3 | 4>(() => {
  const raw = Number(route.query.step ?? 1)
  if (raw >= 1 && raw <= 4) return raw as 1 | 2 | 3 | 4
  return 1
})
function go(step: 1 | 2 | 3 | 4) {
  router.push({ query: { ...route.query, step } })
}

// ── Step 1 validation ────────────────────────────────────────────
const step1Valid = computed(() =>
  form.value.name.trim().length >= 2 &&
  isValidEmail(form.value.email.trim()) &&
  form.value.password.length >= 12,
)
function submitStep1() {
  if (!step1Valid.value) return
  go(2)
}

// ── Step 2: slug derivation + live availability check ───────────
watchEffect(() => {
  // Auto-derive slug from org name until the user edits the slug field
  // directly — then we respect their input.
  if (!form.value.slugDirty) {
    form.value.slug = slugify(form.value.orgName)
  }
})

const slugState = ref<
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; value: string }
  | { state: 'unavailable'; reason: 'taken' | 'reserved' | 'invalid' }
  | { state: 'error' }
>({ state: 'idle' })

let slugAbort: AbortController | null = null
let slugDebounce: ReturnType<typeof setTimeout> | null = null

watch(
  () => form.value.slug,
  (next) => {
    if (slugAbort) slugAbort.abort()
    if (slugDebounce) clearTimeout(slugDebounce)
    if (next.length < 3) { slugState.value = { state: 'idle' }; return }
    slugState.value = { state: 'checking' }
    slugDebounce = setTimeout(async () => {
      const controller = new AbortController()
      slugAbort = controller
      try {
        const result: SubdomainCheckResult = await clubOnboarding.checkSubdomain(next, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (result.available) slugState.value = { state: 'available', value: next }
        else slugState.value = { state: 'unavailable', reason: result.reason }
      } catch {
        if (controller.signal.aborted) return
        slugState.value = { state: 'error' }
      }
    }, 220)
  },
)

const step2Valid = computed(() =>
  form.value.orgName.trim().length >= 2 &&
  slugState.value.state === 'available' &&
  form.value.orgType != null,
)
function submitStep2() {
  if (!step2Valid.value) return
  // Auto-pick the recommended plan for the type on first arrival at step 3.
  form.value.plan = defaultPlanFor(form.value.orgType)
  go(3)
}

// ── Step 3: plan picker ─────────────────────────────────────────
function choosePlan(plan: PlanKey) {
  form.value.plan = plan
  go(4)
}

const TRIAL_DAYS = 30
const trialEndDate = computed<Date>(() => {
  const d = new Date()
  d.setDate(d.getDate() + TRIAL_DAYS)
  return d
})
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Step 4: submit → /public/signup → Stripe redirect ───────────
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function submitSignup() {
  if (submitting.value) return
  submitError.value = null
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://torny.co'
  submitting.value = true
  try {
    const result = await auth.signup({
      user: {
        name: form.value.name.trim(),
        email: form.value.email.trim().toLowerCase(),
        password: form.value.password,
      },
      organisation: {
        name: form.value.orgName.trim(),
        slug: form.value.slug,
        org_type: form.value.orgType as OrgType,
        country: form.value.country,
        timezone: form.value.timezone,
      },
      plan: form.value.plan,
      success_url: `${origin}/signup/welcome?org=${encodeURIComponent(form.value.slug)}`,
      cancel_url: `${origin}/signup?step=4`,
    }, { idempotencyKey: form.value.idempotencyKey })

    // Persist the session token so when Stripe bounces the admin back
    // they're already signed in. Matches the key `/sign-in` uses.
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('torny.token', result.auth_token)
    }
    // Hand over to Stripe-hosted Checkout.
    if (typeof window !== 'undefined') {
      window.location.href = result.checkout_url
    }
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'email_in_use') {
        submitError.value = `That email is already registered. Try signing in instead.`
      } else if (err.code === 'slug_unavailable') {
        submitError.value = `Your organisation name was taken while you were setting up. Go back a step and pick a new one.`
      } else {
        submitError.value = err.message || 'Could not start your signup. Try again.'
      }
    } else if (err instanceof ApiError) {
      submitError.value = err.message || 'Could not start your signup. Try again.'
    } else {
      submitError.value = 'Could not start your signup. Try again.'
    }
    submitting.value = false
  }
}

// ── Guards: can't jump past where you've filled in ──────────────
watchEffect(() => {
  if (!process.client) return
  const s = currentStep.value
  if (s >= 2 && !step1Valid.value) go(1)
  else if (s >= 3 && !step2Valid.value) go(2)
})

// Category picker rows + copy — mirrors the Paper mockup.
const ORG_TYPES: Array<{ value: OrgType; label: string; sub: string }> = [
  { value: 'sports_and_recreation',  label: 'Sports & recreation',  sub: 'Bowls, golf, tennis, boating' },
  { value: 'fitness_and_wellness',   label: 'Fitness & wellness',   sub: 'Yoga, gym, martial arts' },
  { value: 'arts_and_culture',       label: 'Arts & culture',       sub: 'Theatre, choir, dance' },
  { value: 'community_and_civic',    label: 'Community & civic',    sub: 'Town hall, RSA, church' },
  { value: 'youth_groups',           label: 'Youth groups',         sub: 'Scouts, Guides, cadets' },
  { value: 'hospitality',            label: 'Hospitality',          sub: 'Pub, bar, restaurant, cafe' },
  { value: 'holiday_accommodation',  label: 'Holiday accommodation',sub: 'B&B, lodge, holiday park' },
  { value: 'events_venue',           label: 'Events venue',         sub: 'Weddings, functions' },
  { value: 'non_profit',             label: 'Non-profit',           sub: 'Charity, trust, foundation' },
  { value: 'other',                  label: 'Other',                sub: "We'll figure it out together" },
]
</script>

<template>
  <div class="wiz">
    <!-- Top bar -->
    <header class="wiz__bar">
      <a href="/" class="wiz__brand">
        <span class="wiz__brand-dot" />
        <span class="wiz__brand-wordmark">Torny</span>
        <span class="wiz__brand-tag">OS</span>
      </a>
      <div class="wiz__bar-right">
        <template v-if="currentStep === 1">
          <span class="wiz__bar-muted">Already a member?</span>
          <NuxtLink to="/sign-in" class="wiz__bar-ghost">Sign in ↗</NuxtLink>
        </template>
        <template v-else>
          <button type="button" class="wiz__bar-ghost" @click="go((currentStep - 1) as 1 | 2 | 3 | 4)">← Back</button>
        </template>
      </div>
    </header>

    <!-- Progress rail -->
    <div class="wiz__rail">
      <div class="wiz__rail-label">Step 0{{ currentStep }} · of 04</div>
      <div class="wiz__rail-pips">
        <span v-for="i in 4" :key="i" class="wiz__rail-pip" :class="{
          'is-done': i < currentStep,
          'is-active': i === currentStep,
        }" />
      </div>
    </div>

    <!-- ── STEP 1 — Account ─────────────────────────────────────── -->
    <section v-if="currentStep === 1" class="wiz__step">
      <h1 class="wiz__title">Let's start with you.</h1>
      <p class="wiz__sub">
        The admin who signs up here becomes the owner of the Torny account.
        You can invite more admins once you're in.
      </p>
      <form class="wiz__card" @submit.prevent="submitStep1">
        <label class="wiz__field">
          <span class="wiz__label">Your name</span>
          <input v-model.trim="form.name" type="text" autocomplete="name" placeholder="Sarah Whittaker" required />
        </label>
        <label class="wiz__field">
          <span class="wiz__label">Work email</span>
          <input v-model.trim="form.email" type="email" autocomplete="email" placeholder="sarah@yourclub.co.nz" required />
        </label>
        <label class="wiz__field">
          <span class="wiz__label">Password</span>
          <input v-model="form.password" type="password" autocomplete="new-password" placeholder="At least 12 characters" required />
          <span class="wiz__hint">At least 12 characters.</span>
        </label>
        <button class="wiz__primary" type="submit" :disabled="!step1Valid">
          Continue · Step 2 of 4 →
        </button>
      </form>
    </section>

    <!-- ── STEP 2 — Organisation ────────────────────────────────── -->
    <section v-else-if="currentStep === 2" class="wiz__step">
      <h1 class="wiz__title">About your place.</h1>
      <p class="wiz__sub">
        Tell us what you run. This picks the right default plan and preloads
        sample content on your public site — you can change any of it later.
      </p>
      <form class="wiz__card wiz__card--wide" @submit.prevent="submitStep2">
        <div class="wiz__row">
          <label class="wiz__field" style="flex: 1.4;">
            <span class="wiz__label">Organisation name</span>
            <input v-model.trim="form.orgName" type="text" placeholder="Thorndon Bowling Club" required />
          </label>
          <label class="wiz__field" style="flex: 1;">
            <span class="wiz__label">Country</span>
            <select v-model="form.country">
              <option value="NZ">New Zealand</option>
              <option value="AU">Australia</option>
            </select>
          </label>
        </div>

        <label class="wiz__field">
          <span class="wiz__label">Your public website</span>
          <div class="wiz__slug" :class="{
            'is-ok':    slugState.state === 'available',
            'is-bad':   slugState.state === 'unavailable',
            'is-busy':  slugState.state === 'checking',
          }">
            <input
              :value="form.slug"
              type="text"
              placeholder="thorndon-bowling-club"
              @input="(ev) => { form.slug = (ev.target as HTMLInputElement).value; form.slugDirty = true }"
            />
            <span class="wiz__slug-suffix">.torny.co</span>
            <span class="wiz__slug-badge">
              <template v-if="slugState.state === 'checking'">Checking…</template>
              <template v-else-if="slugState.state === 'available'">✓ Available</template>
              <template v-else-if="slugState.state === 'unavailable' && slugState.reason === 'taken'">Taken</template>
              <template v-else-if="slugState.state === 'unavailable' && slugState.reason === 'reserved'">Reserved</template>
              <template v-else-if="slugState.state === 'unavailable' && slugState.reason === 'invalid'">Invalid</template>
              <template v-else-if="slugState.state === 'error'">Try again</template>
            </span>
          </div>
        </label>

        <div class="wiz__field">
          <span class="wiz__label">What are you?</span>
          <div class="wiz__types">
            <button
              v-for="t in ORG_TYPES"
              :key="t.value"
              type="button"
              class="wiz__type"
              :class="{ 'is-on': form.orgType === t.value }"
              @click="form.orgType = t.value"
            >
              <span class="wiz__type-name">{{ t.label }}</span>
              <span class="wiz__type-sub">{{ t.sub }}</span>
            </button>
          </div>
        </div>

        <div class="wiz__row wiz__row--bottom">
          <button class="wiz__primary" type="submit" :disabled="!step2Valid">
            Continue · Step 3 of 4 →
          </button>
          <p v-if="form.orgType" class="wiz__aside">
            We'll preset you on <strong>{{ defaultPlanFor(form.orgType) === 'pro' ? 'Pro' : 'Starter' }}</strong>
            since {{ ORG_TYPES.find((t) => t.value === form.orgType)?.label.toLowerCase() }}
            {{ defaultPlanFor(form.orgType) === 'pro' ? 'unlocks venue hire, tournaments and more' : 'uses the Starter essentials' }}.
            You can change it.
          </p>
        </div>
      </form>
    </section>

    <!-- ── STEP 3 — Pick plan ───────────────────────────────────── -->
    <section v-else-if="currentStep === 3" class="wiz__step">
      <h1 class="wiz__title">Pick your plan.</h1>
      <p class="wiz__sub">
        30 days free either way. You can switch between Starter and Pro any
        time from Settings → Billing.
      </p>
      <div class="wiz__plans">
        <!-- Starter -->
        <div class="wiz__plan" :class="{ 'is-on': form.plan === 'starter' }">
          <div class="wiz__plan-eyebrow">STARTER</div>
          <div class="wiz__plan-price">
            <span class="wiz__plan-amount">$39</span>
            <span class="wiz__plan-period">/ month · NZD</span>
          </div>
          <p class="wiz__plan-blurb">
            The essentials — memberships, comms, events, payments, public website.
          </p>
          <ul class="wiz__plan-list">
            <li>Public website + domain</li>
            <li>Memberships, applications, payments</li>
            <li>Event calendar + RSVPs</li>
            <li>Email campaigns + templates</li>
            <li>Public enquiries inbox</li>
            <li class="muted">— Venue bookings · Pro only</li>
            <li class="muted">— Tournaments + team selections · Pro</li>
            <li class="muted">— Honour boards · Pro</li>
          </ul>
          <button class="wiz__plan-cta wiz__plan-cta--ghost" type="button" @click="choosePlan('starter')">
            Pick Starter
          </button>
        </div>

        <!-- Pro -->
        <div class="wiz__plan wiz__plan--pro" :class="{ 'is-on': form.plan === 'pro' }">
          <div class="wiz__plan-reco" v-if="defaultPlanFor(form.orgType) === 'pro'">● Recommended for you</div>
          <div class="wiz__plan-eyebrow">PRO</div>
          <div class="wiz__plan-price">
            <span class="wiz__plan-amount">$79</span>
            <span class="wiz__plan-period">/ month · NZD</span>
          </div>
          <p class="wiz__plan-blurb">
            Everything in Starter, plus the pieces a venue or sports club needs.
          </p>
          <ul class="wiz__plan-list">
            <li><strong>Everything in Starter</strong></li>
            <li>Venue bookings + packages + capacity</li>
            <li>Tournaments (draw, roster, payments)</li>
            <li>Team selections + announcements</li>
            <li>Honour boards + history</li>
            <li>Stripe Connect for deposits + entries</li>
            <li>Priority support</li>
          </ul>
          <button class="wiz__plan-cta" type="button" @click="choosePlan('pro')">
            Continue with Pro · Step 4 →
          </button>
          <p class="wiz__plan-fine">
            Free until <strong>{{ fmtDate(trialEndDate) }}</strong>. Cancel from Settings any time.
          </p>
        </div>
      </div>
    </section>

    <!-- ── STEP 4 — Payment handoff ─────────────────────────────── -->
    <section v-else class="wiz__step">
      <h1 class="wiz__title">Save your card.</h1>
      <p class="wiz__sub">
        You won't be charged today. We ask for a card now so your site keeps
        running the day your trial ends — no scramble, no interruption.
      </p>

      <div class="wiz__pay">
        <div class="wiz__pay-card">
          <div class="wiz__pay-head">
            <div class="wiz__pay-title">Payment method</div>
            <div class="wiz__pay-stripe">Secured by Stripe</div>
          </div>
          <div class="wiz__pay-explainer">
            We'll hand you over to <strong>Stripe-hosted Checkout</strong> to
            capture your card securely. Your card details never touch Torny's
            servers.
          </div>
          <ul class="wiz__pay-bullets">
            <li><strong>No charge until {{ fmtDate(trialEndDate) }}.</strong> We'll email you 3 days before.</li>
            <li><strong>Cancel in two clicks</strong> from Settings → Billing.</li>
            <li><strong>Switch Pro ↔ Starter</strong> any time. We'll prorate the next bill.</li>
          </ul>
          <button class="wiz__primary wiz__pay-cta" type="button" :disabled="submitting" @click="submitSignup">
            <template v-if="submitting">
              <span class="wiz__spinner" aria-hidden="true" /> Taking you to Stripe…
            </template>
            <template v-else>Save card · Start trial <span class="wiz__pay-chip">$0.00 TODAY</span></template>
          </button>
          <p v-if="submitError" class="wiz__error">{{ submitError }}</p>
        </div>

        <aside class="wiz__pay-sum">
          <div class="wiz__pay-sum-eyebrow">Order summary</div>
          <div class="wiz__pay-sum-row">
            <div>
              <div class="wiz__pay-sum-title">Torny OS · {{ form.plan === 'pro' ? 'Pro' : 'Starter' }}</div>
              <div class="wiz__pay-sum-sub">{{ form.orgName || 'Your organisation' }}</div>
            </div>
            <div class="wiz__pay-sum-amount">
              <div>{{ form.plan === 'pro' ? '$79' : '$39' }}</div>
              <div class="wiz__pay-sum-period">/ month</div>
            </div>
          </div>
          <div class="wiz__pay-sum-grid">
            <div><div>Trial starts</div><div>Today</div></div>
            <div><div>Trial ends</div><div>{{ fmtDate(trialEndDate) }}</div></div>
            <div><div>First charge</div><div>{{ fmtDate(trialEndDate) }}</div></div>
            <div><div>Billed to</div><div>{{ form.email || '—' }}</div></div>
          </div>
          <div class="wiz__pay-today">
            <div class="wiz__pay-today-label">TODAY'S CHARGE</div>
            <div class="wiz__pay-today-amount">$0.00</div>
          </div>
        </aside>
      </div>
    </section>

    <!-- Footer -->
    <footer class="wiz__foot">
      By continuing you agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy notice</a>.
      30 days free, then $39 or $79/month depending on the plan you pick.
    </footer>
  </div>
</template>

<style scoped>
@import url("@torny/design-tokens/tokens.css");

.wiz {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 20% 0%, #0E1A2F 0%, #050912 55%, #000 100%);
  color: #fff;
  font-family: var(--font-body, 'Inter', sans-serif);
  padding: 40px 80px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.wiz__bar { display: flex; justify-content: space-between; align-items: center; }
.wiz__brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.wiz__brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #2563EB; }
.wiz__brand-wordmark { font-family: var(--font-display, 'Space Grotesk'); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.wiz__brand-tag { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 11px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.5); padding-top: 2px; }
.wiz__bar-right { display: flex; align-items: center; gap: 16px; }
.wiz__bar-muted { font-size: 13px; color: rgba(255,255,255,0.55); }
.wiz__bar-ghost { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); padding: 10px 16px; border-radius: 999px; font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; }

.wiz__rail { margin: 72px auto 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.wiz__rail-label { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); text-transform: uppercase; }
.wiz__rail-pips { display: flex; gap: 8px; }
.wiz__rail-pip { width: 48px; height: 3px; border-radius: 999px; background: rgba(255,255,255,0.15); }
.wiz__rail-pip.is-done { background: rgba(255,255,255,0.4); }
.wiz__rail-pip.is-active { background: #fff; }

.wiz__step { margin: 0 auto; max-width: 1180px; width: 100%; }
.wiz__title { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 56px; letter-spacing: -0.03em; line-height: 100%; text-align: center; margin: 0 0 20px; }
.wiz__sub { text-align: center; max-width: 620px; margin: 0 auto 44px; font-size: 15px; line-height: 155%; color: rgba(255,255,255,0.6); }

.wiz__card { background: #fff; color: #0A0A0B; border-radius: 20px; padding: 36px; display: flex; flex-direction: column; gap: 20px; max-width: 540px; margin: 0 auto; }
.wiz__card--wide { max-width: 920px; }

.wiz__row { display: flex; gap: 16px; align-items: flex-start; }
.wiz__row--bottom { align-items: center; margin-top: 8px; }

.wiz__field { display: flex; flex-direction: column; gap: 8px; }
.wiz__label { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #6B6B72; text-transform: uppercase; }
.wiz__field input, .wiz__field select { padding: 14px 16px; border: 1px solid #E7E7E1; border-radius: 12px; font-family: inherit; font-size: 15px; color: #0A0A0B; background: #fff; outline: none; box-sizing: border-box; width: 100%; }
.wiz__field input:focus, .wiz__field select:focus { border-color: #0A0A0B; border-width: 1.5px; }
.wiz__hint { font-size: 12px; color: #6B6B72; }

.wiz__slug { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid #E7E7E1; border-radius: 12px; background: #F5F5F2; font-family: var(--font-mono, 'JetBrains Mono'); font-size: 14px; }
.wiz__slug input { flex: 1; border: 0; background: transparent; padding: 0; font-family: inherit; font-size: 14px; color: #0A0A0B; outline: none; }
.wiz__slug-suffix { color: #A3A39B; }
.wiz__slug-badge { font-family: var(--font-body, 'Inter'); font-size: 12px; font-weight: 500; color: #6B6B72; white-space: nowrap; }
.wiz__slug.is-ok    { border-color: rgba(22, 163, 74, 0.35); }
.wiz__slug.is-ok    .wiz__slug-badge { color: #16A34A; }
.wiz__slug.is-bad   { border-color: rgba(220, 47, 59, 0.35); }
.wiz__slug.is-bad   .wiz__slug-badge { color: #DC2F3B; }
.wiz__slug.is-busy  .wiz__slug-badge { color: #6B6B72; }

.wiz__types { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 4px; }
.wiz__type { padding: 14px 12px; background: #fff; color: #0A0A0B; border: 1px solid #E7E7E1; border-radius: 12px; display: flex; flex-direction: column; gap: 4px; text-align: left; cursor: pointer; font-family: inherit; }
.wiz__type.is-on { background: #0A0A0B; color: #fff; border-color: #0A0A0B; }
.wiz__type-name { font-size: 13px; font-weight: 600; }
.wiz__type-sub { font-size: 11px; color: #6B6B72; }
.wiz__type.is-on .wiz__type-sub { color: rgba(255,255,255,0.55); }

.wiz__primary { padding: 16px 20px; background: #0A0A0B; color: #fff; border: 0; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 10px; }
.wiz__primary:disabled { opacity: 0.4; cursor: not-allowed; }
.wiz__aside { flex: 1; margin: 0 0 0 16px; font-size: 12px; color: #6B6B72; line-height: 150%; }
.wiz__aside strong { color: #0A0A0B; font-weight: 600; }

.wiz__plans { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 44px; max-width: 1120px; margin-inline: auto; }
.wiz__plan { padding: 32px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; display: flex; flex-direction: column; gap: 20px; color: #fff; }
.wiz__plan--pro { background: #fff; color: #0A0A0B; border-color: #fff; box-shadow: 0 32px 72px -12px rgba(37, 99, 235, 0.45); position: relative; }
.wiz__plan-reco { position: absolute; top: 16px; right: 16px; padding: 6px 12px; background: #0A0A0B; color: #fff; border-radius: 999px; font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
.wiz__plan-eyebrow { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: rgba(0,0,0,0.5); text-transform: uppercase; }
.wiz__plan:not(.wiz__plan--pro) .wiz__plan-eyebrow { color: rgba(255,255,255,0.65); }
.wiz__plan-price { display: flex; align-items: baseline; gap: 6px; }
.wiz__plan-amount { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 64px; letter-spacing: -0.03em; line-height: 100%; }
.wiz__plan-period { font-size: 13px; color: rgba(0,0,0,0.55); }
.wiz__plan:not(.wiz__plan--pro) .wiz__plan-period { color: rgba(255,255,255,0.55); }
.wiz__plan-blurb { font-size: 14px; line-height: 155%; margin: 0; }
.wiz__plan:not(.wiz__plan--pro) .wiz__plan-blurb { color: rgba(255,255,255,0.75); }
.wiz__plan-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.wiz__plan-list li.muted { color: rgba(255,255,255,0.4); }
.wiz__plan-cta { margin-top: auto; padding: 14px 20px; background: #0A0A0B; color: #fff; border: 0; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.wiz__plan-cta--ghost { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #fff; }
.wiz__plan-fine { margin: 10px 0 0; text-align: center; font-size: 12px; color: #6B6B72; }

.wiz__pay { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; max-width: 1120px; margin: 44px auto 0; width: 100%; }
.wiz__pay-card { padding: 36px; background: #fff; color: #0A0A0B; border-radius: 20px; display: flex; flex-direction: column; gap: 24px; }
.wiz__pay-head { display: flex; align-items: center; justify-content: space-between; }
.wiz__pay-title { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 22px; letter-spacing: -0.02em; }
.wiz__pay-stripe { padding: 6px 12px; background: #F5F5F2; border: 1px solid #E7E7E1; border-radius: 999px; font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #6B6B72; text-transform: uppercase; }
.wiz__pay-explainer { padding: 20px; background: #F5F5F2; border: 1px dashed #E7E7E1; border-radius: 14px; font-size: 14px; color: #2E2E33; line-height: 155%; }
.wiz__pay-bullets { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.wiz__pay-bullets li { padding-left: 32px; position: relative; font-size: 13px; color: #0A0A0B; }
.wiz__pay-bullets li::before { content: '✓'; position: absolute; left: 0; width: 20px; height: 20px; border-radius: 50%; background: rgba(22, 163, 74, 0.1); color: #16A34A; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.wiz__pay-cta { gap: 10px; }
.wiz__pay-chip { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 11px; letter-spacing: 0.1em; color: rgba(255,255,255,0.65); }
.wiz__error { padding: 10px 14px; background: rgba(220, 47, 59, 0.1); border: 1px solid rgba(220, 47, 59, 0.3); border-radius: 10px; color: #DC2F3B; font-size: 13px; margin: 0; }

.wiz__pay-sum { padding: 36px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; color: #fff; display: flex; flex-direction: column; gap: 22px; }
.wiz__pay-sum-eyebrow { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); text-transform: uppercase; }
.wiz__pay-sum-row { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 20px; border-bottom: 1px dashed rgba(255,255,255,0.1); }
.wiz__pay-sum-title { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 20px; }
.wiz__pay-sum-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; }
.wiz__pay-sum-amount { text-align: right; }
.wiz__pay-sum-amount > div:first-child { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 20px; }
.wiz__pay-sum-period { font-size: 12px; color: rgba(255,255,255,0.55); }
.wiz__pay-sum-grid { display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: rgba(255,255,255,0.75); }
.wiz__pay-sum-grid > div { display: flex; justify-content: space-between; }
.wiz__pay-today { margin-top: auto; padding: 16px; background: rgba(135, 206, 235, 0.08); border: 1px solid rgba(135, 206, 235, 0.25); border-radius: 12px; }
.wiz__pay-today-label { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #87CEEB; text-transform: uppercase; margin-bottom: 6px; }
.wiz__pay-today-amount { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 32px; letter-spacing: -0.02em; line-height: 100%; color: #fff; }

.wiz__foot { margin: 48px auto 0; text-align: center; font-size: 12px; color: rgba(255,255,255,0.4); max-width: 720px; }
.wiz__foot a { color: rgba(255,255,255,0.7); text-decoration: underline; }

/* Inline spinner for the "Taking you to Stripe…" state */
.wiz__spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(255,255,255,0.35);
  border-top-color: currentColor;
  animation: wiz-spin 0.8s linear infinite;
  vertical-align: -2px;
  margin-right: 8px;
}
@keyframes wiz-spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .wiz { padding: 24px 20px; }
  .wiz__title { font-size: 36px; }
  .wiz__row { flex-direction: column; }
  .wiz__row--bottom { align-items: stretch; }
  .wiz__aside { margin: 12px 0 0; }
  .wiz__types { grid-template-columns: repeat(2, 1fr); }
  .wiz__plans, .wiz__pay { grid-template-columns: 1fr; }
}
</style>
