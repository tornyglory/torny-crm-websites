import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from '@/utils/sanitizeHtml'

/**
 * These tests pin the shape of the sanitiser so a future config tweak
 * (loosening ALLOWED_TAGS / FORBID_ATTR etc.) can't silently re-open an
 * XSS path. If a test here needs to change, the change should come with
 * a reason — see docs/production-readiness/01-xss-sanitize-html.md.
 */
describe('sanitizeEmailHtml', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(sanitizeEmailHtml(null)).toBe('')
    expect(sanitizeEmailHtml(undefined)).toBe('')
    expect(sanitizeEmailHtml('')).toBe('')
  })

  it('strips <script> tags entirely', () => {
    const out = sanitizeEmailHtml('<p>hello</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
    expect(out).toContain('<p>hello</p>')
  })

  it('strips inline event handlers (onerror, onclick, onload)', () => {
    const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)" /><a href="#" onclick="alert(2)">x</a>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert')
  })

  it('strips javascript: URLs on anchors', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('alert')
  })

  it('strips <iframe>, <object>, <embed>, <form>', () => {
    const out = sanitizeEmailHtml(
      '<iframe src="evil"></iframe><object data="evil"></object><embed src="evil" /><form action="evil"></form>',
    )
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<embed')
    expect(out).not.toContain('<form')
  })

  it('keeps legitimate email HTML: paragraphs, bold, links, lists, inline images', () => {
    const input =
      '<p>Hi <strong>Fran</strong>,</p><ul><li>Item</li></ul>' +
      '<a href="https://torny.co.nz">Visit</a>' +
      '<img src="https://cdn.example.com/logo.png" alt="logo" />'
    const out = sanitizeEmailHtml(input)
    expect(out).toContain('<p>')
    expect(out).toContain('<strong>Fran</strong>')
    expect(out).toContain('<li>Item</li>')
    expect(out).toContain('href="https://torny.co.nz"')
    expect(out).toContain('src="https://cdn.example.com/logo.png"')
    expect(out).toContain('alt="logo"')
  })

  it('forces external anchors to open with noopener noreferrer target=_blank', () => {
    const out = sanitizeEmailHtml('<a href="https://evil.example">x</a>')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('target="_blank"')
  })

  it('allows mailto: and tel: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="mailto:x@y.z">mail</a><a href="tel:+64211234567">call</a>')
    expect(out).toContain('href="mailto:x@y.z"')
    expect(out).toContain('href="tel:+64211234567"')
  })

  it('allows data: image URIs (for inline signature images)', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const out = sanitizeEmailHtml(`<img src="${png}" alt="" />`)
    expect(out).toContain('src="data:image/png;base64')
  })

  it('strips svg with embedded script (classic bypass)', () => {
    const out = sanitizeEmailHtml('<svg><script>alert(1)</script></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
  })

  it('strips srcdoc on iframes (even if iframe survived — belt and braces)', () => {
    const out = sanitizeEmailHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>')
    expect(out).not.toContain('srcdoc')
    expect(out).not.toContain('<iframe')
  })
})
