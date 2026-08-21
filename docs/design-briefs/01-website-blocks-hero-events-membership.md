# Paper brief — Website blocks: hero + events + membership CTA

**Audience:** Paper (design)
**Deliverable target:** Nuxt Vue components in `packages/content-blocks/src/blocks/`
**Session scope:** three blocks (hero, eventList, membershipCta) — the default composition of a bowling club's home page. Get the design language locked here, then batch the remaining five in a follow-up session.

---

## 1. What Torny is (60-second context)

Torny is a multi-tenant SaaS that gives community bowling clubs their own public website + a CRM to run the club (members, dues, events, honour board). One codebase, thousands of tenants — each club gets its own subdomain (`melbourne-bowling-club.torny.club`) and optional custom domain (`mbc.org.au`).

The public site is built from **blocks** — the club owner drops them on a page in the CRM's Website editor (Notion-style vertical list), reorders, tweaks props, hits Publish. The Nuxt site renders them.

We're designing what those blocks **look like when rendered**. Not the editor UI — that's already done.

## 2. Audience + voice

**Who visits a club's site:**
- **First-timers** deciding if they want to try bowls — need warmth, "come as you are", no jargon
- **Existing members** checking what's on this week
- **Regional / interstate visitors** planning a game

**Tone:** established, community, warm. Bowling clubs are often 100+ years old, deeply rooted in a suburb. Not a tech startup. Not a golf resort either — no leather-and-mahogany posturing. Think: "the club that's been on the corner forever, quietly running competitions and pouring beers".

**Reference sites** (for tone, not aesthetics — most of them look dated):
- melbournebowlingclub.com.au
- randwickbowls.com.au
- Any Bowls Australia state affiliate

**Avoid:**
- Corporate stock imagery (handshakes, grey suits)
- Tech-startup gradients + emoji-heavy copy
- Gamified badges / streaks / points
- Anything that would look out of place in a country town

## 3. Constraints

- **Renders inside a shared layout.** Every page is wrapped in a header (club logo + nav: Home / About / Events / Honour board / Membership / Contact) and footer (© year + club name + "Powered by Torny"). Blocks fill the `<main>` between them. Layout file: `apps/club-sites/layouts/default.vue`.
- **Mobile-first.** Half of club visitors are 60+ and on a phone. Nothing narrower than 320px should break. Nothing wider than 1080px content-width — clubs don't have 4K photography.
- **Brand primary is per-tenant.** Each club sets one accent colour in the CRM (`club.brand_primary`). We expose it as `--brand` on the outer wrapper. Every block that uses accent colour reads `var(--brand)` — don't hardcode `#2563EB`.
- **Accessibility:** WCAG 2.1 AA contrast on text + interactive states. Focus rings on all buttons/links. Nothing conveyed by colour alone.
- **No JS-only components.** Blocks render server-side (Nuxt SSR). Interactivity is fine (hover, focus, form submits) — but the first render is HTML.
- **8 known block types total.** Adding a new type requires a migration. We're not designing a new type here — we're refining three of the existing ones.

## 4. Design tokens available

Full list in `packages/design-tokens/src/tokens.css`. Highlights:

**Colour**
```
Neutrals:  --color-ink #0A0A0B, --color-graphite #2E2E33, --color-fog #6B6B72,
           --color-mute #A3A39B, --color-hairline #E7E7E1, --color-surface #F5F5F2,
           --color-white #FFFFFF
Per-tenant: --brand (whatever the club picked, defaults to --color-accent #2563EB)
Sky palette (public-only): --color-sky-1 #87CEEB → --color-sky-4 #E0F6FF
Feature:   --color-feature-mint, --color-feature-tangerine, --color-feature-violet
Semantic:  --color-success #2E5D3C, --color-danger #DC2F3B
```

**Type**
```
--font-display: 'Space Grotesk'   ← headings, hero, prices
--font-body:    'Inter'           ← body copy, buttons, forms
--font-mono:    'JetBrains Mono'  ← labels, eyebrows, dates

Scale: 11 / 12 / 14 / 16 / 20 / 24 / 32 / 44 / 56 / 88

Weights: 400 / 500 / 600 / 700
Tracking: -0.02em (tight), 0 (normal), 0.08em (label caps)
Leading: 100% (tight), 105% (heading), 150% (body)
```

