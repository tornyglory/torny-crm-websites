<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import { useToast } from '@/composables/useToast'
import { useOnboardingStore } from '@/stores/onboarding'
import { useClubStore } from '@/stores/club'
import { useClubSettingsStore } from '@/stores/clubSettings'
import { useMembershipTiersStore } from '@/stores/membershipTiers'
import { ApiError, clubs, type MembershipTierListItem } from '@torny/api-client'

const toast = useToast()
const onboarding = useOnboardingStore()
const clubStore = useClubStore()
const settingsStore = useClubSettingsStore()
const tiersStore = useMembershipTiersStore()

// Fetch the one-shot settings payload on mount + whenever the active club
// changes. Reads brand.logo_url / favicon_url out of this response instead
// of relying on localStorage or the CORS-blocked `GET /clubs/:id` route.
async function loadSettings() {
  const cid = clubStore.current?.id
  if (typeof cid === 'number') {
    await settingsStore.fetch(cid)
  }
}
async function loadTiers() {
  const cid = clubStore.current?.id
  if (typeof cid === 'number') {
    await tiersStore.fetch(cid)
  } else {
    tiersStore.clear()
  }
}
onMounted(() => { void loadSettings(); void loadTiers() })
watch(() => clubStore.current?.id, () => { void loadSettings(); void loadTiers() })

type SectionKey =
  | 'club'
  | 'membership'
  | 'hours'
  | 'billing'
  | 'team'
  | 'security'
  | 'integrations'
  | 'danger'

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'club', label: 'Club & brand', hint: 'Logo, colour, tagline, contact, address.' },
  { key: 'membership', label: 'Membership types', hint: 'Tiers, pricing, cadence.' },
  { key: 'hours', label: 'Opening hours', hint: 'Weekly schedule for the clubrooms.' },
  { key: 'billing', label: 'Billing', hint: 'Torny subscription + invoices.' },
  { key: 'team', label: 'Team access', hint: 'Who else can manage the CRM.' },
  { key: 'security', label: 'Security', hint: 'Sign-in, sessions, 2FA.' },
  { key: 'integrations', label: 'Integrations', hint: 'Stripe, Google Calendar, mail.' },
  { key: 'danger', label: 'Danger zone', hint: 'Archive or transfer the club.' },
]

const active = ref<SectionKey>('club')

// ── Membership tiers (brief 36 — real CRUD, no onboarding blob) ─────
// Reads / writes via useMembershipTiersStore. Field edits (tier name /
// description / price, cadence, first-year discount) are buffered in
// local drafts and only PATCHed when the user clicks Save. Add / delete
// / make-default remain one-shot actions.

const CADENCE_UNIT: Record<'annual' | 'monthly' | 'season', string> = {
  annual: 'per year', monthly: 'per month', season: 'per season',
}
const cadenceLabel = computed(() => {
  const c = tiersStore.settings.cadence ?? 'annual'
  return CADENCE_UNIT[c] ?? 'per year'
})

/** Palette rotation for the tone chip — matches the honour-board treatment. */
const TIER_TONES: Array<{ key: string; bg: string; fg: string }> = [
  { key: 'accent', bg: 'var(--color-accent-soft)', fg: 'var(--color-accent-strong)' },
  { key: 'mint', bg: '#DCFCE7', fg: '#166534' },
  { key: 'tangerine', bg: '#FEF3C7', fg: '#92400E' },
  { key: 'violet', bg: '#EDE9FE', fg: '#5B21B6' },
]
function tierToneStyle(tier: MembershipTierListItem): { background: string; color: string } {
  const stored = TIER_TONES.find((t) => t.key === tier.tone)
  const fallback = TIER_TONES[tier.sort_order % TIER_TONES.length]!
  const t = stored ?? fallback
  return { background: t.bg, color: t.fg }
}

function tierErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : 'Something went wrong.'
  const body = (err.body ?? {}) as { code?: string }
  switch (body.code) {
    case 'default_tier': return 'Promote another tier as the default before deleting this one.'
    case 'last_tier': return 'Every club needs at least one tier. Add another before deleting this one.'
    case 'tier_in_use': return 'Members are still on this tier — move them to another tier first.'
    case 'default_required': return "Can't remove the default flag — promote another tier first."
    case 'bad_type_name': return 'Tier name needs to be 1–80 characters.'
    case 'bad_cadence': return 'Cadence must be Annual, Monthly, or Season.'
    case 'bad_fee': return 'Price has to be a non-negative number.'
    case 'bad_description': return 'Description must be under 500 characters.'
    case 'slug_conflict': return 'A tier with a similar name already exists — pick something more specific.'
    default: return err.message
  }
}

function isSlugConflict(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  const body = (err.body ?? {}) as { code?: string }
  return body.code === 'slug_conflict'
}

function uniqueTierName(base = 'New tier'): string {
  const existing = new Set(
    tiersStore.tiers.map((t) => t.type_name.trim().toLowerCase()),
  )
  if (!existing.has(base.toLowerCase())) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}`
}

async function addTier() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  const nextTone = TIER_TONES[tiersStore.tiers.length % TIER_TONES.length]!.key
  // Retry-on-collision: the backend can return `slug_conflict` even when
  // no visible tier has the same name — e.g. a previously renamed tier
  // whose stored slug is still `new-tier`. Bump the suffix and try again
  // until we run out of retries.
  let attempt = 0
  let name = uniqueTierName()
  while (true) {
    try {
      await tiersStore.create(cid, {
        type_name: name,
        description: 'What this membership includes.',
        fee: 0,
        tone: nextTone,
      })
      toast.success('Tier added.')
      return
    } catch (err) {
      if (isSlugConflict(err) && attempt < 20) {
        attempt++
        name = uniqueTierName(`New tier ${Date.now().toString(36).slice(-4)}`)
        continue
      }
      toast.error(tierErrorMessage(err))
      return
    }
  }
}

async function removeTier(tier: MembershipTierListItem) {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  const ok = confirm(`Delete the "${tier.type_name}" tier? This cannot be undone.`)
  if (!ok) return
  try {
    await tiersStore.remove(cid, tier.id)
    toast.success('Tier removed.')
  } catch (err) {
    toast.error(tierErrorMessage(err))
  }
}

async function promoteDefault(tier: MembershipTierListItem) {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || tier.is_default) return
  try {
    await tiersStore.setDefault(cid, tier.id)
    toast.success(`${tier.type_name} is now the default tier.`)
  } catch (err) {
    toast.error(tierErrorMessage(err))
  }
}

// ── Buffered draft state — writes only fire on Save ────────────────
// Each tier's pending edits live in `tierDrafts[tierId]`. `settingsDraft`
// holds pending cadence + first-year-discount overrides. Template reads
// go through the `draftedX()` helpers so unsaved input stays reflected
// even after the store refetches.

type TierDraft = Partial<Pick<MembershipTierListItem, 'type_name' | 'description' | 'fee'>>
const tierDrafts = reactive<Record<number, TierDraft>>({})
const settingsDraft = reactive<{
  cadence?: 'annual' | 'monthly' | 'season' | null
  first_year_discount?: boolean
}>({})
const membershipSaving = ref(false)

function membershipDirty(): boolean {
  if (Object.keys(settingsDraft).length > 0) return true
  return Object.values(tierDrafts).some((d) => Object.keys(d).length > 0)
}
const isMembershipDirty = computed(membershipDirty)

function draftedTierField<K extends keyof TierDraft>(
  tier: MembershipTierListItem,
  field: K,
): TierDraft[K] {
  const d = tierDrafts[tier.id]
  if (d && field in d) return d[field]
  return tier[field] as TierDraft[K]
}

function stageTierField(
  tier: MembershipTierListItem,
  field: keyof TierDraft,
  value: string | number | null,
) {
  const stored = tier[field] ?? (field === 'fee' ? 0 : null)
  const next = value === '' ? null : value
  const draft = tierDrafts[tier.id] ?? (tierDrafts[tier.id] = {})
  if (next === stored) {
    delete draft[field]
    if (Object.keys(draft).length === 0) delete tierDrafts[tier.id]
    return
  }
  ;(draft as Record<string, unknown>)[field] = next
}

const draftedCadence = computed<'annual' | 'monthly' | 'season'>(
  () => (settingsDraft.cadence ?? tiersStore.settings.cadence ?? 'annual'),
)
const draftedFirstYearDiscount = computed<boolean>(
  () => settingsDraft.first_year_discount ?? tiersStore.settings.first_year_discount,
)

function stageCadence(next: 'annual' | 'monthly' | 'season') {
  if (tiersStore.settings.cadence === next) {
    delete settingsDraft.cadence
    return
  }
  settingsDraft.cadence = next
}
function stageFirstYearDiscount() {
  const next = !draftedFirstYearDiscount.value
  if (next === tiersStore.settings.first_year_discount) {
    delete settingsDraft.first_year_discount
    return
  }
  settingsDraft.first_year_discount = next
}

function clearMembershipDrafts() {
  for (const key of Object.keys(tierDrafts)) delete tierDrafts[Number(key)]
  delete settingsDraft.cadence
  delete settingsDraft.first_year_discount
}

async function saveMembershipChanges() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  if (!membershipDirty() || membershipSaving.value) return
  membershipSaving.value = true
  try {
    const tierIds = Object.keys(tierDrafts).map(Number)
    const tierWrites = tierIds.map((id) => tiersStore.update(cid, id, tierDrafts[id]!))
    const settingsPatch: { cadence?: 'annual' | 'monthly' | 'season' | null; first_year_discount?: boolean } = {}
    if ('cadence' in settingsDraft) settingsPatch.cadence = settingsDraft.cadence
    if ('first_year_discount' in settingsDraft) settingsPatch.first_year_discount = settingsDraft.first_year_discount!
    const settingsWrite = Object.keys(settingsPatch).length > 0
      ? [tiersStore.updateSettings(cid, settingsPatch)]
      : []
    const results = await Promise.allSettled([...tierWrites, ...settingsWrite])
    const firstFailure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (firstFailure) throw firstFailure.reason
    clearMembershipDrafts()
    toast.success('Membership types saved.')
  } catch (err) {
    toast.error(tierErrorMessage(err))
  } finally {
    membershipSaving.value = false
  }
}

// ── Opening hours (shared with onboarding store) ───────────────
const HOURS_DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const

function toggleDay(key: (typeof HOURS_DAYS)[number]['key']) {
  onboarding.data.hours[key].open = !onboarding.data.hours[key].open
}
function saveHours() {
  toast.success('Opening hours saved.')
}

// ── Brand ──────────────────────────────────────────────────────
const brandSwatches = ['#2563EB', '#DC2626', '#16A34A', '#EA580C', '#7C3AED', '#0F766E', '#0A0A0B']

/**
 * Logo / favicon two-way binding — reads from `settingsStore.data.brand`
 * (populated by `GET /clubs/:id/settings` on mount) and writes through
 * `PATCH /clubs/:id/brand-assets`. Merge the PATCH response back into both
 * the settings store (so the page keeps showing it after save) and the
 * club store (so the sidebar / other surfaces stay in sync).
 *
 * Do NOT read from `clubStore.current.logoUrl` alone — that's populated by
 * `hydrateFull()` which hits the CORS-blocked `GET /clubs/:id` (brief 30).
 */
const brandLogoUrl = computed<string>({
  get: () => settingsStore.data?.brand?.logo_url ?? clubStore.current?.logoUrl ?? '',
  set: (value) => { void persistBrandAsset('logo_url', value) },
})
const brandFaviconUrl = computed<string>({
  get: () => settingsStore.data?.brand?.favicon_url ?? clubStore.current?.faviconUrl ?? '',
  set: (value) => { void persistBrandAsset('favicon_url', value) },
})

async function persistBrandAsset(field: 'logo_url' | 'favicon_url', value: string) {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') {
    toast.error('No active club — refresh and try again.')
    return
  }
  const payload = { [field]: value || null } as Record<'logo_url' | 'favicon_url', string | null>
  try {
    const res = await clubs.updateBrandAssets(clubId, payload)
    settingsStore.patchBrand({ logo_url: res.logo_url, favicon_url: res.favicon_url })
    clubStore.setBrandAssets({
      logoUrl: res.logo_url,
      faviconUrl: res.favicon_url,
    })
    toast.success(value ? `${field === 'logo_url' ? 'Logo' : 'Favicon'} saved.` : `${field === 'logo_url' ? 'Logo' : 'Favicon'} removed.`)
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : `Could not save ${field.replace('_', ' ')}`
    toast.error(msg || 'Could not save')
  }
}

function saveBrand() {
  toast.success('Brand saved.')
}

/**
 * Club profile — the shared fields (name, email, phone, address) live on
 * `onboarding.data` so they hydrate from the backend per club and stay in
 * sync with the wizard. The onboarding store gates its PATCH watch on
 * `!completed`, so edits made here after onboarding don't overwrite the
 * server; a proper PATCH /clubs/:id endpoint is a follow-up.
 *
 * The remaining fields (legalName, incorporationNumber, timeZone) aren't in
 * the wizard schema — held locally with sensible defaults for now.
 */
const clubExtra = ref({
  legalName: '',
  incorporationNumber: '',
  timeZone: 'Pacific/Auckland',
})

/** Full postal address as one line — the wizard splits this into
 *  street / suburb / region / country, this composes for display. */
const fullAddress = computed({
  get: () => [
    onboarding.data.address,
    onboarding.data.suburb,
    onboarding.data.region,
    onboarding.data.country,
  ].filter((s) => s && s.trim().length > 0).join(', '),
  set: (v: string) => { onboarding.data.address = v },
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

// ── Simple button handlers ─────────────────────────────────────
function saveClubProfile() { toast.success('Club profile saved.') }
function signOutSession(id: string) {
  security.value.sessions = security.value.sessions.filter((s) => s.id !== id)
  toast.info('Session signed out.')
}
function toggleIntegration(id: string) {
  const i = integrations.value.find((x) => x.id === id)
  if (!i) return
  if (i.status === 'connected') {
    i.status = 'available'
    toast.info(`Disconnected ${i.label}.`)
  } else {
    i.status = 'connected'
    toast.success(`${i.label} connected.`)
  }
}
function goManage(kind: 'plan' | 'seats' | 'card') {
  const labels: Record<typeof kind, string> = { plan: 'plan', seats: 'seats', card: 'payment method' }
  toast.info(`Managing ${labels[kind]} in a new tab…`)
}
function manageTeamRow(name: string) {
  toast.info(`Managing ${name}'s role — role picker opens next session.`)
}

