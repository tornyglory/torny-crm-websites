<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import { useToast } from '@/composables/useToast'
import { useOnboardingStore } from '@/stores/onboarding'
import { useClubStore } from '@/stores/club'
import { useClubSettingsStore } from '@/stores/clubSettings'
import { useMembershipTiersStore } from '@/stores/membershipTiers'
import { useNotificationsStore } from '@/stores/notifications'
import {
  ApiError,
  clubs,
  emailTemplate as emailTemplateApi,
  enquiries as enquiriesApi,
  type EmailDigest,
  type EmailFlavor,
  type EmailFlavorPatch,
  type EmailFlavorRow,
  type EmailPreviewResult,
  type EmailTemplate,
  type EmailTemplatePatch,
  type EmailVariable,
  type EnquirySettings,
  type EnquiryTopic,
  type MembershipTierListItem,
  type NotificationKind,
} from '@torny/api-client'

const toast = useToast()
const onboarding = useOnboardingStore()
const clubStore = useClubStore()
const settingsStore = useClubSettingsStore()
const tiersStore = useMembershipTiersStore()
const notificationsStore = useNotificationsStore()

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
  | 'notifications'
  | 'enquiries'
  | 'email'
  | 'integrations'
  | 'danger'

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'club', label: 'Club & brand', hint: 'Logo, colour, tagline, contact, address.' },
  { key: 'membership', label: 'Membership types', hint: 'Tiers, pricing, cadence.' },
  { key: 'hours', label: 'Opening hours', hint: 'Weekly schedule for the clubrooms.' },
  { key: 'billing', label: 'Billing', hint: 'Torny subscription + invoices.' },
  { key: 'team', label: 'Team access', hint: 'Who else can manage the CRM.' },
  { key: 'security', label: 'Security', hint: 'Sign-in, sessions, 2FA.' },
  { key: 'notifications', label: 'Notifications', hint: 'Which kinds ping you in-app + by email.' },
  { key: 'enquiries', label: 'Enquiries', hint: 'Contact-form intake, notify email, auto-reply.' },
  { key: 'email', label: 'Email template', hint: 'Header + footer for every outgoing email.' },
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
  applications_open?: boolean
  application_notification_email?: string | null
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
const draftedApplicationsOpen = computed<boolean>(
  () => settingsDraft.applications_open ?? tiersStore.settings.applications_open ?? true,
)
const draftedNotificationEmail = computed<string>({
  get: () => settingsDraft.application_notification_email
    ?? tiersStore.settings.application_notification_email
    ?? '',
  set: (value) => {
    const stored = tiersStore.settings.application_notification_email ?? ''
    const next = value.trim()
    if (next === stored) delete settingsDraft.application_notification_email
    else settingsDraft.application_notification_email = next || null
  },
})

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
function stageApplicationsOpen() {
  const stored = tiersStore.settings.applications_open ?? true
  const next = !draftedApplicationsOpen.value
  if (next === stored) {
    delete settingsDraft.applications_open
    return
  }
  settingsDraft.applications_open = next
}

function clearMembershipDrafts() {
  for (const key of Object.keys(tierDrafts)) delete tierDrafts[Number(key)]
  delete settingsDraft.cadence
  delete settingsDraft.first_year_discount
  delete settingsDraft.applications_open
  delete settingsDraft.application_notification_email
}

async function saveMembershipChanges() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  if (!membershipDirty() || membershipSaving.value) return
  membershipSaving.value = true
  try {
    const tierIds = Object.keys(tierDrafts).map(Number)
    const tierWrites = tierIds.map((id) => tiersStore.update(cid, id, tierDrafts[id]!))
    const settingsPatch: {
      cadence?: 'annual' | 'monthly' | 'season' | null
      first_year_discount?: boolean
      applications_open?: boolean
      application_notification_email?: string | null
    } = {}
    if ('cadence' in settingsDraft) settingsPatch.cadence = settingsDraft.cadence
    if ('first_year_discount' in settingsDraft) settingsPatch.first_year_discount = settingsDraft.first_year_discount!
    if ('applications_open' in settingsDraft) settingsPatch.applications_open = settingsDraft.applications_open!
    if ('application_notification_email' in settingsDraft) settingsPatch.application_notification_email = settingsDraft.application_notification_email!
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

// ── Notifications preferences (brief 40) ─────────────────────
// Per-user, not per-club. One matrix of seven kinds × in-app × email
// + a digest radio. Buffered like the tiers form so the Save button
// stays in charge.
const NOTIFICATION_KINDS: Array<{ key: NotificationKind; label: string; hint: string }> = [
  { key: 'application',      label: 'Applications',      hint: 'New applications land in the inbox.' },
  { key: 'enquiry',          label: 'Enquiries',         hint: 'Someone sent a contact-form message.' },
  { key: 'rsvp',             label: 'Event RSVPs',       hint: 'An event hits a threshold you set.' },
  { key: 'team',             label: 'Team selections',   hint: 'A round needs confirming.' },
  { key: 'publish',          label: 'Website publish',   hint: 'A page deploy finished.' },
  { key: 'payment',          label: 'Payment batches',   hint: 'Dues collection or renewal run finished.' },
  { key: 'member_milestone', label: 'Member milestones', hint: 'A member hits a games / years / trophies milestone.' },
]

interface NotificationDraft {
  perKind: Partial<Record<NotificationKind, Partial<{ in_app: boolean; email: boolean }>>>
  digest?: EmailDigest
}
const notificationDraft = reactive<NotificationDraft>({ perKind: {} })
const notificationSaving = ref(false)

async function loadNotificationSettings() {
  try {
    await notificationsStore.fetchSettings()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load notification settings.')
  }
}
onMounted(loadNotificationSettings)

function draftedPref(kind: NotificationKind, field: 'in_app' | 'email'): boolean {
  const override = notificationDraft.perKind[kind]?.[field]
  if (typeof override === 'boolean') return override
  const stored = notificationsStore.settings?.per_kind[kind]?.[field]
  return stored ?? false
}
function stagePref(kind: NotificationKind, field: 'in_app' | 'email') {
  const stored = notificationsStore.settings?.per_kind[kind]?.[field] ?? false
  const next = !draftedPref(kind, field)
  const draft = notificationDraft.perKind[kind] ?? (notificationDraft.perKind[kind] = {})
  if (next === stored) {
    delete draft[field]
    if (Object.keys(draft).length === 0) delete notificationDraft.perKind[kind]
    return
  }
  draft[field] = next
}
const draftedDigest = computed<EmailDigest>(
  () => notificationDraft.digest ?? notificationsStore.settings?.email_digest ?? 'off',
)
function stageDigest(next: EmailDigest) {
  const stored = notificationsStore.settings?.email_digest ?? 'off'
  if (next === stored) {
    delete notificationDraft.digest
    return
  }
  notificationDraft.digest = next
}
const isNotificationsDirty = computed<boolean>(
  () => notificationDraft.digest != null || Object.keys(notificationDraft.perKind).length > 0,
)
function clearNotificationDraft() {
  for (const key of Object.keys(notificationDraft.perKind)) delete notificationDraft.perKind[key as NotificationKind]
  delete notificationDraft.digest
}
async function saveNotificationSettings() {
  if (!isNotificationsDirty.value || notificationSaving.value) return
  notificationSaving.value = true
  try {
    const patch: { per_kind?: NotificationDraft['perKind']; email_digest?: EmailDigest } = {}
    if (Object.keys(notificationDraft.perKind).length > 0) patch.per_kind = { ...notificationDraft.perKind }
    if (notificationDraft.digest) patch.email_digest = notificationDraft.digest
    await notificationsStore.saveSettings(patch)
    clearNotificationDraft()
    toast.success('Notification settings saved.')
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as { code?: string }) : {}
    if (body.code === 'bad_kind') toast.error('One of the kinds looks wrong — refresh and try again.')
    else if (body.code === 'bad_digest') toast.error('Pick a valid digest schedule (Off / Daily / Weekly).')
    else toast.error(err instanceof ApiError ? err.message : 'Could not save notification settings.')
  } finally {
    notificationSaving.value = false
  }
}

// ── Enquiries settings (brief 41) ─────────────────────────────
// Owner knobs for the public contact-form: intake toggle, notify
// email, auto-reply body, and topics allowlist. Buffered like the
// tiers form so a stray click doesn't fire a PATCH.
const ENQUIRY_TOPICS: Array<{ key: EnquiryTopic; label: string }> = [
  { key: 'membership', label: 'Membership' },
  { key: 'events', label: 'Events & roll-ups' },
  { key: 'facilities', label: 'Facilities hire' },
  { key: 'general', label: 'General enquiry' },
  { key: 'media', label: 'Media' },
]
const enquirySettings = ref<EnquirySettings | null>(null)
const enquirySettingsLoading = ref(false)
const enquirySettingsSaving = ref(false)
const enquiryDraft = reactive<{
  enquiries_open?: boolean
  enquiry_notification_email?: string | null
  auto_reply_body?: string | null
  topics_enabled?: EnquiryTopic[]
}>({})

