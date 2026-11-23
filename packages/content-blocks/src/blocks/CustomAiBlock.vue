<script setup lang="ts">
/**
 * CustomAiBlock — renders owner-authored HTML/CSS/JS inside a scoped
 * wrapper. The CRM editor produces these via the Gemini proxy; once
 * saved they render on the public site like any other block.
 *
 * Isolation:
 *  1. The HTML lives inside a wrapper `<div data-torny-ai-scope="<id>">`.
 *  2. The CSS has every selector prefixed with `[data-torny-ai-scope="<id>"]`
 *     at render time so a `.hero` class here can't collide with a `.hero`
 *     on a sibling block.
 *  3. The JS is only evaluated when `allowJs === true`, and runs inside
 *     a `new Function('root', js)(wrapperEl)` call on mount — no SSR,
 *     no top-level script tag, no window-scope pollution guarantee
 *     (admins who want to touch window-level APIs can, that's their
 *     call).
 *
 * Backend sanitisation is assumed — brief 102 §297 already scrubs
 * dangerous HTML attrs on the sending side. We additionally strip
 * `<script>` and `<style>` tags defensively so an accidental paste
 * can't bypass the scoper.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CustomAiPromptEntry } from '../types'
import { sanitizeWebsiteHtml } from '../utils/sanitizeHtml'

// NOTE: props are inlined here (not `CustomAiProps & { blockId }`) because
// Vue's SFC compiler can't resolve intersection types that pull in an
// imported type reference — see
// https://vuejs.org/guide/typescript/composition-api.html#typing-component-props
// ("Complex type and type imports are not fully supported"). Keep in sync
// with `CustomAiProps` in ../types.ts.
const props = defineProps<{
  /** Stable id used to namespace the scoped CSS selectors. Comes from
   *  the block row id in the page layout — stable across SSR and client
   *  hydration so there's no mismatch flash. */
  blockId: string
  html: string
  css: string
  js?: string | null
  allowJs?: boolean
  aiNotes?: string | null
  promptHistory?: CustomAiPromptEntry[]
}>()

const wrapperEl = ref<HTMLElement | null>(null)

/** Prefix every selector with the per-block scope. Walks the CSS with
 *  a tiny brace-depth state machine so nested at-rules (`@media`,
 *  `@supports`) still scope their inner selectors. `@keyframes`, `@font-face`,
 *  and other at-rules that don't contain selectors pass through verbatim.
 *
 *  This is a best-effort scoper, not a full CSS parser. Author-authored
 *  CSS with unusual constructs (CSS nesting, `@scope`, etc.) may not scope
 *  correctly — document rather than silently break. */
function scopeCss(css: string, scope: string): string {
  if (!css) return ''
  const prefix = `[data-torny-ai-scope="${scope}"]`
  let out = ''
  let i = 0
  const n = css.length

  // Skip to the next non-whitespace, non-comment position.
  function skipTrivia(): void {
    while (i < n) {
      const c = css[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
      if (c === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2)
        if (end === -1) { i = n; return }
        out += css.slice(i, end + 2)
        i = end + 2
        continue
      }
      break
    }
  }

  function prefixSelectorList(selectors: string): string {
    return selectors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        if (s.startsWith('[data-torny-ai-scope')) return s
        if (/^(:root|html|body)\b/i.test(s)) return prefix
        return `${prefix} ${s}`
      })
      .join(', ')
  }

  function readBlock(startChar: '{' = '{'): string {
    if (css[i] !== startChar) return ''
    let depth = 0
    const start = i
    do {
      const c = css[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    } while (i < n && depth > 0)
    return css.slice(start, i)
  }

  while (i < n) {
    skipTrivia()
    if (i >= n) break

    if (css[i] === '@') {
      // At-rule — read the prelude up to '{' or ';'
      const atStart = i
      while (i < n && css[i] !== '{' && css[i] !== ';') i++
      const prelude = css.slice(atStart, i)
      const head = prelude.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

      if (i < n && css[i] === ';') {
        // @charset / @import / @namespace — pass through.
        out += prelude + ';'
        i++
        continue
      }

      if (i < n && css[i] === '{') {
        const body = readBlock('{')
        const inner = body.slice(1, -1)
        if (head === '@media' || head === '@supports' || head === '@container') {
          // Recurse into the body so inner selectors still get scoped.
          out += `${prelude.trim()} { ${scopeCss(inner, scope)} }\n`
        } else {
          // @keyframes, @font-face, @page, etc. — pass through unchanged.
          out += `${prelude.trim()} ${body}\n`
        }
        continue
      }

      // Malformed — bail.
      out += prelude
      break
    }

    // Normal rule: read selectors up to '{', then the block.
    const selStart = i
    while (i < n && css[i] !== '{' && css[i] !== '}') i++
    if (i >= n || css[i] === '}') {
      out += css.slice(selStart, i)
      if (i < n) i++
      continue
    }
    const selectors = css.slice(selStart, i).trim()
    if (!selectors) { i++; continue }
    const body = readBlock('{')
    out += `${prefixSelectorList(selectors)} ${body}\n`
  }

  return out
}