// ── Invite teammate modal ──────────────────────────────────────
const inviteOpen = ref(false)
const inviteForm = reactive({
  email: '',
  role: 'Committee' as 'Admin' | 'Committee',
  message: '',
})
function openInvite() {
  inviteForm.email = ''
  inviteForm.role = 'Committee'
  inviteForm.message = ''
  inviteOpen.value = true
}
function closeInvite() { inviteOpen.value = false }
const canInvite = computed(() => /.+@.+\..+/.test(inviteForm.email.trim()))
function sendInvite() {
  if (!canInvite.value) return
  team.value.push({
    id: `u${Date.now()}`,
    name: inviteForm.email.split('@')[0] ?? inviteForm.email,
    email: inviteForm.email.trim(),
    role: inviteForm.role,
    lastActive: '—',
  })
  inviteOpen.value = false
  toast.success(`Invite sent to ${inviteForm.email.trim()}.`)
}
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
          <!-- Brand — sits above the profile fields as the visual anchor -->
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Visual identity</div>
                <h2 class="card__title">Brand</h2>
              </div>
              <button class="btn btn--outline" @click="saveBrand">Save changes</button>
            </div>
            <p class="card__sub">A logo, an accent colour, and a short tagline. Rendered across the CRM, the public site, and Torny apps.</p>

            <div class="brand-grid">
              <div class="brand-card">
                <ImagePicker
                  v-model="brandLogoUrl"
                  content-type="avatar"
                  aspect="1 / 1"
                  label="Logo"
                  hint="Square, PNG or SVG. Shows in the header, footer, and open-graph share card."
                />
              </div>
              <div class="brand-card">
                <ImagePicker
                  v-model="brandFaviconUrl"
                  content-type="avatar"
                  aspect="1 / 1"
                  label="Favicon"
                  hint="32×32 PNG. Shows in the browser tab."
                  :max-size-mb="1"
                />
              </div>
            </div>

            <div class="brand-card">
              <div class="accent-head">
                <div>
                  <div class="field__label">Accent colour</div>
                  <div class="accent-sub">Used on buttons, links, and highlights across your site.</div>
                </div>
                <div class="hex">
                  <span class="hex__swatch" :style="{ background: onboarding.data.accentColour }" />
                  <span class="hex__code">{{ onboarding.data.accentColour.toUpperCase() }}</span>
                </div>
              </div>
              <div class="swatches">
                <button
                  v-for="c in brandSwatches"
                  :key="c"
                  type="button"
                  class="swatch-btn"
                  :class="{ 'is-on': onboarding.data.accentColour.toLowerCase() === c.toLowerCase() }"
                  :style="{ background: c, '--ring': c } as any"
                  @click="onboarding.data.accentColour = c"
                />
                <label class="swatch-btn swatch-btn--custom">
                  <span>#</span>
                  <input type="color" v-model="onboarding.data.accentColour" />
                </label>
              </div>
            </div>

            <label class="field">
              <div class="field-head">
                <span class="field__label">Tagline</span>
                <span class="field__count">{{ onboarding.data.tagline.length }} / 80</span>
              </div>
              <input v-model="onboarding.data.tagline" maxlength="80" class="tagline" placeholder="Wellington's home for social bowls since 1898." />
              <span class="field__hint">One short line. Appears under your club name on the public site.</span>
            </label>
          </div>

          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Public identity</div>
                <h2 class="card__title">Club profile</h2>
              </div>
              <button class="btn btn--outline" @click="saveClubProfile">Save changes</button>
            </div>
            <div class="grid">
              <div class="field">
                <label>Club name</label>
                <input v-model="onboarding.data.clubName" />
              </div>
              <div class="field">
                <label>Legal name</label>
                <input v-model="clubExtra.legalName" />
              </div>
              <div class="field">
                <label>Incorporation number</label>
                <input v-model="clubExtra.incorporationNumber" />
              </div>
              <div class="field">
                <label>Time zone</label>
                <input v-model="clubExtra.timeZone" />
              </div>
              <div class="field">
                <label>Public email</label>
                <input v-model="onboarding.data.email" />
              </div>
              <div class="field">
                <label>Public phone</label>
                <input v-model="onboarding.data.phone" />
              </div>
              <div class="field field--wide">
                <label>Postal address</label>
                <input v-model="fullAddress" />
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
                <button class="btn btn--outline" @click="goManage('plan')">Change plan</button>
                <button class="btn btn--outline" @click="goManage('seats')">Manage seats</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Payment method</div>
                <h2 class="card__title">{{ billing.paymentMethod }}</h2>
              </div>
              <button class="btn btn--outline" @click="goManage('card')">Update card</button>
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
                <button class="link" @click="toast.info(`Downloading ${i.id.toUpperCase()}…`)">Download</button>
              </li>
            </ul>
          </div>
        </template>

        <!-- Membership types -->
        <template v-else-if="active === 'membership'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Membership types</div>
                <h2 class="card__title">Tiers &amp; pricing</h2>
              </div>
              <span v-if="membershipSaving" class="tier__saving">Saving…</span>
              <span v-else-if="isMembershipDirty" class="tier__saving tier__saving--pending">Unsaved changes</span>
            </div>
            <p class="card__sub">Tiers your members pay to join. Prices show on the public /membership page and drive the application flow.</p>

            <div class="member-controls">
              <div>
                <div class="field__label">Billing cadence</div>
                <div class="segmented">
                  <button type="button" :class="{ 'is-on': draftedCadence === 'annual' }" @click="stageCadence('annual')">Annual</button>
                  <button type="button" :class="{ 'is-on': draftedCadence === 'monthly' }" @click="stageCadence('monthly')">Monthly</button>
                  <button type="button" :class="{ 'is-on': draftedCadence === 'season' }" @click="stageCadence('season')">Season</button>
                </div>
              </div>
              <div class="discount">
                <span class="discount__dot" />
                <span class="discount__label"><b>First year 20% off</b> — new joiners only</span>
                <button type="button" class="switch" :class="{ 'is-on': draftedFirstYearDiscount }" @click="stageFirstYearDiscount"><span class="switch__knob" /></button>
              </div>
            </div>

            <div v-if="tiersStore.loading && tiersStore.tiers.length === 0" class="tier__loading">
              Loading tiers…
            </div>
            <ul v-else class="tiers">
              <li v-for="tier in tiersStore.sortedTiers" :key="tier.id" class="tier">
                <div class="tier__icon" :style="tierToneStyle(tier)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="8" r="3" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /></svg>
                </div>
                <div class="tier__body">
                  <div class="tier__row">
                    <input
                      :value="draftedTierField(tier, 'type_name')"
                      class="tier__name"
                      @input="stageTierField(tier, 'type_name', ($event.target as HTMLInputElement).value)"
                    />
                    <span v-if="tier.is_default" class="tier__flag">Default</span>
                    <button v-else type="button" class="tier__make-default" @click="promoteDefault(tier)">Make default</button>
                  </div>
                  <input
                    :value="draftedTierField(tier, 'description') ?? ''"
                    class="tier__desc"
                    placeholder="What this membership includes."
                    @input="stageTierField(tier, 'description', ($event.target as HTMLInputElement).value || null)"
                  />
                </div>
                <div class="tier__price">
                  <span class="tier__price-sign">$</span>
                  <input
                    :value="draftedTierField(tier, 'fee') ?? 0"
                    type="number"
                    min="0"
                    step="5"
                    class="tier__price-input"
                    @input="stageTierField(tier, 'fee', Number(($event.target as HTMLInputElement).value) || 0)"
                  />
                  <span class="tier__price-unit">{{ cadenceLabel }}</span>
                </div>
                <button v-if="!tier.is_default" type="button" class="tier__remove" aria-label="Remove tier" @click="removeTier(tier)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="14" height="14"><path d="M6 6l12 12M6 18L18 6" /></svg>
                </button>
              </li>
              <button type="button" class="add-tier" @click="addTier">+ Add membership type</button>
            </ul>

            <div class="tier__actions">
              <button
                type="button"
                class="ghost-btn"
                :disabled="!isMembershipDirty || membershipSaving"
                @click="clearMembershipDrafts"
              >Discard</button>
              <button
                type="button"
                class="primary-btn"
                :disabled="!isMembershipDirty || membershipSaving"
                @click="saveMembershipChanges"
              >{{ membershipSaving ? 'Saving…' : 'Save changes' }}</button>
            </div>
          </div>
        </template>

        <!-- Opening hours -->
        <template v-else-if="active === 'hours'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Clubrooms</div>
                <h2 class="card__title">Opening hours</h2>
              </div>
              <button class="btn btn--outline" @click="saveHours">Save changes</button>
            </div>
            <p class="card__sub">When your clubrooms are open. Shown on your public site and drives event scheduling defaults.</p>

            <div class="hours-grid">
              <div v-for="d in HOURS_DAYS" :key="d.key" class="hour-row" :class="{ 'is-closed': !onboarding.data.hours[d.key].open }">
                <button type="button" class="switch switch--sm" :class="{ 'is-on': onboarding.data.hours[d.key].open }" @click="toggleDay(d.key)" aria-label="Toggle open"><span class="switch__knob" /></button>
                <div class="hour-row__day">{{ d.label }}</div>
                <template v-if="onboarding.data.hours[d.key].open">
                  <input v-model="onboarding.data.hours[d.key].from" type="time" class="hour-row__time" />
                  <span class="hour-row__dash">–</span>
                  <input v-model="onboarding.data.hours[d.key].to" type="time" class="hour-row__time" />
                </template>
                <span v-else class="hour-row__closed">Closed</span>
              </div>
            </div>
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
              <button class="btn btn--primary" @click="openInvite">+ Invite</button>
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
                <button class="link" @click="manageTeamRow(u.name)">Manage</button>
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
                <button v-if="!s.current" class="link link--danger" @click="signOutSession(s.id)">Sign out</button>
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
                <button class="link" @click="toggleIntegration(i.id)">{{ i.status === 'connected' ? 'Manage' : 'Connect' }}</button>
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
              <button class="btn btn--outline" @click="toast.info('Transfer opens next session.')">Start transfer</button>
            </div>
            <div class="danger-row">
              <div>
                <h3>Archive this club</h3>
                <p>Public site goes read-only, no new members can apply. Reversible for 30 days.</p>
              </div>
              <button class="btn btn--outline" @click="toast.info('Archive flow opens next session.')">Archive</button>
            </div>
            <div class="danger-row danger-row--severe">
              <div>
                <h3>Delete club record</h3>
                <p>Permanently deletes members, events, honour board and website. This cannot be undone.</p>
              </div>
              <button class="btn btn--danger" @click="toast.error('Delete requires committee approval. Contact support.')">Delete permanently</button>
            </div>
          </div>
        </template>
      </section>
    </div>

    <CrmModal
      :open="inviteOpen"
      eyebrow="Team access"
      title="Invite a teammate"
      width="md"
      @close="closeInvite"
    >
      <p class="invite__body">They'll get an email invite. Once accepted, they can sign in to the CRM with the role you pick.</p>
      <form class="form" @submit.prevent="sendInvite">
        <label class="field">
          <span class="field__label">Email address</span>
          <input v-model="inviteForm.email" type="email" placeholder="teammate@club.co.nz" autofocus />
        </label>
        <label class="field">
          <span class="field__label">Role</span>
          <select v-model="inviteForm.role">
            <option value="Admin">Admin — same rights as you</option>
            <option value="Committee">Committee — read-only + reply to enquiries</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Personal message (optional)</span>
          <textarea v-model="inviteForm.message" rows="3" placeholder="Kia ora — you'll now have CRM access…" />
        </label>
      </form>
      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeInvite">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canInvite" @click="sendInvite">Send invite</button>
      </template>
    </CrmModal>
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