async function loadEnquirySettings() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  enquirySettingsLoading.value = true
  try {
    // Reads via GET /clubs/:id/settings.enquiries — but the api-client
    // doesn't have a dedicated getter for that yet, so we PATCH with an
    // empty body which server returns the merged settings.
    enquirySettings.value = await enquiriesApi.updateSettings(cid, {})
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load enquiry settings.')
  } finally {
    enquirySettingsLoading.value = false
  }
}
onMounted(loadEnquirySettings)
watch(() => clubStore.current?.id, loadEnquirySettings)

function draftedEnquiriesOpen(): boolean {
  return enquiryDraft.enquiries_open ?? enquirySettings.value?.enquiries_open ?? true
}
const draftedEnquiriesOpenVal = computed(draftedEnquiriesOpen)
function stageEnquiriesOpen() {
  const stored = enquirySettings.value?.enquiries_open ?? true
  const next = !draftedEnquiriesOpen()
  if (next === stored) { delete enquiryDraft.enquiries_open; return }
  enquiryDraft.enquiries_open = next
}
const draftedNotifyEmail = computed<string>({
  get: () => (enquiryDraft.enquiry_notification_email
    ?? enquirySettings.value?.enquiry_notification_email
    ?? ''),
  set: (v) => {
    const stored = enquirySettings.value?.enquiry_notification_email ?? ''
    const next = v.trim()
    if (next === stored) delete enquiryDraft.enquiry_notification_email
    else enquiryDraft.enquiry_notification_email = next || null
  },
})
const draftedAutoReply = computed<string>({
  get: () => (enquiryDraft.auto_reply_body
    ?? enquirySettings.value?.auto_reply_body
    ?? ''),
  set: (v) => {
    const stored = enquirySettings.value?.auto_reply_body ?? ''
    if (v === stored) delete enquiryDraft.auto_reply_body
    else enquiryDraft.auto_reply_body = v || null
  },
})
function draftedTopics(): EnquiryTopic[] {
  return enquiryDraft.topics_enabled ?? enquirySettings.value?.topics_enabled ?? []
}
function isTopicEnabled(t: EnquiryTopic): boolean {
  const list = draftedTopics()
  // Empty list = all allowed.
  return list.length === 0 || list.includes(t)
}
function toggleTopic(t: EnquiryTopic) {
  const current = draftedTopics()
  // If the current state is "all enabled" (empty list), moving to a
  // subset means initialising with every topic except the toggled one.
  const base = current.length === 0 ? ENQUIRY_TOPICS.map((x) => x.key) : [...current]
  const idx = base.indexOf(t)
  if (idx >= 0) base.splice(idx, 1)
  else base.push(t)
  // If the user has re-enabled every topic, collapse back to "all".
  const isFullSet = base.length === ENQUIRY_TOPICS.length
  const stored = enquirySettings.value?.topics_enabled ?? []
  const nextArr = isFullSet ? [] : base
  const isSame = nextArr.length === stored.length && nextArr.every((x) => stored.includes(x))
  if (isSame) delete enquiryDraft.topics_enabled
  else enquiryDraft.topics_enabled = nextArr
}
const isEnquiryDirty = computed(() => Object.keys(enquiryDraft).length > 0)
function clearEnquiryDraft() {
  delete enquiryDraft.enquiries_open
  delete enquiryDraft.enquiry_notification_email
  delete enquiryDraft.auto_reply_body
  delete enquiryDraft.topics_enabled
}
async function saveEnquirySettings() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !isEnquiryDirty.value) return
  enquirySettingsSaving.value = true
  try {
    enquirySettings.value = await enquiriesApi.updateSettings(cid, enquiryDraft)
    clearEnquiryDraft()
    toast.success('Enquiry settings saved.')
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as { code?: string }) : {}
    if (body.code === 'bad_topics') toast.error('One of the topic slugs looks wrong.')
    else toast.error(err instanceof ApiError ? err.message : 'Could not save enquiry settings.')
  } finally {
    enquirySettingsSaving.value = false
  }
}

// ── Email template (brief 45) ─────────────────────────────────
// Owner-editable header + footer that wraps every outgoing club email.
// {{curly-brace}} tokens get substituted at send time by the backend;
// the CRM preview does the same substitution client-side using each
// variable's `sample` value (or the owner's `sample_overrides`).

const EMAIL_FLAVORS: Array<{ value: EmailFlavor; label: string; subject: string; body: string }> = [
  { value: 'application_received', label: 'Application received', subject: 'Thanks for applying to {{club_name}}', body: 'Hi {{recipient_first_name}},\n\nThanks for your membership application. The committee reviews new applications weekly — you\'ll hear from us within seven days.\n\nApplied for: {{application_tier}}\n\nIf you don\'t hear back, email membership@{{club_name}} and we\'ll chase it up.\n\nSee you on the greens,\n{{club_name}}' },
  { value: 'application_approved', label: 'Application approved', subject: 'Welcome to {{club_name}}', body: 'Hi {{recipient_first_name}},\n\nGreat news — your application to join {{club_name}} has been approved.\n\nHere\'s your member sign-in: {{sign_in_url}}\n\nSee you on the greens,\n{{club_name}}' },
  { value: 'application_rejected', label: 'Application declined', subject: 'Update on your application to {{club_name}}', body: 'Hi {{recipient_first_name}},\n\nThanks for your interest in joining {{club_name}}. Unfortunately we\'re not able to progress your application at this time.\n\nRegards,\n{{club_name}}' },
  { value: 'enquiry_received', label: 'Enquiry received', subject: 'Thanks for reaching out', body: 'Hi {{recipient_first_name}},\n\nThanks for your enquiry to {{club_name}}. We\'ll be in touch within a day or two.\n\nIf it\'s urgent, ring the clubhouse on {{club_phone}}.\n\n{{club_name}}' },
  { value: 'enquiry_reply', label: 'Enquiry reply', subject: 'Re: your enquiry to {{club_name}}', body: '{{reply_body}}' },
  { value: 'member_welcome', label: 'Member welcome', subject: 'Welcome to {{club_name}}, {{recipient_first_name}}', body: 'Hi {{recipient_first_name}},\n\nWelcome to {{club_name}}. You\'re officially a member — sign in any time at {{sign_in_url}}.\n\nSee you on the greens,\n{{club_name}}' },
  { value: 'broadcast', label: 'Broadcast / announcement', subject: 'A quick note from {{club_name}}', body: 'Hi {{recipient_first_name}},\n\n[Your broadcast body goes here — use {{tokens}} to personalise per member.]\n\n— {{club_name}}' },
]

const emailTemplate = ref<EmailTemplate | null>(null)
const emailLoading = ref(false)
const emailSaving = ref(false)
const emailTestSending = ref(false)
const emailDraft = reactive<EmailTemplatePatch>({})
const emailPreviewFlavor = ref<EmailFlavor>('application_received')
const emailPreviewDevice = ref<'desktop' | 'mobile'>('desktop')
const serverPreview = ref<EmailPreviewResult | null>(null)
const serverPreviewLoading = ref(false)
const serverPreviewError = ref<string | null>(null)
let serverPreviewAbort: AbortController | null = null

async function loadEmailTemplate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  emailLoading.value = true
  try {
    emailTemplate.value = await emailTemplateApi.get(cid)
  } catch (err) {
    // Endpoint may 404 until brief 45 ships — set a client-side stub so the
    // preview + editor still works.
    if (err instanceof ApiError && err.status === 404) {
      emailTemplate.value = stubEmailTemplate()
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load email template.')
    }
  } finally {
    emailLoading.value = false
  }
}
onMounted(loadEmailTemplate)
watch(() => clubStore.current?.id, loadEmailTemplate)

/** Fetch the server-rendered preview HTML. Reflects the *saved* template
 *  — unsaved draft edits show up in the small live previews above but
 *  won't show in the iframe until the owner hits Save. */
