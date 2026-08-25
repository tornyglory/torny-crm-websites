import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import {
  members as membersApi,
  ApiError,
  type MembershipTierListItem,
  type MembershipSettings,
  type CreateTierInput,
  type UpdateTierInput,
} from '@torny/api-client'

/**
 * Membership tiers + club-level settings — one store, one fetch.
 *
 * Backs the CRM Settings → Membership types tab. Replaces the earlier
 * onboarding.data.tiers reads (which stopped syncing to backend post-
 * onboarding). All mutations go through brief 36's CRUD endpoints;
 * successful responses are merged into local state so we don't need to
 * refetch the whole list per edit.
 */
export const useMembershipTiersStore = defineStore('membershipTiers', () => {
  const tiers = ref<MembershipTierListItem[]>([])
  const settings = ref<MembershipSettings>({ cadence: null, first_year_discount: false })
  const loadedClubId = ref<number | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const defaultTier = computed<MembershipTierListItem | null>(
    () => tiers.value.find((t) => t.is_default) ?? null,
  )
  const sortedTiers = computed<MembershipTierListItem[]>(
    () => [...tiers.value].sort((a, b) => a.sort_order - b.sort_order),
  )

  function upsertTier(next: MembershipTierListItem) {
    const idx = tiers.value.findIndex((t) => t.id === next.id)
    if (idx >= 0) tiers.value.splice(idx, 1, next)
    else tiers.value.push(next)
    // When a tier is promoted to default, backend flips the previous default
    // atomically — mirror that here so the UI stays in sync without a refetch.
    if (next.is_default) {
      tiers.value = tiers.value.map((t) =>
        t.id === next.id ? t : { ...t, is_default: false },
      )
    }
  }

  async function fetch(clubId: number, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force && loadedClubId.value === clubId) return
    loading.value = true
    error.value = null
    try {
      const res = await membersApi.listTiers(clubId)
      tiers.value = res.tiers
      settings.value = res.settings
      loadedClubId.value = clubId
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : (err as Error).message
    } finally {
      loading.value = false
    }
  }

  async function create(clubId: number, input: CreateTierInput): Promise<MembershipTierListItem> {
    saving.value = true
    error.value = null
    try {
      const created = await membersApi.createTier(clubId, input)
      upsertTier(created)
      return created
    } finally {
      saving.value = false
    }
  }

  async function update(
    clubId: number,
    tierId: number,
    patch: UpdateTierInput,
  ): Promise<MembershipTierListItem> {
    saving.value = true
    error.value = null
    try {
      const updated = await membersApi.updateTier(clubId, tierId, patch)
      upsertTier(updated)
      return updated
    } finally {
      saving.value = false
    }
  }

  async function remove(clubId: number, tierId: number): Promise<void> {
    saving.value = true
    error.value = null
    try {
      await membersApi.deleteTier(clubId, tierId)
      tiers.value = tiers.value.filter((t) => t.id !== tierId)
    } finally {
      saving.value = false
    }
  }

  async function setDefault(clubId: number, tierId: number): Promise<MembershipTierListItem> {
    saving.value = true
    error.value = null
    try {
      const promoted = await membersApi.setDefaultTier(clubId, tierId)
      upsertTier(promoted)
      return promoted
    } finally {
      saving.value = false
    }
  }

  async function updateSettings(
    clubId: number,
    patch: Partial<MembershipSettings>,
  ): Promise<MembershipSettings> {
    saving.value = true
    error.value = null
    try {
      const next = await membersApi.updateMembershipSettings(clubId, patch)
      settings.value = next
      return next
    } finally {
      saving.value = false
    }
  }

  function clear(): void {
    tiers.value = []
    settings.value = { cadence: null, first_year_discount: false }
    loadedClubId.value = null
    error.value = null
  }

  return {
    tiers,
    sortedTiers,
    settings,
    defaultTier,
    loadedClubId,
    loading,
    saving,
    error,
    fetch,
    create,
    update,
    remove,
    setDefault,
    updateSettings,
    clear,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMembershipTiersStore, import.meta.hot))
}
