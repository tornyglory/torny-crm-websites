export type BlockType =
  | 'hero'
  | 'richText'
  | 'eventList'
  | 'honourBoard'
  | 'gallery'
  | 'contactForm'
  | 'membershipCta'
  | 'ctaBanner'

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
  heading?: string
  categorySlug?: string
  yearsToShow?: number
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

export type Block =
  | BlockBase<'hero', HeroProps>
  | BlockBase<'richText', RichTextProps>
  | BlockBase<'eventList', EventListProps>
  | BlockBase<'honourBoard', HonourBoardProps>
  | BlockBase<'gallery', GalleryProps>
  | BlockBase<'contactForm', ContactFormProps>
  | BlockBase<'membershipCta', MembershipCtaProps>
  | BlockBase<'ctaBanner', CtaBannerProps>

/**
 * Shape data-hydrated blocks (eventList, honourBoard) inject at render time.
 * The parent page provides this via Vue's `provide()` so blocks stay
 * data-source-agnostic and work in both the CRM preview and Nuxt sites.
 */
export interface BlockContext {
  brandPrimary?: string | null
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
    member_name: string
    notes?: string | null
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
  href: string
  /** Optional right-side badge, e.g. "4 THIS WEEK". */
  badge?: string
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
