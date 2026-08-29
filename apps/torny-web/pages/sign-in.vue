<script setup lang="ts">
/**
 * torny.co/sign-in — the Torny web app's front door.
 *
 * Optional ?club=slug query param fetches that club's brand payload and
 * skins the left rail with its logo, name, and accent colour so a member
 * arriving from `[slug].torny.co` feels continuity at the auth moment.
 * Without the param, the page shows Torny's generic surface.
 */
import { computed, ref, watch } from 'vue'

const route = useRoute()
const clubParam = computed(() => {
  const raw = route.query.club
  if (typeof raw !== 'string') return null
  return raw.trim().toLowerCase() || null
})

// Nuxt warns when useAsyncData's handler returns null/undefined, so we
// wrap the null case in an object and unwrap it after.
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

// ── Brand-driven CSS custom properties ─────────────────────────
// Defaults reflect Torny's generic surface; overridden by the club skin
// when a valid ?club= slug is present.
const brandStyles = computed(() => {
  const s = skin.value
  const out: Record<string, string> = {}
  if (s?.accentColour) {
    out['--brand-accent'] = s.accentColour
    // Derived tint for focus glow — the CRM uses the same pattern.
    out['--brand-accent-glow'] = `${s.accentColour}14` // ~8% alpha via hex suffix
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

// Display copy — falls back to a warm Torny welcome when no club skin.
const displayName = computed(() => skin.value?.name ?? 'Torny')
const displayInitial = computed(() => (skin.value?.name ?? 'T').charAt(0).toUpperCase())
const eyebrow = computed(() => {
  if (skin.value?.foundedYear) {
    const bits = [`Est. '${String(skin.value.foundedYear).slice(-2)}`]
    if (skin.value.region) bits.push(skin.value.region)
    return bits.join(' · ').toUpperCase()
  }
  return 'MEMBER PORTAL'
})
const headline = computed(() =>
  skin.value ? ['Welcome', 'back to', 'the greens.'] : ['Sign in', 'to your', 'Torny.'],
)
const subCopy = computed(() =>
  skin.value
    ? "Sign in to check your subs, RSVP for what's on, update your details, and see who else is rolling this week. Your Torny login works across every club you're a member of."
    : "One login for every club you're a part of. Check your subs, RSVP for what's on, and see who's rolling this week.",
)
const backHref = computed(() => skin.value?.publicSiteUrl ?? 'https://torny.co')
const backLabel = computed(() => {
  if (!skin.value) return 'torny.co'
  try { return new URL(skin.value.publicSiteUrl).host } catch { return 'Back' }
})
const registerCopy = computed(() =>
  skin.value ? `New to ${skin.value.name.split(' ')[0]}?` : 'No account yet?',
)
const registerHref = computed(() =>
  skin.value ? `${skin.value.publicSiteUrl}/membership` : '/register',
)

// ── Form state — minimal, mocked auth for now. Real POST wires later. ─
const form = ref({ email: '', password: '', keepSignedIn: true })
const showPassword = ref(false)
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

async function handleSubmit() {
  if (!form.value.email.trim() || !form.value.password) {
    errorMessage.value = 'Enter your email and password.'
    return
  }
  submitting.value = true
  errorMessage.value = null
  try {
    // TODO: wire to auth.login() from @torny/api-client + persist token.
    await new Promise((r) => setTimeout(r, 500))
    errorMessage.value = 'Auth endpoint not wired yet — coming next.'
  } finally {
    submitting.value = false
  }
}

// SEO — dynamic based on skin.
watch(
  skin,
  (s) => {
    useSeoMeta({
      title: s ? `Sign in to ${s.name} · Torny` : 'Sign in · Torny',
      description: s
        ? `Sign in to your ${s.name} member portal on Torny.`
        : "Sign in to Torny — the bowls club network.",
    })
  },
  { immediate: true },
)

// Stats surfaced in the bottom strip (only when we have a club skin).
const stats = computed(() => {
  const s = skin.value
  if (!s) return []
  const out: Array<{ value: string; label: string }> = []
  if (s.foundedYear) out.push({ value: `Est. '${String(s.foundedYear).slice(-2)}`, label: 'ESTABLISHED' })
  if (s.region) out.push({ value: s.region, label: `${s.country ? `${s.country} ·` : ''} REGION` })
  return out
})
</script>

<template>
  <div class="signin" :style="brandStyles">
    <!-- Left rail — editorial welcome (club-skinned or Torny generic) -->
    <aside class="signin__left">
      <header class="signin__nav">
        <div class="crest">
          <div class="crest__mark" v-if="skin?.logoUrl">
            <img :src="skin.logoUrl" :alt="`${skin.name} logo`" />
          </div>
          <div class="crest__mark crest__mark--initial" v-else>{{ displayInitial }}</div>
          <div class="crest__name">
            <div class="crest__title">{{ displayName }}</div>
            <div class="crest__eyebrow">MEMBER PORTAL</div>
          </div>
        </div>
        <a class="backlink" :href="backHref">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 3L4 7L9 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Back to {{ backLabel }}</span>
        </a>
      </header>

      <section class="hero">
        <div class="hero__eyebrow">{{ eyebrow }} · SIGN IN</div>
        <h1 class="hero__title">
          <span v-for="(line, i) in headline" :key="i">{{ line }}<br v-if="i < headline.length - 1" /></span>
        </h1>
        <p class="hero__sub">{{ subCopy }}</p>
      </section>

      <footer v-if="stats.length > 0" class="stats">
        <div v-for="stat in stats" :key="stat.label" class="stat">
          <div class="stat__value">{{ stat.value }}</div>
          <div class="stat__label">{{ stat.label }}</div>
        </div>
      </footer>
    </aside>

    <!-- Right rail — form card on the surface tint -->
    <main class="signin__right">
      <form class="card" @submit.prevent="handleSubmit">
        <header class="card__head">
          <div class="card__eyebrow">02 — SIGN IN</div>
          <h2 class="card__title">Hi again.</h2>
          <p class="card__sub">Use the same email you gave the club when you joined.</p>
        </header>

        <label class="field">
          <span class="field__label">EMAIL</span>
          <input
            v-model="form.email"
            type="email"
            autocomplete="email"
            spellcheck="false"
            required
            :placeholder="skin ? `you@${skin.slug}.org.nz` : 'you@email.com'"
          />
        </label>

        <label class="field">
          <div class="field__label-row">
            <span class="field__label">PASSWORD</span>
            <a href="#" class="field__hint-link" @click.prevent>Forgot password</a>
          </div>
          <div class="field__with-toggle">
            <input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              placeholder="Your password"
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
        </label>

        <label class="check">
          <input v-model="form.keepSignedIn" type="checkbox" />
          <span class="check__box" aria-hidden="true">
            <svg v-if="form.keepSignedIn" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="var(--color-ground)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="check__label">Keep me signed in on this device</span>
        </label>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

        <button type="submit" class="submit" :disabled="submitting">
          <span>{{ submitting ? 'Signing in…' : 'Sign in to your portal' }}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8H13M13 8L8.5 3.5M13 8L8.5 12.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <footer class="card__foot">
          <span class="card__foot-label">{{ registerCopy }}</span>
          <a class="card__foot-cta" :href="registerHref">
            <span>{{ skin ? 'Apply to join' : 'Register' }}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 6H9.5M9.5 6L6.5 3M9.5 6L6.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </a>
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
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.crest { display: flex; align-items: center; gap: 12px; }
.crest__mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--color-ink);
  color: var(--color-ground);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.02em;
  overflow: hidden;
  flex-shrink: 0;
}
.crest__mark img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
.crest__title {
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 17px;
  color: var(--color-ink);
  letter-spacing: -0.01em;
  line-height: 100%;
}
.crest__eyebrow {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  color: var(--color-fog);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 100%;
  margin-top: 4px;
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

.stats {
  display: flex;
  gap: 56px;
  padding-top: 32px;
  border-top: 1px solid var(--color-hairline);
}
.stat { display: flex; flex-direction: column; gap: 4px; }
.stat__value {
  font-family: var(--brand-font-display);
  font-weight: 700;
  font-size: 32px;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  line-height: 100%;
}
.stat__label {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
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
  gap: 28px;
  width: 100%;
  max-width: 420px;
  padding: 40px 36px;
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 40px -20px rgba(15, 23, 42, 0.06);
}

.card__head { display: flex; flex-direction: column; gap: 12px; }
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
.field__label-row { display: flex; align-items: center; justify-content: space-between; }
.field__label {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.field__hint-link {
  font-family: var(--brand-font-body);
  font-weight: 600;
  font-size: 12px;
  color: var(--brand-accent);
  line-height: 100%;
  transition: opacity 150ms ease;
}
.field__hint-link:hover { opacity: 0.8; }

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

/* ── Check row ────────────────────────────────────────────────── */
.check {
  display: flex;
  align-items: center;
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
}
.check input:checked + .check__box { background: var(--color-ink); }
.check__label {
  font-family: var(--brand-font-body);
  font-weight: 500;
  font-size: 13px;
  color: var(--color-ink);
  line-height: 100%;
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
  .stats { display: none; }
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
