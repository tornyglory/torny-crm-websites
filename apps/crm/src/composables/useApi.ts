import { createTornyClient, type TornyClient } from '@torny/api-client'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

let client: TornyClient | null = null

export function useApi(): TornyClient {
  if (client) return client
  const auth = useAuthStore()
  const club = useClubStore()
  client = createTornyClient({
    baseURL: import.meta.env.VITE_CRM_BASE_URL,
    getAuthToken: () => auth.token,
    getClubId: () => club.current?.id ?? null,
  })
  return client
}