async function loadServerPreview() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !emailTemplate.value) return
  serverPreviewAbort?.abort()
  serverPreviewAbort = new AbortController()
  serverPreviewLoading.value = true
  serverPreviewError.value = null
  try {
    serverPreview.value = await emailTemplateApi.preview(
      cid,
      emailPreviewFlavor.value,
      { signal: serverPreviewAbort.signal },
    )
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return
    // Endpoint may 404 during the pre-shipping window — fall back to the
    // client-side render already computed below.
    if (err instanceof ApiError && err.status === 404) {
      serverPreview.value = null
    } else {
      serverPreviewError.value = err instanceof ApiError ? err.message : 'Could not load preview.'
    }
  } finally {
    serverPreviewLoading.value = false
  }
}

// Re-fetch on flavour change and whenever the saved template rev changes
// (i.e. after a successful save or reload).
watch([emailPreviewFlavor, () => emailTemplate.value?.updated_at], () => {
  void loadServerPreview()
})

/** Polished platform-default header. Same skeleton for every club — logo,
 *  club name, address eyebrow, brand-accent rule underneath. Tokens for
 *  brand colour + font pull from the club's own Settings so every email
 *  feels like a first-class communication from that specific club. */
const PLATFORM_DEFAULT_HEADER = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #FFFFFF;">
  <tr>
    <td valign="middle" style="padding: 32px 0 32px 40px; width: 1px; white-space: nowrap;">
      <img src="{{club_logo_url}}" alt="{{club_name}} logo" style="display: block; height: 44px; width: auto; border: 0;" />
    </td>
    <td align="left" valign="middle" style="padding: 32px 40px 32px 16px;">
      <div style="font-family: '{{font_display}}', 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: #0A0A0B; line-height: 1.2;">{{club_name}}</div>
    </td>
  </tr>
</table>
<div style="height: 4px; background: {{accent_colour}}; line-height: 4px; font-size: 4px;">&nbsp;</div>`

/** Polished platform-default footer. Contact block on surface tint,
 *  hairline separator, then legal row with unsubscribe + Torny mark. */
const PLATFORM_DEFAULT_FOOTER = `<div style="padding: 32px 40px 24px; background: #F5F5F2; border-top: 1px solid #E7E7E1;">
  <div style="font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: #6B6B72; margin-bottom: 12px;">GET IN TOUCH</div>
  <div style="font-family: '{{font_display}}', 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: #0A0A0B; margin-bottom: 8px;">{{club_name}}</div>
  <div style="font-family: '{{font_body}}', 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.55; color: #6B6B72;">
    {{club_address}}<br>
    <a href="mailto:{{club_email}}" style="color: {{accent_colour}}; text-decoration: none;">{{club_email}}</a> · {{club_phone}}
  </div>
</div>
<div style="padding: 20px 40px 32px; background: #F5F5F2; border-top: 1px solid #E7E7E1;">
  <div style="font-family: '{{font_body}}', 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #A3A39B; line-height: 1.55;">
    <a href="{{unsubscribe_url}}" style="color: #A3A39B; text-decoration: underline;">Unsubscribe</a> · © {{year}} {{club_name}}<br>
    <span style="font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.08em;">SENT WITH TORNY</span>
  </div>
</div>`

function stubEmailTemplate(): EmailTemplate {
  return {
    header_html: resolveBrandTokens(PLATFORM_DEFAULT_HEADER),
    footer_html: resolveBrandTokens(PLATFORM_DEFAULT_FOOTER),
    accent_colour: null,
    font_family: null,
    show_logo: true,
    sample_overrides: {},
    variables: STUB_VARIABLES,
    updated_at: null,
  }
}

/** Resolve FE-only brand tokens ({{font_display}}, {{font_body}},
 *  {{accent_colour}}) into concrete values from the club's Settings.
 *  These tokens are NOT on the backend whitelist — inlining them here
 *  keeps the template brand-driven without triggering `unknown_variable`
 *  on PATCH. The backend still substitutes the 16 real tokens at send
 *  time ({{club_name}}, {{club_logo_url}}, {{unsubscribe_url}}, etc). */
function resolveBrandTokens(html: string): string {
  const brand = settingsStore.data?.brand
  const fontDisplay = brand?.font_pair_resolved?.heading?.family ?? 'Space Grotesk'
  const fontBody = brand?.font_pair_resolved?.body?.family ?? 'Inter'
  const accent = brand?.accent_colour ?? '#2563EB'
  return html
    .split('{{font_display}}').join(fontDisplay)
    .split('{{font_body}}').join(fontBody)
    .split('{{accent_colour}}').join(accent)
}

/** Overwrite the current draft with the Torny polished default, brand
 *  tokens already resolved so it saves cleanly. */
function resetEmailTemplateToDefault() {
  stageHeader(resolveBrandTokens(PLATFORM_DEFAULT_HEADER))
  stageFooter(resolveBrandTokens(PLATFORM_DEFAULT_FOOTER))
  toast.info('Reset to Torny default — hit Save changes to apply.')
}

const STUB_VARIABLES: EmailVariable[] = [
  { key: 'club_name',              token: '{{club_name}}',              label: 'Club name',                     category: 'club',      sample: 'Naenae Bowling Club' },
  { key: 'club_email',             token: '{{club_email}}',             label: 'Club email',                    category: 'club',      sample: 'hello@naenaebowls.nz' },
  { key: 'club_phone',             token: '{{club_phone}}',             label: 'Club phone',                    category: 'club',      sample: '04 567 5823' },
  { key: 'club_address',           token: '{{club_address}}',           label: 'Club address',                  category: 'club',      sample: '25 Vogel Street, Naenae, Lower Hutt' },
  { key: 'club_logo_url',          token: '{{club_logo_url}}',          label: 'Club logo URL',                 category: 'club',      sample: '' },
  { key: 'club_url',               token: '{{club_url}}',               label: 'Public site URL',               category: 'club',      sample: 'https://naenaebowls.torny.co' },
  { key: 'recipient_name',         token: '{{recipient_name}}',         label: "Recipient's full name",         category: 'recipient', sample: 'Frances Roydon-Miller' },
  { key: 'recipient_first_name',   token: '{{recipient_first_name}}',   label: "Recipient's first name",        category: 'recipient', sample: 'Frances' },
  { key: 'recipient_email',        token: '{{recipient_email}}',        label: "Recipient's email",             category: 'recipient', sample: 'frances@example.co.nz' },
  { key: 'application_tier',       token: '{{application_tier}}',       label: 'Applied membership tier',       category: 'context',   sample: 'Playing member', flavors: ['application_received', 'application_approved', 'application_rejected'] },
  { key: 'event_name',             token: '{{event_name}}',             label: 'Event name',                    category: 'context',   sample: 'Twilight Triples · Round 3', flavors: ['broadcast'] },
  { key: 'event_date',             token: '{{event_date}}',             label: 'Event date',                    category: 'context',   sample: 'Friday 10 October 5:30pm', flavors: ['broadcast'] },
  { key: 'reply_body',             token: '{{reply_body}}',             label: 'Admin reply body',              category: 'context',   sample: 'Great to hear from you — come along Friday.', flavors: ['enquiry_reply'] },
  { key: 'sign_in_url',            token: '{{sign_in_url}}',            label: 'Sign-in URL',                   category: 'auto',      sample: 'https://naenaebowls.torny.co/sign-in' },
  { key: 'unsubscribe_url',        token: '{{unsubscribe_url}}',        label: 'Unsubscribe URL',               category: 'auto',      sample: 'https://naenaebowls.torny.co/unsubscribe/…' },
  { key: 'year',                   token: '{{year}}',                   label: 'Current year',                  category: 'auto',      sample: String(new Date().getFullYear()) },
]

// ── Draft helpers ────
function draftedHeader(): string {
  return emailDraft.header_html ?? emailTemplate.value?.header_html ?? ''
}
function draftedFooter(): string {
  return emailDraft.footer_html ?? emailTemplate.value?.footer_html ?? ''
}
function draftedShowLogo(): boolean {
  return emailDraft.show_logo ?? emailTemplate.value?.show_logo ?? true
}
const draftedHeaderVal = computed(draftedHeader)
const draftedFooterVal = computed(draftedFooter)
const draftedShowLogoVal = computed(draftedShowLogo)

function stageHeader(v: string) {
  const stored = emailTemplate.value?.header_html ?? ''
  if (v === stored) delete emailDraft.header_html
  else emailDraft.header_html = v
}
function stageFooter(v: string) {
  const stored = emailTemplate.value?.footer_html ?? ''
  if (v === stored) delete emailDraft.footer_html
  else emailDraft.footer_html = v
}
function stageShowLogo() {
  const stored = emailTemplate.value?.show_logo ?? true
  const next = !draftedShowLogo()
  if (next === stored) delete emailDraft.show_logo
  else emailDraft.show_logo = next
}
const isEmailDirty = computed(() =>
  emailDraft.header_html !== undefined || emailDraft.footer_html !== undefined || emailDraft.show_logo !== undefined,
)
function clearEmailDraft() {
  delete emailDraft.header_html
  delete emailDraft.footer_html
  delete emailDraft.show_logo
}
/** Sanitizer + variable errors come back with structured `ctx` / `missing`
 *  arrays. Build the most specific human message we can. */
interface EmailSaveErrorBody {
  code?: string
  ctx?: { tag?: string; attr?: string; value?: string }
  missing?: string[]
}
function saveErrorMessage(body: EmailSaveErrorBody, fallback: string): string {
  switch (body.code) {
    case 'bad_html': {
      const c = body.ctx ?? {}
      if (c.tag && c.attr) return `<${c.tag} ${c.attr}="…"> isn't allowed. Remove that attribute and try again.`
      if (c.tag) return `<${c.tag}> isn't allowed in email HTML. Remove it and try again.`
      if (c.attr) return `The "${c.attr}" attribute isn't allowed. Remove it and try again.`
      return 'The HTML has a disallowed tag or attribute — check the console for details.'
    }
    case 'unknown_variable': {
      const missing = body.missing ?? []
      if (missing.length === 1) return `${missing[0]} isn't a recognised variable — check the palette.`
      if (missing.length > 1) return `These variables aren't recognised: ${missing.join(', ')}. Check the palette.`
      return 'One of the {{variables}} isn\'t recognised — check the palette.'
    }
    case 'header_too_long': return 'Header HTML is too long (max 20,000 chars). Trim it back.'
    case 'footer_too_long': return 'Footer HTML is too long (max 20,000 chars). Trim it back.'
    case 'sample_overrides_too_long': return 'Sample overrides are too long. Shorten a value and try again.'
    case 'bad_sample_overrides': return 'Sample overrides must be an object of string values.'
    case 'bad_accent': return 'That accent colour isn\'t valid CSS — use a hex or rgba() value.'
    default: return fallback
  }
}

