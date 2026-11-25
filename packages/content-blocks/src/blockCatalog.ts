/**
 * Block catalog — the single source of truth for every content block's
 * tier (core vs paid add-on) and category (for CRM picker grouping).
 *
 * Why a catalog instead of ad-hoc metadata on each block component:
 *   - One place to audit which blocks are free vs paid. Anybody can
 *     read this file and know the whole product offering.
 *   - Entitlement logic (`isBlockEntitled`) can be a pure function
 *     over this data — the CRM picker, BlockRenderer, and any backend
 *     validation all read from the same source.
 *   - When paid add-ons ship (brief 122) we flip one entry's tier
 *     from 'core' to 'addon' + wire its entitlement id. No search +
 *     replace across the codebase.
 *
 * See docs/backend-briefs/122-paid-addon-blocks.md for the full
 * product shape. Today every block is `tier: 'core'` — the scaffolding
 * is what matters so brief 122's V1 (Tournament Management Pro) is a
 * one-line config flip once the block itself is built.
 */
import type { BlockType } from './types'

/** Grouping used by the CRM block picker. Not sent to the backend —
 *  purely a UX convenience. New categories are cheap; prefer adding one
 *  over cramming a block into a mismatched bucket. */
export type BlockCategory =
  | 'layout'       // structural + typographic chrome (sections, dividers, columns)
  | 'content'      // free-form author content (rich text, AI)
  | 'hero'         // large display blocks that lead a page
  | 'members'      // people-facing (grid, search, join form, CTAs)
  | 'events'       // upcoming / calendar / club social
  | 'tournaments'  // competitive play (listings, heroes, search)
  | 'honour'       // past champions, winners, honour boards
  | 'venue'        // venue hire, packages, booking
  | 'commerce'     // sponsors, bistro, contact — things that carry a "business" relationship

/** Core blocks ship to every club on every plan. Addon blocks require a
 *  matching entry in the club's `addons` list — see brief 122 §1. */
export type BlockTier = 'core' | 'addon'

export interface BlockCatalogEntry {
  type: BlockType
  category: BlockCategory
  tier: BlockTier
  /** Required when `tier === 'addon'`. Kebab-case, stable identifier —
   *  once published it's forever (matches the Stripe Price metadata
   *  convention in brief 122 §2). Absent for core blocks. */
  entitlement?: string
}

/**
 * Every block in `BlockType` MUST have an entry here. The exhaustiveness
 * check at the bottom of the file enforces that at compile time — if
 * you add a new block to `types.ts::BlockType`, the typescript error
 * will steer you back here.
 */
