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

/** Three gating tiers:
 *  - `core`: ships to every club on every plan (default).
 *  - `pro`: requires `plan === 'pro'`. Starter clubs see it greyed out
 *    in the picker with an "Upgrade to Pro" upsell path.
 *  - `addon`: requires a matching entitlement in the club's `addons`
 *    list — see brief 122 §1. Independent of plan tier so a Starter
 *    club could theoretically unlock a specific add-on without going
 *    Pro, if we ever decide to sell them à la carte.
 *  Today the catalog uses `core` + `pro`; `addon` is scaffolded for
 *  brief 122's follow-up work. */
export type BlockTier = 'core' | 'pro' | 'addon'

export interface BlockCatalogEntry {
  type: BlockType
  category: BlockCategory
  tier: BlockTier
  /** Required when `tier === 'addon'`. Kebab-case, stable identifier —
   *  once published it's forever (matches the Stripe Price metadata
   *  convention in brief 122 §2). Absent for core / pro blocks. */
  entitlement?: string
}

/** Match the PlanKey from @torny/api-client::billing. Duplicated here
 *  rather than imported so the content-blocks package stays dep-free
 *  on api-client (keeps the SSR bundle smaller + the dep graph
 *  acyclic). Keep these unions in sync. */
export type PlanTier = 'starter' | 'pro'

/**
 * Every block in `BlockType` MUST have an entry here. The exhaustiveness
 * check at the bottom of the file enforces that at compile time — if
 * you add a new block to `types.ts::BlockType`, the typescript error
 * will steer you back here.
 */
/**
 * Starting classification (2026-11-26):
 *   - Basic presentational blocks (hero, rich text, layout chrome,
 *     gallery, contact form, membership CTA, event list) stay `core`
 *     so every Starter club can build a usable public site.
 *   - Operationally-complex blocks that create real value — anything
 *     backed by live members / tournaments / venue bookings / honour
 *     board history, plus the AI block (expensive to run) — are
 *     `pro`. These are the features that justify the plan upgrade.
 *   - Reclassify by editing this file; it's the single source of truth.
 */
export const BLOCK_CATALOG: Record<BlockType, BlockCatalogEntry> = {
  // ── Hero / display — core so Starter clubs can build an attractive site
  hero:                     { type: 'hero',                     category: 'hero',        tier: 'core' },
  fullBleedImage:           { type: 'fullBleedImage',           category: 'hero',        tier: 'core' },
  fullBleedMedia:           { type: 'fullBleedMedia',           category: 'hero',        tier: 'core' },
  ctaBanner:                { type: 'ctaBanner',                category: 'hero',        tier: 'core' },
  pullQuote:                { type: 'pullQuote',                category: 'hero',        tier: 'core' },
  gallery:                  { type: 'gallery',                  category: 'hero',        tier: 'core' },

  // ── Layout / typography — core, these are structural primitives
  sectionTitle:             { type: 'sectionTitle',             category: 'layout',      tier: 'core' },
  divider:                  { type: 'divider',                  category: 'layout',      tier: 'core' },
  twoColumn:                { type: 'twoColumn',                category: 'layout',      tier: 'core' },
  mediaSplit:               { type: 'mediaSplit',               category: 'layout',      tier: 'core' },
  featureGrid:              { type: 'featureGrid',              category: 'layout',      tier: 'core' },
  faqAccordion:             { type: 'faqAccordion',             category: 'layout',      tier: 'core' },
  timeline:                 { type: 'timeline',                 category: 'layout',      tier: 'core' },

  // ── Content ───────────────────────────────────────────────────
  richText:                 { type: 'richText',                 category: 'content',     tier: 'core' },
  // AI block is pro — nontrivial LLM cost per render, premium feature
  customAi:                 { type: 'customAi',                 category: 'content',     tier: 'pro' },

  // ── Members — basic CTA is core; anything that reads live member data is pro
  peopleGrid:               { type: 'peopleGrid',               category: 'members',     tier: 'core' },
  membershipCta:            { type: 'membershipCta',            category: 'members',     tier: 'core' },
  membersSearch:            { type: 'membersSearch',            category: 'members',     tier: 'pro' },
  membershipJoinForm:       { type: 'membershipJoinForm',       category: 'members',     tier: 'pro' },

  // ── Events — basic list is core; interactive calendar is pro
  eventList:                { type: 'eventList',                category: 'events',      tier: 'core' },
  eventsCalendar:           { type: 'eventsCalendar',           category: 'events',      tier: 'pro' },

  // ── Tournaments — all pro, these are a core Pro-plan differentiator
  upcomingTournamentsList:  { type: 'upcomingTournamentsList',  category: 'tournaments', tier: 'pro' },
  upcomingTournamentHero:   { type: 'upcomingTournamentHero',   category: 'tournaments', tier: 'pro' },
  tournamentSearch:         { type: 'tournamentSearch',         category: 'tournaments', tier: 'pro' },

  // ── Honour board — pro, requires historical data + search index
  honourBoard:              { type: 'honourBoard',              category: 'honour',      tier: 'pro' },
  honourBoardSearch:        { type: 'honourBoardSearch',        category: 'honour',      tier: 'pro' },

  // ── Venue hire — hero + spaces are core marketing; packages + booking are pro (monetised)
  venueHireHero:            { type: 'venueHireHero',            category: 'venue',       tier: 'core' },
  venueSpaces:              { type: 'venueSpaces',              category: 'venue',       tier: 'core' },
  venuePackages:            { type: 'venuePackages',            category: 'venue',       tier: 'pro' },
  venueBooking:             { type: 'venueBooking',             category: 'venue',       tier: 'pro' },

  // ── Commerce / relationships — all core, lightweight content blocks
  sponsors:                 { type: 'sponsors',                 category: 'commerce',    tier: 'core' },
  bistroMenu:               { type: 'bistroMenu',               category: 'commerce',    tier: 'core' },
  contactForm:              { type: 'contactForm',              category: 'commerce',    tier: 'core' },
}

/**
 * True when the block is unlocked for the given club context:
 *   - `core` blocks are always entitled.
 *   - `pro` blocks need `plan === 'pro'`.
 *   - `addon` blocks need their entitlement id in `clubAddons`.
 *
 * `plan` and `clubAddons` are both optional so callers don't need to
 * normalise. Undefined plan behaves like Starter (locks pro); undefined
 * addons behaves like an empty list (locks every addon block).
 */
export function isBlockEntitled(
  type: BlockType,
  plan: PlanTier | undefined,
  clubAddons: readonly string[] | undefined,
): boolean {
  const entry = BLOCK_CATALOG[type]
  if (entry.tier === 'core') return true
  if (entry.tier === 'pro') return plan === 'pro'
  // addon tier
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
