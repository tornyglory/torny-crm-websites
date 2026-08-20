<script setup lang="ts">
import { ref } from 'vue'

type SectionKey = 'club' | 'billing' | 'team' | 'security' | 'integrations' | 'danger'

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'club', label: 'Club profile', hint: 'Name, logo, address, contact.' },
  { key: 'billing', label: 'Billing', hint: 'Torny subscription + invoices.' },
  { key: 'team', label: 'Team access', hint: 'Who else can manage the CRM.' },
  { key: 'security', label: 'Security', hint: 'Sign-in, sessions, 2FA.' },
  { key: 'integrations', label: 'Integrations', hint: 'Stripe, Google Calendar, mail.' },
  { key: 'danger', label: 'Danger zone', hint: 'Archive or transfer the club.' },
]

const active = ref<SectionKey>('club')

const club = ref({
  name: 'Kelburn Bowling Club',
  legalName: 'Kelburn Bowling Club Inc.',
  incorporationNumber: 'INC-1908-KLBN',
  email: 'admin@kelburnbowls.co.nz',
  phone: '04 555 0101',
  address: '25 Salamanca Road, Kelburn, Wellington 6012',
  timeZone: 'Pacific/Auckland',
})

const billing = ref({
  plan: 'Standard',
  seats: 8,
  amount: '$79 / month',
  nextInvoice: '01 Sep 2026',
  paymentMethod: 'Visa ending 4242',
  invoices: [
    { id: 'inv-24', date: '01 Aug 2026', amount: '$79.00', status: 'paid' as 'paid' | 'due' },
    { id: 'inv-23', date: '01 Jul 2026', amount: '$79.00', status: 'paid' as 'paid' | 'due' },
    { id: 'inv-22', date: '01 Jun 2026', amount: '$79.00', status: 'paid' as 'paid' | 'due' },
  ],
})

const team = ref([
  { id: 'u1', name: 'Marcus Tuilagi', email: 'marcus@example.com', role: 'Owner', lastActive: '2h ago' },
  { id: 'u2', name: 'Denise Peters', email: 'denise@example.com', role: 'Admin', lastActive: '3d ago' },
  { id: 'u3', name: 'Sione Vagana', email: 'sione@example.com', role: 'Committee', lastActive: '1w ago' },
])

const security = ref({
  twoFactor: false,
  passkey: false,
  sessions: [
    { id: 's1', device: 'MacBook Pro · Chrome', ip: '203.0.113.14', when: 'Now', current: true },
    { id: 's2', device: 'iPad · Safari', ip: '203.0.113.14', when: 'Yesterday', current: false },
    { id: 's3', device: 'iPhone · Torny app', ip: '203.0.113.14', when: '3 days ago', current: false },
  ],
})

const integrations = ref([
  { id: 'stripe', label: 'Stripe', description: 'Take card payments for dues and events.', status: 'connected' },
  { id: 'gcal', label: 'Google Calendar', description: 'Two-way sync for events.', status: 'connected' },
  { id: 'ses', label: 'AWS SES', description: 'Send email campaigns from your own domain.', status: 'available' },
  { id: 'xero', label: 'Xero', description: 'Export invoices to your ledger.', status: 'available' },
])
</script>