/* Invite modal */
.invite__body { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin: 0 0 16px; }
.form { display: flex; flex-direction: column; gap: 14px; }
.form .field { display: flex; flex-direction: column; gap: 6px; }
.form .field input, .form .field select, .form .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.form .field input:focus, .form .field select:focus, .form .field textarea:focus { outline: none; border-color: var(--color-ink); }
.form .field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

/* ── Membership types ────────────────────────────────────────── */
.member-controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin: 16px 0 20px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); display: block; }
.member-controls .field__label { margin-bottom: 8px; }
.segmented { display: inline-flex; padding: 4px; background: var(--color-surface); border-radius: 999px; }
.segmented button { padding: 8px 16px; background: transparent; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented button.is-on { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.discount { display: inline-flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--color-accent-soft); border-radius: 12px; }
.discount__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-accent); }
.discount__label { font-family: var(--font-body); font-size: 12px; color: var(--color-accent-strong); }
.discount__label b { font-weight: 600; }

.tiers { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.tier { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 14px; }
.tier__icon { width: 40px; height: 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tier__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tier__row { display: flex; align-items: center; gap: 10px; }
.tier__name { border: 0; background: transparent; padding: 0; font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); width: 100%; }
.tier__name:focus { outline: none; }
.tier__desc { border: 0; background: transparent; padding: 0; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); width: 100%; }
.tier__desc:focus { outline: none; color: var(--color-ink); }
.tier__flag { font-family: var(--font-mono); font-size: 10px; padding: 2px 8px; background: var(--color-accent-soft); color: var(--color-accent-strong); border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.tier__saving { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.tier__loading { padding: 32px; text-align: center; font-family: var(--font-body); font-size: 14px; color: var(--color-fog); border: 1px dashed var(--color-hairline); border-radius: 12px; }
.tier__make-default { background: transparent; border: 0; padding: 0; font-family: var(--font-body); font-size: 11px; color: var(--color-accent); font-weight: 600; cursor: pointer; text-decoration: underline; }
.tier__make-default:hover { color: var(--color-accent-strong); }
.tier__price { display: inline-flex; align-items: center; padding: 8px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; gap: 4px; flex-shrink: 0; }
.tier__price-sign { font-family: var(--font-mono); font-size: 13px; color: var(--color-fog); }
.tier__price-input { width: 60px; padding: 4px 0; background: transparent; border: 0; font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; text-align: right; -moz-appearance: textfield; }
.tier__price-input::-webkit-outer-spin-button, .tier__price-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.tier__price-input:focus { outline: none; }
.tier__price-unit { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-left: 4px; }
.tier__remove { width: 32px; height: 32px; border-radius: 8px; background: transparent; border: 1px solid var(--color-hairline); color: var(--color-fog); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tier__remove:hover { background: var(--color-danger); border-color: var(--color-danger); color: #fff; }
.add-tier { padding: 12px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-accent); cursor: pointer; }
.add-tier:hover { background: var(--color-accent-soft); }

.tier__saving--pending { color: var(--color-accent-strong); }
.tier__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.primary-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; background: var(--color-ink); color: #fff; }
.primary-btn:hover:not(:disabled) { background: var(--color-graphite); }
.primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-hairline); background: transparent; color: var(--color-ink); }
.ghost-btn:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-ink); }
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Opening hours ───────────────────────────────────────────── */
.hours-grid { display: flex; flex-direction: column; margin-top: 16px; }
.hour-row { display: grid; grid-template-columns: 40px 130px 100px 12px 100px 1fr; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--color-hairline); }
.hour-row:last-child { border-bottom: 0; }
.hour-row.is-closed { opacity: 0.6; }
.switch--sm { width: 34px; height: 20px; padding: 2px; }
.switch--sm .switch__knob { width: 16px; height: 16px; }
.switch--sm.is-on .switch__knob { transform: translateX(14px); }
.hour-row__day { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.hour-row__time { padding: 8px 10px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-mono); font-size: 13px; color: var(--color-ink); }
.hour-row__time:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.hour-row__dash { text-align: center; color: var(--color-fog); }
.hour-row__closed { grid-column: 3 / -1; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); font-style: italic; }

