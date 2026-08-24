import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useClubStore } from './club'
import { useAuthStore } from './auth'
import {
  clubOnboarding,
  ApiError,
  type WizardData,
  type WizardStepValue,
  type OnboardingValidationError,
  type WizardTier,
} from '@torny/api-client'

export type WizardStep = 'welcome' | 1 | 2 | 3 | 4 | 5 | 6 | 'complete'

export interface DayHours {
  open: boolean
  from: string
  to: string
}

export interface MembershipTier extends WizardTier {
  id: string
  tone: 'accent' | 'mint' | 'tangerine' | 'violet'
}

export interface OnboardingData extends WizardData {
  tiers: MembershipTier[]
  logoDataUrl: string | null
}

const defaultHours: OnboardingData['hours'] = {
  mon: { open: true, from: '15:00', to: '20:00' },
  tue: { open: true, from: '15:00', to: '20:00' },
  wed: { open: true, from: '15:00', to: '20:00' },
  thu: { open: true, from: '15:00', to: '20:00' },
  fri: { open: true, from: '15:00', to: '21:00' },
  sat: { open: true, from: '10:00', to: '18:00' },
  sun: { open: false, from: '', to: '' },
}

const defaultData = (): OnboardingData => ({
  clubName: '',
  yearFounded: '',
  clubType: 'community',
  shortDescription: '',
  address: '',
  suburb: '',
  region: '',
  country: 'New Zealand',
  greens: 2,
  rinks: 8,
  greenSurface: 'tifdwarf',
  email: '',
  phone: '',
  hours: JSON.parse(JSON.stringify(defaultHours)),
  cadence: 'annual',
  firstYearDiscount: true,
  tiers: [
    { id: 'playing', name: 'Playing member', description: 'Full playing rights, all comps, unlimited rink bookings.', price: 140, tone: 'accent', isDefault: true },
    { id: 'social', name: 'Social member', description: 'Clubhouse access, twilight roll-ups, no pennant.', price: 60, tone: 'mint' },
    { id: 'junior', name: 'Junior (under 25)', description: 'Full playing rights at a supported rate.', price: 40, tone: 'tangerine' },
  ],
  logoName: null,
  logoUrl: null,
  logoDataUrl: null,
  accentColour: '#2563EB',
  tagline: '',
  subdomain: '',
  pages: { home: true, about: true, membership: true, events: true, shop: false },
})

const TONES: MembershipTier['tone'][] = ['accent', 'mint', 'tangerine', 'violet']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * Merge a server-returned WizardData over local defaults. Server may omit
 * fields — the wizard should never see undefined for a required field. Also
 * hydrates tier tones (server doesn't know about them, they're a client UI hint).
 */
function fromServerData(remote: Partial<WizardData> | null | undefined): OnboardingData {
  const d = defaultData()
  if (!remote) return d
  return {
    ...d,
    ...remote,
    hours: { ...d.hours, ...(remote.hours ?? {}) },
    pages: { ...d.pages, ...(remote.pages ?? {}) },
    tiers: (remote.tiers && remote.tiers.length > 0 ? remote.tiers : d.tiers).map((t, i): MembershipTier => ({
      id: t.id ?? `tier-${i}`,
      name: t.name,
      description: t.description,
      price: t.price,
      tone: (t.tone as MembershipTier['tone']) ?? TONES[i % TONES.length]!,
      isDefault: t.isDefault,
    })),
    logoDataUrl: d.logoDataUrl,
  }
}

function toServerData(local: OnboardingData): WizardData {
  // Drop `logoDataUrl` (client-only preview) — server has its own logoUrl.
  const { logoDataUrl: _unused, ...rest } = local
  void _unused
  return rest
}

// WizardStep (local, mixed number/string) ↔ WizardStepValue (server, all strings).
function stepToServer(step: WizardStep): WizardStepValue {
  if (step === 'welcome' || step === 'complete') return step
  return String(step) as WizardStepValue
}
function stepFromServer(v: WizardStepValue): WizardStep {
  if (v === 'welcome' || v === 'complete') return v
  return Number(v) as WizardStep
}

// Simple debounce so a quick edit-and-tab-away doesn't flood the API.
function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

// Local fallback key so an offline session still holds the wizard state.
function fallbackKey(clubId: number | string | null): string {
  return `torny.crm.onboarding.${clubId ?? 'draft'}`
}