<template>
  <div class="settings">
    <header class="settings__header">
      <div>
        <div class="settings__eyebrow">Account</div>
        <h1 class="settings__heading">Settings</h1>
        <p class="settings__sub">Club record, billing, who has access, and the plumbing behind it.</p>
      </div>
    </header>

    <div class="settings__grid">
      <aside class="nav">
        <ul>
          <li
            v-for="s in SECTIONS"
            :key="s.key"
            class="nav__item"
            :class="{ 'is-active': active === s.key, 'is-danger': s.key === 'danger' }"
            @click="active = s.key"
          >
            <div class="nav__label">{{ s.label }}</div>
            <div class="nav__hint">{{ s.hint }}</div>
          </li>
        </ul>
      </aside>

      <section class="pane">
        <!-- Club profile -->
        <template v-if="active === 'club'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Public identity</div>
                <h2 class="card__title">Club profile</h2>
              </div>
              <button class="btn btn--outline">Save changes</button>
            </div>
            <div class="grid">
              <div class="field">
                <label>Club name</label>
                <input v-model="club.name" />
              </div>
              <div class="field">
                <label>Legal name</label>
                <input v-model="club.legalName" />
              </div>
              <div class="field">
                <label>Incorporation number</label>
                <input v-model="club.incorporationNumber" />
              </div>
              <div class="field">
                <label>Time zone</label>
                <input v-model="club.timeZone" />
              </div>
              <div class="field">
                <label>Public email</label>
                <input v-model="club.email" />
              </div>
              <div class="field">
                <label>Public phone</label>
                <input v-model="club.phone" />
              </div>
              <div class="field field--wide">
                <label>Postal address</label>
                <input v-model="club.address" />
              </div>
            </div>
          </div>
        </template>

        <!-- Billing -->
        <template v-else-if="active === 'billing'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Plan</div>
                <h2 class="card__title">{{ billing.plan }}</h2>
                <p class="card__body">{{ billing.amount }} · {{ billing.seats }} CRM seats · next invoice {{ billing.nextInvoice }}</p>
              </div>
              <div class="card__actions">
                <button class="btn btn--outline">Change plan</button>
                <button class="btn btn--outline">Manage seats</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Payment method</div>
                <h2 class="card__title">{{ billing.paymentMethod }}</h2>
              </div>
              <button class="btn btn--outline">Update card</button>
            </div>
          </div>

          <div class="card">
            <div class="card__eyebrow">Recent invoices</div>
            <ul class="rows">
              <li v-for="i in billing.invoices" :key="i.id" class="frow">
                <div class="frow__id">{{ i.id.toUpperCase() }}</div>
                <div class="frow__date">{{ i.date }}</div>
                <div class="frow__amount">{{ i.amount }}</div>
                <div class="frow__status" :class="`frow__status--${i.status}`">{{ i.status }}</div>
                <button class="link">Download</button>
              </li>
            </ul>
          </div>
        </template>

        <!-- Team access -->
        <template v-else-if="active === 'team'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">CRM access</div>
                <h2 class="card__title">Team members</h2>
                <p class="card__body">People who can sign in and manage this club’s CRM.</p>
              </div>
              <button class="btn btn--primary">+ Invite</button>
            </div>
            <ul class="rows">
              <li v-for="u in team" :key="u.id" class="frow">
                <div class="frow__avatar">{{ u.name.split(' ').map((s) => s[0]).slice(0,2).join('') }}</div>
                <div>
                  <div class="frow__name">{{ u.name }}</div>
                  <div class="frow__meta">{{ u.email }}</div>
                </div>
                <div class="badge" :class="`badge--${u.role.toLowerCase()}`">{{ u.role }}</div>
                <div class="frow__time">Last active {{ u.lastActive }}</div>
                <button class="link">Manage</button>
              </li>
            </ul>
          </div>
        </template>

        <!-- Security -->
        <template v-else-if="active === 'security'">
          <div class="card">
            <div class="card__eyebrow">Sign-in methods</div>
            <div class="row-switch">
              <div>
                <h3>Two-factor authentication</h3>
                <p>Require a code from your authenticator app on every sign-in.</p>
              </div>
              <button class="switch" :class="{ 'is-on': security.twoFactor }" @click="security.twoFactor = !security.twoFactor">
                <span class="switch__knob" />
              </button>
            </div>
            <div class="row-switch">
              <div>
                <h3>Passkey sign-in</h3>
                <p>Sign in with Face ID / Touch ID on this device.</p>
              </div>
              <button class="switch" :class="{ 'is-on': security.passkey }" @click="security.passkey = !security.passkey">
                <span class="switch__knob" />
              </button>
            </div>
          </div>

          <div class="card">
            <div class="card__eyebrow">Active sessions</div>
            <ul class="rows">
              <li v-for="s in security.sessions" :key="s.id" class="frow frow--sessions">
                <div>
                  <div class="frow__name">{{ s.device }} <span v-if="s.current" class="badge badge--soft">This device</span></div>
                  <div class="frow__meta">{{ s.ip }} · {{ s.when }}</div>
                </div>
                <button v-if="!s.current" class="link link--danger">Sign out</button>
              </li>
            </ul>
          </div>
        </template>

        <!-- Integrations -->
        <template v-else-if="active === 'integrations'">
          <div class="grid grid--intg">
            <article
              v-for="i in integrations"
              :key="i.id"
              class="card card--intg"
            >
              <div class="intg__crest">{{ i.label[0] }}</div>
              <h3 class="intg__label">{{ i.label }}</h3>
              <p class="intg__desc">{{ i.description }}</p>
              <div class="intg__foot">
                <span class="badge" :class="i.status === 'connected' ? 'badge--ok' : 'badge--muted'">{{ i.status }}</span>
                <button class="link">{{ i.status === 'connected' ? 'Manage' : 'Connect' }}</button>
              </div>
            </article>
          </div>
        </template>

        <!-- Danger -->
        <template v-else>
          <div class="card card--danger">
            <div class="card__eyebrow">Danger zone</div>
            <div class="danger-row">
              <div>
                <h3>Transfer club ownership</h3>
                <p>Hand this club record to another Torny member. You keep your player account.</p>
              </div>
              <button class="btn btn--outline">Start transfer</button>
            </div>
            <div class="danger-row">
              <div>
                <h3>Archive this club</h3>
                <p>Public site goes read-only, no new members can apply. Reversible for 30 days.</p>
              </div>
              <button class="btn btn--outline">Archive</button>
            </div>
            <div class="danger-row danger-row--severe">
              <div>
                <h3>Delete club record</h3>
                <p>Permanently deletes members, events, honour board and website. This cannot be undone.</p>
              </div>
              <button class="btn btn--danger">Delete permanently</button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings { max-width: 1200px; }