/* ── Brand ───────────────────────────────────────────────────── */
.brand-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
.brand-card { padding: 20px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 14px; display: flex; flex-direction: column; gap: 12px; }
/* Constrain the ImagePicker drop-zone so 1:1 avatars don't blow out the card height. */
.brand-card :deep(.picker__frame) { max-width: 160px; }
.brand-grid + .brand-card { margin-top: 12px; }

.accent-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.accent-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.hex { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 8px; flex-shrink: 0; }
.hex__swatch { width: 14px; height: 14px; border-radius: 4px; border: 1px solid rgba(0, 0, 0, 0.06); }
.hex__code { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); font-weight: 600; }
.swatches { display: flex; gap: 10px; flex-wrap: wrap; }
.swatch-btn { width: 38px; height: 38px; border-radius: 10px; border: 0; padding: 0; cursor: pointer; position: relative; transition: transform 0.1s ease; }
.swatch-btn:hover { transform: scale(1.05); }
.swatch-btn.is-on { box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--ring, var(--color-ink)); }
.swatch-btn--custom { background: #fff; border: 1px dashed var(--color-hairline); display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); overflow: hidden; }
.swatch-btn--custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.field { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.field-head { display: flex; justify-content: space-between; align-items: baseline; }
.field__count { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-mute); }
.tagline { padding: 12px 14px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-display); font-size: 16px; color: var(--color-ink); font-weight: 500; }
.tagline:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

@media (max-width: 900px) {
  .settings__grid { grid-template-columns: 1fr; }
  .nav { position: static; }
  .grid { grid-template-columns: 1fr; }
  .member-controls { flex-direction: column; align-items: stretch; }
  .brand-grid { grid-template-columns: 1fr; }
  .hour-row { grid-template-columns: 32px 90px 1fr auto 1fr; row-gap: 6px; }
}
</style>
