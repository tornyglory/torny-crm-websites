export type BlockType =
  | 'hero'
  | 'richText'
  | 'eventList'
  | 'honourBoard'
  | 'honourBoardSearch'
  | 'gallery'
  | 'contactForm'
  | 'membershipCta'
  | 'ctaBanner'
  | 'mediaSplit'
  | 'sectionTitle'
  | 'pullQuote'
  | 'featureGrid'
  | 'faqAccordion'
  | 'fullBleedImage'
  | 'timeline'
  | 'twoColumn'
  | 'divider'

export interface BlockBase<T extends BlockType, P> {
  id: string
  type: T
  props: P
}

export interface HeroStat {
  value: string
  label: string
}

export interface HeroProps {
  heading: string
  subheading?: string
  eyebrow?: string
  description?: string
  imageUrl?: string
  /** Row id from the block-images API — needed for later DELETE/PATCH. */
  imageId?: number | null
  mediaCaption?: string
  primaryCta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
  stats?: HeroStat[]
}

export interface RichTextProps {
  html: string
}

export interface EventListProps {
  heading?: string
  limit?: number
  upcomingOnly?: boolean
}

export interface HonourBoardProps {
  eyebrow?: string
  heading?: string
  description?: string
  /** Which honour-board category to feature. Defaults to Champion of Champions. */
  categorySlug?: string
  /** How many recent winners to show in the strip below the champion feature card. */
  yearsToShow?: number
  ctaLabel?: string
  ctaHref?: string
}

/** Searchable full-page honour board block — reads from brief 31's public
 *  endpoints. Owner-configurable copy at the top; everything below is data. */
export interface HonourBoardSearchProps {
  eyebrow?: string
  heading?: string
  description?: string
  /** Rows per page fetch. Defaults to 50 on server-side. */
  pageSize?: number
}

export interface GalleryProps {
  heading?: string
  images: Array<{ url: string; alt?: string; caption?: string }>
}

export interface ContactFormProps {
  heading?: string
  submitLabel?: string
  successMessage?: string
}

export interface MembershipCtaProps {
  heading: string
  body?: string
  ctaLabel?: string
  ctaHref?: string
}

export interface CtaBannerProps {
  heading: string
  body?: string
  ctaLabel?: string
  ctaHref?: string
  tone?: 'accent' | 'ink' | 'surface'
}

// ── Editorial blocks (Paper "Editorial blocks" sets) ─────────────

export interface MediaSplitBadge {
  label: string
  tone?: 'green' | 'blue' | 'amber' | 'ink'
}
export interface MediaSplitProps {
  eyebrow?: string
  heading: string
  bodyParagraphs?: string[]
  checklist?: string[]
  primaryCta?: { label: string; href: string }
  /** Rendered as a plain text (with an underline) after the primary CTA. */
  secondaryText?: string
  secondaryCta?: { label: string; href: string }
  imageUrl?: string
  mediaCaption?: string
  topBadge?: MediaSplitBadge
  mediaSide?: 'left' | 'right'
  background?: 'ground' | 'surface'
}

export interface SectionTitleProps {
  eyebrow?: string
  heading: string
  body?: string
  align?: 'center' | 'left'
}

export interface PullQuoteProps {
  quote: string
  authorName?: string
  authorRole?: string
  authorInitials?: string
  authorAvatarUrl?: string
}

export interface FeatureGridItem {
  icon?: 'target' | 'people' | 'star' | 'calendar' | 'trophy' | 'sparkle' | 'coffee' | 'bolt'
  iconTone?: 'accent' | 'mint' | 'tangerine' | 'violet' | 'sky' | 'amber'
  title: string
  body?: string
  linkLabel?: string
  linkHref?: string
}
export interface FeatureGridProps {
  eyebrow?: string
  heading?: string
  columns?: 2 | 3 | 4
  items: FeatureGridItem[]
}

export interface FaqItem {
  question: string
  answer: string
}
export interface FaqAccordionProps {
  eyebrow?: string
  heading?: string
  supportText?: string
  cta?: { label: string; href: string }
  items: FaqItem[]
}

export interface FullBleedImageProps {
  imageUrl?: string
  overlayOpacity?: number
  eyebrow?: string
  heading: string
  subheading?: string
  cta?: { label: string; href: string }
  topBadge?: { label: string; tone?: 'green' | 'blue' | 'amber' }
  bottomCaption?: string
}

export interface TimelineEntry {
  year: string
  yearLabel?: string
  yearTone?: 'default' | 'danger' | 'accent'
  title: string
  body?: string
  tag?: string
  highlighted?: boolean
  avatarInitials?: string
}
export interface TimelineProps {
  eyebrow?: string
  heading?: string
  entries: TimelineEntry[]
}

export interface TwoColumnItem {
  eyebrow?: string
  eyebrowTone?: 'accent' | 'amber' | 'mint' | 'violet' | 'danger'
  heading?: string
  bodyParagraphs?: string[]
}
export interface TwoColumnProps {
  eyebrow?: string
  heading?: string
  background?: 'ground' | 'surface'
  columns: [TwoColumnItem, TwoColumnItem]
}

export interface DividerProps {
  variant?: 'hairline' | 'label' | 'dots' | 'spacer'
  label?: string
  height?: number
}

