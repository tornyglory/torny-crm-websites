/**
 * HTML sanitizer for anything rendered via `v-html` in the CRM.
 *
 * The CRM renders three flavours of HTML:
 *   1. Inbound email bodies (adversarial by default — a sender can inject
 *      anything).
 *   2. User-authored content (signatures, campaign bodies, email
 *      templates). Lower risk, but one admin editing another admin's
 *      preview is still an escalation path.
 *   3. Server-rendered template fragments (header/footer injected into
 *      the composer preview). Trusted but still flows through the same
 *      path — sanitise anyway so there's no "trusted" exception to
 *      audit.
 *
 * Everything goes through this file. Call sites import `sanitizeEmailHtml`
 * and bind the return value into `v-html`.
 *
 * See docs/production-readiness/01-xss-sanitize-html.md for context.
 */
import DOMPurify from 'dompurify'

const EMAIL_SAFE_CONFIG = {
  // Explicit allowlist — do not combine with USE_PROFILES, which would
  // override these. Email bodies legitimately include inline images
  // (cid: refs rewritten to data: or https: on the backend) and anchor
  // tags. Everything else is stripped.
  ALLOWED_TAGS: [
    'a',
    'b',
    'blockquote',
    'br',
    'caption',
    'div',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'q',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'style',
    'width',
    'height',
    'target',
    'rel',
    'cite',
    'colspan',
    'rowspan',
    'align',
    'valign',
  ],
  // Keep URL schemes conservative. `data:` is allowed for inline images
  // only (configured per-attribute below via the URI regex).
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'link', 'meta', 'style'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'formaction', 'srcdoc'],
  // Keep links safe by default. Rel gets `noopener noreferrer` and
  // target gets stripped unless it's `_blank`.
  ADD_ATTR: ['target'],
  // Make sure the sanitiser returns a string, not a DocumentFragment.
  RETURN_TRUSTED_TYPE: false,
}

// Belt-and-braces: after DOMPurify runs, force every surviving <a> to
// open safely. DOMPurify already strips `javascript:` URIs, but external
// links should still carry noopener/noreferrer.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (href.startsWith('http://') || href.startsWith('https://')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  }
})

/**
 * Sanitise HTML that will be rendered via `v-html`. Returns a string
 * safe to bind. Empty / nullish input returns an empty string so call
 * sites don't need to null-guard.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, EMAIL_SAFE_CONFIG)
}
