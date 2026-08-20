<script setup lang="ts">
import { ref } from 'vue'

type SectionKey = 'domain' | 'brand' | 'seo' | 'navigation' | 'forms' | 'analytics'

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'domain', label: 'Domains', hint: 'Custom domain + fallback subdomain.' },
  { key: 'brand', label: 'Brand', hint: 'Logo, favicon, colours, typography.' },
  { key: 'seo', label: 'SEO + social', hint: 'Meta title, description, share card.' },
  { key: 'navigation', label: 'Navigation', hint: 'Header links, footer links.' },
  { key: 'forms', label: 'Forms', hint: 'Contact, membership, RSVPs.' },
  { key: 'analytics', label: 'Analytics', hint: 'Google Analytics, Plausible.' },
]
const active = ref<SectionKey>('domain')

const domain = ref({
  custom: 'kelburnbowls.co.nz',
  status: 'live' as 'live' | 'pending' | 'unset',
  ssl: 'issued' as 'issued' | 'issuing' | 'error',
  fallback: 'kelburn.sites.torny.club',
  redirectWww: true,
  dnsRecords: [
    { type: 'CNAME', host: 'kelburnbowls.co.nz', value: 'proxy.torny.pages.dev', status: 'ok' as 'ok' | 'missing' | 'wrong' },
    { type: 'TXT', host: '_torny-verify', value: 'torny=verify-abc123', status: 'ok' as 'ok' | 'missing' | 'wrong' },
    { type: 'CNAME', host: 'www.kelburnbowls.co.nz', value: 'proxy.torny.pages.dev', status: 'ok' as 'ok' | 'missing' | 'wrong' },
  ],
})

const brand = ref({
  primary: '#2563EB',
  accent: '#16A34A',
  font: 'Inter',
  logoName: 'kelburn-mark.svg',
  faviconName: 'kelburn-favicon.png',
})

const seo = ref({
  metaTitle: 'Kelburn Bowling Club — Wellington',
  metaDescription: 'A friendly lawn bowls club in the heart of Wellington. Est. 1908. Join us for roll-ups, pennant, and socials.',
  ogImage: 'og-hero.jpg',
  robotsAllowed: true,
})

const navHeader = ref([
  { id: 'n1', label: 'Home', target: '/', external: false, enabled: true },
  { id: 'n2', label: 'Events', target: '/events', external: false, enabled: true },
  { id: 'n3', label: 'Honour board', target: '/honour-board', external: false, enabled: true },
  { id: 'n4', label: 'Membership', target: '/membership', external: false, enabled: true },
  { id: 'n5', label: 'Contact', target: '/contact', external: false, enabled: true },
])

const navFooter = ref([
  { id: 'f1', label: 'Bowls NZ', target: 'https://bowlsnewzealand.co.nz', external: true, enabled: true },
  { id: 'f2', label: 'Privacy', target: '/privacy', external: false, enabled: true },
])

const forms = ref([
  { id: 'form-contact', label: 'Contact form', recipients: 'admin@kelburnbowls.co.nz', autoReply: true, spamFilter: 'strict' },
  { id: 'form-membership', label: 'Membership application', recipients: 'admin@kelburnbowls.co.nz', autoReply: true, spamFilter: 'moderate' },
  { id: 'form-rsvp', label: 'Event RSVPs', recipients: 'events@kelburnbowls.co.nz', autoReply: false, spamFilter: 'moderate' },
])

const analytics = ref({
  provider: 'plausible' as 'none' | 'ga4' | 'plausible',
  gaId: '',
  plausibleDomain: 'kelburnbowls.co.nz',
  cookieBanner: false,
})

const statusTone = (s: string) => (s === 'ok' || s === 'live' || s === 'issued' ? 'ok' : s === 'unset' || s === 'missing' ? 'warn' : s === 'error' || s === 'wrong' ? 'danger' : 'info')
</script>

