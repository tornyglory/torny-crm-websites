import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useClubStore } from './club'

export type WizardStep = 'welcome' | 1 | 2 | 3 | 4 | 5 | 6 | 'complete'

export interface DayHours {
  open: boolean
  from: string
  to: string
}

export interface MembershipTier {
  id: string
  name: string
  description: string
  price: number
  tone: 'accent' | 'mint' | 'tangerine' | 'violet'
  isDefault?: boolean
}

export interface OnboardingData {
  // Step 1 — Club basics
  clubName: string
  yearFounded: string
  clubType: 'community' | 'private' | 'district'
  shortDescription: string
  // Step 2 — Where you play
  address: string
  suburb: string
  region: string
  country: string
  greens: number
  rinks: number
  greenSurface: 'tifdwarf' | 'cotula' | 'synthetic' | 'mixed'
  // Step 3 — Contact & hours
  email: string
  phone: string
  hours: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>
  // Step 4 — Membership
  cadence: 'annual' | 'monthly' | 'season'
  firstYearDiscount: boolean
  tiers: MembershipTier[]
  // Step 5 — Brand
  logoName: string | null
  logoDataUrl: string | null    // client-side preview only; backend upload is a follow-up (brief 10 §6)
  accentColour: string
  tagline: string
  // Step 6 — Website
  subdomain: string
  pages: Record<'home' | 'about' | 'membership' | 'events' | 'shop', boolean>
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
  logoDataUrl: null,
  accentColour: '#2563EB',
  tagline: '',
  subdomain: '',
  pages: { home: true, about: true, membership: true, events: true, shop: false },
})

function storageKey(clubId: number | string | null): string {
  return `torny.crm.onboarding.${clubId ?? 'draft'}`
}

interface Persisted {
  data: OnboardingData
  completed: boolean
  step: WizardStep
}

function load(clubId: number | string | null): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(clubId))
    if (!raw) return { data: defaultData(), completed: false, step: 'welcome' }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      data: { ...defaultData(), ...(parsed.data ?? {}) },
      completed: !!parsed.completed,
      step: parsed.step ?? 'welcome',
    }
  } catch {
    return { data: defaultData(), completed: false, step: 'welcome' }
  }
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const club = useClubStore()
  const initial = load(club.current?.id ?? null)

  const data = ref<OnboardingData>(initial.data)
  const completed = ref(initial.completed)
  const step = ref<WizardStep>(initial.step)

  const stepNumber = computed<number | null>(() => (typeof step.value === 'number' ? step.value : null))
  const progressPct = computed(() => {
    if (step.value === 'welcome') return 0
    if (step.value === 'complete') return 100
    return Math.round(((stepNumber.value ?? 0) / 6) * 100)
  })

  function setStep(next: WizardStep) {
    step.value = next
    persist()
  }

  function markComplete() {
    completed.value = true
    step.value = 'complete'
    persist()
  }

  function reset() {
    data.value = defaultData()
    completed.value = false
    step.value = 'welcome'
    persist()
  }

  function persist() {
    const key = storageKey(club.current?.id ?? null)
    const payload: Persisted = { data: data.value, completed: completed.value, step: step.value }
    localStorage.setItem(key, JSON.stringify(payload))
  }

  watch(data, persist, { deep: true })

  return { data, completed, step, stepNumber, progressPct, setStep, markComplete, reset }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useOnboardingStore, import.meta.hot))
}