**Spacing (4-based scale):** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64

**Radii:** 4 / 8 / 12 / 20 / 999px

**Shadows:** sm / md / lg (all soft, tinted with ink not black)

**Breakpoints:** sm 390 · md 768 · lg 1024 · xl 1440; content max-width 1200

Use these tokens directly rather than reinventing values. New tokens are welcome — just flag them so we add to the file.

## 5. Block-by-block spec

### 5.1 `hero`

**Purpose:** the first thing every visitor sees. Establish who the club is in two seconds.

**Props (from `packages/content-blocks/src/types.ts`):**
```ts
interface HeroProps {
  heading: string          // e.g. "Melbourne Bowling Club"
  subheading?: string      // e.g. "Proud, Feared, United"
  imageUrl?: string        // optional background image (Cloudflare CDN URL)
  primaryCta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
}
```

**Real content sample (MBC):**
```
Heading:      Melbourne Bowling Club
Subheading:   Proud, Feared, United
Primary CTA:  "Join the club" → /membership
Secondary:    "See what's on" → /events
Image:        photo of two bowlers rolling on a green, late afternoon light
```

**Variations to design:**
- **A. With background image** — heading + subheading + CTAs sit over a photo. Overlay for legibility.
- **B. Without image** — same content but on a solid or brand-tinted background. Must feel deliberate, not "the image is missing".
- **C. Eyebrow "Established 1864"** when the club has a `founded_year`. Small mono type above the heading.

**States:** default, hover on CTAs, focus rings.

**Considerations:**
- The heading is the club's name — often long ("Waverley RSL Memorial Bowls Club"). Design must handle 40 chars gracefully.
- Subheading is a tagline — 3–8 words typical.
- Primary CTA uses `--brand`. Secondary is neutral outline.
- Height: don't set fixed height. Let content dictate; feel proportional.
- If both CTAs are missing, hide the button row entirely — don't leave empty space.

### 5.2 `eventList`

**Purpose:** show what's coming up. Pulls upcoming events from the club's calendar (data injected via `BLOCK_CONTEXT_KEY`).

**Props:**
```ts
interface EventListProps {
  heading?: string         // e.g. "What's on" — hide the heading if empty
  limit?: number           // default 6, max 20
  upcomingOnly?: boolean   // default true — filter past events
}
```

**Data injected at render time (per event):**
```ts
{
  title: string            // "Twilight Triples Round 3"
  starts_at: ISO string    // "2026-09-04T18:00:00+10:00"
  ends_at?: ISO string
  location?: string        // "Green 2" or "Clubhouse"
  excerpt?: string         // one paragraph blurb
  slug?: string            // used to link to detail page (not required for design)
}
```

**Real content sample (2 events):**
```
Twilight Triples Round 3
Thu 4 Sep · 6:00 PM · Green 2
Bring a plate — bar open from 5:30.

Saturday Pennant vs Windsor
Sat 6 Sep · 12:30 PM · Home
Selectors up Wednesday. Wear whites.
```

**Variations to design:**
- **A. List view** (default) — each event is a card with date + title + meta + excerpt
- **B. Compact view** — no cards, just rows with a strong date column. Denser, better for clubs with many events.
- **Empty state** — "Nothing scheduled just yet. Check back soon." — friendly, not apologetic. This will render often on new clubs.

**Considerations:**
- Date is the anchor — leading with a coloured date block (day + month) is our current approach; keep or change deliberately.
- Time formatting: "6:00 PM" not "18:00". Locale is Australia/NZ.
- Excerpt is optional — half of events won't have one. Don't leave a stub.
- The heading is optional and hides if blank. But respect the visual rhythm — the section shouldn't sit right against the block above it.

### 5.3 `membershipCta`

