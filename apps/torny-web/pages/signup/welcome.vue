<script setup lang="ts">
/**
 * torny.co/signup/welcome — landing page after Stripe Checkout succeeds.
 *
 * The admin arrives here with `?org=<slug>` in the URL. Their JWT was
 * stored in localStorage before the Stripe redirect so they're already
 * signed in — the first-run checklist links straight into the CRM.
 *
 * Stripe's checkout.session.completed webhook has (within a second or
 * two of this redirect) flipped `subscription_status` to 'trialing' and
 * `plan` to whatever the admin picked. This page doesn't need to wait
 * on the webhook — the CRM will reflect it when they click through.
 */
const route = useRoute()

const slug = computed<string>(() => {
  const raw = route.query.org
  return typeof raw === 'string' && raw.length > 0 ? raw : ''
})
const publicSite = computed<string | null>(() =>
  slug.value ? `https://${slug.value}.torny.co` : null,
)
const CRM_ORIGIN = 'https://app.torny.co'  // adjust when the CRM is on a different host

useSeoMeta({
  title: `You're In — Torny OS`,
  description: 'Welcome aboard. Your site is live. 30 days of Pro, on us.',
})

// Pulled from the wizard state so the welcome copy says "Thorndon Bowling Club"
// instead of a generic string. If someone reloads the welcome URL directly
// (lost state), we fall back to the slug.
const form = useSignupWizard()
const orgName = computed<string>(() => form.value.orgName.trim() || slug.value || 'Your organisation')
</script>

<template>
  <div class="welcome">
    <header class="welcome__bar">
      <a href="/" class="welcome__brand">
        <span class="welcome__brand-dot" />
        <span class="welcome__brand-wordmark">Torny</span>
        <span class="welcome__brand-tag">OS</span>
      </a>
      <div class="welcome__bar-right">
        <div class="welcome__trial">● Trial active · 30 days left</div>
      </div>
    </header>

    <section class="welcome__hero">
      <div class="welcome__eyebrow">You're in · Welcome to Torny OS</div>
      <h1 class="welcome__title">
        {{ orgName }}<br /><span class="welcome__title-faded">is live.</span>
      </h1>
      <p class="welcome__sub">
        Your public site is up
        <template v-if="publicSite">at <a :href="publicSite" class="welcome__link">{{ publicSite }}</a>.</template>
        Here are four things to tick off in the next 10 minutes so it feels like yours.
      </p>
    </section>

    <section class="welcome__grid">
      <a :href="`${CRM_ORIGIN}/website/settings/brand`" class="welcome__card welcome__card--primary">
        <div class="welcome__card-n">01</div>
        <div class="welcome__card-body">
          <div class="welcome__card-title">Upload your logo + pick brand colours</div>
          <div class="welcome__card-sub">Takes 2 minutes. Changes the header on your public site + emails.</div>
          <div class="welcome__card-link">Open Brand settings →</div>
        </div>
      </a>
      <a :href="`${CRM_ORIGIN}/members/invite`" class="welcome__card">
        <div class="welcome__card-n">02</div>
        <div class="welcome__card-body">
          <div class="welcome__card-title">Invite your committee</div>
          <div class="welcome__card-sub">Add the treasurer, secretary and one or two others so you're not the only admin.</div>
          <div class="welcome__card-link">Invite admins →</div>
        </div>
      </a>
      <a :href="`${CRM_ORIGIN}/venue-packages/new`" class="welcome__card">
        <div class="welcome__card-n">03</div>
        <div class="welcome__card-body">
          <div class="welcome__card-title">Set up your first venue package</div>
          <div class="welcome__card-sub">The clubhouse, function room, or whatever you let people hire.</div>
          <div class="welcome__card-link">Create a package →</div>
        </div>
      </a>
      <a :href="`${CRM_ORIGIN}/members/import`" class="welcome__card">
        <div class="welcome__card-n">04</div>
        <div class="welcome__card-body">
          <div class="welcome__card-title">Import members from your spreadsheet</div>
          <div class="welcome__card-sub">Drag in a CSV. Matches columns automatically.</div>
          <div class="welcome__card-link">Start the import →</div>
        </div>
      </a>
    </section>

    <div class="welcome__ctas">
      <a :href="CRM_ORIGIN" class="welcome__cta welcome__cta--primary">Open the dashboard →</a>
      <a v-if="publicSite" :href="publicSite" class="welcome__cta welcome__cta--ghost" target="_blank" rel="noopener">View your public site ↗</a>
    </div>

    <footer class="welcome__foot">
      Stuck? Book a <a href="mailto:hello@torny.co?subject=Onboarding%20call">15-min onboarding call</a> with the team — included on every trial.
    </footer>
  </div>