<template>
  <div class="site">
    <header class="site__header">
      <div>
        <div class="site__eyebrow">Public site</div>
        <h1 class="site__heading">Site settings</h1>
        <p class="site__sub">The wiring behind {{ domain.custom || domain.fallback }}. Everything visitors see and everything Google indexes.</p>
      </div>
      <a class="btn btn--outline" :href="`https://${domain.custom || domain.fallback}`" target="_blank" rel="noopener">View live site ↗</a>
    </header>

    <div class="site__grid">
      <aside class="nav">
        <ul>
          <li
            v-for="s in SECTIONS"
            :key="s.key"
            class="nav__item"
            :class="{ 'is-active': active === s.key }"
            @click="active = s.key"
          >
            <div class="nav__label">{{ s.label }}</div>
            <div class="nav__hint">{{ s.hint }}</div>
          </li>
        </ul>
      </aside>

      <section class="pane">
        <!-- Domains -->
        <template v-if="active === 'domain'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Custom domain</div>
                <h2 class="card__title">{{ domain.custom }}</h2>
                <div class="site__meta">
                  <span class="badge" :class="`badge--${statusTone(domain.status)}`">{{ domain.status }}</span>
                  <span class="badge" :class="`badge--${statusTone(domain.ssl)}`">SSL {{ domain.ssl }}</span>
                </div>
              </div>
              <button class="btn btn--outline">Edit</button>
            </div>

            <div class="row-switch">
              <div>
                <h3>Redirect www → apex</h3>
                <p>Send www.kelburnbowls.co.nz visitors to the bare domain.</p>
              </div>
              <button class="switch" :class="{ 'is-on': domain.redirectWww }" @click="domain.redirectWww = !domain.redirectWww">
                <span class="switch__knob" />
              </button>
            </div>
          </div>

          <div class="card">
            <div class="card__eyebrow">Fallback</div>
            <p class="card__body">Every club also gets a Torny-hosted address that always works while DNS is settling.</p>
            <div class="mono-row">
              <span class="mono">{{ domain.fallback }}</span>
              <button class="link">Copy</button>
            </div>
          </div>

          <div class="card">
            <div class="card__eyebrow">DNS records</div>
            <ul class="dns">
              <li v-for="r in domain.dnsRecords" :key="r.host + r.value" class="dns__row">
                <span class="dns__type">{{ r.type }}</span>
                <div class="dns__body">
                  <div class="mono">{{ r.host }}</div>
                  <div class="mono muted">{{ r.value }}</div>
                </div>
                <span class="badge" :class="`badge--${statusTone(r.status)}`">{{ r.status }}</span>
              </li>
            </ul>
          </div>
        </template>

        <!-- Brand -->
        <template v-else-if="active === 'brand'">
          <div class="card">
            <div class="card__eyebrow">Colours</div>
            <div class="colours">
              <div class="colour">
                <input type="color" v-model="brand.primary" />
                <div class="colour__body">
                  <div>Primary</div>
                  <span class="mono">{{ brand.primary }}</span>
                </div>
              </div>
              <div class="colour">
                <input type="color" v-model="brand.accent" />
                <div class="colour__body">
                  <div>Accent</div>
                  <span class="mono">{{ brand.accent }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card__eyebrow">Typography</div>
            <div class="field">
              <label>Body font</label>
              <select v-model="brand.font">
                <option>Inter</option>
                <option>Space Grotesk</option>
                <option>DM Sans</option>
                <option>Manrope</option>
              </select>
            </div>
          </div>
          <div class="card">
            <div class="card__eyebrow">Logo &amp; favicon</div>
            <div class="upload-grid">
              <div class="upload">
                <div class="upload__label">Logo (SVG or PNG)</div>
                <div class="upload__chip">
                  <span class="mono">{{ brand.logoName }}</span>
                  <button class="link">Replace</button>
                </div>
              </div>
              <div class="upload">
                <div class="upload__label">Favicon (32×32 PNG)</div>
                <div class="upload__chip">
                  <span class="mono">{{ brand.faviconName }}</span>
                  <button class="link">Replace</button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- SEO -->
        <template v-else-if="active === 'seo'">
          <div class="card">
            <div class="card__eyebrow">Site metadata</div>
            <div class="field">
              <label>Meta title</label>
              <input v-model="seo.metaTitle" />
            </div>
            <div class="field">
              <label>Meta description</label>
              <textarea rows="3" v-model="seo.metaDescription" />
            </div>
          </div>
          <div class="card">
            <div class="card__eyebrow">Share card (OG image)</div>
            <div class="upload__chip">
              <span class="mono">{{ seo.ogImage }}</span>
              <button class="link">Replace</button>
            </div>
          </div>
          <div class="card">
            <div class="card__eyebrow">Search visibility</div>
            <div class="row-switch">
              <div>
                <h3>Allow search engines to index</h3>
                <p>Disable while the site is under construction.</p>
              </div>
              <button class="switch" :class="{ 'is-on': seo.robotsAllowed }" @click="seo.robotsAllowed = !seo.robotsAllowed">
                <span class="switch__knob" />
              </button>
            </div>
          </div>
        </template>

        <!-- Navigation -->
        <template v-else-if="active === 'navigation'">
          <div class="card">
            <div class="card__eyebrow">Header navigation</div>
            <ul class="nav-list">
              <li v-for="n in navHeader" :key="n.id" class="nav-row">
                <span class="handle">≡</span>
                <div>
                  <div class="nav-label">{{ n.label }}</div>
                  <div class="mono muted">{{ n.target }}</div>
                </div>
                <button class="switch switch--sm" :class="{ 'is-on': n.enabled }" @click="n.enabled = !n.enabled">
                  <span class="switch__knob" />
                </button>
              </li>
            </ul>
            <button class="btn btn--ghost">+ Add link</button>
          </div>
          <div class="card">
            <div class="card__eyebrow">Footer navigation</div>
            <ul class="nav-list">
              <li v-for="n in navFooter" :key="n.id" class="nav-row">
                <span class="handle">≡</span>
                <div>
                  <div class="nav-label">{{ n.label }} <span v-if="n.external" class="mono muted">(external)</span></div>
                  <div class="mono muted">{{ n.target }}</div>
                </div>
                <button class="switch switch--sm" :class="{ 'is-on': n.enabled }" @click="n.enabled = !n.enabled">
                  <span class="switch__knob" />
                </button>
              </li>
            </ul>
            <button class="btn btn--ghost">+ Add link</button>
          </div>
        </template>

        <!-- Forms -->
        <template v-else-if="active === 'forms'">
          <div v-for="f in forms" :key="f.id" class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Form</div>
                <h2 class="card__title">{{ f.label }}</h2>
              </div>
              <span class="mono">{{ f.id }}</span>
            </div>
            <div class="field">
              <label>Recipients</label>
              <input v-model="f.recipients" />
            </div>
            <div class="row-switch">
              <div>
                <h3>Auto-reply</h3>
                <p>Confirm receipt with a thank-you message to the sender.</p>
              </div>
              <button class="switch" :class="{ 'is-on': f.autoReply }" @click="f.autoReply = !f.autoReply">
                <span class="switch__knob" />
              </button>
            </div>
            <div class="field">
              <label>Spam filter</label>
              <select v-model="f.spamFilter">
                <option value="off">Off</option>
                <option value="moderate">Moderate</option>
                <option value="strict">Strict</option>
              </select>
            </div>
          </div>
        </template>

        <!-- Analytics -->
        <template v-else-if="active === 'analytics'">
          <div class="card">
            <div class="card__eyebrow">Analytics provider</div>
            <div class="provider-grid">
              <button
                class="provider"
                :class="{ 'is-active': analytics.provider === 'none' }"
                @click="analytics.provider = 'none'"
              >
                <div class="provider__label">None</div>
                <div class="provider__hint">Skip analytics.</div>
              </button>
              <button
                class="provider"
                :class="{ 'is-active': analytics.provider === 'plausible' }"
                @click="analytics.provider = 'plausible'"
              >
                <div class="provider__label">Plausible</div>
                <div class="provider__hint">Cookie-free, GDPR-safe by default.</div>
              </button>
              <button
                class="provider"
                :class="{ 'is-active': analytics.provider === 'ga4' }"
                @click="analytics.provider = 'ga4'"
              >
                <div class="provider__label">Google Analytics 4</div>
                <div class="provider__hint">More power, requires cookie banner.</div>
              </button>
            </div>
            <div v-if="analytics.provider === 'plausible'" class="field">
              <label>Plausible domain</label>
              <input v-model="analytics.plausibleDomain" />
            </div>
            <div v-if="analytics.provider === 'ga4'" class="field">
              <label>GA4 Measurement ID</label>
              <input v-model="analytics.gaId" placeholder="G-XXXXXXXXXX" />
            </div>
            <div v-if="analytics.provider === 'ga4'" class="row-switch">
              <div>
                <h3>Show cookie banner</h3>
                <p>Torny will inject a compliant consent banner before GA4 fires.</p>
              </div>
              <button class="switch" :class="{ 'is-on': analytics.cookieBanner }" @click="analytics.cookieBanner = !analytics.cookieBanner">
                <span class="switch__knob" />
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.site { max-width: 1200px; }
.site__header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 24px; }
.site__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.site__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.site__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.site__meta { display: flex; gap: 6px; margin-top: 8px; }

