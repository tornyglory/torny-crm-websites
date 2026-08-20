/**
 * Sport taxonomy for the platform.
 * Kept as a plain module (no store) so it can be imported from anywhere.
 * Backend will eventually own this list; keep the codes stable.
 */

export type SportCode = 'bowls' | 'tennis' | 'golf' | 'cricket' | 'petanque' | 'croquet'

export interface SportMeta {
  code: SportCode
  label: string
  short: string
  emoji: string
}

export const SPORTS: Record<SportCode, SportMeta> = {
  bowls: { code: 'bowls', label: 'Lawn bowls', short: 'Bowls', emoji: '🎳' },
  tennis: { code: 'tennis', label: 'Tennis', short: 'Tennis', emoji: '🎾' },
  golf: { code: 'golf', label: 'Golf', short: 'Golf', emoji: '⛳️' },
  cricket: { code: 'cricket', label: 'Cricket', short: 'Cricket', emoji: '🏏' },
  petanque: { code: 'petanque', label: 'Pétanque', short: 'Pétanque', emoji: '🥎' },
  croquet: { code: 'croquet', label: 'Croquet', short: 'Croquet', emoji: '🏑' },
}

export const SPORT_CODES: SportCode[] = Object.keys(SPORTS) as SportCode[]

export function sportLabel(code: SportCode): string {
  return SPORTS[code]?.label ?? code
}
export function sportShort(code: SportCode): string {
  return SPORTS[code]?.short ?? code
}
