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

export interface HeroProps {
  heading: string
  subheading?: string
  imageUrl?: string
  primaryCta?: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
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