async function saveEmailTemplate() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !isEmailDirty.value) return
  emailSaving.value = true
  try {
    // Resolve FE-only brand tokens before PATCH — the backend whitelist
    // doesn't include font_display / font_body / accent_colour.
    const patch: EmailTemplatePatch = { ...emailDraft }
    if (patch.header_html != null) patch.header_html = resolveBrandTokens(patch.header_html)
    if (patch.footer_html != null) patch.footer_html = resolveBrandTokens(patch.footer_html)
    emailTemplate.value = await emailTemplateApi.update(cid, patch)
    clearEmailDraft()
    toast.success('Email template saved.')
  } catch (err) {
    const body = err instanceof ApiError ? ((err.body ?? {}) as EmailSaveErrorBody) : {}
    const fallback = err instanceof ApiError ? err.message : 'Could not save email template.'
    toast.error(saveErrorMessage(body, fallback))
  } finally {
    emailSaving.value = false
  }
}
async function sendTestEmail() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  emailTestSending.value = true
  try {
    const res = await emailTemplateApi.testSend(cid, { flavor: emailPreviewFlavor.value })
    const idSuffix = res.provider_message_id ? ` · ${res.provider_message_id.slice(0, 16)}…` : ''
    toast.success(`Test email sent to ${res.to}${idSuffix}`)
  } catch (err) {
    const body = err instanceof ApiError
      ? ((err.body ?? {}) as { code?: string; data?: { provider_error?: string } })
      : {}
    if (body.code === 'rate_limited') toast.error('3 test sends per hour — try again in a bit.')
    else if (body.code === 'bad_flavor') toast.error('That preview flavour isn\'t recognised.')
    else if (body.code === 'bad_email') toast.error('Recipient email isn\'t valid.')
    else if (body.code === 'send_failed') {
      const providerErr = body.data?.provider_error
      toast.error(providerErr ? `SES rejected the send: ${providerErr}` : 'Send failed — check SES setup.')
    }
    else toast.error(err instanceof ApiError ? err.message : 'Could not send test.')
  } finally {
    emailTestSending.value = false
  }
}

// ── Per-flavour body overrides — brief 46 ─────────────────────
// Owner customises subject + body per transactional flavour. Shared
// header + footer from brief 45 still wraps every send.

const emailFlavors = ref<EmailFlavorRow[]>([])
const emailFlavorsLoading = ref(false)
const selectedFlavor = ref<EmailFlavor>('application_received')
const activeEmailTab = ref<'frame' | 'body'>('frame')
const flavorDrafts = reactive<Partial<Record<EmailFlavor, EmailFlavorPatch>>>({})
const flavorSaving = ref(false)
const flavorLastFocused = ref<'subject' | 'body'>('body')

async function loadEmailFlavors() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  emailFlavorsLoading.value = true
  try {
    const res = await emailTemplateApi.listFlavors(cid)
    emailFlavors.value = res.flavors
  } catch (err) {
    // Silently 404 until backend ships — the header/footer editor above
    // still works without this data.
    if (!(err instanceof ApiError && err.status === 404)) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load email bodies.')
    }
    emailFlavors.value = []
  } finally {
    emailFlavorsLoading.value = false
  }
}
onMounted(loadEmailFlavors)
watch(() => clubStore.current?.id, loadEmailFlavors)
// Also refetch when the outer template save fires (updated_at rev change)
// so any flavour edits done elsewhere stay in sync.

const currentFlavorRow = computed<EmailFlavorRow | null>(() =>
  emailFlavors.value.find(f => f.flavor === selectedFlavor.value) ?? null,
)

/** Effective override for a field on a given flavour, blending draft →
 *  stored override → null (using default). Empty string in the draft
 *  means the field is being cleared by the user. */
function draftedFlavorSubject(): string {
  const draft = flavorDrafts[selectedFlavor.value]
  if (draft && 'subject_override' in draft) return draft.subject_override ?? ''
  return currentFlavorRow.value?.subject_override ?? ''
}
function draftedFlavorBody(): string {
  const draft = flavorDrafts[selectedFlavor.value]
  if (draft && 'body_html_override' in draft) return draft.body_html_override ?? ''
  return currentFlavorRow.value?.body_html_override ?? ''
}
const draftedFlavorSubjectVal = computed(draftedFlavorSubject)
const draftedFlavorBodyVal = computed(draftedFlavorBody)

function stageFlavorSubject(v: string) {
  const stored = currentFlavorRow.value?.subject_override ?? ''
  const draft = flavorDrafts[selectedFlavor.value] ?? {}
  if (v === stored) {
    delete draft.subject_override
    if (Object.keys(draft).length === 0) delete flavorDrafts[selectedFlavor.value]
    else flavorDrafts[selectedFlavor.value] = draft
  } else {
    flavorDrafts[selectedFlavor.value] = { ...draft, subject_override: v }
  }
}
function stageFlavorBody(v: string) {
  const stored = currentFlavorRow.value?.body_html_override ?? ''
  const draft = flavorDrafts[selectedFlavor.value] ?? {}
  if (v === stored) {
    delete draft.body_html_override
    if (Object.keys(draft).length === 0) delete flavorDrafts[selectedFlavor.value]
    else flavorDrafts[selectedFlavor.value] = draft
  } else {
    flavorDrafts[selectedFlavor.value] = { ...draft, body_html_override: v }
  }
}

function flavorHasOverride(row: EmailFlavorRow): boolean {
  return row.subject_override !== null || row.body_html_override !== null
}
function flavorHasDraft(flavor: EmailFlavor): boolean {
  return flavorDrafts[flavor] !== undefined
}
const isCurrentFlavorDirty = computed(() => flavorHasDraft(selectedFlavor.value))
const currentFlavorHasStoredOverride = computed(() =>
  currentFlavorRow.value ? flavorHasOverride(currentFlavorRow.value) : false,
)

function discardCurrentFlavor() {
  delete flavorDrafts[selectedFlavor.value]
}

/** Body ref for cursor-aware token insertion into whichever field
 *  was last focused. */
const flavorSubjectRef = ref<HTMLInputElement | null>(null)
const flavorBodyRef = ref<HTMLTextAreaElement | null>(null)

