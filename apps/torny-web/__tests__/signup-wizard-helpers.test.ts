/**
 * Unit tests for the pure helpers used by the signup wizard
 * (apps/torny-web/composables/useSignupWizard.ts).
 *
 * The composable itself depends on Nuxt's `useState` auto-import — that
 * part is exercised in Playwright. These tests cover the exported pure
 * functions: `slugify` and `defaultPlanFor`.
 */
import { describe, expect, it } from 'vitest'
import { defaultPlanFor, slugify } from '../composables/useSignupWizard'

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Thorndon Bowling Club')).toBe('thorndon-bowling-club')
  })

  it('strips punctuation', () => {
    expect(slugify("St Mark's Hall, Wellington")).toBe('st-mark-s-hall-wellington')
    expect(slugify('The Pavilion @ Oriental Bay')).toBe('the-pavilion-oriental-bay')
  })

  it('collapses runs of non-alphanumeric chars to a single hyphen', () => {
    expect(slugify('A   lot    of    spaces')).toBe('a-lot-of-spaces')
    expect(slugify('weird//punct$$chars')).toBe('weird-punct-chars')
  })

  it('removes leading and trailing hyphens', () => {
    expect(slugify('-starts with dash-')).toBe('starts-with-dash')
    expect(slugify('!!!shouting!!!')).toBe('shouting')
  })

  it('respects the 30-char cap', () => {
    // 50 "a"s → 30 "a"s
    const long = 'a'.repeat(50)
    const result = slugify(long)
    expect(result.length).toBe(30)
    expect(result).toBe('a'.repeat(30))
  })

  it('empty / whitespace-only inputs collapse to empty', () => {
    expect(slugify('')).toBe('')
    expect(slugify('    ')).toBe('')
    expect(slugify('!!!!')).toBe('')
  })

  it('handles unicode by stripping it (ASCII-only slug)', () => {
    expect(slugify('Café Soleil')).toBe('caf-soleil')
    expect(slugify('Naenae & Taitā RSA')).toBe('naenae-tait-rsa')
  })
})

describe('defaultPlanFor', () => {
  it('returns Pro for revenue-generating venue orgs', () => {
    expect(defaultPlanFor('sports_and_recreation')).toBe('pro')
    expect(defaultPlanFor('community_and_civic')).toBe('pro')
    expect(defaultPlanFor('holiday_accommodation')).toBe('pro')
    expect(defaultPlanFor('events_venue')).toBe('pro')
  })

  it('returns Starter for lighter-weight orgs', () => {
    expect(defaultPlanFor('fitness_and_wellness')).toBe('starter')
    expect(defaultPlanFor('arts_and_culture')).toBe('starter')
    expect(defaultPlanFor('youth_groups')).toBe('starter')
    expect(defaultPlanFor('hospitality')).toBe('starter')
    expect(defaultPlanFor('non_profit')).toBe('starter')
    expect(defaultPlanFor('other')).toBe('starter')
  })

  it('returns Starter for null (nothing picked yet)', () => {
    expect(defaultPlanFor(null)).toBe('starter')
  })
})
