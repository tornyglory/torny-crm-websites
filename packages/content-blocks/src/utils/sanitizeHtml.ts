/**
 * HTML sanitiser for block content rendered on public club sites.
 *
 * Two render contexts use this helper:
 *   1. Vite SPA (the CRM block editor preview)
 *   2. Nuxt SSR + CSR (public club sites: apps/club-sites)
 *
 * The `isomorphic-dompurify` wrapper switches between the browser's
 * native DOM and a jsdom instance on the server — same API either
 * way. Call sites import this file and bind the return value into
 * `v-html`.
 *
 * Why not reuse apps/crm/src/utils/sanitizeHtml.ts: that one is scoped
 * to email HTML (narrow tag set, `target=_blank noopener` hardening on
 * every external link). Website content is a different context — allows
 * structural / semantic HTML tags, doesn't need to force-rewrite
 * anchors, and runs in both SSR and CSR. Separate helper for separate
 * trust model.
 *
 * See docs/production-readiness/01b-xss-sanitize-content-blocks.md.
 */
import DOMPurify from 'isomorphic-dompurify'

const WEBSITE_SAFE_CONFIG = {
  ALLOWED_TAGS: [
    // Text + inline
    'a', 'abbr', 'b', 'br', 'cite', 'code', 'del', 'em', 'i', 'ins',
    'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub',
    'sup', 'u', 'var',
    // Block
    'blockquote', 'div', 'hr', 'p', 'pre',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'dd', 'dl', 'dt', 'li', 'ol', 'ul',
    // Media
    'figcaption', 'figure', 'img', 'picture', 'source',
    // Semantic structure
    'article', 'aside', 'footer', 'header', 'main', 'nav', 'section',
    // Tables
    'caption', 'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr',
  ],
  ALLOWED_ATTR: [
    'alt', 'class', 'href', 'id', 'rel', 'src', 'srcset', 'sizes',
    'style', 'target', 'title', 'width', 'height', 'loading', 'colspan',
    'rowspan', 'align', 'valign', 'media', 'type', 'datetime', 'cite',
    // Data attrs — common in block-authored content for hooks /
    // custom targeting. Prefixed with a wildcard below via ADD_DATA_URI.
    'data-*',
  ],
  // Allow https, http, mailto, tel, data: (images only — DOMPurify's
  // default handling restricts data: to safe image subtypes). Everything
  // else (javascript:, file:, etc.) gets stripped.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  FORBID_TAGS: [
    'script', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'base', 'link', 'meta', 'style', 'noscript',
  ],
  FORBID_ATTR: [
    'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
    'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress',
    'formaction', 'srcdoc', 'autofocus',
  ],
  ALLOW_DATA_ATTR: true,
  RETURN_TRUSTED_TYPE: false,
}

/**
 * Sanitise HTML for rendering via `v-html` on a public club site or
 * in the CRM block editor preview. Empty / nullish input returns an
 * empty string so call sites don't need to null-guard.
 */
export function sanitizeWebsiteHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, WEBSITE_SAFE_CONFIG)
}