function insertFlavorToken(token: string) {
  const useSubject = flavorLastFocused.value === 'subject'
  const target = useSubject ? flavorSubjectRef.value : flavorBodyRef.value
  const current = useSubject ? draftedFlavorSubject() : draftedFlavorBody()
  if (!target) {
    const next = current + token
    if (useSubject) stageFlavorSubject(next)
    else stageFlavorBody(next)
    return
  }
  const start = target.selectionStart ?? current.length
  const end = target.selectionEnd ?? current.length
  const next = current.slice(0, start) + token + current.slice(end)
  if (useSubject) stageFlavorSubject(next)
  else stageFlavorBody(next)
  requestAnimationFrame(() => {
    target.focus()
    const caret = start + token.length
    if ('setSelectionRange' in target) target.setSelectionRange(caret, caret)
  })
}

async function saveCurrentFlavor() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  const flavor = selectedFlavor.value
  const draft = flavorDrafts[flavor]
  if (!draft) return

  // Empty string in a draft field = "clear the override" — send null.
  const patch: EmailFlavorPatch = {}
  if ('subject_override' in draft) {
    patch.subject_override = draft.subject_override && draft.subject_override.length > 0
      ? draft.subject_override
      : null
  }
  if ('body_html_override' in draft) {
    patch.body_html_override = draft.body_html_override && draft.body_html_override.length > 0
      ? draft.body_html_override
      : null
  }

  flavorSaving.value = true
  try {
    const updated = await emailTemplateApi.updateFlavor(cid, flavor, patch)
    const idx = emailFlavors.value.findIndex(f => f.flavor === flavor)
    if (idx >= 0) emailFlavors.value[idx] = updated
    delete flavorDrafts[flavor]
    toast.success(`${updated.label} saved.`)
    // Refetch preview so iframe reflects the new override.
    void loadServerPreview()
  } catch (err) {
    const body = err instanceof ApiError
      ? ((err.body ?? {}) as { code?: string; ctx?: { tag?: string; attr?: string }; missing?: string[] })
      : {}
    switch (body.code) {
      case 'bad_html': {
        const c = body.ctx ?? {}
        if (c.tag && c.attr) toast.error(`<${c.tag} ${c.attr}="…"> isn't allowed in email HTML.`)
        else if (c.tag) toast.error(`<${c.tag}> isn't allowed in email HTML.`)
        else if (c.attr) toast.error(`The "${c.attr}" attribute isn't allowed.`)
        else toast.error('The body HTML has a disallowed tag or attribute.')
        break
      }
      case 'unknown_variable': {
        const missing = body.missing ?? []
        if (missing.length === 1) toast.error(`${missing[0]} isn't valid for this flavour.`)
        else if (missing.length > 1) toast.error(`Not valid for this flavour: ${missing.join(', ')}`)
        else toast.error('One of the {{tokens}} isn\'t valid for this flavour.')
        break
      }
      case 'subject_too_long': toast.error('Subject is too long (max 200 chars).'); break
      case 'body_too_long':    toast.error('Body is too long (max 20,000 chars).'); break
      case 'empty_subject':    toast.error('Subject can\'t be empty.'); break
      case 'empty_body':       toast.error('Body can\'t be empty.'); break
      case 'empty_patch':      toast.error('Nothing to save.'); break
      default: toast.error(err instanceof ApiError ? err.message : 'Could not save.')
    }
  } finally {
    flavorSaving.value = false
  }
}

async function resetCurrentFlavor() {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  const flavor = selectedFlavor.value
  flavorSaving.value = true
  try {
    await emailTemplateApi.resetFlavor(cid, flavor)
    const idx = emailFlavors.value.findIndex(f => f.flavor === flavor)
    if (idx >= 0) {
      emailFlavors.value[idx] = {
        ...emailFlavors.value[idx]!,
        subject_override: null,
        body_html_override: null,
        updated_at: null,
        updated_by: null,
      }
    }
    delete flavorDrafts[flavor]
    toast.success('Reset to platform default.')
    void loadServerPreview()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not reset.')
  } finally {
    flavorSaving.value = false
  }
}

// Sync selectedFlavor with the preview picker so switching one moves the
// other. The preview iframe already reflects overrides server-side.
watch(selectedFlavor, (f) => { emailPreviewFlavor.value = f })
watch(emailPreviewFlavor, (f) => { selectedFlavor.value = f })

/** Build a `{{token}}` string for a token key. Kept as a helper because
 *  a template literal like `` `{{${k}}}` `` inside a Vue mustache
 *  ({{ … }}) confuses the compiler — it sees `{{` as an interpolation
 *  open. Concatenation sidesteps that. */
function tokenFor(k: string): string {
  return '{' + '{' + k + '}' + '}'
}

// ── Variable substitution — client-side preview render ─────────
function sampleValueFor(v: EmailVariable): string {
  const override = emailTemplate.value?.sample_overrides[v.key]
  return override ?? v.sample
}
function substituteTokens(html: string): string {
  const vars = emailTemplate.value?.variables ?? STUB_VARIABLES
  return vars.reduce((acc, v) => acc.split(v.token).join(sampleValueFor(v)), html)
}
function copyToken(token: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard.writeText(token).catch(() => { /* silent */ })
  toast.success(`Copied ${token}`)
}
function insertToken(target: 'header' | 'footer', token: string) {
  if (target === 'header') stageHeader(draftedHeader() + token)
  else stageFooter(draftedFooter() + token)
}
const availableVariables = computed(() => {
  const list = emailTemplate.value?.variables ?? STUB_VARIABLES
  return list.filter((v) => !v.flavors || v.flavors.includes(emailPreviewFlavor.value))
})
const variablesByCategory = computed(() => {
  const groups: Record<string, EmailVariable[]> = { club: [], recipient: [], context: [], auto: [] }
  for (const v of availableVariables.value) {
    if (groups[v.category]) groups[v.category]!.push(v)
  }
  return groups
})

