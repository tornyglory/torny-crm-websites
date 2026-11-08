# Site Style owns radius; Image Style owns treatment; Accent is the button colour

**Feature:** reshape the Brand tab so each picker has one obvious job. Right now the three pickers (Site Style, Image Style, Colours) overlap — Site Style sets radius for cards + buttons, Image Style sets radius for images, and admins can't tell which one to change when they want "all my corners the same." Simplified roles:

- **Site Style** → owns border radius across the whole site: buttons, cards, **and images**.
- **Image Style** → owns **image treatment only**: filter (saturation / grayscale), scrim gradient, duotone overlay. No radius knobs.
- **Brand → Accent** → the button colour. (Already wired this way — just confirming the final shape.)

**Status:** backend-side there's nothing to do. This is a design-tokens refactor + a two-line useTheme change. Brief filed under the same numbering so the pattern stays consistent.

**Related:**
- Brief 79 — introduced Image Style presets (Soft / Studio / Archive).
- Brief 81 — Brand → Primary + Accent overrides.
- Site Style presets — already live (Editorial / Sharp / Soft / Rounded / Classic) with per-preset `radius` tokens served from the `/site` hydrate.

---

## Why the change

Admins currently see two radius knobs:

1. **Image Style → Soft/Studio/Archive** — each preset sets `--image-radius-sm/md/lg` to different pixel values.
2. **Site Style → Editorial/Sharp/Rounded/Classic** — each preset sets `--radius-sm/md/lg` via `useTheme`'s `styleDeclarations`.

If an admin picks "Sharp" for the site (tight 4px corners) and "Soft" for images (16px corners), the public site gets tight square buttons next to pillow-rounded photos — clashes visually.

The fix: Site Style's `radius.{sm,md,lg}` drive both the general and image radii. Image Style stops touching corners altogether.

---

## 1. `packages/design-tokens/src/tokens.css`

### Drop image-radius from the Image Style presets

Each `[data-image-style="…"]` block currently sets `--image-radius-sm/md/lg`. Remove those three lines from every preset. The `:root` defaults stay in place as a safety net.

**Before (example — `studio`):**
```css
[data-image-style='studio'] {
  --image-radius-sm: 4px;
  --image-radius-md: 8px;
  --image-radius-lg: 14px;
  --image-ring: none;
  --image-filter: saturate(1.06) contrast(1.06) brightness(1.02);
  --image-scrim: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.65) 100%);
  --image-overlay-color: transparent;
  --image-overlay-opacity: 0;
}
```

**After:**
```css
[data-image-style='studio'] {
  --image-ring: none;
  --image-filter: saturate(1.06) contrast(1.06) brightness(1.02);
  --image-scrim: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.65) 100%);
  --image-overlay-color: transparent;
  --image-overlay-opacity: 0;
}
```

Same cleanup for `soft` (which currently matches `:root` defaults and can stay / be deleted) and `archive`.

Leave the `:root` defaults at the top of tokens.css so a block that reads `--image-radius-md` still gets a sensible number if Site Style hasn't shipped its radii yet.

---

## 2. `apps/club-sites/composables/useTheme.ts`

Extend `styleDeclarations` so Site Style's radii drive image radii in parallel.

**Before:**
```ts
function styleDeclarations(style: SiteStyle): string[] {
  return [
    `--radius-xs: ${style.radius.xs}px !important;`,
    `--radius-sm: ${style.radius.sm}px !important;`,
    `--radius-md: ${style.radius.md}px !important;`,
    `--radius-lg: ${style.radius.lg}px !important;`,
    `--radius-pill: ${style.radius.pill}px !important;`,
    `--card-bg: ${cardBgVar(style.cards.background)} !important;`,
    `--card-border: ${cardBorderVar(style.cards.border)} !important;`,
    `--card-shadow: ${cardShadowVar(style.cards.shadow)} !important;`,
    `--btn-radius: ${style.buttons.radius}px !important;`,
  ]
}
```

**After:**
```ts
function styleDeclarations(style: SiteStyle): string[] {
  return [
    `--radius-xs: ${style.radius.xs}px !important;`,
    `--radius-sm: ${style.radius.sm}px !important;`,
    `--radius-md: ${style.radius.md}px !important;`,
    `--radius-lg: ${style.radius.lg}px !important;`,
    `--radius-pill: ${style.radius.pill}px !important;`,
    // Image radii shadow the general radii — Site Style now drives both,
    // so a preset's "sharp corners" feel applies to photos too (brief 82).
    `--image-radius-sm: ${style.radius.sm}px !important;`,
    `--image-radius-md: ${style.radius.md}px !important;`,
    `--image-radius-lg: ${style.radius.lg}px !important;`,
    `--card-bg: ${cardBgVar(style.cards.background)} !important;`,
    `--card-border: ${cardBorderVar(style.cards.border)} !important;`,
    `--card-shadow: ${cardShadowVar(style.cards.shadow)} !important;`,
    `--btn-radius: ${style.buttons.radius}px !important;`,
  ]
}
```

Three lines added.

---

## 3. Confirm the accent → button mapping (no change)

Already wired per brief 81:

- `brand_accent` → `--color-accent-strong` (via useTheme).
- Primary CTA buttons across the blocks consume `var(--color-accent-strong, var(--color-ink))` — sweep landed in commit `2ddaf62`.

Keep the mapping. Nothing to do here — just noting it so the model is explicit:

| Admin picker | Public-site effect |
|---|---|
| Brand → Primary | `--color-accent` (dots, pills, link states, selected checkboxes, icon tints — anything the blocks already paint with the accent token) |
| Brand → Accent | `--color-accent-strong` (primary CTA button background on every page) |
| Site Style | Border radii (buttons, cards, images), card background / border / shadow treatment |
| Image Style | Photo filter (saturation / grayscale), scrim gradient, duotone overlay, inset ring — but **not** corners |

---

## 4. Verification

1. Set Site Style = "Sharp" and Image Style = "Soft". Confirm images render with tight (sharp) corners, not the old 16px pillow radius. Image tone (filter / overlay) still comes from the Image Style preset.
2. Set Site Style = "Rounded" and Image Style = "Studio". Confirm images are rounded AND crisp-filtered (studio's saturation + contrast bump).
3. Reset Image Style to default. Confirm no radius regression — radii driven entirely by Site Style now.
4. Flip Accent colour in Brand → Colours. Confirm every primary CTA (hero "Plan your visit", header "Join the club", venue "Pay deposit", events "Book", etc.) updates to the picked hex.

Pass criteria:
- ✓ Image Style no longer changes corner radii on photos.
- ✓ Switching Site Style changes buttons, cards, AND images together.
- ✓ Primary accent still paints the pills + dots across blocks.
- ✓ Secondary accent still paints the CTA button background.

---

## 5. Non-goals

- **No Site Style additions.** The five presets stay as they are.
- **No new image-radius picker.** The whole point is one knob per concern.
- **No CRM UI changes beyond copy.** The Site Style and Image Style cards stay in place; I'll just update the lede copy on the Image Style picker so admins know it only touches tone/overlay now.