.site__grid { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }

.nav { padding: 6px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 24px; }
.nav ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.nav__item { padding: 12px 14px; border-radius: 10px; cursor: pointer; }
.nav__item:hover { background: var(--color-surface); }
.nav__item.is-active { background: var(--color-accent-soft); }
.nav__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.nav__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }

.pane { display: flex; flex-direction: column; gap: 12px; }
.card { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.card__head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 16px; }
.card__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.card__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 6px; color: var(--color-ink); }
.card__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0 0 12px; }

.mono { font-family: var(--font-mono); font-size: 12px; }
.mono-row { display: flex; gap: 12px; align-items: center; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }
.muted { color: var(--color-mute); }

.badge { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge--ok { background: #DCFCE7; color: #166534; }
.badge--warn { background: #FEF3C7; color: #92400E; }
.badge--danger { background: #FEE2E2; color: #991B1B; }
.badge--info { background: var(--color-accent-soft); color: var(--color-accent-strong); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost { background: transparent; color: var(--color-accent); border: 1px dashed var(--color-accent-soft); margin-top: 12px; }
.link { background: transparent; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.link:hover { text-decoration: underline; }

.row-switch { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; }
.row-switch h3 { font-family: var(--font-body); font-size: 14px; font-weight: 600; margin: 0 0 2px; color: var(--color-ink); }
.row-switch p { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch--sm { width: 34px; height: 20px; padding: 2px; }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch--sm .switch__knob { width: 16px; height: 16px; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.switch--sm.is-on .switch__knob { transform: translateX(14px); }

.dns { list-style: none; padding: 0; margin: 0; }
.dns__row { display: grid; grid-template-columns: 60px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-hairline); }
.dns__row:last-child { border-bottom: 0; }
.dns__type { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: var(--color-fog); }

.colours { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.colour { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; }
.colour input { width: 40px; height: 40px; border: 0; padding: 0; border-radius: 8px; cursor: pointer; }
.colour__body div { font-family: var(--font-body); font-size: 12px; color: var(--color-ink); font-weight: 600; }

.upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.upload__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.upload__chip { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--color-surface); border-radius: 8px; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.field label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }

.nav-list { list-style: none; padding: 0; margin: 0; }
.nav-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; margin-bottom: 6px; }
.handle { color: var(--color-mute); cursor: grab; }
.nav-label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); display: flex; gap: 8px; align-items: baseline; }

.provider-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 16px; }
.provider { padding: 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; cursor: pointer; text-align: left; }
.provider.is-active { border-color: var(--color-ink); background: var(--color-accent-soft); }
.provider__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.provider__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }

@media (max-width: 900px) {
  .site__grid { grid-template-columns: 1fr; }
  .nav { position: static; }
  .colours, .upload-grid { grid-template-columns: 1fr; }
}
</style>