const safeHtml = computed(() => sanitizeWebsiteHtml(props.html))
const scopedCss = computed(() => scopeCss(props.css ?? '', props.blockId))

// ── JS execution (opt-in) ──────────────────────────────────────
//
// Only runs client-side, only when `allowJs === true`, only once per
// mount. Re-runs when the JS source or the allow toggle change so an
// admin iterating in the editor sees their changes without a reload.
// Returns a teardown function from the user script (optional) which we
// call on unmount — gives them a place to disconnect listeners.

type Teardown = (() => void) | void
const teardown = ref<Teardown>(undefined)

function runJs(): void {
  teardown.value?.()
  teardown.value = undefined
  if (typeof window === 'undefined') return
  if (!props.allowJs) return
  const src = (props.js ?? '').trim()
  if (!src) return
  const root = wrapperEl.value
  if (!root) return
  try {
    const fn = new Function('root', src) as (root: HTMLElement) => Teardown
    teardown.value = fn(root)
  } catch (err) {
    // Surface in the console so admins see the error while iterating
    // in the editor, but never bubble — one broken block shouldn't
    // crash the whole page.
    if (typeof console !== 'undefined') {
      console.error('[CustomAiBlock] Script error', err)
    }
  }
}

onMounted(runJs)
watch(() => [props.js, props.allowJs], runJs)
onBeforeUnmount(() => {
  teardown.value?.()
})

// ── SSR / hydration ────────────────────────────────────────────
//
// Author-supplied HTML goes through `v-html`. On SSR the server
// serialises it verbatim, but the browser's HTML parser auto-corrects
// invalid nesting (e.g. `<p><div>` → the browser closes the `<p>`
// before the `<div>`). The two DOMs diverge and Vue logs "Hydration
// completed but contains mismatches."
//
// Fix: render the inner content client-only. The outer `<section>` is
// deterministic so SSR still emits a correct shell (good for layout
// above-the-fold); the inner HTML/CSS lands on mount. Minor FOUC on
// initial paint; acceptable trade-off for admin-authored custom
// markup where correctness beats a 50ms flash.
const mounted = ref(false)
onMounted(() => { mounted.value = true })
</script>

<template>
  <section
    ref="wrapperEl"
    class="custom-ai"
    :data-torny-ai-scope="blockId"
  >
    <!-- Inner contents are client-only to avoid hydration mismatches on
         author-supplied HTML (see the SSR / hydration note in <script>). -->
    <template v-if="mounted">
      <!-- Author-supplied CSS, scoped to this instance only. -->
      <component :is="'style'" v-if="scopedCss">{{ scopedCss }}</component>
      <!-- Author-supplied HTML. v-html here is intentional — this is an
           owner-authored custom block and the backend sanitiser is the
           trust boundary for the HTML side. -->
      <div class="custom-ai__root" v-html="safeHtml" />
    </template>
  </section>
</template>

<style scoped>
/* Match the sibling blocks' layout convention: break out of the
 * `.page-blocks` container gutter, then re-apply our own horizontal
 * padding on the inner root. Using the `calc(50% - 50vw)` form so this
 * is container-agnostic (vs. the hardcoded `margin: 0 -48px` other
 * blocks use). Without this, a Custom AI block sits inside the full
 * 48px container gutter + whatever internal padding its own CSS adds,
 * reading as visibly over-indented next to a MediaSplit / Hero. */
.custom-ai {
  position: relative;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  /* Clip any content that overflows the block's own box — stops
   * AI-generated marquees, wide grids, or in-CSS `width: 100vw`
   * attempts from leaking past the viewport edge. */
  overflow: hidden;
  /* `contain: content` keeps author overflow / fixed-position elements
   *  from escaping the block's own rectangle. */
  contain: content;
}

/* Horizontal padding on the inner root so AI content lines up with
 * sibling blocks. Mobile-first — grows with the viewport. The desktop
 * `max()` formula caps content at the design-tokens container width. */
.custom-ai__root {
  padding: 0 20px;
}
@media (min-width: 768px) {
  .custom-ai__root { padding: 0 32px; }
}
@media (min-width: 1024px) {
  .custom-ai__root {
    padding: 0 max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  }
}
</style>
