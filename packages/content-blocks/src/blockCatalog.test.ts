/**
 * Guards for the block catalog — brief 122 §4.
 *
 * The type-level `Record<BlockType, BlockCatalogEntry>` already catches
 * "you added a BlockType but forgot to catalog it" at compile time.
 * These tests cover runtime invariants that TS can't express:
 *   - every entry's `type` field matches its catalog key
 *   - addon entries have an entitlement id; core entries don't
 *   - isBlockEntitled handles every combination correctly
 */
import { describe, it, expect } from 'vitest'
import {
  BLOCK_CATALOG,
  isBlockEntitled,
  blocksByCategory,
  addonBlocks,
  type BlockCatalogEntry,
} from './blockCatalog'

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

  it('core entries don\'t have an entitlement id (would be confusing)', () => {
    const core = Object.values(BLOCK_CATALOG).filter((e) => e.tier === 'core')
    for (const entry of core) {
      expect(entry.entitlement, `core block ${entry.type} shouldn\'t carry an entitlement id`).toBeUndefined()
    }
  })
})

describe('isBlockEntitled', () => {
  it('returns true for every core block regardless of addons list', () => {
    const coreTypes = Object.values(BLOCK_CATALOG)
      .filter((e) => e.tier === 'core')
      .map((e) => e.type)
    for (const t of coreTypes) {
      expect(isBlockEntitled(t, []), `${t} with empty addons`).toBe(true)
      expect(isBlockEntitled(t, undefined), `${t} with undefined addons`).toBe(true)
      expect(isBlockEntitled(t, ['tournaments-pro']), `${t} with unrelated addon`).toBe(true)
    }
  })

  it('returns true for an addon block when the entitlement is in the list', () => {
    // Construct a synthetic addon entry so the test doesn't depend on
    // the catalog actually having an addon shipped yet.
    const fakeEntry: BlockCatalogEntry = {
      type: 'hero', // borrow a real BlockType — isBlockEntitled reads the catalog
      category: 'hero',
      tier: 'addon',
      entitlement: 'test-entitlement',
    }
    // Monkey-patch for the duration of this test — avoid in prod code,
    // but acceptable in a unit test that owns its state.
    const original = BLOCK_CATALOG.hero
    ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = fakeEntry
    try {
      expect(isBlockEntitled('hero', ['test-entitlement'])).toBe(true)
      expect(isBlockEntitled('hero', ['other-entitlement'])).toBe(false)
      expect(isBlockEntitled('hero', [])).toBe(false)
      expect(isBlockEntitled('hero', undefined)).toBe(false)
    } finally {
      ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = original
    }
  })

  it('returns false for a misconfigured addon entry (defensive)', () => {
    const broken: BlockCatalogEntry = {
      type: 'hero',
      category: 'hero',
      tier: 'addon',
      // entitlement intentionally missing — a catalog misconfig
    }
    const original = BLOCK_CATALOG.hero
    ;(BLOCK_CATALOG as Record<string, BlockCatalogEntry>).hero = broken
    try {
      expect(isBlockEntitled('hero', ['anything'])).toBe(false)
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
