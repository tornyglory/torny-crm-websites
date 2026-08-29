<script setup lang="ts">
/**
 * torny.co/register — sign-up for a new Torny account.
 *
 * Same shape as /sign-in — same left rail (Torny mark + tenant chip when
 * arriving from a club via ?club=slug) and same right column. Different
 * form: name + email + password + terms agreement, primary CTA "Create
 * account". Copy adapts when a tenant is present.
 *
 * Auth still stubbed until backend cookie auth wires up.
 */
import { computed, ref, watch } from 'vue'

const route = useRoute()
const clubParam = computed(() => {
  const raw = route.query.club
  if (typeof raw !== 'string') return null
  return raw.trim().toLowerCase() || null
})

const { data: skinWrap } = await useAsyncData(
  () => `club-skin:${clubParam.value ?? 'none'}`,
  async () => {
    if (!clubParam.value) return { value: null }
    const result = await fetchClubSkin(clubParam.value)
    return { value: result }
  },
  { watch: [clubParam] },
)
const skin = computed<ClubSkin | null>(() => skinWrap.value?.value ?? null)

// ── Brand-driven CSS custom properties (same recipe as sign-in) ────
const brandStyles = computed(() => {
  const s = skin.value
  const out: Record<string, string> = {}
  if (s?.accentColour) {
    out['--brand-accent'] = s.accentColour
    out['--brand-accent-glow'] = `${s.accentColour}14`
  } else {
    out['--brand-accent'] = 'var(--color-accent)'
    out['--brand-accent-glow'] = 'rgba(37, 99, 235, 0.08)'
  }
  if (s?.fontDisplay) out['--brand-font-display'] = `'${s.fontDisplay}', var(--font-display)`
  else out['--brand-font-display'] = 'var(--font-display)'
  if (s?.fontBody) out['--brand-font-body'] = `'${s.fontBody}', var(--font-body)`
  else out['--brand-font-body'] = 'var(--font-body)'
  return out
})

// Hero — always Torny-editorial, tenant identity lives in the chip + FROM pill.
const HERO_HEADLINE = ['One profile.', 'Every green', 'you play.']
const HERO_SUB =
  'Get one Torny account, then use it at every club running on Torny — enter tournaments, track your record, follow players you like.'

const backHref = computed(() => skin.value?.publicSiteUrl ?? 'https://torny.co')
const backLabel = computed(() => {
  if (!skin.value) return 'torny.co'
  try { return new URL(skin.value.publicSiteUrl).host } catch { return 'Back' }
})

// Sign-in preserves the ?club= param so a visitor bouncing between the two
// keeps the tenant context.
const signInHref = computed(() => {
  const path = '/sign-in'
  const next = typeof route.query.next === 'string' ? route.query.next : null
  const params = new URLSearchParams()
  if (clubParam.value) params.set('club', clubParam.value)
  if (next) params.set('next', next)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
})

const tenantHost = computed(() => {
  if (!skin.value) return null
  try { return new URL(skin.value.publicSiteUrl).host } catch { return null }
})
const tenantInitials = computed(() => {
  const n = skin.value?.name
  if (!n) return ''
  return n.split(/\s+/).map((s) => s[0] ?? '').join('').slice(0, 2).toUpperCase()
})
const formSubCopy = computed(() => {
  if (!skin.value) return "Takes about 30 seconds. You can join clubs, follow players, and enter tournaments once you're in."
  const first = skin.value.name.split(/\s+/)[0]
  return `Once you're set up, we'll take you back to ${first} to finish what you started.`
})
const primaryCtaLabel = computed(() => (skin.value ? 'Create account & continue' : 'Create account'))

// ── Form state — mocked until auth wires up. ─────────────────────
const form = ref({ name: '', email: '', password: '', agreeTerms: false })
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

async function handleSubmit() {
  if (!form.value.name.trim() || !form.value.email.trim() || !form.value.password) {
    errorMessage.value = 'Fill in your name, email, and password.'
    return
  }
  if (form.value.password.length < 8) {
    errorMessage.value = 'Password needs to be at least 8 characters.'
    return
  }
  if (!form.value.agreeTerms) {
    errorMessage.value = "You'll need to agree to the terms to create an account."
    return
  }
  submitting.value = true
  errorMessage.value = null
  try {
    // TODO: wire to auth.register() from @torny/api-client + persist token.
    await new Promise((r) => setTimeout(r, 500))
    errorMessage.value = 'Register endpoint not wired yet — coming next.'
  } finally {
    submitting.value = false
  }
}

