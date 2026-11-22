# Brief 113a — Follow-up: AI design-system brief should default to contained blocks

**Scope:** one-paragraph edit to the system-prompt brief in the AI generator Lambda bundle. No code change, no new endpoint. Ship as a prompt-only PR.

**Prereq:** brief 113 Phase B shipped (the Gemini proxy Lambda, `POST /clubs/:cid/ai-generate`).

**File to edit:** `src/handlers/ai-custom-block-generate/prompts/ai-design-system.md` in the Venue-stack Lambda bundle (the markdown you ported verbatim from the Nuxt prototype per brief 113 §5.4).

---

## 1. The ask

Flip the brief's default on the "full-bleed + container pattern" so AI-generated blocks sit inside the page container gutter, not break out of it. Full-bleed becomes an opt-in triggered by the admin's prompt, not the baseline.

---

## 2. What triggered it

Live check on `naenae-bowling-club.torny.pro` — an admin-generated Custom AI block renders edge-to-edge while every block above and below it respects `.page-blocks`' ~48px horizontal gutter. Looks visibly off next to a standard hero or event-list block.

The model is doing what we taught it. The brief's §5 "The full-bleed + container pattern" section currently reads:

> Use this when the block has a distinct background (a dark hero, a surface-coloured section). Skip it for inline rich-text / quote blocks that inherit the page background.

That's a reasonable description of the pattern, but it's being over-applied. The model treats "distinct background" generously — any section with a coloured surface qualifies, which is most of them.

The context the model doesn't have: every Custom AI block is rendered *inside* `.page-blocks`, which already provides the container-aligned horizontal padding. The full-bleed trick (`width: 100vw; margin-left: calc(50% - 50vw)`) exists so Vue-authored blocks can break out of that padding when they need to run a dark background to the viewport edge — it's a workaround, not a default.

---

## 3. The edit

Replace §5's "The full-bleed + container pattern" block with:

```md
### The default is contained — the page container handles the gutter

Every Custom AI block is mounted inside a page container that already
provides horizontal padding aligned with the rest of the site (~20px
mobile, ~32px tablet, ~48px+ desktop, maxing content at 1280px).

**Default behaviour:** write CSS that assumes the block sits inside
this container. Use normal padding on the outer `<section>`:

```css
.block {
  padding: 64px 0;
  background: var(--color-ground);
}
```

The horizontal 0 means "take the container's gutter"; the vertical
64px (scale with breakpoints) sets the block's own rhythm.

### Full-bleed is opt-in only

Only use the full-bleed break-out pattern (`width: 100vw;
margin-left: calc(50% - 50vw); padding: 128px max(48px, calc((100vw
 - 1280px) / 2));`) when the admin's prompt explicitly asks for an
edge-to-edge hero or a full-width coloured band. Keywords that
qualify: "full-bleed", "edge to edge", "full width hero", "dark band
across the page".

If the prompt doesn't use any of those, the block is contained.
```

Also strip the current full-bleed code sample from the "SPACING & LAYOUT" section of the system-prompt rules — it's been encouraging the pattern implicitly by being the only concrete padding example.

---

## 4. Rationale

- **Consistency wins.** The admin picks a Custom AI block to fill a long-tail layout gap, not to break out of their site's rhythm. The default should match the rest of the page.
- **The dramatic break-out is still available.** Admins who want an edge-to-edge hero can say so — "a full-bleed dark hero with a bowls green texture" — and the model flips into the pattern.
- **Zero FE change.** The CustomAiBlock renderer and page container stay as-is. The design-tokens scoping, the CSS prefixing, the HTML sanitisation — none of it moves. One markdown edit.

---

## 5. Verification

After the Lambda redeploys with the edited brief:

- Generate a block with a plain prompt — *"a short welcome section with a heading and two sentences"*. Expect: block's outer section uses `padding: 48-64px 0` (or similar), inherits the page container's horizontal gutter, visually aligns with sibling blocks.
- Generate a block with an explicit full-bleed prompt — *"a full-bleed dark hero with a bold headline and one CTA"*. Expect: block uses the `width: 100vw` break-out pattern. Edge-to-edge dark background.
- Re-generate the block that triggered this brief against the updated prompt. The new output should sit inside the gutter.

No per-field validation or shape changes — this is pure prompt tuning.

---

## 6. Non-goals

- A `fullBleed: boolean` prop on the Custom AI block schema. The brief handles this via prompt interpretation; adding a toggle duplicates state.
- Renderer-side clipping or `max-width` enforcement on our side. If the model misbehaves, the fix is more prompt work, not CSS defence.
- Retraining / fine-tuning. Prompt edit only.
