import { describe, it, expect } from 'vitest'

describe('vitest smoke test', () => {
  it('arithmetic still works', () => {
    expect(1 + 1).toBe(2)
  })
  it('jsdom is available', () => {
    const el = document.createElement('div')
    el.textContent = 'hello'
    expect(el.textContent).toBe('hello')
  })
  it('setup stubbed the token', () => {
    expect(localStorage.getItem('torny.token')).toBe('test-token')
  })
})