// SEO
watch(
  skin,
  (s) => {
    useSeoMeta({
      title: s ? `Create your Torny · from ${s.name}` : 'Create your Torny',
      description: 'Set up a Torny account to enter tournaments, track your record, and follow players you like.',
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="signin" :style="brandStyles">
    <!-- Left rail — Torny-primary; tenant chip when arriving from a club -->
    <aside class="signin__left">
      <header class="signin__nav">
        <div class="crest-col">
          <div class="crest">
            <span class="crest__dot" aria-hidden="true"></span>
            <span class="crest__wordmark">Torny</span>
          </div>
          <a v-if="skin && tenantHost" class="tenant-chip" :href="skin.publicSiteUrl">
            <div class="tenant-chip__avatar" :style="skin.accentColour ? { background: skin.accentColour } : {}">
              <img v-if="skin.logoUrl" :src="skin.logoUrl" :alt="`${skin.name} logo`" />
              <span v-else>{{ tenantInitials }}</span>
            </div>
            <div class="tenant-chip__body">
              <div class="tenant-chip__label">CONTINUE TO</div>
              <div class="tenant-chip__host">{{ tenantHost }}</div>
            </div>
          </a>
        </div>
        <a class="backlink" :href="backHref">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 3L4 7L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Back to {{ backLabel }}</span>
        </a>
      </header>

      <section class="hero">
        <div class="hero__eyebrow">CREATE ACCOUNT · MEMBER PORTAL</div>
        <h1 class="hero__title">
          <span v-for="(line, i) in HERO_HEADLINE" :key="i">{{ line }}<br v-if="i < HERO_HEADLINE.length - 1" /></span>
        </h1>
        <p class="hero__sub">{{ HERO_SUB }}</p>
      </section>

      <footer class="foot">
        <div class="foot__label">EST. 2024 · WELLINGTON, NZ</div>
        <div class="foot__copy">© Torny. Bowls, better.</div>
      </footer>
    </aside>

    <!-- Right rail — form card on the surface tint -->
    <main class="signin__right">
      <form class="card" @submit.prevent="handleSubmit">
        <header class="card__head">
          <div v-if="skin" class="card__from">
            <span class="card__from-dot" aria-hidden="true"></span>
            <span>FROM {{ skin.name.toUpperCase() }}</span>
          </div>
          <div class="card__eyebrow">CREATE ACCOUNT</div>
          <h2 class="card__title">Create your Torny.</h2>
          <p class="card__sub">{{ formSubCopy }}</p>
        </header>

        <label class="field">
          <span class="field__label">FULL NAME</span>
          <input
            v-model="form.name"
            type="text"
            autocomplete="name"
            required
            placeholder="First and last name"
          />
        </label>

        <label class="field">
          <span class="field__label">EMAIL</span>
          <input
            v-model="form.email"
            type="email"
            autocomplete="email"
            spellcheck="false"
            required
            placeholder="you@email.com"
          />
        </label>

        <label class="field">
          <span class="field__label">PASSWORD</span>
          <div class="field__with-toggle">
            <input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              required
              placeholder="At least 8 characters"
              minlength="8"
            />
            <button
              type="button"
              class="field__toggle"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              @click="showPassword = !showPassword"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 3.75C4.5 3.75 1.5 9 1.5 9C1.5 9 4.5 14.25 9 14.25C13.5 14.25 16.5 9 16.5 9C16.5 9 13.5 3.75 9 3.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="9" cy="9" r="2.25" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
          </div>
          <span class="field__hint">At least 8 characters.</span>
        </label>

        <label class="check">
          <input v-model="form.agreeTerms" type="checkbox" />
          <span class="check__box" aria-hidden="true">
            <svg v-if="form.agreeTerms" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="var(--color-ground)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="check__label">
            I agree to Torny's <a href="#" @click.prevent>terms of use</a> and <a href="#" @click.prevent>privacy policy</a>.
          </span>
        </label>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

        <button type="submit" class="submit" :disabled="submitting">
          <span>{{ submitting ? 'Creating account…' : primaryCtaLabel }}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <footer class="card__foot">
          <span class="card__foot-label">Already have a Torny?</span>
          <NuxtLink class="card__foot-cta" :to="signInHref">
            <span>Sign in instead</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </NuxtLink>
        </footer>
      </form>
    </main>
  </div>
</template>

<style scoped>
.signin {
  display: flex;
  min-height: 100vh;
  background: var(--color-ground);
  font-family: var(--brand-font-body);
}

/* ── Left rail ────────────────────────────────────────────────── */
.signin__left {
  flex: 1 1 60%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 40px 72px 56px;
  background: var(--color-ground);
  min-width: 0;
}

.signin__nav {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.crest-col { display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
.crest { display: inline-flex; align-items: center; gap: 8px; }
.crest__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--color-accent);
  flex-shrink: 0;
}
.crest__wordmark {
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  line-height: 100%;
}

.tenant-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-pill);
  transition: border-color 150ms ease;
  text-decoration: none;
}
.tenant-chip:hover { border-color: var(--color-mute); }
.tenant-chip__avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 10px;
  flex-shrink: 0;
  overflow: hidden;
}
.tenant-chip__avatar img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
.tenant-chip__body { display: flex; flex-direction: column; gap: 0; line-height: 100%; }
.tenant-chip__label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--color-fog);
  font-weight: 700;
}
.tenant-chip__host {
  font-family: var(--brand-font-body);
  font-size: 12px;
  color: var(--color-ink);
  font-weight: 600;
  margin-top: 3px;
}

.backlink {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--brand-font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-fog);
  transition: color 150ms ease;
}
.backlink:hover { color: var(--color-ink); }

