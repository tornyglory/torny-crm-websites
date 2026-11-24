<script setup lang="ts">
/**
 * /privacy — platform privacy policy.
 *
 * STATUS: scaffold / placeholder. The copy below is structured around
 * NZ Privacy Act 2020 (IPPs 1–13) and gets us past the legal-blocker
 * of the signup page linking to a nonexistent route. It is NOT
 * reviewed by counsel and should not be shipped as the real policy.
 *
 * Before production:
 *   1. Have a lawyer familiar with NZ Privacy Act 2020 (and AU Privacy
 *      Principles if AU launch is in scope) review and populate each
 *      section with real text.
 *   2. Decide on cookie / analytics stance before the Cookies section
 *      goes live — today we ship no analytics. Once we do, the choice
 *      (Plausible = GDPR-safe no banner; GA4 = banner required) drives
 *      that section.
 *   3. Confirm the Data Retention periods with the backend team.
 *   4. Wire a real contact method into the "How to contact us" section.
 *
 * See docs/production-readiness/08-compliance-floor.md.
 */
useSeoMeta({
  title: 'Privacy — Torny',
  description: 'How Torny collects, uses, and protects personal information.',
})
</script>

<template>
  <main class="legal">
    <div class="legal__inner">
      <div class="legal__draft">
        <strong>Draft.</strong> This page is a placeholder scaffold — the real policy must be reviewed by legal counsel before production. See the source file comments for what each section needs.
      </div>

      <header class="legal__head">
        <div class="legal__eyebrow">Legal</div>
        <h1>Privacy</h1>
        <p class="legal__lede">
          How Torny collects, uses, stores, and discloses personal information. We operate under the New Zealand Privacy Act 2020.
        </p>
        <p class="legal__meta">Last updated: <span class="legal__draft-mark">DRAFT — pending legal review</span></p>
      </header>

      <section>
        <h2>1. Who we are</h2>
        <p>
          Torny is operated by <span class="legal__draft-mark">Legal entity name, NZBN, registered address — fill in</span>. We provide software to sports clubs for managing membership, communications, events, and public websites.
        </p>
      </section>

      <section>
        <h2>2. What information we collect</h2>
        <p>We collect only the information needed to run the service you asked for:</p>
        <ul>
          <li><strong>Account information</strong> — your name, email address, phone number, and the clubs you're associated with.</li>
          <li><strong>Membership records</strong> — information your club administrator enters about you (membership tier, dues status, date of birth, address, membership number).</li>
          <li><strong>Communications</strong> — emails sent to and received from you via your club's Torny account.</li>
          <li><strong>Payment information</strong> — processed by Stripe. We do not store card numbers or bank details on Torny servers.</li>
          <li><strong>Technical information</strong> — IP address, browser type, operating system, and timestamps, logged for security and troubleshooting.</li>
        </ul>
        <p class="legal__draft-mark">TODO: confirm every category above matches current backend reality before shipping.</p>
      </section>

      <section>
        <h2>3. How we use your information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide the service — sign-in, membership management, communications delivery.</li>
          <li>Send transactional emails (invitations, receipts, password reset) and, when your club admin asks, newsletters you have consented to receive.</li>
          <li>Keep the service secure and troubleshoot problems.</li>
          <li>Comply with our legal obligations.</li>
        </ul>
        <p>We do not sell personal information. We do not use your information to train AI models.</p>
      </section>

      <section>
        <h2>4. When we share information</h2>
        <p>We only share personal information in these cases:</p>
        <ul>
          <li>With your club administrators (who have access to the records they manage).</li>
          <li>With service providers who operate our infrastructure (hosting, email delivery, payments). <span class="legal__draft-mark">TODO: list sub-processors — AWS Lambda / Azure SWA / Cloudflare / SES / Stripe — and their regions.</span></li>
          <li>When required by law, or to protect our rights or the safety of others.</li>
        </ul>
      </section>

      <section>
        <h2>5. Where your information is stored</h2>
        <p>
          Personal information is stored in Amazon Web Services' Sydney (ap-southeast-2) region. <span class="legal__draft-mark">TODO: confirm regions for every sub-processor. If any data crosses borders (e.g. Sentry US, Stripe Ireland), say so and explain the basis.</span>
        </p>
      </section>

      <section>
        <h2>6. How long we keep information</h2>
        <p>
          We keep personal information only as long as needed for the purposes above or as required by law. <span class="legal__draft-mark">TODO: confirm retention periods per data category with backend — account data, communications, payment records, audit logs.</span>
        </p>
      </section>

      <section>
        <h2>7. Your rights</h2>
        <p>Under the NZ Privacy Act 2020 you can ask us to:</p>
        <ul>
          <li>Confirm whether we hold personal information about you.</li>
          <li>Access the information we hold.</li>
          <li>Correct information that is wrong or out of date.</li>
          <li>Delete your account.</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at <span class="legal__draft-mark">privacy@torny.pro (or similar — set a real address + route internally).</span> We'll respond within 20 working days, as required by the Act.
        </p>
      </section>

      <section>
        <h2>8. Cookies and tracking</h2>
        <p>
          Torny uses essential cookies (such as your sign-in session) to make the service work. We do not use third-party advertising cookies.
        </p>
        <p class="legal__draft-mark">TODO: when analytics lands, add a section on the specific tool used, whether it's cookie-based (GA4) or cookieless (Plausible), and how to opt out.</p>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          We use HTTPS throughout, store passwords only as salted hashes, send errors and anomalies to our monitoring tool (Sentry), and apply a Content Security Policy to limit the blast radius of any client-side injection. Access to production systems is limited to team members who need it.
        </p>
        <p>
          No system is perfectly secure. If you believe your account has been compromised, contact us immediately.
        </p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>
          We'll update this page when the service or the applicable law changes materially. When the change is significant, we'll email account holders to let them know.
        </p>
      </section>

      <section>
        <h2>11. How to contact us</h2>
        <p class="legal__draft-mark">
          Email: privacy@torny.pro — placeholder; wire to a real inbox and intake process.<br />
          Postal: <em>Legal entity name + address.</em>
        </p>
        <p>
          You can also complain to the Office of the Privacy Commissioner: <a href="https://www.privacy.org.nz" target="_blank" rel="noopener noreferrer">www.privacy.org.nz</a>.
        </p>
      </section>

      <footer class="legal__foot">
        <NuxtLink to="/">← Home</NuxtLink>
        <NuxtLink to="/terms">Terms</NuxtLink>
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
