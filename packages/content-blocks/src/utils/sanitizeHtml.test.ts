/**
 * Pins the shape of the website-content sanitiser so a future config
 * tweak (loosening ALLOWED_TAGS, forgetting a FORBID_ATTR entry, etc.)
 * can't silently re-open an XSS path. If a test here needs to change,
 * the change should come with a reason — see
 * docs/production-readiness/01b-xss-sanitize-content-blocks.md.
 *
 * Mirrors apps/crm/src/__tests__/sanitizeHtml.test.ts in spirit but
 * for the website trust model (semantic structure tags allowed,
 * anchors not forcibly rewritten to target=_blank — because a block
 * author may deliberately want same-tab navigation to their About
 * page).
 */
import { describe, it, expect } from 'vitest'
import { sanitizeWebsiteHtml } from './sanitizeHtml'

describe('sanitizeWebsiteHtml', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(sanitizeWebsiteHtml(null)).toBe('')
    expect(sanitizeWebsiteHtml(undefined)).toBe('')
    expect(sanitizeWebsiteHtml('')).toBe('')
  })

  it('strips <script> tags entirely', () => {
    const out = sanitizeWebsiteHtml('<p>safe</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
    expect(out).toContain('<p>safe</p>')
  })

  it('strips inline event handlers (onerror, onclick, onload, onmouseover)', () => {
    const out = sanitizeWebsiteHtml(
      '<img src="x" onerror="alert(1)" /><a href="#" onclick="alert(2)">x</a><div onmouseover="alert(3)">y</div>',
    )
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onmouseover')
    expect(out).not.toContain('alert')
  })

  it('strips javascript: URLs on anchors', () => {
    const out = sanitizeWebsiteHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('alert')
  })

  it('strips <iframe>, <object>, <embed>, <form>, <noscript>', () => {
    const out = sanitizeWebsiteHtml(
      '<iframe src="evil"></iframe><object data="evil"></object><embed src="evil" /><form action="evil"></form><noscript>x</noscript>',
    )
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<embed')
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<noscript')
  })

  it('keeps semantic structure tags: article, section, header, footer, nav, aside', () => {
    const input =
      '<article><header><h2>Title</h2></header><section><p>body</p></section><aside>side</aside><footer>end</footer></article>'
    const out = sanitizeWebsiteHtml(input)
    expect(out).toContain('<article>')
    expect(out).toContain('<header>')
    expect(out).toContain('<section>')
    expect(out).toContain('<aside>')
    expect(out).toContain('<footer>')
    expect(out).toContain('<h2>Title</h2>')
  })

  it('keeps tables with structure', () => {
    const out = sanitizeWebsiteHtml(
      '<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>val</td></tr></tbody></table>',
    )
    expect(out).toContain('<table>')
    expect(out).toContain('<thead>')
    expect(out).toContain('<tbody>')
    expect(out).toContain('<th>Col</th>')
    expect(out).toContain('<td>val</td>')
  })

  it('keeps legitimate text formatting and links', () => {
    const input =
      '<p>Hi <strong>everyone</strong>, see <a href="https://torny.co.nz">our site</a>.</p>'
    const out = sanitizeWebsiteHtml(input)
    expect(out).toContain('<p>')
    expect(out).toContain('<strong>everyone</strong>')
    expect(out).toContain('href="https://torny.co.nz"')
  })

  it('allows data: image URIs (for inline author-pasted images)', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const out = sanitizeWebsiteHtml(`<img src="${png}" alt="" />`)
    expect(out).toContain('src="data:image/png;base64')
  })

  it('allows loading="lazy" on images (perf hint)', () => {
    const out = sanitizeWebsiteHtml('<img src="https://cdn.example/logo.png" alt="logo" loading="lazy" />')
    expect(out).toContain('loading="lazy"')
    expect(out).toContain('src="https://cdn.example/logo.png"')
  })

  it('strips svg with embedded script (classic bypass)', () => {
    const out = sanitizeWebsiteHtml('<svg><script>alert(1)</script></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
  })

  it('strips srcdoc on iframes (belt and braces — iframe is already forbidden)', () => {
    const out = sanitizeWebsiteHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>')
    expect(out).not.toContain('srcdoc')
    expect(out).not.toContain('<iframe')
  })

  it('strips formaction (clickjack vector on buttons)', () => {
    const out = sanitizeWebsiteHtml('<button formaction="javascript:alert(1)">x</button>')
    // buttons are forbidden anyway; double-check formaction is stripped
    // even if a future config decides to allow buttons
    expect(out).not.toContain('formaction')
    expect(out).not.toContain('javascript:')
  })

  it('preserves data-* attributes (author block hooks sometimes rely on these)', () => {
    const out = sanitizeWebsiteHtml('<div data-torny-hook="foo" data-id="42">x</div>')
    expect(out).toContain('data-torny-hook="foo"')
    expect(out).toContain('data-id="42"')
  })
})
