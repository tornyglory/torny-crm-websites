// AI block generator — brief 113 §5. Hosted on the Venue API (one
// endpoint per club) because the CRM CloudFormation stack hit its
// 500-resource cap; the Venue stack has room. Same JWT works across
// stacks. Request/response shape is identical to the original Nuxt
// prototype — see §5.2 of the brief for the full example.

import { VENUE_BASE } from '../config'
import { authedFetch } from '../http'

// ── Domain types ─────────────────────────────────────────────────

export interface AiBrandContext {
  club_name?: string | null
  /** Primary accent (brand colour). Used sparingly — buttons, links,
   *  highlights. Everything else leans on the neutral palette below. */
  accent_color?: string | null
  /** Core neutrals — mirror the `--color-*` tokens in
   *  `packages/design-tokens/src/tokens.css`. Named so the model can
   *  reason about them (text on surfaces, borders on ground). */
  ink_color?: string | null
  surface_color?: string | null
  hairline_color?: string | null
  fog_color?: string | null
  mute_color?: string | null
  graphite_color?: string | null
  /** Headings vs. body typography. Falls back to system sans if absent. */
  heading_font?: string | null
  body_font?: string | null
  /** Monospace family — for code, mono eyebrows, small caps-style labels. */
  mono_font?: string | null
  /** Type scale cheat-sheet in a human-readable string, e.g.
   *  `"label 11 · caption 12 · body 16 · title 24 · display 44 · hero 88"`.
   *  Author CSS should pick values from this scale rather than inventing
   *  arbitrary sizes. */
  type_scale?: string | null
  /** Font-weight cheat-sheet, e.g. `"regular 400, medium 500, semibold 600, bold 700"`. */
  font_weights?: string | null
  /** Comma-separated spacing scale (px). Author CSS should use these
   *  values for padding / margin / gap — not arbitrary integers. */
  spacing_scale?: string | null
  /** Comma-separated radius scale (px, with `999px` as the pill). */
  radius_scale?: string | null
  /** Breakpoint cheat-sheet in a one-line human-readable string.
   *  Author CSS must include at least `@media (min-width: <tablet>)`
   *  and `@media (min-width: <desktop>)` rules so the block looks
   *  intentional on all three form factors. */
  breakpoints?: string | null
  /** Max content width for narrative blocks. Centres everything above
   *  it. Defaults to 1280px in our token set. */
  container_max?: string | null
}

export interface AiNearbyBlock {
  type: string
  title?: string | null
  text?: string | null
}

export interface AiIterationContext {
  prev_html: string
  prev_css: string
  prev_js: string | null
}

export interface GenerateBlockInput {
  prompt: string
  brand?: AiBrandContext
  nearby_blocks?: AiNearbyBlock[]
  iteration?: AiIterationContext | null
  /** Off by default — custom JS is opt-in because it's the biggest
   *  surface for site breakage. */
  allow_js?: boolean
}

export interface GeneratedBlock {
  html: string
  css: string
  js: string | null
  notes: string
}

export type GenerateBlockErrorCode =
  | 'unauthenticated'
  | 'misconfigured'
  | 'missing_prompt'
  | 'prompt_too_long'
  | 'bad_params'
  | 'rate_limited'
  | 'gemini_failed'
  | 'gemini_bad_shape'
  | 'gemini_empty'

/** `data` payload on the 429 `rate_limited` response. */
export interface GenerateBlockRateLimit {
  limit: number
  used: number
}

interface Envelope<T> { status: 'success'; data: T }

// ── Calls ────────────────────────────────────────────────────────

/** `clubId` keys both auth (the Venue stack gates on the caller's CRM
 *  role for this club) and rate limiting (20 generations / user / hour). */
export async function generateBlock(
  clubId: number,
  input: GenerateBlockInput,
): Promise<GeneratedBlock> {
  const res = await authedFetch<Envelope<GeneratedBlock>>(
    `${VENUE_BASE}/clubs/${clubId}/ai-generate`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
  return res.data
}
