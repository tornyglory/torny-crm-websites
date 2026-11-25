/**
 * Pure-helper tests for server/utils/tornyApi.ts.
 *
 * The Nitro / Nuxt-bound functions (resolveClubForHost, fetchSite,
 * tornyFetch, etc.) need a full Nuxt test runtime (@nuxt/test-utils)
 * and are deferred — once those get coverage, they'll land in the
 * same `__tests__` directory next to this file. For now we pin the
 * two building blocks the Nuxt-bound code sits on:
 *
 *   - normaliseHost — canonicalises the host key before cache
 *     lookup. A silent change here would fragment the tenant cache
 *     and let the same club resolve twice from different cache rows.
 *   - unwrapFacets — accepts three backend envelope shapes and
 *     drops a Record<string, unknown>-shaped payload rather than
 *     throwing on nulls. The inline comment in tornyApi.ts explicitly
 *     flags "don't silently drop rows when the shape shifts" — this
 *     test is the shape pin.
 */
import { describe, it, expect } from 'vitest'
import { normaliseHost, unwrapFacets } from '../tornyApiHelpers'

describe('normaliseHost', () => {
  it('lowercases the host', () => {
    expect(normaliseHost('NaenaeBowls.torny.pro')).toBe('naenaebowls.torny.pro')
  })

  it('strips a leading www.', () => {
    expect(normaliseHost('www.naenaebowls.co.nz')).toBe('naenaebowls.co.nz')
  })

  it('strips a trailing port', () => {
    expect(normaliseHost('naenaebowls.torny.pro:443')).toBe('naenaebowls.torny.pro')
  })

  it('does all three on a nasty-case input at once', () => {
    expect(normaliseHost('WWW.NAENAEBOWLS.CO.NZ:8080')).toBe('naenaebowls.co.nz')
  })

  it('leaves a clean host unchanged', () => {
    expect(normaliseHost('naenaebowls.co.nz')).toBe('naenaebowls.co.nz')
  })

  it('does not strip a www inside the hostname (only a leading www.)', () => {
    // E.g. `wwwclub.example` is a legit different host — not `www.club`.
    expect(normaliseHost('wwwclub.example')).toBe('wwwclub.example')
  })
})

describe('unwrapFacets', () => {
  const FACET_A = { id: 1, slug: 'a', label: 'A' }
  const FACET_B = { id: 2, slug: 'b', label: 'B' }

  it('returns a bare array verbatim', () => {
    expect(unwrapFacets([FACET_A, FACET_B])).toEqual([FACET_A, FACET_B])
  })

  it('unwraps { facets: [...] }', () => {
    expect(unwrapFacets({ facets: [FACET_A] })).toEqual([FACET_A])
  })

  it('unwraps { rows: [...] }', () => {
    expect(unwrapFacets({ rows: [FACET_B] })).toEqual([FACET_B])
  })

  it('unwraps { items: [...] }', () => {
    expect(unwrapFacets({ items: [FACET_A, FACET_B] })).toEqual([FACET_A, FACET_B])
  })

  it('returns [] when none of the known keys match', () => {
    expect(unwrapFacets({ something_else: [FACET_A] })).toEqual([])
  })

  it('returns [] on null', () => {
    expect(unwrapFacets(null)).toEqual([])
  })

  it('returns [] on undefined', () => {
    expect(unwrapFacets(undefined)).toEqual([])
  })

  it('returns [] on a string / number / boolean', () => {
    expect(unwrapFacets('not-a-facet-list')).toEqual([])
    expect(unwrapFacets(42)).toEqual([])
    expect(unwrapFacets(true)).toEqual([])
  })

  it('returns [] when a known key holds a non-array (never silently drops rows)', () => {
    // Guards against a backend shape change that puts an object under
    // `facets` instead of an array — we'd rather return empty than crash.
    expect(unwrapFacets({ facets: { nested: 'oops' } })).toEqual([])
  })
})
