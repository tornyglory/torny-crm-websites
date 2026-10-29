/**
 * Global test setup. Runs before every test file.
 *
 * - Stubs localStorage so api-client's `readToken()` (which reads
 *   `torny.token`) can't blow up in jsdom.
 * - Stubs ResizeObserver / IntersectionObserver so modal + chart
 *   components mount without polyfills.
 */
import { vi } from 'vitest'

// jsdom provides localStorage, but stub token to a known value so any
// authedFetch mock gets a predictable Authorization header.
localStorage.setItem('torny.token', 'test-token')

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

// jsdom doesn't ship these — stub them so modal + chart components mount.
;(globalThis as unknown as { ResizeObserver: typeof StubObserver }).ResizeObserver = StubObserver
;(globalThis as unknown as { IntersectionObserver: typeof StubObserver }).IntersectionObserver = StubObserver

// Silence Vue's "unknown component" warnings during tests; mount({ global: { stubs } })
// is a clearer place to opt into them.
vi.spyOn(console, 'warn').mockImplementation((msg: unknown) => {
  const s = String(msg)
  if (s.includes('[Vue warn]: Failed to resolve component')) return
  // Pass everything else through so real warnings surface.
  console.info(msg)
})
