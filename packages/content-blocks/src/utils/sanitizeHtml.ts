/**
 * HTML sanitiser for block content rendered on public club sites.
 *
 * Two render contexts use this helper:
 *   1. Vite SPA (the CRM block editor preview)
 *   2. Nuxt SSR + CSR (public club sites: apps/club-sites)
 *
 * We use `sanitize-html` (pure JS, no DOM dependency) because the
 * public sites deploy to Cloudflare Workers / Pages where jsdom doesn't
 * run. The previous `isomorphic-dompurify` approach crashed SSR cold
 * starts with "Cannot read properties of undefined (reading 'bind')"
 * — jsdom silently failed to initialise, DOMPurify was left as a stub,
 * and the module-level bind calls took the whole worker down. See the
 * commit that landed this file for the full trace.
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
import sanitizeHtml from 'sanitize-html'

const WEBSITE_SAFE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
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
  allowedAttributes: {
    '*': [
      'alt', 'class', 'href', 'id', 'rel', 'src', 'srcset', 'sizes',
      'style', 'target', 'title', 'width', 'height', 'loading', 'colspan',
      'rowspan', 'align', 'valign', 'media', 'type', 'datetime', 'cite',
      // data-* attributes — common in block-authored content for hooks
      // / custom targeting. sanitize-html supports the `data-*` wildcard.
      'data-*',
    ],
  },
  // Allow https, http, mailto, tel, data: (images only). Everything
  // else (javascript:, file:, etc.) gets stripped.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  allowProtocolRelative: false,
  parseStyleAttributes: false,
}

/**
 * Sanitise HTML for rendering via `v-html` on a public club site or
 * in the CRM block editor preview. Empty / nullish input returns an
 * empty string so call sites don't need to null-guard.
 */
export function sanitizeWebsiteHtml(html: string | null | undefined): string {
  if (!html) return ''
  return sanitizeHtml(html, WEBSITE_SAFE_CONFIG)
}