export type Block =
  | BlockBase<'hero', HeroProps>
  | BlockBase<'richText', RichTextProps>
  | BlockBase<'eventList', EventListProps>
  | BlockBase<'honourBoard', HonourBoardProps>
  | BlockBase<'honourBoardSearch', HonourBoardSearchProps>
  | BlockBase<'gallery', GalleryProps>
  | BlockBase<'contactForm', ContactFormProps>
  | BlockBase<'membershipCta', MembershipCtaProps>
  | BlockBase<'ctaBanner', CtaBannerProps>
  | BlockBase<'mediaSplit', MediaSplitProps>
  | BlockBase<'sectionTitle', SectionTitleProps>
  | BlockBase<'pullQuote', PullQuoteProps>
  | BlockBase<'featureGrid', FeatureGridProps>
  | BlockBase<'faqAccordion', FaqAccordionProps>
  | BlockBase<'fullBleedImage', FullBleedImageProps>
  | BlockBase<'timeline', TimelineProps>
  | BlockBase<'twoColumn', TwoColumnProps>
  | BlockBase<'divider', DividerProps>

/**
 * Shape data-hydrated blocks (eventList, honourBoard) inject at render time.
 * The parent page provides this via Vue's `provide()` so blocks stay
 * data-source-agnostic and work in both the CRM preview and Nuxt sites.
 */
export interface BlockContext {
  brandPrimary?: string | null
  /** Public club slug — used by data-hydrated blocks that hit the public
   *  honour-board / events endpoints (need the slug to construct URLs). */
  clubSlug?: string | null
  events?: Array<{
    id: number | string
    title: string
    starts_at: string
    ends_at?: string | null
    location?: string | null
    excerpt?: string | null
    slug?: string
  }>
  honourEntries?: Array<{
    category_slug: string
    category_name: string
    year: number
    /** First player's display name — kept for single-name block layouts. */
    member_name: string
    /** First player's user_id, if they're a Torny user. Null for guests. */
    member_user_id?: number | null
    /** Optional short initials for the avatar chip (fallback derived from name). */
    initials?: string
    /** Optional final score, e.g. "21–14". */
    score?: string | null
    /** Optional ISO date the trophy was awarded. */
    awarded_at?: string | null
    notes?: string | null
    /**
     * Full player list — populated for multi-player entries (pairs / triples /
     * fours). `players[0]` mirrors `member_name` for single-player layouts.
     * `user_id` null means a guest / historic non-member.
     */
    players?: Array<{
      user_id: number | null
      display_name: string
      position: string | null
    }>
  }>
}

/** Injection key. Use `Symbol.for` so multiple package versions share the same key. */
export const BLOCK_CONTEXT_KEY = Symbol.for('torny.block-context')

/**
 * Chrome (nav + footer) shared props. Site layouts pass these in — the
 * components render the same in the club-sites Nuxt app and in the CRM's
 * Website editor preview.
 */

export interface SiteChromeClub {
  name: string
  logoUrl?: string | null
  /** Fallback avatar characters when no logo — usually 2–3 uppercase letters. */
  initials?: string
  /** Small mono strapline under the club name (e.g. "Est. 1953 · Hutt Valley"). */
  strapline?: string
}

export interface NavLink {
  label: string
  /** Required for leaves. Optional on a parent that only exists to group its `children`. */
  href?: string
  /** Optional right-side badge, e.g. "4 THIS WEEK". */
  badge?: string
  /** When present, renders `target="_blank" rel="noopener"`. Auto-detected from `href` otherwise. */
  external?: boolean
  /** Sub-links shown in a dropdown (desktop) or inline expandable list (mobile). One level only. */
  children?: NavLink[]
}

export interface SiteHeaderProps {
  club: SiteChromeClub
  navLinks: NavLink[]
  /** Path of the current route — used to compute the active link. */
  currentPath?: string
  /** Secondary members link ("Members sign in"). Hidden if not provided. */
  signInHref?: string
  /** Primary CTA, right-most action ("Join the club"). Hidden if not provided. */
  primaryCta?: { label: string; href: string }
  /** When true, the mobile hamburger button appears pressed / drawer is open. */
  drawerOpen?: boolean
}

export interface SocialLink {
  /** Display label (used for aria-label). */
  label: string
  href: string
  /** Icon key — the component ships a small set. */
  icon: 'instagram' | 'facebook' | 'email' | 'twitter'
}

export interface FooterNavColumn {
  /** Uppercase mono header (e.g. "Explore"). */
  heading: string
  links: NavLink[]
}

export interface FooterContact {
  addressLines?: string[]
  email?: string
  phone?: string
  /** Live status pill (e.g. "Green open now"). Green dot indicator + label. */
  status?: string
}

export interface SiteFooterProps {
  club: SiteChromeClub
  /** Short description under the brand column. */
  description?: string
  socials?: SocialLink[]
  columns?: FooterNavColumn[]
  contact?: FooterContact
  /** Legal links in the bottom bar (Privacy / Terms / Cookies). */
  legalLinks?: NavLink[]
  /** Show the "Powered by Torny" mark. Defaults to true. */
  poweredBy?: boolean
}
