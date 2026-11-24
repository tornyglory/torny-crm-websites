/**
 * Shared setup for api-client vitest. Stubs localStorage so tests
 * don't bleed state across files (jsdom gives a persistent one by
 * default). Any suite that needs a specific token should
 * `localStorage.setItem('torny.token', '…')` in its `beforeEach`.
 */
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
})
