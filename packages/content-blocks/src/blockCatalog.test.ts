/**
 * Guards for the block catalog — brief 122 §4 + plan-tier gating.
 *
 * The type-level `Record<BlockType, BlockCatalogEntry>` already catches
 * "you added a BlockType but forgot to catalog it" at compile time.
 * These tests cover runtime invariants that TS can't express:
 *   - every entry's `type` field matches its catalog key
 *   - addon entries have an entitlement id; core / pro entries don't
 *   - isBlockEntitled handles every (tier × plan × addons) combination
 */
import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATALOG,
  isBlockEntitled,
  blocksByCategory,
  addonBlocks,
  type BlockCatalogEntry,
} from './blockCatalog'
import type { BlockType } from './types'

describe('block catalog', () => {
  it('every entry\'s `type` matches its key', () => {
    for (const [key, entry] of Object.entries(BLOCK_CATALOG)) {
      expect(entry.type, `catalog key ${key} vs entry.type`).toBe(key)
    }
  })

  it('addon entries have an entitlement id', () => {
    const addons = Object.values(BLOCK_CATALOG).filter((e) => e.tier === 'addon')
    for (const entry of addons) {
      expect(entry.entitlement, `addon ${entry.type} missing entitlement id`).toBeTruthy()
    }
  })

  it('core and pro entries don\'t have an entitlement id (would be confusing)', () => {
    const planTiered = Object.values(BLOCK_CATALOG).filter((e) => e.tier === 'core' || e.tier === 'pro')
    for (const entry of planTiered) {
      expect(entry.entitlement, `${entry.tier} block ${entry.type} shouldn\'t carry an entitlement id`).toBeUndefined()
    }
  })
})

describe('isBlockEntitled — core blocks', () => {
  const coreTypes: BlockType[] = Object.values(BLOCK_CATALOG)
    .filter((e) => e.tier === 'core')
    .map((e) => e.type)

  it('returns true regardless of plan or addons', () => {
    for (const t of coreTypes) {
      expect(isBlockEntitled(t, undefined, undefined), `${t} / no plan / no addons`).toBe(true)
      expect(isBlockEntitled(t, 'starter', []), `${t} / starter`).toBe(true)
      expect(isBlockEntitled(t, 'pro', []), `${t} / pro`).toBe(true)
    }
  })
})

describe('isBlockEntitled — pro blocks', () => {
  // Grab the first catalogued pro block for these tests — brittle to
  // the catalog, but if we ever remove all pro blocks, the gating UX
  // is dead anyway and we'd want to know.
  const proBlock = Object.values(BLOCK_CATALOG).find((e) => e.tier === 'pro')

  it('are entitled when plan is pro', () => {
    if (!proBlock) return expect.fail('expected at least one pro block in the catalog')
    expect(isBlockEntitled(proBlock.type, 'pro', [])).toBe(true)
    expect(isBlockEntitled(proBlock.type, 'pro', ['anything'])).toBe(true)
  })

  it('are NOT entitled when plan is starter or undefined', () => {
    if (!proBlock) return expect.fail('expected at least one pro block in the catalog')
    expect(isBlockEntitled(proBlock.type, 'starter', [])).toBe(false)
    expect(isBlockEntitled(proBlock.type, undefined, [])).toBe(false)
    // An unrelated addon entitlement doesn't magically unlock a pro block
    expect(isBlockEntitled(proBlock.type, 'starter', ['tournaments-pro'])).toBe(false)
  })
})

describe('isBlockEntitled — addon blocks', () => {
  it('returns true when the entitlement is in the addons list', () => {
    // Synthetic addon entry — borrow a real BlockType key, swap its
    // catalog entry for the scope of this test so we don't depend on
    // an addon shipping in the catalog yet.
    const fakeEntry: BlockCatalogEntry = {
      type: 'hero',
      category: 'hero',
      tier: 'addon',
      entitlement: 'test-entitlement',
    }
    const original = BLOCK_CATALOG.hero
    ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = fakeEntry
    try {
      expect(isBlockEntitled('hero', 'starter', ['test-entitlement'])).toBe(true)
      expect(isBlockEntitled('hero', 'pro', ['test-entitlement'])).toBe(true)
      // Addons are plan-independent — a pro plan without the entitlement is still locked.
      expect(isBlockEntitled('hero', 'pro', [])).toBe(false)
      expect(isBlockEntitled('hero', 'starter', [])).toBe(false)
      expect(isBlockEntitled('hero', 'starter', ['other'])).toBe(false)
      expect(isBlockEntitled('hero', undefined, undefined)).toBe(false)
    } finally {
      ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = original
    }
  })

  it('returns false for a misconfigured addon entry (defensive)', () => {
    const broken: BlockCatalogEntry = {
      type: 'hero',
      category: 'hero',
      tier: 'addon',
      // entitlement intentionally missing
    }
    const original = BLOCK_CATALOG.hero
    ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = broken
    try {
      expect(isBlockEntitled('hero', 'pro', ['anything'])).toBe(false)
    } finally {
      ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = original
    }
  })
})

describe('blocksByCategory', () => {
  it('returns every catalogued block for a known category', () => {
    const venue = blocksByCategory('venue')
    const expected = Object.values(BLOCK_CATALOG)
      .filter((e) => e.category === 'venue')
      .map((e) => e.type)
      .sort()
    expect(venue.map((e) => e.type).sort()).toEqual(expected)
    expect(venue.length).toBeGreaterThan(0)
  })
})

describe('addonBlocks', () => {
  it('returns only tier="addon" entries', () => {
    const addons = addonBlocks()
    for (const e of addons) expect(e.tier).toBe('addon')
  })
})