/** Map a server validation `field` string to the wizard step that owns it. */
export function stepForField(field: string): WizardStep {
  if (/^clubName|yearFounded|clubType|shortDescription/.test(field)) return 1
  if (/^address|suburb|region|country|greens|rinks|greenSurface/.test(field)) return 2
  if (/^email|phone|hours/.test(field)) return 3
  if (/^tiers|cadence|firstYearDiscount/.test(field)) return 4
  if (/^logo|accentColour|tagline/.test(field)) return 5
  if (/^subdomain|pages/.test(field)) return 6
  return 'welcome'
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const club = useClubStore()
  const auth = useAuthStore()

  const data = ref<OnboardingData>(defaultData())
  const completed = ref(false)
  const completedAt = ref<string | null>(null)
  const step = ref<WizardStep>('welcome')

  const loading = ref(false)
  const saving = ref(false)
  const saveError = ref<string | null>(null)

  const publicUrl = ref<string | null>(null)
  const membershipTierIds = ref<number[]>([])
  const validationErrors = ref<OnboardingValidationError[]>([])

  const stepNumber = computed<number | null>(() => (typeof step.value === 'number' ? step.value : null))
  const progressPct = computed(() => {
    if (step.value === 'welcome') return 0
    if (step.value === 'complete') return 100
    return Math.round(((stepNumber.value ?? 0) / 6) * 100)
  })

  // ── Server sync ──────────────────────────────────────────────
  async function hydrate(): Promise<void> {
    const clubId = club.current?.id
    if (!clubId || typeof clubId !== 'number') return
    loading.value = true
    saveError.value = null
    try {
      const state = await clubOnboarding.get(clubId)
      data.value = fromServerData(state.data)
      completed.value = state.completed
      completedAt.value = state.completedAt
      step.value = stepFromServer(state.step)
    } catch (err) {
      // Non-fatal: fall back to whatever's in localStorage.
      try {
        const raw = localStorage.getItem(fallbackKey(clubId))
        if (raw) {
          const parsed = JSON.parse(raw) as { data?: OnboardingData; step?: WizardStep; completed?: boolean }
          if (parsed.data) data.value = { ...defaultData(), ...parsed.data }
          if (parsed.step) step.value = parsed.step
          if (parsed.completed) completed.value = parsed.completed
        }
      } catch { /* ignore */ }
      saveError.value = err instanceof ApiError ? err.message : (err as Error).message
    } finally {
      loading.value = false
    }
  }

  async function pushPatch(payload: { step?: WizardStep; data?: Partial<WizardData> }) {
    const clubId = club.current?.id
    if (!clubId || typeof clubId !== 'number') return
    saving.value = true
    saveError.value = null
    try {
      const serverPayload: { step?: WizardStepValue; data?: Partial<WizardData> } = {}
      if (payload.step !== undefined) serverPayload.step = stepToServer(payload.step)
      if (payload.data !== undefined) serverPayload.data = payload.data
      await clubOnboarding.patch(clubId, serverPayload)
      // Also persist offline for resilience.
      try {
        localStorage.setItem(fallbackKey(clubId), JSON.stringify({ data: data.value, step: step.value, completed: completed.value }))
      } catch { /* localStorage might be full — non-fatal */ }
    } catch (err) {
      saveError.value = err instanceof ApiError ? err.message : (err as Error).message
      // Keep the local edit even if PATCH failed — user retries on next change.
      try {
        localStorage.setItem(fallbackKey(clubId), JSON.stringify({ data: data.value, step: step.value, completed: completed.value }))
      } catch { /* ignore */ }
    } finally {
      saving.value = false
    }
  }

  const debouncedPatch = debounce(pushPatch, 500)

  // ── Actions ──────────────────────────────────────────────────
  function setStep(next: WizardStep) {
    step.value = next
    // Fire an immediate patch on step advance (not debounced) so the bookmark
    // is durable even if the user closes the tab straight after.
    pushPatch({ step: next, data: toServerDataStrip(data.value) })
  }

  /**
   * Force an immediate PATCH of the current wizard data — used right before
   * `markComplete()` so any pending debounced writes don't race the finalize
   * call and leave the server validating stale state.
   */
  async function flush(): Promise<void> {
    await pushPatch({ data: toServerDataStrip(data.value) })
  }

  async function markComplete(): Promise<'ok' | 'validation' | 'error'> {
    const clubId = club.current?.id
    if (!clubId || typeof clubId !== 'number') return 'error'
    saving.value = true
    saveError.value = null
    validationErrors.value = []
    try {
      const res = await clubOnboarding.complete(clubId)
      completed.value = true
      completedAt.value = res.onboardedAt
      publicUrl.value = res.publicUrl
      membershipTierIds.value = res.membershipTierIds
      step.value = 'complete'
      // Refresh session so /me picks up the new onboarded state on clubs[].
      await auth.refresh()
      return 'ok'
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray((err.body as { errors?: unknown[] })?.errors)) {
        validationErrors.value = ((err.body as { errors: OnboardingValidationError[] }).errors) ?? []
        const first = validationErrors.value[0]
        if (first) step.value = stepForField(first.field)
        return 'validation'
      }
      if (err instanceof ApiError && err.code === 'already_onboarded') {
        completed.value = true
        step.value = 'complete'
        return 'ok'
      }
      saveError.value = err instanceof ApiError ? err.message : (err as Error).message
      return 'error'
    } finally {
      saving.value = false
    }
  }

  function reset() {
    data.value = defaultData()
    completed.value = false
    completedAt.value = null
    publicUrl.value = null
    membershipTierIds.value = []
    validationErrors.value = []
    step.value = 'welcome'
  }

  function toServerDataStrip(local: OnboardingData): Partial<WizardData> {
    const { logoDataUrl: _unused, ...rest } = local
    void _unused
    return rest
  }

  // Debounced autosave whenever wizard fields change. Skips completed sessions.
  watch(
    data,
    (val) => {
      if (completed.value) return
      debouncedPatch({ data: toServerDataStrip(val) })
    },
    { deep: true },
  )

  // When the current club changes (post-approval, post-switch), re-hydrate.
  watch(
    () => club.current?.id,
    (id) => {
      if (id && typeof id === 'number') hydrate()
      else reset()
    },
    { immediate: true },
  )

  return {
    data,
    completed,
    completedAt,
    step,
    stepNumber,
    progressPct,
    loading,
    saving,
    saveError,
    publicUrl,
    membershipTierIds,
    validationErrors,
    setStep,
    markComplete,
    reset,
    hydrate,
    flush,
  }
})

// Deliberately not re-exporting from this store — WizardTier is authored in
// api-client; MembershipTier is the local extension used by the store + views.
export type { WizardTier }

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOnboardingStore, import.meta.hot))
}