**Purpose:** convert a first-time visitor into a signup. A single, focused block — not a tier grid (that's a different block on the `/membership` page).

**Props:**
```ts
interface MembershipCtaProps {
  heading: string          // "Play with us this season"
  body?: string            // 1–2 sentences
  ctaLabel?: string        // "See tiers"
  ctaHref?: string         // "/membership"
}
```

**Real content sample:**
```
Heading:  Play with us this season
Body:     Whether you're a first-time bowler or a seasoned skip,
          there's a spot for you. Full playing rights from $140/year;
          twilight-only social from $60.
CTA:      "See tiers" → /membership
```

**Variations to design:**
- **A. Accent panel** — brand-primary background, white text, single button. High visual weight.
- **B. Neutral panel** — surface / hairline border, ink text, brand-primary button. Lower weight, sits comfortably between other blocks.
- **C. Icon or illustration accent** — very small, optional. A single lawn-bowl icon feels right, but only if it doesn't look like clip-art. Alternative: a hairline geometric mark.

Not designing: photo backgrounds (belongs to hero), form submission (belongs to contactForm).

**Considerations:**
- Body is optional. When missing, heading is centered and larger.
- If both `ctaLabel` and `ctaHref` are missing, hide the button. But that's a weird state — flag in the CRM validation later.
- Contrast: brand-primary + white doesn't always pass AA (e.g. muted teals). Design a fallback.

## 6. Composition — the home page as a whole

The default home layout is `[hero, eventList, membershipCta]`. When Paper hands back mocks, please include one screen where all three sit stacked, so we can see:

- **Rhythm** — is the spacing between blocks predictable? Do they feel like one page or three cut-and-paste sections?
- **Colour balance** — does the accent appear too many times, too few?
- **Progression** — hero sets identity, events give a reason to come, CTA converts. Does the flow read from top to bottom?

If any of the three blocks needs to change for the composition to work, prefer changing the block over adding a bridging element.

## 7. Deliverable format

For each block, we need:

1. **Static hero mock** at mobile (390px) and desktop (1080px) widths
2. **State variations** as sub-frames (hover, focus, empty, per §5 variations)
3. **A composition frame** at both widths showing the three blocks stacked
4. **Design notes** on any new tokens you'd introduce or existing tokens you'd retire
5. **Handoff-ready CSS** or annotations on non-obvious spacing / type decisions

We'll implement in Vue by reading `packages/content-blocks/src/blocks/{HeroBlock,EventListBlock,MembershipCtaBlock}.vue` and rewriting them to match. Design tokens map 1:1 to CSS custom properties.

## 8. Out of scope for this session

- The other five block types (`richText`, `honourBoard`, `gallery`, `contactForm`, `ctaBanner`) — separate brief once the language is locked.
- Site header + footer redesign — they're OK for now.
- The CRM editor UI — done, not touching.
- Motion / scroll animation — happy to add later; get the static right first.
- Custom fonts beyond Space Grotesk + Inter + JetBrains Mono — we've picked, tokens are stable.

## 9. Known good decisions to preserve

- **One accent per tenant.** Blocks lean on `--brand` for warmth. No secondary brand colours per club.
- **Content-max-width 1080–1200.** Bowling club photography maxes out at 1200 in practice. Anything wider looks empty.
- **Space Grotesk for headings.** Warm without being decorative. Reads well at 20px and at 88px.
- **Inter for body.** Standard, boring, correct.

## 10. Anti-patterns to avoid

- **Placeholder maximalism** — no lorem-ipsum "lorem ipsum dolor sit amet consectetur adipiscing" runs. Use the real content in §5.
- **Marketing-page energy** — no "10x your club engagement" headers, no testimonial carousels, no logos-of-brands-you-know strips. That's SaaS marketing pattern language, not community sport.
- **Empty state as an error** — an empty events list should feel like "nothing yet", not "something is broken".
- **Motion as decoration** — animation is for feedback (hover, focus, submit success), not for pizzazz. If a block scrolls or fades in for no reason, we won't build it.

## 11. Contact

Nev (`nev@torny.co`). Happy to pair through a first-pass mid-session if it's easier than waiting for a batch review.
