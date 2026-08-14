interface Club {
  id: string
  slug: string
  name: string
  domain: string | null
  brandPrimary: string | null
  logoUrl: string | null
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
