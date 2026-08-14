// Public club directory — used during signup/claim before the user has an auth
// token. Lives on the SAM API (separate base URL from the main CRM API); the
// endpoint is public and un-authed.

export interface DirectoryClub {
  club_id: number
  sport: number
  name: string
  description: string | null
  achievements: string | null
  avatar: string | null
  banner_image: string | null
  country: string | null
  state: string | null
  region: string | null
  address: string | null
  latitude: string | null
  longitude: string | null
  email: string | null
  phone: string | null
  website: string | null
  created: string | null
  similarity_score?: number
}

export interface ClubSearchParams {
  name?: string
  fuzzy?: boolean
  sport?: number
  country?: string
  state?: string
  region?: string
}

export type SearchType = 'exact' | 'fuzzy'

export interface ClubSearchResult {
  clubs: DirectoryClub[]
  searchType: SearchType
}

const DEFAULT_DIRECTORY_URL = 'https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod'

export async function searchClubs(
  params: ClubSearchParams,
  opts: { baseURL?: string; signal?: AbortSignal } = {},
): Promise<ClubSearchResult> {
  const base = opts.baseURL ?? DEFAULT_DIRECTORY_URL
  const url = new URL(`${base}/clubs`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, { signal: opts.signal })
  if (!res.ok) throw new Error(`Club search failed: ${res.status}`)
  const json = (await res.json()) as {
    status: string
    data: DirectoryClub[]
    search_type?: SearchType
  }
  return {
    clubs: Array.isArray(json.data) ? json.data : [],
    searchType: json.search_type ?? 'exact',
  }
}

// Two-stage search: substring first (cheap), fuzzy fallback if empty.
export async function searchClubsSmart(
  name: string,
  opts: { baseURL?: string; signal?: AbortSignal; sport?: number } = {},
): Promise<ClubSearchResult> {
  if (!name.trim()) return { clubs: [], searchType: 'exact' }
  const substring = await searchClubs(
    { name, sport: opts.sport },
    { baseURL: opts.baseURL, signal: opts.signal },
  )
  if (substring.clubs.length > 0) return substring
  return await searchClubs(
    { name, fuzzy: true, sport: opts.sport },
    { baseURL: opts.baseURL, signal: opts.signal },
  )
}