// ── Preview render ─────
const currentFlavor = computed(() => EMAIL_FLAVORS.find((f) => f.value === emailPreviewFlavor.value)!)
const renderedSubject = computed(() => substituteTokens(currentFlavor.value.subject))
const renderedHeader = computed(() => substituteTokens(draftedHeaderVal.value))
const renderedFooter = computed(() => substituteTokens(draftedFooterVal.value))
const renderedBody = computed(() => {
  // Escape HTML for the body then convert double-newlines to paragraphs
  // — mirrors the platform default (owner doesn't write per-email HTML).
  const escaped = substituteTokens(currentFlavor.value.body)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 16px; font-family: Inter, sans-serif; font-size: 15px; line-height: 155%; color: #0A0A0B;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
})
const previewShellStyle = computed(() => ({
  maxWidth: emailPreviewDevice.value === 'mobile' ? '390px' : '640px',
}))

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
              <div class="tier__head-actions">
                <span v-if="isMembershipDirty && !membershipSaving" class="tier__saving tier__saving--pending">Unsaved changes</span>
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
            <p class="card__sub">Tiers your members pay to join. Prices show on the public /membership page and drive the application flow.</p>

            <div class="applications-controls">
              <div class="applications-controls__row">
                <div>
                  <div class="applications-controls__title">Accept new applications</div>
                  <div class="applications-controls__hint">Off = the public join form returns "applications closed". Existing tiers still show.</div>
                </div>
                <button type="button" class="switch" :class="{ 'is-on': draftedApplicationsOpen }" @click="stageApplicationsOpen"><span class="switch__knob" /></button>
              </div>
              <div class="applications-controls__row applications-controls__row--input">
                <label class="applications-controls__label">
                  <span>Notify email</span>
                  <input
                    v-model="draftedNotificationEmail"
                    type="email"
                    placeholder="inbox@yourclub.co.nz"
                  />
                </label>
                <div class="applications-controls__hint applications-controls__hint--right">Address that gets the "new application" alert. Leave empty to send to the owner.</div>
              </div>
            </div>

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

        <!-- Notifications -->
        <template v-else-if="active === 'notifications'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Notifications</div>
                <h2 class="card__title">What pings you</h2>
              </div>
              <div class="tier__head-actions">
                <span v-if="isNotificationsDirty && !notificationSaving" class="tier__saving tier__saving--pending">Unsaved changes</span>
                <button
                  type="button"
                  class="ghost-btn"
                  :disabled="!isNotificationsDirty || notificationSaving"
                  @click="clearNotificationDraft"
                >Discard</button>
                <button
                  type="button"
                  class="primary-btn"
                  :disabled="!isNotificationsDirty || notificationSaving"
                  @click="saveNotificationSettings"
                >{{ notificationSaving ? 'Saving…' : 'Save changes' }}</button>
              </div>
            </div>
            <p class="card__sub">Preferences are per-user — they follow you across clubs. In-app pings show in the bell dropdown; email pings send a transactional email as soon as the event fires.</p>

            <div v-if="notificationsStore.settingsLoading && !notificationsStore.settings" class="tier__loading">
              Loading preferences…
            </div>
            <table v-else class="notif-matrix">
              <thead>
                <tr>
                  <th class="notif-matrix__kind">Kind</th>
                  <th class="notif-matrix__col">In-app</th>
                  <th class="notif-matrix__col">Email</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in NOTIFICATION_KINDS" :key="k.key">
                  <td>
                    <div class="notif-matrix__label">{{ k.label }}</div>
                    <div class="notif-matrix__hint">{{ k.hint }}</div>
                  </td>
                  <td class="notif-matrix__toggle-cell">
                    <button type="button" class="switch" :class="{ 'is-on': draftedPref(k.key, 'in_app') }" @click="stagePref(k.key, 'in_app')">
                      <span class="switch__knob" />
                    </button>
                  </td>
                  <td class="notif-matrix__toggle-cell">
                    <button type="button" class="switch" :class="{ 'is-on': draftedPref(k.key, 'email') }" @click="stagePref(k.key, 'email')">
                      <span class="switch__knob" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="notif-digest">
              <div class="field__label">Email digest</div>
              <div class="segmented">
                <button type="button" :class="{ 'is-on': draftedDigest === 'off' }" @click="stageDigest('off')">Off</button>
                <button type="button" :class="{ 'is-on': draftedDigest === 'daily' }" @click="stageDigest('daily')">Daily</button>
                <button type="button" :class="{ 'is-on': draftedDigest === 'weekly' }" @click="stageDigest('weekly')">Weekly</button>
              </div>
              <p class="card__sub" style="margin-top: 8px;">Bundles anything you opted into email for above into one send. Immediate emails still fire regardless when Off is picked.</p>
            </div>
          </div>
        </template>

        <!-- Enquiries -->
        <template v-else-if="active === 'enquiries'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Contact form</div>
                <h2 class="card__title">Enquiry intake</h2>
              </div>
              <div class="tier__head-actions">
                <span v-if="isEnquiryDirty && !enquirySettingsSaving" class="tier__saving tier__saving--pending">Unsaved changes</span>
                <button
                  type="button"
                  class="ghost-btn"
                  :disabled="!isEnquiryDirty || enquirySettingsSaving"
                  @click="clearEnquiryDraft"
                >Discard</button>
                <button
                  type="button"
                  class="primary-btn"
                  :disabled="!isEnquiryDirty || enquirySettingsSaving"
                  @click="saveEnquirySettings"
                >{{ enquirySettingsSaving ? 'Saving…' : 'Save changes' }}</button>
              </div>
            </div>
            <p class="card__sub">Controls the public /contact form on your site and where new enquiries land.</p>

            <div v-if="enquirySettingsLoading && !enquirySettings" class="tier__loading">
              Loading enquiry settings…
            </div>
            <template v-else>
              <label class="switch-row">
                <div>
                  <div class="switch-row__label">Accept new enquiries</div>
                  <div class="switch-row__hint">Off = the public contact form shows a "not accepting enquiries" message.</div>
                </div>
                <button
                  type="button"
                  class="switch"
                  :class="{ 'is-on': draftedEnquiriesOpenVal }"
                  @click="stageEnquiriesOpen"
                ><span class="switch__knob" /></button>
              </label>

              <label class="field">
                <span class="field__label">Notify email</span>
                <input v-model="draftedNotifyEmail" type="email" placeholder="inbox@yourclub.co.nz" />
                <span class="field__hint">Alert lands here on every new enquiry. Empty = uses your club's contact email.</span>
              </label>

              <label class="field">
                <span class="field__label">Auto-reply body</span>
                <textarea v-model="draftedAutoReply" rows="5" placeholder="Thanks for your message! We'll be in touch within a day or two." />
                <span class="field__hint">Sent to the enquirer straight after they submit. Empty = uses the platform default.</span>
              </label>

              <div class="field__group">
                <div class="field__group-title">Topics accepted</div>
                <p class="field__hint" style="margin: 4px 0 8px;">Uncheck any topic your club doesn't want to receive enquiries about. All checked = accept everything.</p>
                <div class="chip-picker">
                  <template v-for="t in ENQUIRY_TOPICS" :key="t.key">
                    <label class="chip-picker__item">
                      <input
                        type="checkbox"
                        :checked="isTopicEnabled(t.key)"
                        @change="toggleTopic(t.key)"
                      />
                      <span>{{ t.label }}</span>
                    </label>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </template>

        <!-- Email template -->
        <template v-else-if="active === 'email'">
          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Transactional email</div>
                <h2 class="card__title">Design your emails</h2>
              </div>
            </div>
            <p class="card__sub">Shared header + footer wraps every outgoing club email; the middle body changes per flavour. Your logo, fonts and accent colour come from <router-link to="/settings">Club &amp; brand</router-link>. Use <code v-pre>{{variables}}</code> to inject values at send time.</p>

            <div class="segmented email-tabs">
              <button
                type="button"
                :class="{ 'is-on': activeEmailTab === 'frame' }"
                @click="activeEmailTab = 'frame'"
              >Header &amp; footer</button>
              <button
                v-if="emailFlavors.length > 0"
                type="button"
                :class="{ 'is-on': activeEmailTab === 'body' }"
                @click="activeEmailTab = 'body'"
              >Subject &amp; body</button>
            </div>

            <section v-if="activeEmailTab === 'frame'" class="email-section">
              <header class="email-section__head">
                <div>
                  <div class="email-section__eyebrow">Shared frame</div>
                  <div class="email-section__title">Header &amp; footer</div>
                </div>
                <div class="tier__head-actions">
                  <span v-if="isEmailDirty && !emailSaving" class="tier__saving tier__saving--pending">Unsaved changes</span>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="emailSaving"
                    @click="resetEmailTemplateToDefault"
                    title="Overwrite with Torny's polished default, using your club's brand"
                  >Reset to default</button>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="!isEmailDirty || emailSaving"
                    @click="clearEmailDraft"
                  >Discard</button>
                  <button
                    type="button"
                    class="primary-btn"
                    :disabled="!isEmailDirty || emailSaving"
                    @click="saveEmailTemplate"
                  >{{ emailSaving ? 'Saving…' : 'Save changes' }}</button>
                </div>
              </header>

              <div class="email-editor">
              <div class="email-editor__pane">
                <label class="field">
                  <span class="field__label">Header HTML</span>
                  <textarea
                    :value="draftedHeaderVal"
                    @input="stageHeader(($event.target as HTMLTextAreaElement).value)"
                    rows="10"
                    class="email-editor__textarea"
                    spellcheck="false"
                  ></textarea>
                  <span class="field__hint">Rendered above the body. Inline styles only — external CSS is dropped by most mail clients.</span>
                </label>
                <label class="field">
                  <span class="field__label">Footer HTML</span>
                  <textarea
                    :value="draftedFooterVal"
                    @input="stageFooter(($event.target as HTMLTextAreaElement).value)"
                    rows="10"
                    class="email-editor__textarea"
                    spellcheck="false"
                  ></textarea>
                  <span class="field__hint">Must include the <code v-pre>{{unsubscribe_url}}</code> link for CAN-SPAM compliance.</span>
                </label>
                <label class="logo-toggle" :class="{ 'is-off': !draftedShowLogoVal }">
                  <div class="logo-toggle__crest">
                    <img
                      v-if="clubStore.current?.logoUrl"
                      :src="clubStore.current.logoUrl"
                      :alt="`${clubStore.current?.name ?? 'Club'} logo`"
                    />
                    <div v-else class="logo-toggle__placeholder">
                      <span class="logo-toggle__placeholder-eyebrow">No logo</span>
                      <router-link to="/settings" class="logo-toggle__placeholder-link">Add one →</router-link>
                    </div>
                  </div>
                  <div class="logo-toggle__body">
                    <div class="logo-toggle__label">
                      <span class="logo-toggle__title">Show club logo above the header</span>
                      <span class="logo-toggle__badge" :class="draftedShowLogoVal ? 'is-on' : 'is-off'">
                        {{ draftedShowLogoVal ? 'On' : 'Off' }}
                      </span>
                    </div>
                    <div class="logo-toggle__hint">
                      Pulled from <router-link to="/settings">Club &amp; brand</router-link>. Turn off if your header HTML already ships its own image.
                    </div>
                  </div>
                  <button
                    type="button"
                    class="switch"
                    :class="{ 'is-on': draftedShowLogoVal }"
                    :aria-pressed="draftedShowLogoVal"
                    @click="stageShowLogo"
                  >
                    <span class="switch__knob" />
                  </button>
                </label>
              </div>

              <aside class="email-vars">
                <div class="email-vars__head">
                  <h3 class="email-vars__title">Variables</h3>
                  <p class="email-vars__hint">Click to copy or hit "Insert" to append to the focused editor.</p>
                </div>
                <template v-for="(list, cat) in variablesByCategory" :key="cat">
                  <div v-if="list.length > 0" class="email-vars__group">
                    <div class="email-vars__category">{{ cat }}</div>
                    <ul class="email-vars__list">
                      <li v-for="v in list" :key="v.key" class="email-vars__item">
                        <button type="button" class="email-vars__token" @click="copyToken(v.token)" :title="`${v.label} — sample: ${v.sample}`">
                          {{ v.token }}
                        </button>
                        <span class="email-vars__label">{{ v.label }}</span>
                        <div class="email-vars__insert">
                          <button type="button" @click="insertToken('header', v.token)">→ Header</button>
                          <button type="button" @click="insertToken('footer', v.token)">→ Footer</button>
                        </div>
                      </li>
                    </ul>
                  </div>
                </template>
              </aside>
            </div>
            </section>

            <!-- Body copy — per-flavour subject + body overrides (brief 46) -->
            <section v-if="activeEmailTab === 'body' && emailFlavors.length > 0" class="email-section">
              <header class="email-section__head">
                <div>
                  <div class="email-section__eyebrow">Per email</div>
                  <div class="email-section__title">Subject &amp; body</div>
                </div>
                <div class="tier__head-actions">
                  <span v-if="isCurrentFlavorDirty && !flavorSaving" class="tier__saving tier__saving--pending">Unsaved changes</span>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="!currentFlavorHasStoredOverride || flavorSaving"
                    @click="resetCurrentFlavor"
                    title="Clear both overrides — revert to Torny's platform copy"
                  >Use default</button>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="!isCurrentFlavorDirty || flavorSaving"
                    @click="discardCurrentFlavor"
                  >Discard</button>
                  <button
                    type="button"
                    class="primary-btn"
                    :disabled="!isCurrentFlavorDirty || flavorSaving"
                    @click="saveCurrentFlavor"
                  >{{ flavorSaving ? 'Saving…' : 'Save changes' }}</button>
                </div>
              </header>

              <div class="flavor-editor">
              <!-- Left: flavour picker -->
              <aside class="flavor-picker">
                <ul class="flavor-picker__list">
                  <li v-for="f in emailFlavors" :key="f.flavor">
                    <button
                      type="button"
                      class="flavor-picker__row"
                      :class="{ 'is-on': selectedFlavor === f.flavor }"
                      @click="selectedFlavor = f.flavor"
                    >
                      <div class="flavor-picker__row-top">
                        <span class="flavor-picker__label">{{ f.label }}</span>
                        <span v-if="flavorHasDraft(f.flavor)" class="flavor-picker__chip flavor-picker__chip--dirty">Unsaved</span>
                        <span v-else-if="flavorHasOverride(f)" class="flavor-picker__chip flavor-picker__chip--on">Custom</span>
                        <span v-else class="flavor-picker__chip flavor-picker__chip--default">Default</span>
                      </div>
                      <div class="flavor-picker__hint">{{ f.hint }}</div>
                    </button>
                  </li>
                </ul>
              </aside>

              <!-- Right: subject + body editor -->
              <div v-if="currentFlavorRow" class="flavor-editor__pane">
                <label class="field">
                  <span class="field__label">Subject</span>
                  <input
                    ref="flavorSubjectRef"
                    type="text"
                    class="flavor-editor__subject"
                    :value="draftedFlavorSubjectVal"
                    :placeholder="currentFlavorRow.subject_default"
                    @input="stageFlavorSubject(($event.target as HTMLInputElement).value)"
                    @focus="flavorLastFocused = 'subject'"
                  />
                  <span class="field__hint">
                    <template v-if="draftedFlavorSubjectVal.length > 0">
                      Overriding Torny's default: <em>{{ currentFlavorRow.subject_default }}</em>
                    </template>
                    <template v-else>
                      Blank — Torny's default subject will be used.
                    </template>
                  </span>
                </label>

                <label class="field">
                  <span class="field__label">Body HTML</span>
                  <textarea
                    ref="flavorBodyRef"
                    class="flavor-editor__body"
                    :value="draftedFlavorBodyVal"
                    :placeholder="currentFlavorRow.body_html_default"
                    rows="14"
                    spellcheck="false"
                    @input="stageFlavorBody(($event.target as HTMLTextAreaElement).value)"
                    @focus="flavorLastFocused = 'body'"
                  ></textarea>
                  <span class="field__hint">
                    <template v-if="draftedFlavorBodyVal.length > 0">
                      Overriding Torny's default body.
                    </template>
                    <template v-else>
                      Blank — Torny's default body will be used. Placeholder shows what recipients get today.
                    </template>
                  </span>
                </label>

                <div class="flavor-tokens">
                  <div class="flavor-tokens__head">Supported tokens · click to insert at cursor</div>
                  <div class="flavor-tokens__list">
                    <button
                      v-for="k in currentFlavorRow.supported_tokens"
                      :key="k"
                      type="button"
                      class="flavor-tokens__pill"
                      @click="insertFlavorToken(tokenFor(k))"
                    >{{ tokenFor(k) }}</button>
                  </div>
                </div>
              </div>
            </div>
            </section>
          </div>

          <div class="card">
            <div class="card__head">
              <div>
                <div class="card__eyebrow">Preview</div>
                <h2 class="card__title">See it in a real email</h2>
              </div>
              <button
                type="button"
                class="primary-btn"
                :disabled="emailTestSending"
                @click="sendTestEmail"
              >{{ emailTestSending ? 'Sending…' : 'Send test to me' }}</button>
            </div>
            <p class="card__sub">Substitutes <code v-pre>{{variables}}</code> with sample data. The real send uses the actual recipient's details.</p>

            <div class="email-preview-controls">
              <label class="email-preview-flavor">
                <span class="email-preview-flavor__label">Preview</span>
                <select v-model="emailPreviewFlavor" class="email-preview-flavor__select">
                  <option v-for="f in EMAIL_FLAVORS" :key="f.value" :value="f.value">{{ f.label }}</option>
                </select>
              </label>
              <div class="segmented segmented--sm">
                <button type="button" :class="{ 'is-on': emailPreviewDevice === 'desktop' }" @click="emailPreviewDevice = 'desktop'">Desktop</button>
                <button type="button" :class="{ 'is-on': emailPreviewDevice === 'mobile' }" @click="emailPreviewDevice = 'mobile'">Mobile</button>
              </div>
            </div>

            <div class="email-preview-frame">
              <div class="email-preview-meta">
                <div class="email-preview-meta-row">
                  <span>Subject</span>
                  <span class="email-preview-subject">{{ serverPreview?.subject ?? renderedSubject }}</span>
                </div>
                <div class="email-preview-meta-row"><span>To</span><span>frances@example.co.nz</span></div>
              </div>

              <div v-if="isEmailDirty" class="email-preview-hint">
                <span class="email-preview-hint__dot"></span>
                You've got unsaved edits — this preview still shows the last saved template. Save to update it.
              </div>

              <div class="email-preview-shell" :style="previewShellStyle">
                <!-- Server-rendered HTML (isolated in an iframe so its CSS
                     doesn't leak into the CRM). Falls back to a client
                     render while the endpoint loads or if it 404s. -->
                <iframe
                  v-if="serverPreview"
                  class="email-preview-iframe"
                  :srcdoc="serverPreview.html"
                  sandbox=""
                  title="Email preview"
                ></iframe>
                <div v-else-if="serverPreviewLoading" class="email-preview-loading">Rendering preview…</div>
                <div v-else-if="serverPreviewError" class="email-preview-loading email-preview-loading--error">
                  {{ serverPreviewError }}
                </div>
                <template v-else>
                  <div class="email-preview-inner" v-html="renderedHeader" />
                  <div class="email-preview-body" v-html="renderedBody" />
                  <div class="email-preview-inner" v-html="renderedFooter" />
                </template>
              </div>
            </div>
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

/* Logo toggle — card-style row with a live crest of the club's saved logo. */
.logo-toggle { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 16px; margin-top: 12px; padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: opacity 150ms ease; }
.logo-toggle:hover { border-color: var(--color-graphite); }
.logo-toggle.is-off .logo-toggle__crest { opacity: 0.35; filter: grayscale(1); }
.logo-toggle__crest { width: 64px; height: 64px; border-radius: 12px; background: #fff; border: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 8px; box-sizing: border-box; transition: opacity 150ms ease, filter 150ms ease; }
.logo-toggle__crest img { max-width: 100%; max-height: 100%; display: block; }
.logo-toggle__placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; text-align: center; }
.logo-toggle__placeholder-eyebrow { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.logo-toggle__placeholder-link { font-family: var(--font-body); font-size: 10px; color: var(--color-accent); text-decoration: none; }
.logo-toggle__placeholder-link:hover { text-decoration: underline; }
.logo-toggle__body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.logo-toggle__label { display: flex; align-items: center; gap: 8px; }
.logo-toggle__title { font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-ink); }
.logo-toggle__badge { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
.logo-toggle__badge.is-on { background: #DCFCE7; color: #166534; }
.logo-toggle__badge.is-off { background: var(--color-hairline); color: var(--color-graphite); }
.logo-toggle__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; }
.logo-toggle__hint a { color: var(--color-accent); text-decoration: none; }
.logo-toggle__hint a:hover { text-decoration: underline; }

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
.applications-controls { display: flex; flex-direction: column; gap: 12px; padding: 16px; margin: 16px 0; background: var(--color-surface); border-radius: 12px; }
.applications-controls__row { display: flex; align-items: center; gap: 16px; }
.applications-controls__row > div:first-child { flex: 1; }
.applications-controls__title { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.applications-controls__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; line-height: 145%; }
.applications-controls__hint--right { flex: 1; max-width: 320px; margin-top: 0; }
.applications-controls__row--input { padding-top: 12px; border-top: 1px solid var(--color-hairline); }
.applications-controls__label { display: flex; flex-direction: column; gap: 6px; width: 320px; flex-shrink: 0; }
.applications-controls__label span { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.applications-controls__label input { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.applications-controls__label input:focus { outline: none; border-color: var(--color-ink); }
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
.tier__head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.primary-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; background: var(--color-ink); color: #fff; }
.primary-btn:hover:not(:disabled) { background: var(--color-graphite); }
.primary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost-btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-hairline); background: transparent; color: var(--color-ink); }
.ghost-btn:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-ink); }
.ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Notifications matrix ────────────────────────────────────── */
.notif-matrix { width: 100%; border-collapse: collapse; margin-top: 16px; }
.notif-matrix th, .notif-matrix td { padding: 12px 16px; border-bottom: 1px solid var(--color-hairline); text-align: left; vertical-align: middle; }
.notif-matrix thead th { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.notif-matrix__kind { width: 100%; }
.notif-matrix__col { width: 96px; text-align: center; }
.notif-matrix__toggle-cell { text-align: center; }
.notif-matrix__toggle-cell .switch { margin: 0 auto; }
.notif-matrix__label { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.notif-matrix__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; line-height: 145%; }
.notif-matrix tbody tr:last-child th, .notif-matrix tbody tr:last-child td { border-bottom: 0; }

.notif-digest { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--color-hairline); }
.notif-digest .field__label { margin-bottom: 8px; }