.hero { display: flex; flex-direction: column; gap: 40px; max-width: 720px; }
.hero__eyebrow {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.hero__title {
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: clamp(56px, 8vw, 88px);
  line-height: 100%;
  letter-spacing: -0.03em;
  color: var(--color-ink);
  margin: 0;
}
.hero__sub {
  font-family: var(--brand-font-body);
  font-weight: 400;
  font-size: 18px;
  line-height: 155%;
  color: var(--color-graphite);
  max-width: 520px;
  margin: 0;
}

.foot { display: flex; flex-direction: column; gap: 6px; }
.foot__label {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-mute);
  line-height: 100%;
}
.foot__copy {
  font-family: var(--brand-font-body);
  font-size: 12px;
  color: var(--color-fog);
  line-height: 100%;
}

/* ── Right rail ───────────────────────────────────────────────── */
.signin__right {
  flex: 0 0 540px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: var(--color-surface);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 420px;
  padding: 40px 36px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 40px -20px rgba(15, 23, 42, 0.06);
}

.card__head { display: flex; flex-direction: column; gap: 10px; }
.card__from {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 4px 10px 4px 8px;
  background: var(--brand-accent-glow);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  font-weight: 700;
  color: var(--brand-accent);
  line-height: 100%;
  margin-bottom: 4px;
}
.card__from-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}
.card__eyebrow {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.card__title {
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 40px;
  letter-spacing: -0.03em;
  line-height: 100%;
  color: var(--color-ink);
  margin: 0;
}
.card__sub {
  font-family: var(--brand-font-body);
  font-weight: 400;
  font-size: 14px;
  line-height: 150%;
  color: var(--color-fog);
  margin: 0;
}

/* ── Fields ───────────────────────────────────────────────────── */
.field { display: flex; flex-direction: column; gap: 8px; }
.field__label {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.field__hint {
  font-family: var(--brand-font-body);
  font-size: 12px;
  color: var(--color-fog);
}

.field input {
  width: 100%;
  padding: 14px 16px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md);
  font-family: var(--brand-font-body);
  font-size: 15px;
  color: var(--color-ink);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.field input::placeholder { color: var(--color-mute); }
.field input:focus {
  outline: none;
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px var(--brand-accent-glow);
}

.field__with-toggle { position: relative; }
.field__toggle {
  position: absolute;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  background: transparent;
  border: 0;
  padding: 4px;
  cursor: pointer;
  color: var(--color-fog);
  transition: color 150ms ease;
}
.field__toggle:hover { color: var(--color-ink); }
.field__with-toggle input { padding-right: 44px; }

/* ── Check row (terms) ────────────────────────────────────────── */
.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.check__box {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--color-hairline);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 120ms ease;
  margin-top: 1px;
}
.check input:checked + .check__box { background: var(--color-ink); }
.check__label {
  font-family: var(--brand-font-body);
  font-weight: 500;
  font-size: 13px;
  color: var(--color-graphite);
  line-height: 150%;
}
.check__label a {
  color: var(--color-ink);
  font-weight: 500;
  text-decoration: underline;
}

/* ── Submit ───────────────────────────────────────────────────── */
.submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 24px;
  background: var(--color-ink);
  color: var(--color-accent-ink);
  border: 0;
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-family: var(--brand-font-body);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.005em;
  line-height: 100%;
  transition: transform 150ms ease, opacity 150ms ease;
}
.submit:hover:not(:disabled) { transform: translateY(-1px); }
.submit:disabled { opacity: 0.6; cursor: not-allowed; }

.error {
  font-family: var(--brand-font-body);
  font-size: 13px;
  color: var(--color-danger);
  margin: 0;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border-radius: var(--radius-sm);
  line-height: 150%;
}

/* ── Card foot ────────────────────────────────────────────────── */
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--color-hairline);
}
.card__foot-label {
  font-family: var(--brand-font-body);
  font-weight: 500;
  font-size: 13px;
  color: var(--color-fog);
  line-height: 100%;
}
.card__foot-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--brand-font-body);
  font-weight: 600;
  font-size: 13px;
  color: var(--color-ink);
  line-height: 100%;
  transition: gap 150ms ease;
  text-decoration: none;
}
.card__foot-cta:hover { gap: 10px; }

/* ── Responsive ───────────────────────────────────────────────── */
@media (max-width: 1023px) {
  .signin { flex-direction: column; }
  .signin__left {
    flex: 0 0 auto;
    padding: 32px 24px 24px;
    gap: 32px;
  }
  .signin__right {
    flex: 1 1 auto;
    padding: 24px;
    align-items: flex-start;
  }
  .hero { gap: 24px; }
  .hero__title { font-size: 44px; }
  .hero__sub { font-size: 15px; }
  .foot { display: none; }
}

@media (max-width: 480px) {
  .signin__left { padding: 20px 24px 16px; gap: 24px; }
  .signin__nav { flex-direction: column; align-items: flex-start; gap: 16px; }
  .card { padding: 28px 24px; gap: 20px; border-radius: var(--radius-md); }
  .card__title { font-size: 32px; }
  .field input { padding: 12px 14px; font-size: 14px; }
  .submit { padding: 16px 20px; font-size: 14px; }
}
</style>