</template>

<style scoped>
@import url("@torny/design-tokens/tokens.css");

.welcome {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 20% 0%, #0E1A2F 0%, #050912 55%, #000 100%);
  color: #fff;
  font-family: var(--font-body, 'Inter');
  padding: 40px 80px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.welcome__bar { display: flex; justify-content: space-between; align-items: center; }
.welcome__brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.welcome__brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #2563EB; }
.welcome__brand-wordmark { font-family: var(--font-display, 'Space Grotesk'); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.welcome__brand-tag { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 11px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.5); padding-top: 2px; }
.welcome__trial { padding: 6px 12px; background: rgba(22,163,74,0.14); border: 1px solid rgba(22,163,74,0.35); border-radius: 999px; font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #86EFAC; text-transform: uppercase; }

.welcome__hero { margin: 48px auto 40px; text-align: center; max-width: 820px; }
.welcome__eyebrow { font-family: var(--font-mono, 'JetBrains Mono'); font-size: 10px; letter-spacing: 0.14em; color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 20px; }
.welcome__title { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 72px; letter-spacing: -0.03em; line-height: 95%; margin: 0; }
.welcome__title-faded { color: rgba(255,255,255,0.45); }
.welcome__sub { margin: 24px auto 0; font-size: 15px; line-height: 155%; color: rgba(255,255,255,0.6); }
.welcome__link { color: #87CEEB; font-family: var(--font-mono, 'JetBrains Mono'); font-size: 14px; text-decoration: none; }

.welcome__grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 1120px; width: 100%; margin: 0 auto; }
.welcome__card { display: flex; gap: 16px; padding: 24px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: #fff; text-decoration: none; }
.welcome__card--primary { background: #fff; color: #0A0A0B; }
.welcome__card-n { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display, 'Space Grotesk'); font-size: 16px; font-weight: 700; flex-shrink: 0; background: rgba(255,255,255,0.08); }
.welcome__card--primary .welcome__card-n { background: #0A0A0B; color: #fff; }
.welcome__card-body { display: flex; flex-direction: column; gap: 6px; }
.welcome__card-title { font-family: var(--font-display, 'Space Grotesk'); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
.welcome__card-sub { font-size: 13px; line-height: 150%; color: rgba(255,255,255,0.6); }
.welcome__card--primary .welcome__card-sub { color: #6B6B72; }
.welcome__card-link { margin-top: 6px; font-size: 12px; font-weight: 600; text-decoration: underline; color: #87CEEB; }
.welcome__card--primary .welcome__card-link { color: #0A0A0B; }

.welcome__ctas { margin: 36px auto 0; display: flex; gap: 12px; }
.welcome__cta { padding: 16px 28px; border-radius: 999px; font-size: 14px; font-weight: 500; text-decoration: none; display: inline-flex; align-items: center; gap: 10px; }
.welcome__cta--primary { background: #fff; color: #0A0A0B; font-weight: 600; }
.welcome__cta--ghost { border: 1px solid rgba(255,255,255,0.2); color: #fff; }

.welcome__foot { margin: 48px auto 0; text-align: center; font-size: 12px; color: rgba(255,255,255,0.4); }
.welcome__foot a { color: rgba(255,255,255,0.7); text-decoration: underline; }

@media (max-width: 768px) {
  .welcome { padding: 24px 20px; }
  .welcome__title { font-size: 44px; }
  .welcome__grid { grid-template-columns: 1fr; }
  .welcome__ctas { flex-direction: column; }
  .welcome__cta { justify-content: center; }
}
</style>
