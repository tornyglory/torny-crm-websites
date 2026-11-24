<script setup lang="ts">
/**
 * /terms — platform terms of service.
 *
 * STATUS: scaffold / placeholder. Structural framework with reasonable
 * defaults for a NZ-launched SaaS. Unblocks the /signup link to this
 * route. Real text must be reviewed and populated by counsel before
 * production.
 *
 * Before production:
 *   1. Lawyer review of every section, especially: liability cap,
 *      acceptable-use, data ownership (club admin owns their member
 *      data), termination rights, payment / billing terms.
 *   2. Confirm the Stripe + Torny billing boundary — who owns the
 *      customer relationship for subscription charges.
 *   3. Dispute resolution clause — NZ jurisdiction / arbitration?
 *   4. Price plan disclosure — public pricing or "contact sales"?
 *
 * See docs/production-readiness/08-compliance-floor.md.
 */
useSeoMeta({
  title: 'Terms of Service — Torny',
  description: 'The agreement between you and Torny for using the service.',
})
</script>

<template>
  <main class="legal">
    <div class="legal__inner">
      <div class="legal__draft">
        <strong>Draft.</strong> This page is a placeholder scaffold — the real terms must be reviewed by legal counsel before production. See the source file comments for what each section needs.
      </div>

      <header class="legal__head">
        <div class="legal__eyebrow">Legal</div>
        <h1>Terms of Service</h1>
        <p class="legal__lede">
          The agreement between you and Torny for using the service.
        </p>
        <p class="legal__meta">Last updated: <span class="legal__draft-mark">DRAFT — pending legal review</span></p>
      </header>

      <section>
        <h2>1. The agreement</h2>
        <p>
          These Terms govern your use of Torny. By signing up for an account, you agree to be bound by them. If you're agreeing on behalf of a club or organisation, you confirm you have authority to do so.
        </p>
      </section>

      <section>
        <h2>2. The service</h2>
        <p>
          Torny provides software to clubs for managing membership, events, communications, and public websites. We'll do our best to keep the service available, secure, and reliable, but we don't guarantee it will be uninterrupted or error-free.
        </p>
      </section>

      <section>
        <h2>3. Accounts and access</h2>
        <ul>
          <li>You are responsible for keeping your sign-in credentials private.</li>
          <li>You must be at least 18 to hold a club administrator role. Players under 18 can hold a player profile with a parent or guardian's agreement.</li>
          <li>If you lose access or suspect your account has been compromised, tell us immediately.</li>
        </ul>
      </section>

      <section>
        <h2>4. Who owns what</h2>
        <ul>
          <li><strong>Your data.</strong> Member records, communications, images, and content a club or its members upload remain owned by the club. We only use them to provide the service.</li>
          <li><strong>The platform.</strong> Torny, the software and the Torny branding are owned by us.</li>
          <li><strong>Feedback.</strong> If you send us suggestions, we can use them freely.</li>
        </ul>
      </section>

      <section>
        <h2>5. Acceptable use</h2>
        <p>Don't use Torny to:</p>
        <ul>
          <li>Send spam, bulk unsolicited email, or anything that would violate CAN-SPAM, the NZ Unsolicited Electronic Messages Act, or similar laws.</li>
          <li>Upload content that is illegal, misleading, defamatory, or infringes someone else's rights.</li>
          <li>Try to break into or damage the service, or reverse-engineer it.</li>
          <li>Scrape or bulk-export other clubs' information without their explicit permission.</li>
        </ul>
        <p>We can suspend or terminate accounts that break these rules.</p>
      </section>

      <section>
        <h2>6. Payments and billing</h2>
        <p class="legal__draft-mark">
          TODO: describe the Torny subscription model (Starter / Pro), billing cadence, upgrades/downgrades, refunds, and what happens when payment fails. Confirm Stripe's role — Torny is the merchant of record for subscription charges; club-collected member dues are a separate Stripe Connect relationship between the club and its members.
        </p>
      </section>

      <section>
        <h2>7. Service availability</h2>
        <p>
          We work hard to keep Torny available, but we don't offer a specific uptime SLA for the <span class="legal__draft-mark">Starter / entry</span> plan. Enterprise or Pro-tier SLAs, if offered, will be set out in a separate agreement.
        </p>
      </section>

      <section>
        <h2>8. Limitation of liability</h2>
        <p class="legal__draft-mark">
          TODO: liability cap. Standard SaaS boilerplate is "fees paid in the 12 months preceding the claim" with carve-outs for fraud, gross negligence, wilful misconduct. Confirm with counsel.
        </p>
      </section>

      <section>
        <h2>9. Termination</h2>
        <ul>
          <li>You can cancel your Torny account at any time from the settings page.</li>
          <li>We can suspend or terminate accounts that violate these Terms, with notice where practical.</li>
          <li>On termination, you'll have <span class="legal__draft-mark">a reasonable period (e.g. 30 days)</span> to export your data before it's permanently deleted.</li>
        </ul>
      </section>

      <section>
        <h2>10. Changes to these terms</h2>
        <p>
          We may update these Terms as the service evolves. When a change is material, we'll email account holders with reasonable notice. Continued use after the effective date means you accept the change.
        </p>
      </section>

      <section>
        <h2>11. Governing law</h2>
        <p>
          These Terms are governed by the laws of New Zealand. Disputes are subject to the exclusive jurisdiction of the New Zealand courts.
        </p>
      </section>

      <section>
        <h2>12. Contact</h2>
        <p class="legal__draft-mark">
          Email: hello@torny.pro — placeholder; wire to a real inbox.
        </p>
      </section>

      <footer class="legal__foot">
        <NuxtLink to="/">← Home</NuxtLink>
        <NuxtLink to="/privacy">Privacy</NuxtLink>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.legal {
  min-height: 100vh;
  padding: 48px 24px 96px;
  background: var(--color-ground);
  color: var(--color-ink);
}
.legal__inner {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.legal__draft {
  padding: 14px 18px;
  border-radius: 12px;
  background: #FFF4D6;
  border: 1px solid #F5CE5E;
  color: #724B00;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
}
.legal__head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.legal__eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.legal__inner h1 {
  font-family: var(--font-display);
  font-size: 48px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0;
}
.legal__lede {
  font-family: var(--font-body);
  font-size: 18px;
  line-height: 1.55;
  color: var(--color-graphite);
  margin: 0;
}
.legal__meta {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-fog);
  margin: 0;
}
.legal__draft-mark {
  color: #C2410C;
  font-weight: 600;
}
.legal section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.legal section h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 0 0 4px;
}
.legal p,
.legal ul {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.65;
  color: var(--color-graphite);
  margin: 0;
}
.legal ul {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.legal a {
  color: var(--color-accent);
}
.legal__foot {
  display: flex;
  gap: 20px;
  padding-top: 24px;
  border-top: 1px solid var(--color-hairline);
  font-family: var(--font-body);
  font-size: 14px;
}
.legal__foot a {
  color: var(--color-ink);
  text-decoration: none;
}
.legal__foot a:hover {
  text-decoration: underline;
}
</style>