/* ── Email template ─────────────────────────────────────────── */
.email-editor { display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-top: 16px; align-items: flex-start; }
.email-editor__pane { display: flex; flex-direction: column; gap: 20px; }
.email-editor__textarea { padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-mono); font-size: 12px; line-height: 155%; color: var(--color-ink); background: var(--color-surface); resize: vertical; min-height: 200px; box-sizing: border-box; width: 100%; }
.email-editor__textarea:focus { outline: none; border-color: var(--color-ink); background: #fff; }

.email-vars { padding: 20px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; display: flex; flex-direction: column; gap: 16px; }
.email-vars__title { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--color-ink); margin: 0; }
.email-vars__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin: 0; line-height: 145%; }
.email-vars__group { display: flex; flex-direction: column; gap: 6px; }
.email-vars__category { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.email-vars__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.email-vars__item { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 8px; }
.email-vars__token { padding: 3px 6px; background: var(--color-ink); color: #fff; border: 0; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; cursor: pointer; }
.email-vars__token:hover { background: var(--color-graphite); }
.email-vars__label { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); flex: 1; min-width: 0; }
.email-vars__insert { display: flex; gap: 4px; }
.email-vars__insert button { padding: 2px 6px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 6px; font-family: var(--font-body); font-size: 10px; color: var(--color-fog); cursor: pointer; }
.email-vars__insert button:hover { color: var(--color-ink); border-color: var(--color-ink); }

.email-preview-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.email-preview-controls .segmented { flex-wrap: wrap; }
.email-preview-flavor { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 14px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.email-preview-flavor__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.email-preview-flavor__select { border: 0; background: transparent; padding: 4px 24px 4px 6px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); cursor: pointer; appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%230A0A0B' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 6px center; }
.email-preview-flavor__select:focus { outline: none; }
.segmented--sm button { padding: 6px 12px; font-size: 12px; }

.email-preview-frame { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; padding: 24px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 14px; }
.email-preview-meta { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.email-preview-meta-row { display: flex; gap: 12px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.email-preview-meta-row > span:first-child { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); width: 60px; padding-top: 2px; }
.email-preview-subject { font-weight: 600; }
.email-preview-shell { width: 100%; margin: 0 auto; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 24px -12px rgba(15, 23, 42, 0.15); }
.email-preview-inner { }
.email-preview-body { padding: 32px; font-family: Inter, sans-serif; color: var(--color-ink); }
.email-preview-iframe { display: block; width: 100%; height: 720px; border: 0; background: #fff; }
.email-preview-loading { padding: 48px 24px; text-align: center; font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }
.email-preview-loading--error { color: #B91C1C; }
.email-preview-hint { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 10px; font-family: var(--font-body); font-size: 12px; color: #92400E; }
.email-preview-hint__dot { width: 8px; height: 8px; border-radius: 999px; background: #F59E0B; flex-shrink: 0; }

/* Email tabs — pick between shared frame + per-email body. */
.email-tabs { margin: 16px 0 4px; }

/* Email section — one tab's worth of editor. */
.email-section { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.email-section__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.email-section__eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.email-section__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); margin-top: 2px; }

/* Body copy — per-flavour subject + body editor */
.flavor-editor { display: grid; grid-template-columns: 260px 1fr; gap: 20px; margin-top: 16px; align-items: flex-start; }
.flavor-picker { background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; overflow: hidden; }
.flavor-picker__list { list-style: none; padding: 0; margin: 0; }
.flavor-picker__list li + li { border-top: 1px solid var(--color-hairline); }
.flavor-picker__row { display: block; width: 100%; padding: 12px 14px; background: transparent; border: 0; text-align: left; cursor: pointer; font-family: var(--font-body); transition: background 120ms ease; }
.flavor-picker__row:hover:not(.is-on) { background: #fff; }
.flavor-picker__row.is-on { background: var(--color-ink); }
.flavor-picker__row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.flavor-picker__label { font-size: 13px; font-weight: 600; color: var(--color-ink); flex: 1; min-width: 0; }
.flavor-picker__row.is-on .flavor-picker__label { color: #fff; }
.flavor-picker__hint { font-size: 11px; color: var(--color-fog); line-height: 1.4; }
.flavor-picker__row.is-on .flavor-picker__hint { color: rgba(255, 255, 255, 0.6); }
.flavor-picker__chip { font-family: var(--font-mono); font-size: 9px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; flex-shrink: 0; }
.flavor-picker__chip--default { background: var(--color-hairline); color: var(--color-graphite); }
.flavor-picker__chip--on { background: #DCFCE7; color: #166534; }
.flavor-picker__chip--dirty { background: #FEF3C7; color: #92400E; }
.flavor-picker__row.is-on .flavor-picker__chip--default { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.7); }

.flavor-editor__pane { display: flex; flex-direction: column; gap: 20px; }
.flavor-editor__subject { width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: var(--color-surface); }
.flavor-editor__subject:focus { outline: none; border-color: var(--color-ink); background: #fff; }
.flavor-editor__body { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-mono); font-size: 12px; line-height: 155%; color: var(--color-ink); background: var(--color-surface); resize: vertical; min-height: 220px; }
.flavor-editor__body:focus { outline: none; border-color: var(--color-ink); background: #fff; }

.flavor-tokens { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; }
.flavor-tokens__head { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.flavor-tokens__list { display: flex; flex-wrap: wrap; gap: 6px; }
.flavor-tokens__pill { padding: 4px 10px; background: var(--color-ink); color: #fff; border: 0; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; cursor: pointer; }
.flavor-tokens__pill:hover { background: var(--color-graphite); }

@media (max-width: 1023px) {
  .flavor-editor { grid-template-columns: 1fr; }
}

@media (max-width: 1023px) {
  .email-editor { grid-template-columns: 1fr; }
}

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
