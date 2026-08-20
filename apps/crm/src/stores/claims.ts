import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import { claims as claimsApi, ApiError, type AdminClaim, type ClaimStatus, type Sport } from '@torny/api-client'

// Re-export for view consumers.
export type { AdminClaim as Claim, ClaimStatus, Sport }

export const useClaimsStore = defineStore('claims', () => {
  const pending = ref<AdminClaim[]>([])
  const approved = ref<AdminClaim[]>([])
  const rejected = ref<AdminClaim[]>([])

  const loading = ref<Record<ClaimStatus, boolean>>({ pending: false, approved: false, rejected: false })
  const error = ref<string | null>(null)
  const decidingId = ref<number | null>(null)

  const pendingCount = computed(() => pending.value.length)
  // Compat with older callers — full list, all statuses.
  const claims = computed<AdminClaim[]>(() => [...pending.value, ...approved.value, ...rejected.value])

  async function fetchStatus(status: ClaimStatus): Promise<void> {
    loading.value[status] = true
    error.value = null
    try {
      const { claims: rows } = await claimsApi.adminList({ status })
      if (status === 'pending') pending.value = rows
      else if (status === 'approved') approved.value = rows
      else rejected.value = rows
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : (err as Error).message
      throw err
    } finally {
      loading.value[status] = false
    }
  }

  async function fetchAll(): Promise<void> {
    await Promise.all([fetchStatus('pending'), fetchStatus('approved'), fetchStatus('rejected')])
  }

  async function approve(claimId: number): Promise<void> {
    decidingId.value = claimId
    try {
      await claimsApi.approve(claimId)
      // Refetch pending + approved + rejected — approve may auto-reject siblings
      // that were in pending, moving them into rejected.
      await fetchAll()
    } finally {
      decidingId.value = null
    }
  }

  async function reject(claimId: number, reason: string): Promise<void> {
    decidingId.value = claimId
    try {
      await claimsApi.reject(claimId, reason)
      // Refetch pending + rejected. Approved is unaffected.
      await Promise.all([fetchStatus('pending'), fetchStatus('rejected')])
    } finally {
      decidingId.value = null
    }
  }

  return {
    pending,
    approved,
    rejected,
    claims,
    pendingCount,
    loading,
    error,
    decidingId,
    fetchStatus,
    fetchAll,
    approve,
    reject,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useClaimsStore, import.meta.hot))
}
