/**
 * Shape returned by `GET /clubs/resolve` — set on `event.context.club` by
 * server/middleware/tenant.ts and read here for pages + layouts.
 */
export interface Club {
  id: number
  slug: string
  name: string
  primary_host: string
  custom_hosts: string[]
  brand_primary: string | null
  logo_url: string | null
  onboarded_at: string | null
}

// SSR: reads from event.context.club (set by server/middleware/tenant.ts).
// Client hydration: reads from the initial payload nuxtApp exposes.
export function useClub() {
  const club = useState<Club | null>('club', () => null)

  const nuxtApp = useNuxtApp()
  if (import.meta.server && !club.value) {
    const ssrClub = nuxtApp.ssrContext?.event.context.club as Club | undefined
    if (ssrClub) club.value = ssrClub
  }

  return club
}