export const BLOCK_CATALOG: Record<BlockType, BlockCatalogEntry> = {
  // ── Hero / display ────────────────────────────────────────────
  hero:                     { type: 'hero',                     category: 'hero',        tier: 'core' },
  fullBleedImage:           { type: 'fullBleedImage',           category: 'hero',        tier: 'core' },
  fullBleedMedia:           { type: 'fullBleedMedia',           category: 'hero',        tier: 'core' },
  ctaBanner:                { type: 'ctaBanner',                category: 'hero',        tier: 'core' },
  pullQuote:                { type: 'pullQuote',                category: 'hero',        tier: 'core' },
  gallery:                  { type: 'gallery',                  category: 'hero',        tier: 'core' },

  // ── Layout / typography ───────────────────────────────────────
  sectionTitle:             { type: 'sectionTitle',             category: 'layout',      tier: 'core' },
  divider:                  { type: 'divider',                  category: 'layout',      tier: 'core' },
  twoColumn:                { type: 'twoColumn',                category: 'layout',      tier: 'core' },
  mediaSplit:               { type: 'mediaSplit',               category: 'layout',      tier: 'core' },
  featureGrid:              { type: 'featureGrid',              category: 'layout',      tier: 'core' },
  faqAccordion:             { type: 'faqAccordion',             category: 'layout',      tier: 'core' },
  timeline:                 { type: 'timeline',                 category: 'layout',      tier: 'core' },

  // ── Content ───────────────────────────────────────────────────
  richText:                 { type: 'richText',                 category: 'content',     tier: 'core' },
  customAi:                 { type: 'customAi',                 category: 'content',     tier: 'core' },

  // ── Members ───────────────────────────────────────────────────
  peopleGrid:               { type: 'peopleGrid',               category: 'members',     tier: 'core' },
  membersSearch:            { type: 'membersSearch',            category: 'members',     tier: 'core' },
  membershipJoinForm:       { type: 'membershipJoinForm',       category: 'members',     tier: 'core' },
  membershipCta:            { type: 'membershipCta',            category: 'members',     tier: 'core' },

  // ── Events ────────────────────────────────────────────────────
  eventList:                { type: 'eventList',                category: 'events',      tier: 'core' },
  eventsCalendar:           { type: 'eventsCalendar',           category: 'events',      tier: 'core' },

  // ── Tournaments ───────────────────────────────────────────────
  // All tournament blocks start as core; brief 122 V1 ships a new
  // `tournamentManagementPro` block as the first add-on, these stay free.
  upcomingTournamentsList:  { type: 'upcomingTournamentsList',  category: 'tournaments', tier: 'core' },
  upcomingTournamentHero:   { type: 'upcomingTournamentHero',   category: 'tournaments', tier: 'core' },
  tournamentSearch:         { type: 'tournamentSearch',         category: 'tournaments', tier: 'core' },

  // ── Honour board ──────────────────────────────────────────────
  honourBoard:              { type: 'honourBoard',              category: 'honour',      tier: 'core' },
  honourBoardSearch:        { type: 'honourBoardSearch',        category: 'honour',      tier: 'core' },

  // ── Venue hire ────────────────────────────────────────────────
  venueHireHero:            { type: 'venueHireHero',            category: 'venue',       tier: 'core' },
  venueSpaces:              { type: 'venueSpaces',              category: 'venue',       tier: 'core' },
  venuePackages:            { type: 'venuePackages',            category: 'venue',       tier: 'core' },
  venueBooking:             { type: 'venueBooking',             category: 'venue',       tier: 'core' },

  // ── Commerce / relationships ──────────────────────────────────
  sponsors:                 { type: 'sponsors',                 category: 'commerce',    tier: 'core' },
  bistroMenu:               { type: 'bistroMenu',               category: 'commerce',    tier: 'core' },
  contactForm:              { type: 'contactForm',              category: 'commerce',    tier: 'core' },
}

/**
 * True when the block is either a core block (free for everyone) or an
 * add-on whose entitlement id is present in the club's addons list.
 *
 * Accepts `readonly string[] | undefined` so callers don't need to
 * normalise the payload shape — missing / undefined addons behave the
 * same as an empty list (no entitlements granted).
 */
export function isBlockEntitled(
  type: BlockType,
  clubAddons: readonly string[] | undefined,
): boolean {
  const entry = BLOCK_CATALOG[type]
  if (entry.tier === 'core') return true
  // Defensive: an addon entry without an entitlement id is a catalog
  // misconfiguration. Treat it as locked so bad config doesn't give
  // a block away for free.
  if (!entry.entitlement) return false
  return (clubAddons ?? []).includes(entry.entitlement)
}

/** All blocks in a given category, in catalog order. Used by the CRM
 *  picker to render category-grouped columns. */
export function blocksByCategory(category: BlockCategory): BlockCatalogEntry[] {
  return Object.values(BLOCK_CATALOG).filter((e) => e.category === category)
}

/** All add-on blocks regardless of entitlement state — useful for the
 *  Settings → Billing "Browse add-ons" surface. */
export function addonBlocks(): BlockCatalogEntry[] {
  return Object.values(BLOCK_CATALOG).filter((e) => e.tier === 'addon')
}