.settings__header { margin-bottom: 24px; }
.settings__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.settings__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.settings__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.settings__grid { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }

.nav { padding: 6px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 24px; }
.nav ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.nav__item { padding: 12px 14px; border-radius: 10px; cursor: pointer; }
.nav__item:hover { background: var(--color-surface); }
.nav__item.is-active { background: var(--color-accent-soft); }
.nav__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.nav__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; }
.nav__item.is-danger .nav__label { color: var(--color-danger); }

.pane { display: flex; flex-direction: column; gap: 12px; }
.card { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.card--danger { border-color: rgba(220,47,59,0.25); }
.card__head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 16px; }
.card__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.card__title { font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 6px; color: var(--color-ink); }
.card__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin: 0; }
.card__actions { display: flex; gap: 8px; flex-shrink: 0; }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.grid--intg { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin-top: 0; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field--wide { grid-column: 1 / -1; }
.field label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.field input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus { outline: none; border-color: var(--color-ink); }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.frow { display: grid; grid-template-columns: 60px 1fr auto auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 8px; }
.frow:hover { background: var(--color-surface); }
.frow--sessions { grid-template-columns: 1fr auto; }
.frow__id { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.frow__date { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.frow__amount { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; }
.frow__status { font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.frow__status--paid { color: #166534; }
.frow__status--due { color: #991B1B; }
.frow__avatar { width: 40px; height: 40px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; }
.frow__name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); display: flex; align-items: center; gap: 8px; }
.frow__meta { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.frow__time { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.badge { display: inline-flex; padding: 3px 10px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge--owner { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.badge--admin { background: #DCFCE7; color: #166534; }
.badge--committee { background: var(--color-hairline); color: var(--color-graphite); }
.badge--ok { background: #DCFCE7; color: #166534; }
.badge--muted { background: var(--color-hairline); color: var(--color-graphite); }
.badge--soft { background: var(--color-accent-soft); color: var(--color-accent-strong); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--danger { background: var(--color-danger); color: #fff; }
.link { background: transparent; border: 0; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.link:hover { text-decoration: underline; }
.link--danger { color: var(--color-danger); }

.row-switch { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--color-hairline); }
.row-switch:last-child { border-bottom: 0; }
.row-switch h3 { font-family: var(--font-body); font-size: 14px; font-weight: 600; margin: 0 0 2px; color: var(--color-ink); }
.row-switch p { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }

.intg__crest { width: 40px; height: 40px; border-radius: 10px; background: var(--color-accent-soft); color: var(--color-accent-strong); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 18px; font-weight: 700; margin-bottom: 12px; }
.intg__label { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; margin: 0 0 4px; color: var(--color-ink); }
.intg__desc { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; margin: 0 0 12px; }
.intg__foot { display: flex; justify-content: space-between; align-items: center; }

.danger-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px 0; border-top: 1px solid var(--color-hairline); }
.danger-row:first-of-type { border-top: 0; padding-top: 4px; }
.danger-row--severe { border-top-color: rgba(220,47,59,0.25); }
.danger-row h3 { font-family: var(--font-body); font-size: 14px; font-weight: 600; margin: 0 0 2px; color: var(--color-ink); }
.danger-row p { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; max-width: 480px; line-height: 1.5; }

@media (max-width: 900px) {
  .settings__grid { grid-template-columns: 1fr; }
  .nav { position: static; }
  .grid { grid-template-columns: 1fr; }
}
</style>
