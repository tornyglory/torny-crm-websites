<script setup lang="ts">
/**
 * Website page editor.
 *
 * Vertical-list block editor. Same shell for all 6 public pages (home,
 * about, membership, events, honour-board, contact) — the active page
 * comes from the route param `pageSlug`. Each page has its own curated
 * palette + seed layout, and its own row in the backend's
 * `public_site_pages` table.
 *
 * Persistence (brief 17):
 * - On mount / page-switch / club-switch → `GET /clubs/:id/pages/:slug`
 *   fills the state. Backend returns a seeded default layout if the
 *   owner has never touched the page, so nothing looks blank.
 * - Every edit debounces 500ms → `PATCH .../pages/:slug` with
 *   `{ layout_draft: { blocks } }`. Full replacement.
 * - Publish → `POST .../pages/:slug/publish`. Returns `public_url` for
 *   the "View live" link.
 * - LocalStorage still writes on every autosave as an offline fallback
 *   in case the network drops mid-session.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useClubStore } from '@/stores/club'
import { useOnboardingStore } from '@/stores/onboarding'
import ImagePicker from '@/components/ImagePicker.vue'
import Skeleton from '@/components/Skeleton.vue'
import BlockPaletteDialog from '@/components/BlockPaletteDialog.vue'
import WebsiteSettingsPanel, { type WebsiteSettingsSection } from '@/components/WebsiteSettingsPanel.vue'
import { ApiError, pages, isValidPageSlug, RESERVED_PAGE_SLUGS, slugifyTitle, type PageBlock } from '@torny/api-client'
import { usePagesStore } from '@/stores/pages'
import type {
  Block,
  BlockType,
  HeroProps,
  RichTextProps,
  EventListProps,
  HonourBoardProps,
  HonourBoardSearchProps,
  GalleryProps,
  ContactFormProps,
  MembershipCtaProps,
  CtaBannerProps,
  MediaSplitProps,
  SectionTitleProps,
  PullQuoteProps,
  FeatureGridProps,
  FeatureGridItem,
  FaqAccordionProps,
  FaqItem,
  FullBleedImageProps,
  TimelineProps,
  TimelineEntry,
  TwoColumnProps,
  DividerProps,
} from '@torny/content-blocks'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()
const onboarding = useOnboardingStore()

// ── Sections (pages + settings) ──────────────────────────────
/** Now widened to any kebab-case slug — clubs mint custom pages via the
 *  sidebar. The six seed slugs still have their own curated palettes /
 *  seed blocks / labels; custom pages use the generic fallbacks. */
type PageSlug = string
type SystemPageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
const SYSTEM_PAGE_SLUGS: SystemPageSlug[] = ['home', 'about', 'membership', 'events', 'honour-board', 'contact']
const SETTINGS_SLUGS: WebsiteSettingsSection[] = ['navigation', 'brand', 'seo', 'domain', 'forms', 'analytics']
type Section = PageSlug | WebsiteSettingsSection

const pagesStore = usePagesStore()

const SYSTEM_PAGE_LABELS: Record<SystemPageSlug, string> = {
  home: 'Home',
  about: 'About',
  membership: 'Membership',
  events: 'Events',
  'honour-board': 'Honour board',
  contact: 'Contact',
}
const SYSTEM_PAGE_SUBTITLES: Record<SystemPageSlug, string> = {
  home: 'The front door — hero, upcoming events, a nudge to join.',
  about: 'Who you are and what makes the club feel like home.',
  membership: 'Show your tiers and why someone would join.',
  events: 'What\'s coming up. Auto-pulled from the events calendar.',
  'honour-board': 'A century of results, category by category.',
  contact: 'How people reach the club — address, hours, contact form.',
}
/** Human title for any slug. System pages use their curated label; custom
 *  pages look up their `title` on the store row (falls back to slug). */
function pageLabel(slug: PageSlug): string {
  if ((SYSTEM_PAGE_SLUGS as readonly string[]).includes(slug)) {
    return SYSTEM_PAGE_LABELS[slug as SystemPageSlug]
  }
  return pagesStore.findBySlug(slug)?.title ?? slug
}
function pageSubtitle(slug: PageSlug): string {
  if ((SYSTEM_PAGE_SLUGS as readonly string[]).includes(slug)) {
    return SYSTEM_PAGE_SUBTITLES[slug as SystemPageSlug]
  }
  return 'Custom page — drop in blocks to tell its story.'
}
const SETTINGS_LABELS: Record<WebsiteSettingsSection, string> = {
  navigation: 'Navigation',
  brand: 'Brand',
  seo: 'SEO',
  domain: 'Domain',
  forms: 'Forms',
  analytics: 'Analytics',
}
const SETTINGS_SUBTITLES: Record<WebsiteSettingsSection, string> = {
  navigation: 'Header + footer links. Same on every page.',
  brand: 'Logo, favicon, colours, and typography.',
  seo: 'Meta title, description, share card, search visibility.',
  domain: 'Custom domain, DNS records, fallback subdomain.',
  forms: 'Contact form, membership application, RSVPs.',
  analytics: 'Google Analytics, Plausible, cookie banner.',
}

function isSettingsSlug(s: string): s is WebsiteSettingsSection {
  return (SETTINGS_SLUGS as readonly string[]).includes(s)
}
/** Anything not a settings section (and slug-shaped) counts as a page. */
function isPageSlug(s: string): s is PageSlug {
  return !isSettingsSlug(s) && isValidPageSlug(s)
}

const currentSection = computed<Section>(() => {
  const s = (route.params.pageSlug ?? route.params.section) as string | undefined
  if (s && (isPageSlug(s) || isSettingsSlug(s))) return s
  return 'home'
})
const currentPage = computed<PageSlug>(() => {
  const s = currentSection.value
  return isPageSlug(s) ? s : 'home'
})
const isSettingsView = computed(() => isSettingsSlug(currentSection.value))
const currentSettings = computed<WebsiteSettingsSection | null>(() => {
  const s = currentSection.value
  return isSettingsSlug(s) ? s : null
})

function switchSection(slug: Section): void {
  if (slug === currentSection.value) return
  router.push({ name: 'website', params: { pageSlug: slug } })
}

// ── Types + block palettes ────────────────────────────────
interface PaletteItem {
  type: BlockType
  label: string
  hint: string
  icon: string  // simple text icon for MVP
  defaults: () => Block['props']
}

const clubName = (): string => clubStore.current?.name ?? 'Your club'

interface HeroDefaultExtras {
  eyebrow?: string
  description?: string
  mediaCaption?: string
  stats?: Array<{ value: string; label: string }>
}
const heroDefault = (
  heading: string,
  sub: string,
  cta1: [string, string],
  cta2?: [string, string],
  extras: HeroDefaultExtras = {},
): HeroProps => ({
  heading,
  subheading: sub,
  eyebrow: extras.eyebrow,
  description: extras.description,
  mediaCaption: extras.mediaCaption,
  stats: extras.stats,
  primaryCta: { label: cta1[0], href: cta1[1] },
  ...(cta2 ? { secondaryCta: { label: cta2[0], href: cta2[1] } } : {}),
})

const homeHeroExtras: HeroDefaultExtras = {
  eyebrow: 'Est. 1953 · Hutt Valley',
  description: 'Naenae Bowling Club has been playing on the same green in the Hutt Valley since 1953. Mixed-membership, open twilights every Friday from October to March, and bowls until you find a set you like.',
  mediaCaption: 'Green A · Friday twilight',
  stats: [
    { value: '142', label: 'Members' },
    { value: '4', label: 'Events this week' },
    { value: '3', label: 'Greens on site' },
  ],
}

// ── Editorial-block default builders ─────────────────────────
const mediaSplitDefault = (mediaSide: 'left' | 'right' = 'left'): MediaSplitProps => ({
  mediaSide,
  background: mediaSide === 'right' ? 'surface' : 'ground',
  eyebrow: 'Our story · Chapter one',
  heading: 'Three greens, seventy-three summers, one very stubborn hedge.',
  bodyParagraphs: [
    'We opened on land the council forgot about. A few returned servicemen laid the first green by hand — twelve months of level checks, borrowed rollers, and one memorable delivery of the wrong topsoil.',
    'Seventy-three years later, we\'re still here. Still on the same block. Still watching the same weathervane spin.',
  ],
  primaryCta: { label: 'Read the full history', href: '/about' },
  secondaryCta: { label: 'See the timeline', href: '/about#timeline' },
  mediaCaption: 'Green A · 1972',
})

const sectionTitleDefault = (): SectionTitleProps => ({
  eyebrow: 'About the club',
  heading: 'A community of people who like each other and love the game.',
  body: 'One hundred and forty-two members, from beginners on their first lesson to skips who\'ve played every Saturday for thirty years. Everyone gets the same welcome.',
})

const pullQuoteDefault = (): PullQuoteProps => ({
  quote: 'Rangi taught me the weight of a wounded jack in one Thursday morning. Thirty years later I\'m still working on the line.',
  authorName: 'Grace Whittaker',
  authorRole: 'Club President · Member since 1996',
  authorInitials: 'GW',
})

const featureGridDefault = (): FeatureGridProps => ({
  eyebrow: 'What you get',
  heading: 'More than a bowling club.',
  columns: 4,
  items: [
    { icon: 'target', iconTone: 'accent', title: 'Three greens, one keeper', body: 'Our greenkeeper has looked after our surfaces for years. They roll consistent, they run true.', linkLabel: 'Meet the greenkeeper', linkHref: '/about' } satisfies FeatureGridItem,
    { icon: 'people', iconTone: 'mint', title: '142 members, all sorts', body: 'Retired teachers, tradies, students. Bring who you are.', linkLabel: 'Meet the club', linkHref: '/about' } satisfies FeatureGridItem,
    { icon: 'star', iconTone: 'amber', title: 'A wall full of names', body: '73 seasons of Champion of Champions, 41 unique winners on the honour board.', linkLabel: 'Honour board', linkHref: '/honour-board' } satisfies FeatureGridItem,
    { icon: 'calendar', iconTone: 'violet', title: 'Something on every week', body: 'Twilights, pennant, coaching, function nights. Even the quiet weeks have coffee at 10.', linkLabel: 'See calendar', linkHref: '/events' } satisfies FeatureGridItem,
  ],
})

const faqAccordionDefault = (): FaqAccordionProps => ({
  eyebrow: 'First-timer questions',
  heading: 'Whatever you\'re wondering, someone else asked first.',
  supportText: 'Still stuck? Drop us a note — we usually reply within a day.',
  cta: { label: 'Ask us anything', href: '/contact' },
  items: [
    { question: 'Do I need any gear to come along?', answer: 'Not a thing. We\'ve got bowls in every weight and enough flat-soled shoes to fit most feet. Wear something comfortable — long trousers and a collared top are fine for socials.' } satisfies FaqItem,
    { question: 'What\'s the age range at the club?', answer: 'Our youngest member is 14 and our oldest is 89. Most of the club sits between 40 and 70, but everyone plays together — no separate groups.' } satisfies FaqItem,
    { question: 'Is there parking on-site?', answer: 'Yes, free parking behind the clubhouse. Overflow street parking on match days.' } satisfies FaqItem,
    { question: 'Can I hire the clubhouse for a private event?', answer: 'Absolutely. The clubhouse holds up to 80 seated or 120 standing. Contact us for pricing and dates.' } satisfies FaqItem,
    { question: 'How do I join a pennant team?', answer: 'Speak to Sarah — our selectors watch every Friday twilight to see how the summer bowls are running. Teams are picked in September.' } satisfies FaqItem,
  ],
})

const fullBleedImageDefault = (): FullBleedImageProps => ({
  eyebrow: 'One night a year',
  heading: 'The whole club under one roof.',
  cta: { label: 'Book Champions night', href: '/events' },
  topBadge: { label: 'Champions night · Mar 2026', tone: 'amber' },
  bottomCaption: '142 members going',
  overlayOpacity: 0.35,
})

const timelineDefault = (): TimelineProps => ({
  eyebrow: 'Milestones · 1953 – 2026',
  heading: 'Seventy-three years, in short.',
  entries: [
    { year: '1953', yearLabel: 'Year one', title: 'Green A opened by hand', body: 'A dozen returned servicemen level the first surface over twelve months. First game played on Boxing Day.', tag: 'Founding' } satisfies TimelineEntry,
    { year: '1968', title: 'Green B and the clubhouse extension', body: 'Membership passes 60. Second green laid on the neighbouring section, clubhouse doubled in size.' } satisfies TimelineEntry,
    { year: '1984', yearLabel: 'First title', title: 'First Champion of Champions', body: 'Alfie Whakatane wins the inaugural club singles championship, 21–19. The honour board starts, and it hasn\'t stopped.', highlighted: true, avatarInitials: 'AW' } satisfies TimelineEntry,
    { year: '2004', title: 'Tāne takes over the greens', body: 'Head greenkeeper Tāne Rahupene joins. Consistent surfaces for twenty-two seasons and counting.' } satisfies TimelineEntry,
    { year: '2020', yearLabel: 'Interrupted', yearTone: 'danger', title: 'No Champion of Champions', body: 'The first year the championship wasn\'t held. Members still turned up on Fridays anyway.' } satisfies TimelineEntry,
    { year: '2026', yearLabel: 'This year', yearTone: 'accent', title: '142 members, three greens, new website', body: 'You\'re looking at the result.' } satisfies TimelineEntry,
  ],
})

const twoColumnDefault = (): TwoColumnProps => ({
  eyebrow: 'The way we play',
  heading: 'Two houses, one game.',
  background: 'surface',
  columns: [
    { eyebrow: 'Friday twilight', eyebrowTone: 'accent', heading: 'Social, whites optional', bodyParagraphs: [
      'Named after the sun on the greens at 6pm. This is where most of our members started — no team required, no ranking, no expectations. Bring a plate for the shared table, bring a friend if you\'ve got one.',
      'Coaching help is on the sidelines every Friday. Ask for a walk-through of stance and delivery.',
    ] },
    { eyebrow: 'Saturday pennant', eyebrowTone: 'amber', heading: 'Whites, teams, results', bodyParagraphs: [
      'Saturday pennant runs October to March. We enter three teams across two grades.',
      'Whites are required. Ties optional. Selectors watch every Friday twilight to see how the summer bowls are running.',
    ] },
  ],
})

const dividerDefault = (variant: DividerProps['variant'] = 'hairline'): DividerProps => ({
  variant,
  label: variant === 'label' ? 'Section break' : undefined,
  height: variant === 'spacer' ? 64 : undefined,
})

// Palette entries reused across multiple pages.
const EDITORIAL_PALETTE = [
  { type: 'mediaSplit' as const, label: 'Media + text', hint: 'Image on one side, story on the other', icon: '◨',
    defaults: () => mediaSplitDefault('left') },
  { type: 'sectionTitle' as const, label: 'Section title', hint: 'A centered display heading', icon: '¶',
    defaults: () => sectionTitleDefault() },
  { type: 'pullQuote' as const, label: 'Pull quote', hint: 'A big centered testimonial', icon: '"',
    defaults: () => pullQuoteDefault() },
  { type: 'featureGrid' as const, label: 'Feature grid', hint: '4 columns of icon + copy', icon: '▤',
    defaults: () => featureGridDefault() },
  { type: 'faqAccordion' as const, label: 'FAQ', hint: 'Expandable question rows', icon: '?',
    defaults: () => faqAccordionDefault() },
  { type: 'fullBleedImage' as const, label: 'Full-bleed image', hint: 'A big picture with a CTA', icon: '◪',
    defaults: () => fullBleedImageDefault() },
  { type: 'timeline' as const, label: 'Timeline', hint: 'Milestones by year', icon: '⌘',
    defaults: () => timelineDefault() },
  { type: 'twoColumn' as const, label: 'Two-column text', hint: 'Side-by-side text columns', icon: '║',
    defaults: () => twoColumnDefault() },
  { type: 'divider' as const, label: 'Divider', hint: 'Section break line, label, or spacer', icon: '—',
    defaults: () => dividerDefault('hairline') },
]

const PALETTES: Record<SystemPageSlug, PaletteItem[]> = {
  home: [
    { type: 'hero', label: 'Hero', hint: 'Big heading, tagline, two CTAs', icon: '☰',
      defaults: (): HeroProps => heroDefault("Roll up whenever the sun's out.", 'A friendly bowls club. New members always welcome.', ['Join the club', '/membership'], ['See what\'s on this month', '/events'], homeHeroExtras) },
    { type: 'richText', label: 'Rich text', hint: 'A block of writing', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Tell your visitors about the club — history, atmosphere, what makes you different.</p>' }) },
    { type: 'eventList', label: 'Events', hint: 'Auto-pulled from your events calendar', icon: '◧',
      defaults: (): EventListProps => ({ heading: "What's on", limit: 4, upcomingOnly: true }) },
    { type: 'gallery', label: 'Gallery', hint: 'A photo strip of the club', icon: '▨',
      defaults: (): GalleryProps => ({ heading: 'Around the club', images: [] }) },
    { type: 'membershipCta', label: 'Membership CTA', hint: 'Push people to /membership', icon: '★',
      defaults: (): MembershipCtaProps => ({ heading: 'Play with us this season', body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.', ctaLabel: 'See tiers', ctaHref: '/membership' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Have questions? Get in touch.', ctaLabel: 'Contact us', ctaHref: '/contact', tone: 'accent' }) },
    ...EDITORIAL_PALETTE,
  ],
  about: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('About the club', 'Our story, in short.', ['See membership', '/membership']) },
    { type: 'richText', label: 'Rich text', hint: 'History, atmosphere, values', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Founded in <strong>[year]</strong>, we\'re a community club welcoming all levels of bowler…</p>' }) },
    { type: 'gallery', label: 'Gallery', hint: 'Photos of the greens, the pavilion, the people', icon: '▨',
      defaults: (): GalleryProps => ({ heading: 'The club', images: [] }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Come down for a roll-up.', ctaLabel: 'Contact us', ctaHref: '/contact', tone: 'ink' }) },
    ...EDITORIAL_PALETTE,
  ],
  membership: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Membership', 'Choose the tier that fits how you play.', ['Contact us', '/contact']) },
    { type: 'richText', label: 'Rich text', hint: 'Benefits, discounts, joining process', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Every level has full clubhouse access. Discounted first year for new joiners.</p>' }) },
    { type: 'membershipCta', label: 'Membership CTA', hint: 'A join-us block with a button', icon: '★',
      defaults: (): MembershipCtaProps => ({ heading: 'Ready to join?', body: 'Send us a note and we\'ll get you sorted.', ctaLabel: 'Get in touch', ctaHref: '/contact' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Questions about a tier?', ctaLabel: 'Ask us', ctaHref: '/contact', tone: 'surface' }) },
    ...EDITORIAL_PALETTE,
  ],
  events: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault("What's on", 'Tournaments, roll-ups, training nights.', ['Contact us', '/contact']) },
    { type: 'richText', label: 'Rich text', hint: 'Intro / booking notes', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Everything coming up at the club. Members can RSVP directly.</p>' }) },
    { type: 'eventList', label: 'Events list', hint: 'The full upcoming feed', icon: '◧',
      defaults: (): EventListProps => ({ heading: 'Upcoming', limit: 20, upcomingOnly: true }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Want to run an event?', ctaLabel: 'Tell us more', ctaHref: '/contact', tone: 'accent' }) },
  ],
  'honour-board': [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Honour board', 'A century of results.', ['Back to the club', '/']) },
    { type: 'richText', label: 'Rich text', hint: 'Preamble', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>Winners of every competition, year by year.</p>' }) },
    { type: 'honourBoardSearch', label: 'Honour board · Search', hint: 'Full searchable wall of names — every category, every year', icon: '⌕',
      defaults: (): HonourBoardSearchProps => ({
        heading: 'The honour board.',
        description: 'Every winner of every event since we opened. Names on the wall, names on this page.',
      }) },
    { type: 'honourBoard', label: 'Honour board · Feature', hint: 'Reigning champion + recent winners', icon: '♛',
      defaults: (): HonourBoardProps => ({
        eyebrow: 'Honour board · Since 1953',
        heading: 'Champions.',
        description: 'Seventy-three seasons of Champion of Champions. Forty-one unique winners on the plaque above the bar.',
        categorySlug: 'champion-of-champions',
        yearsToShow: 5,
        ctaLabel: 'See the whole honour board',
        ctaHref: '/honour-board',
      }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Notice something missing?', ctaLabel: 'Let us know', ctaHref: '/contact', tone: 'surface' }) },
  ],
  contact: [
    { type: 'hero', label: 'Hero', hint: 'Page opener', icon: '☰',
      defaults: (): HeroProps => heroDefault('Contact', 'Say hello. We\'ll get back to you.', ['Directions', '#directions']) },
    { type: 'richText', label: 'Rich text', hint: 'Address, hours, notes', icon: '¶',
      defaults: (): RichTextProps => ({ html: '<p>You\'ll find us at the club most afternoons. Drop a note below or email direct.</p>' }) },
    { type: 'contactForm', label: 'Contact form', hint: 'A simple message form', icon: '✉',
      defaults: (): ContactFormProps => ({ heading: 'Drop us a note', submitLabel: 'Send', successMessage: 'Thanks — we\'ll be in touch.' }) },
    { type: 'ctaBanner', label: 'CTA banner', hint: 'A slim strip with one link', icon: '▬',
      defaults: (): CtaBannerProps => ({ heading: 'Prefer to call?', ctaLabel: 'Give us a ring', ctaHref: 'tel:+', tone: 'ink' }) },
  ],
}

const BLOCK_LABEL: Record<BlockType, string> = {
  hero: 'Hero',
  richText: 'Rich text',
  eventList: 'Events',
  honourBoard: 'Honour board',
  honourBoardSearch: 'Honour board · Search',
  gallery: 'Gallery',
  contactForm: 'Contact form',
  membershipCta: 'Membership CTA',
  ctaBanner: 'CTA banner',
  mediaSplit: 'Media + text',
  sectionTitle: 'Section title',
  pullQuote: 'Pull quote',
  featureGrid: 'Feature grid',
  faqAccordion: 'FAQ',
  fullBleedImage: 'Full-bleed image',
  timeline: 'Timeline',
  twoColumn: 'Two-column text',
  divider: 'Divider',
}

// ── Seed layouts (per page) ───────────────────────────────
function newBlockId(): string {
  return `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function seed(...blocks: Array<{ type: BlockType; props: Block['props'] }>): Block[] {
  return blocks.map((b) => ({ id: newBlockId(), type: b.type, props: b.props }) as Block)
}

const SEEDS: Record<SystemPageSlug, () => Block[]> = {
  home: () => seed(
    { type: 'hero', props: heroDefault("Roll up whenever the sun's out.", 'A friendly bowls club. New members always welcome.', ['Join the club', '/membership'], ['See what\'s on this month', '/events'], homeHeroExtras) },
    { type: 'eventList', props: { heading: "What's on", limit: 4, upcomingOnly: true } satisfies EventListProps },
    { type: 'membershipCta', props: { heading: 'Play with us this season', body: 'Whether you\'re a first-time bowler or a seasoned skip, there\'s a spot for you.', ctaLabel: 'See tiers', ctaHref: '/membership' } satisfies MembershipCtaProps },
  ),
  about: () => seed(
    { type: 'hero', props: heroDefault('About the club', 'Our story, in short.', ['See membership', '/membership']) },
    { type: 'richText', props: { html: `<p>Founded in <strong>[year]</strong>, ${clubName()} has been a friendly place to bowl ever since. New members and visitors are always welcome — come down for a roll-up.</p>` } satisfies RichTextProps },
    { type: 'gallery', props: { heading: 'Around the club', images: [] } satisfies GalleryProps },
  ),
  membership: () => seed(
    { type: 'hero', props: heroDefault('Membership', 'Choose the tier that fits how you play.', ['Contact us', '/contact']) },
    { type: 'richText', props: { html: '<p>Every level has full clubhouse access. Discounted first year for new joiners.</p>' } satisfies RichTextProps },
    { type: 'membershipCta', props: { heading: 'Ready to join?', body: 'Send us a note and we\'ll get you sorted.', ctaLabel: 'Get in touch', ctaHref: '/contact' } satisfies MembershipCtaProps },
  ),
  events: () => seed(
    { type: 'hero', props: heroDefault("What's on", 'Tournaments, roll-ups, training nights.', ['Contact us', '/contact']) },
    { type: 'eventList', props: { heading: 'Upcoming', limit: 20, upcomingOnly: true } satisfies EventListProps },
  ),
  // `/honour-board` renders a purpose-built searchable full-page experience
  // via the Nuxt fallback slot (see apps/club-sites/pages/honour-board/index.vue).
  // Ship an empty seed so new clubs get that search page by default; owners
  // can still publish a custom layout of blocks in the CRM if they'd rather.
  'honour-board': () => seed(),
  contact: () => seed(
    { type: 'hero', props: heroDefault('Contact', 'Say hello. We\'ll get back to you.', ['Directions', '#directions']) },
    { type: 'contactForm', props: { heading: 'Drop us a note', submitLabel: 'Send', successMessage: 'Thanks — we\'ll be in touch.' } satisfies ContactFormProps },
  ),
}

// ── State ─────────────────────────────────────────────────
interface PageMetaState {
  title: string
  description: string
}
interface EditorState {
  blocks: Block[]
  meta: PageMetaState
  publishedBlocks: Block[] | null
  draftUpdatedAt: string | null
  publishedAt: string | null
  hasUnpublishedChanges: boolean
}

const state = reactive<EditorState>({
  blocks: [],
  meta: { title: '', description: '' },
  publishedBlocks: null,
  draftUpdatedAt: null,
  publishedAt: null,
  hasUnpublishedChanges: false,
})

// Char limits per brief 26.
const META_TITLE_MAX = 70
const META_DESC_MAX = 180
const metaTitleRemaining = computed(() => META_TITLE_MAX - state.meta.title.length)
const metaDescRemaining = computed(() => META_DESC_MAX - state.meta.description.length)
const selectedId = ref<string | null>(null)
const paletteOpen = ref<null | { after: string | null }>(null)
const loading = ref(true)
const saving = ref(false)
const publishing = ref(false)
const saveError = ref<string | null>(null)
const lastPublicUrl = ref<string | null>(null)

// LocalStorage is now an offline fallback only. On load, we hit the API
// first; on autosave, we PATCH the API and also write here so a network
// blip doesn't lose the owner's work.
function storageKey(slug: PageSlug): string | null {
  const cid = clubStore.current?.id
  return cid ? `torny.website.${cid}.${slug}` : null
}
function readOffline(slug: PageSlug): Block[] | null {
  const key = storageKey(slug)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { blocks?: Block[] }
    return parsed.blocks ?? null
  } catch {
    return null
  }
}
function writeOffline(slug: PageSlug, blocks: Block[]): void {
  const key = storageKey(slug)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify({ blocks, savedAt: new Date().toISOString() }))
  } catch { /* full — non-fatal */ }
}

// Suppress autosave while `load()` is applying server state — otherwise
// the assignment fires the deep-watcher and PATCHes back the same blocks.
let suppressAutosave = false

async function load(slug: PageSlug): Promise<void> {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  loading.value = true
  saveError.value = null
  try {
    const server = await pages.get(clubId, slug)
    suppressAutosave = true
    state.blocks = (server.layout_draft?.blocks ?? []) as unknown as Block[]
    state.meta = {
      title: server.layout_draft?.meta?.title ?? '',
      description: server.layout_draft?.meta?.description ?? '',
    }
    state.publishedBlocks = (server.layout_published?.blocks ?? null) as unknown as Block[] | null
    state.draftUpdatedAt = server.draft_updated_at
    state.publishedAt = server.published_at
    state.hasUnpublishedChanges = server.has_unpublished_changes
    selectedId.value = state.blocks[0]?.id ?? null
    paletteOpen.value = null
    // Overwrite the offline cache with the server's authoritative draft.
    writeOffline(slug, state.blocks)
  } catch (err) {
    // Network / auth error — fall back to whatever's in localStorage.
    const offline = readOffline(slug)
    if (offline && offline.length > 0) {
      suppressAutosave = true
      state.blocks = offline
      state.publishedBlocks = null
      state.draftUpdatedAt = null
      state.publishedAt = null
      state.hasUnpublishedChanges = true
      selectedId.value = state.blocks[0]?.id ?? null
      toast.info('Offline — showing your last saved draft.')
    } else {
      // Nothing on server, nothing offline — start with the local seed.
      suppressAutosave = true
      state.blocks = seedFor(slug)()
      state.publishedBlocks = null
      state.draftUpdatedAt = null
      state.publishedAt = null
      state.hasUnpublishedChanges = true
      selectedId.value = state.blocks[0]?.id ?? null
    }
    if (err instanceof ApiError && err.status === 403) {
      saveError.value = "You don't have permission to edit this club's pages."
      toast.error(saveError.value)
    }
  } finally {
    loading.value = false
    // Allow autosave watcher to catch subsequent edits (next microtask
    // so the assignment above doesn't fire it).
    await Promise.resolve()
    suppressAutosave = false
  }
}

onMounted(() => {
  void pagesStore.load()
  if (!isSettingsView.value) void load(currentPage.value)
})
watch([() => clubStore.current?.id, currentPage, isSettingsView], ([, slug, settingsActive]) => {
  if (settingsActive) return
  void load(slug)
})
watch(() => clubStore.current?.id, () => { void pagesStore.load() })

// ── Sidebar page list, custom-page modals ────────────────
/**
 * Ordered list for the sidebar. Uses the store when it's loaded for the
 * active club, falling back to the six seed slugs before the first fetch
 * so the sidebar is never empty on first paint.
 */
const sidebarPages = computed(() => {
  if (pagesStore.byPosition.length > 0) return pagesStore.byPosition
  return SYSTEM_PAGE_SLUGS.map((slug, i) => ({
    id: -1 - i,
    slug,
    title: SYSTEM_PAGE_LABELS[slug],
    is_system: true,
    is_published: true,
    position: i,
    draft_updated_at: null,
    published_at: null,
    has_unpublished_changes: false,
  }))
})

const openMenuSlug = ref<string | null>(null)
function closeMenu(): void {
  openMenuSlug.value = null
}
if (typeof window !== 'undefined') {
  window.addEventListener('click', closeMenu)
}

// New-page modal
const newPageOpen = ref(false)
const newPageSubmitting = ref(false)
const newPageError = ref<string | null>(null)
const newPageForm = reactive({ title: '', slug: '', slugTouched: false })
function openNewPage(): void {
  newPageForm.title = ''
  newPageForm.slug = ''
  newPageForm.slugTouched = false
  newPageError.value = null
  newPageOpen.value = true
  closeMenu()
}
function onNewPageTitleInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  newPageForm.title = v
  if (!newPageForm.slugTouched) newPageForm.slug = slugifyTitle(v)
}
function onNewPageSlugInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  newPageForm.slug = v
  newPageForm.slugTouched = true
}
const newPageSlugStatus = computed<'ok' | 'reserved' | 'invalid' | 'conflict' | 'empty'>(() => {
  const s = newPageForm.slug.trim()
  if (!s) return 'empty'
  if (RESERVED_PAGE_SLUGS.includes(s)) return 'reserved'
  if (!isValidPageSlug(s)) return 'invalid'
  if (pagesStore.findBySlug(s)) return 'conflict'
  return 'ok'
})
const newPageCanSubmit = computed(() =>
  newPageForm.title.trim().length > 0 &&
  newPageForm.title.length <= 80 &&
  newPageSlugStatus.value === 'ok',
)
async function submitNewPage(): Promise<void> {
  if (!newPageCanSubmit.value) return
  newPageSubmitting.value = true
  newPageError.value = null
  try {
    const created = await pagesStore.create({
      slug: newPageForm.slug.trim(),
      title: newPageForm.title.trim(),
    })
    newPageOpen.value = false
    switchSection(created.slug)
    toast.success(`"${created.title}" created.`)
  } catch (err) {
    newPageError.value = pagesStore.messageForError(err, 'create')
  } finally {
    newPageSubmitting.value = false
  }
}

// Rename modal
const renameOpen = ref(false)
const renameSubmitting = ref(false)
const renameError = ref<string | null>(null)
const renameForm = reactive({
  originalSlug: '',
  isSystem: false,
  title: '',
  slug: '',
})
function openRename(p: { slug: string; title: string; is_system: boolean }): void {
  renameForm.originalSlug = p.slug
  renameForm.isSystem = p.is_system
  renameForm.title = p.title
  renameForm.slug = p.slug
  renameError.value = null
  renameOpen.value = true
  closeMenu()
}
const renameSlugChanged = computed(() => renameForm.slug !== renameForm.originalSlug)
const renameSlugStatus = computed<'ok' | 'reserved' | 'invalid' | 'conflict' | 'empty' | 'locked'>(() => {
  if (renameForm.isSystem && renameSlugChanged.value) return 'locked'
  const s = renameForm.slug.trim()
  if (!s) return 'empty'
  if (!renameSlugChanged.value) return 'ok'
  if (RESERVED_PAGE_SLUGS.includes(s)) return 'reserved'
  if (!isValidPageSlug(s)) return 'invalid'
  if (pagesStore.findBySlug(s)) return 'conflict'
  return 'ok'
})
const renameCanSubmit = computed(() =>
  renameForm.title.trim().length > 0 &&
  renameForm.title.length <= 80 &&
  renameSlugStatus.value === 'ok' &&
  (renameForm.title !== '' || renameSlugChanged.value),
)
async function submitRename(): Promise<void> {
  if (!renameCanSubmit.value) return
  // Warn once, upfront, if the slug is changing — inbound links will break.
  if (renameSlugChanged.value) {
    const ok = window.confirm(
      `Renaming this page's URL from /${renameForm.originalSlug} to /${renameForm.slug} will break any existing links to the old URL. Continue?`,
    )
    if (!ok) return
  }
  renameSubmitting.value = true
  renameError.value = null
  try {
    const patch: { title?: string; slug?: string } = {}
    if (renameForm.title.trim() !== '') patch.title = renameForm.title.trim()
    if (renameSlugChanged.value) patch.slug = renameForm.slug.trim()
    const res = await pagesStore.rename(renameForm.originalSlug, patch)
    renameOpen.value = false
    // If the current view is the page we just reslugged, follow it.
    if (currentSection.value === renameForm.originalSlug && res.slug !== renameForm.originalSlug) {
      switchSection(res.slug)
    }
    toast.success('Page updated.')
  } catch (err) {
    renameError.value = pagesStore.messageForError(err, 'rename')
  } finally {
    renameSubmitting.value = false
  }
}

// Delete modal — tiered confirmation.
const deleteOpen = ref(false)
const deleteSubmitting = ref(false)
const deleteError = ref<string | null>(null)
const deleteTarget = ref<{ slug: string; title: string; is_system: boolean; is_published: boolean } | null>(null)
const deleteConfirmText = ref('')
function openDelete(p: { slug: string; title: string; is_system: boolean; is_published: boolean }): void {
  deleteTarget.value = { ...p }
  deleteConfirmText.value = ''
  deleteError.value = null
  deleteOpen.value = true
  closeMenu()
}
const deleteRequiresTypeToConfirm = computed(
  () => !!deleteTarget.value && (deleteTarget.value.is_system || deleteTarget.value.is_published),
)
const deleteCanSubmit = computed(() => {
  if (!deleteTarget.value) return false
  if (!deleteRequiresTypeToConfirm.value) return true
  return deleteConfirmText.value.trim().toLowerCase() === deleteTarget.value.title.trim().toLowerCase()
})
async function submitDelete(): Promise<void> {
  if (!deleteTarget.value || !deleteCanSubmit.value) return
  const target = deleteTarget.value
  deleteSubmitting.value = true
  deleteError.value = null
  try {
    await pagesStore.remove(target.slug)
    deleteOpen.value = false
    toast.success(`"${target.title}" deleted.`)
    // If we were viewing that page, bounce to home.
    if (currentSection.value === target.slug) switchSection('home')
  } catch (err) {
    deleteError.value = pagesStore.messageForError(err, 'rename')
  } finally {
    deleteSubmitting.value = false
  }
}

const selectedBlock = computed<Block | null>(() => state.blocks.find((b) => b.id === selectedId.value) ?? null)

const hasUnpublishedChanges = computed(() => state.hasUnpublishedChanges)

// ── Autosave (real API + offline mirror) ──────────────────
async function autosave(): Promise<void> {
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  const slug = currentPage.value
  saving.value = true
  saveError.value = null
  // Always mirror to localStorage so a mid-flight failure doesn't lose work.
  writeOffline(slug, state.blocks)
  try {
    const title = state.meta.title.trim()
    const description = state.meta.description.trim()
    const meta = title || description
      ? {
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
        }
      : null
    const res = await pages.patch(clubId, slug, {
      blocks: state.blocks as unknown as PageBlock[],
      meta,
    })
    state.draftUpdatedAt = res.draft_updated_at
    state.hasUnpublishedChanges = true  // draft is now newer than published
  } catch (err) {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'too_many_blocks':
          saveError.value = 'That page has too many blocks — keep it under 50.'
          break
        case 'payload_too_large':
          saveError.value = 'Page content too large to save (200 KB max).'
          break
        case 'unknown_block_type':
          saveError.value = `Unknown block type "${err.body?.type ?? ''}" — refresh to reset.`
          break
        case 'invalid_block_shape':
          saveError.value = 'A block is missing required fields — refresh to reset.'
          break
        default:
          saveError.value = err.status === 403
            ? "You don't have permission to edit this club's pages."
            : (err.message || 'Save failed — retrying will resume when the network returns.')
      }
      toast.error(saveError.value)
    } else {
      // Silent — the offline mirror caught it, we'll retry on the next edit.
      saveError.value = 'Offline — changes saved locally and will sync when reconnected.'
    }
  } finally {
    saving.value = false
  }
}

// Debounced autosave on any change to the layout.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (suppressAutosave) return
  if (saveTimer) clearTimeout(saveTimer)
  saving.value = true
  saveTimer = setTimeout(() => {
    void autosave()
  }, 500)
}

watch(() => state.blocks, scheduleSave, { deep: true })
watch(() => state.meta, scheduleSave, { deep: true })

// ── Block ops ─────────────────────────────────────────────
function addBlock(type: BlockType, afterId: string | null): void {
  const palette = paletteFor(currentPage.value).find((p) => p.type === type)
  if (!palette) return
  const block = { id: newBlockId(), type, props: palette.defaults() } as Block
  const idx = afterId ? state.blocks.findIndex((b) => b.id === afterId) : -1
  if (idx === -1) state.blocks.push(block)
  else state.blocks.splice(idx + 1, 0, block)
  selectedId.value = block.id
  paletteOpen.value = null
}

function removeBlock(id: string): void {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  state.blocks.splice(idx, 1)
  if (selectedId.value === id) selectedId.value = state.blocks[Math.max(0, idx - 1)]?.id ?? null
}

function moveBlock(id: string, dir: -1 | 1): void {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  const target = idx + dir
  if (target < 0 || target >= state.blocks.length) return
  const [block] = state.blocks.splice(idx, 1) as [Block]
  state.blocks.splice(target, 0, block)
}

function resetBlock(id: string): void {
  const idx = state.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return
  const block = state.blocks[idx]!
  const palette = paletteFor(currentPage.value).find((p) => p.type === block.type)
  if (!palette) return
  const label = BLOCK_LABEL[block.type]
  if (!window.confirm(`Reset ${label} to defaults? This replaces your current content for this block.`)) return
  // Fresh id so Vue's :key sees a new block and re-mounts the inspector.
  const fresh = { id: newBlockId(), type: block.type, props: palette.defaults() } as Block
  state.blocks.splice(idx, 1, fresh)
  selectedId.value = fresh.id
}

// ── Publish (real API) ────────────────────────────────────
async function publish(): Promise<void> {
  if (!hasUnpublishedChanges.value) return
  const clubId = clubStore.current?.id
  if (typeof clubId !== 'number') return
  const slug = currentPage.value
  publishing.value = true
  try {
    const res = await pages.publish(clubId, slug)
    state.publishedBlocks = JSON.parse(JSON.stringify(state.blocks)) as Block[]
    state.publishedAt = res.published_at
    state.hasUnpublishedChanges = false
    lastPublicUrl.value = res.public_url
    toast.success(`${pageLabel(slug)} page published.`)
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'empty_draft') {
        toast.error('Add at least one block before publishing.')
      } else if (err.status === 403) {
        toast.error("You don't have permission to publish this club's pages.")
      } else {
        toast.error(err.message || 'Publish failed — try again in a moment.')
      }
    } else {
      toast.error('Publish failed — check your connection and try again.')
    }
  } finally {
    publishing.value = false
  }
}

const PREVIEW_PATHS: Record<SystemPageSlug, string> = {
  home: '/',
  about: '/about',
  membership: '/membership',
  events: '/events',
  'honour-board': '/honour-board',
  contact: '/contact',
}
function previewPathFor(slug: PageSlug): string {
  return (PREVIEW_PATHS as Record<string, string>)[slug] ?? `/${slug}`
}

/** Palette for a page — system palettes are curated; custom pages get a
 *  union of every block type so nothing is missing. */
function paletteFor(slug: PageSlug): PaletteItem[] {
  const p = (PALETTES as Record<string, PaletteItem[]>)[slug]
  if (p) return p
  return PALETTES.home
}
function seedFor(slug: PageSlug): () => Block[] {
  const s = (SEEDS as Record<string, () => Block[]>)[slug]
  return s ?? (() => [])
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function preview(): Promise<void> {
  // Prefer onboarding.subdomain — the guard already hydrated it and it's
  // the authoritative slug the tenant middleware resolves on. Fall back to
  // clubStore.current.slug (backfilled from /clubs/:id), then to a
  // slugified club name so the button never dead-ends.
  if (!onboarding.data.subdomain && !clubStore.current?.slug) {
    // Guard should have hydrated, but on a fresh reload of /crm/website
    // there's a race — force it.
    await Promise.all([onboarding.hydrate(), clubStore.hydrateFull()])
  }
  const slug =
    (onboarding.data.subdomain?.trim() || null) ??
    clubStore.current?.slug ??
    (clubStore.current?.name ? slugify(clubStore.current.name) : null)

  if (!slug) {
    toast.error("Couldn't get this club's slug — try refreshing.")
    return
  }
  const path = previewPathFor(currentPage.value)
  // Dev: hits the Nuxt club-sites app (port 3001, `PORT=3001 pnpm dev`).
  // The `?host=` override lets the tenant middleware pick the right club
  // without needing a real DNS entry. In prod this button should link to
  // the club's live domain instead — swap when we ship staging URLs.
  window.open(`http://localhost:3001${path}?host=${slug}.torny.club`, '_blank', 'noopener')
}

// ── Block summary (shown in the list row) ─────────────────
function blockSummary(block: Block): string {
  switch (block.type) {
    case 'hero':          return (block.props as HeroProps).heading || '(no heading)'
    case 'richText':      return stripHtml((block.props as RichTextProps).html).slice(0, 60)
    case 'eventList':     return (block.props as EventListProps).heading ?? `${(block.props as EventListProps).limit ?? 4} upcoming events`
    case 'honourBoard':   return (block.props as HonourBoardProps).heading || `Honour board — last ${(block.props as HonourBoardProps).yearsToShow ?? 10} years`
    case 'honourBoardSearch': return (block.props as HonourBoardSearchProps).heading || 'Full searchable honour board'
    case 'gallery':       return `${(block.props as GalleryProps).images.length} photos`
    case 'contactForm':   return (block.props as ContactFormProps).heading || 'Contact form'
    case 'membershipCta': return (block.props as MembershipCtaProps).heading || '(no heading)'
    case 'ctaBanner':     return (block.props as CtaBannerProps).heading || '(no heading)'
    case 'mediaSplit':    return (block.props as MediaSplitProps).heading || '(no heading)'
    case 'sectionTitle':  return (block.props as SectionTitleProps).heading || '(no heading)'
    case 'pullQuote':     return stripHtml((block.props as PullQuoteProps).quote).slice(0, 60)
    case 'featureGrid':   return (block.props as FeatureGridProps).heading || `${(block.props as FeatureGridProps).items.length} features`
    case 'faqAccordion':  return (block.props as FaqAccordionProps).heading || `${(block.props as FaqAccordionProps).items.length} questions`
    case 'fullBleedImage':return (block.props as FullBleedImageProps).heading || '(no heading)'
    case 'timeline':      return (block.props as TimelineProps).heading || `${(block.props as TimelineProps).entries.length} milestones`
    case 'twoColumn':     return (block.props as TwoColumnProps).heading || 'Two-column text'
    case 'divider':       return `Divider · ${(block.props as DividerProps).variant ?? 'hairline'}`
    default:              return ''
  }
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const lastSavedLabel = computed(() => {
  if (loading.value) return 'Loading…'
  if (saving.value) return 'Saving…'
  if (!state.draftUpdatedAt) return ''
  const then = new Date(state.draftUpdatedAt).getTime()
  const ago = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (ago < 5) return 'Saved'
  if (ago < 60) return `Saved ${ago}s ago`
  if (ago < 3600) return `Saved ${Math.round(ago / 60)}m ago`
  return `Saved ${Math.round(ago / 3600)}h ago`
})
</script>

<template>
  <div class="web">
    <header class="web__header">
      <div>
        <div class="web__eyebrow">Website</div>
        <h1 v-if="isSettingsView && currentSettings" class="web__heading">{{ SETTINGS_LABELS[currentSettings] }}</h1>
        <h1 v-else class="web__heading">{{ pageLabel(currentPage) }} page</h1>
        <p v-if="isSettingsView && currentSettings" class="web__sub">{{ SETTINGS_SUBTITLES[currentSettings] }}</p>
        <p v-else class="web__sub">{{ pageSubtitle(currentPage) }}</p>
      </div>
      <div v-if="!isSettingsView" class="web__actions">
        <span class="web__save-hint">{{ lastSavedLabel }}</span>
        <a v-if="lastPublicUrl" :href="lastPublicUrl" target="_blank" rel="noopener" class="web__live-link">View live →</a>
        <button class="btn btn--outline" @click="preview">Preview →</button>
        <button
          class="btn btn--primary"
          :disabled="!hasUnpublishedChanges || publishing || loading"
          @click="publish"
        >
          {{ publishing ? 'Publishing…' : hasUnpublishedChanges ? 'Publish changes' : 'Published' }}
        </button>
      </div>
    </header>

    <nav class="section-tabs" aria-label="Website sections">
      <div class="section-tabs__toggle" role="tablist" aria-label="Section type">
        <button
          type="button"
          class="section-tabs__toggle-btn"
          :class="{ 'section-tabs__toggle-btn--active': !isSettingsView }"
          role="tab"
          :aria-selected="!isSettingsView"
          @click="switchSection('home')"
        >Pages</button>
        <button
          type="button"
          class="section-tabs__toggle-btn"
          :class="{ 'section-tabs__toggle-btn--active': isSettingsView }"
          role="tab"
          :aria-selected="isSettingsView"
          @click="switchSection('navigation')"
        >Settings</button>
      </div>
      <div v-if="isSettingsView" class="section-tabs__row" role="group" aria-label="Settings">
        <button
          v-for="slug in SETTINGS_SLUGS"
          :key="slug"
          type="button"
          class="page-tab"
          :class="{ 'page-tab--active': currentSection === slug }"
          @click="switchSection(slug)"
        >{{ SETTINGS_LABELS[slug] }}</button>
      </div>
    </nav>

    <WebsiteSettingsPanel v-if="isSettingsView && currentSettings" :section="currentSettings" />

    <div v-else class="web__body">
      <!-- Pages sidebar — reads from the store so custom pages appear
           the moment they're created. System pages get a lock badge on
           the slug; custom pages get a hover menu (Rename · Delete). -->
      <aside class="pages-nav" aria-label="Pages">
        <div class="pages-nav__head">
          <span class="pages-nav__label">Pages</span>
        </div>
        <ul v-if="pagesStore.loading && sidebarPages.length === 0" class="pages-nav__list" aria-busy="true" aria-label="Loading pages">
          <li v-for="n in 6" :key="`skel-${n}`" class="pages-nav__row pages-nav__row--skel">
            <Skeleton :width="`${70 - n * 6}%`" />
          </li>
        </ul>
        <ul v-else class="pages-nav__list">
          <li
            v-for="p in sidebarPages"
            :key="p.slug"
            class="pages-nav__row"
            :class="{ 'pages-nav__row--active': currentSection === p.slug }"
          >
            <button
              type="button"
              class="pages-nav__item"
              @click="switchSection(p.slug)"
            >
              <span class="pages-nav__item-name">{{ p.title }}</span>
              <span v-if="p.is_system" class="pages-nav__lock" aria-hidden="true" title="System page — slug is locked">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 4.5V3.2a2 2 0 0 1 4 0v1.3" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="4.5" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
              </span>
              <span v-if="!p.is_published" class="pages-nav__draft" aria-label="Draft only">Draft</span>
              <span v-if="currentSection === p.slug" class="pages-nav__item-dot" aria-hidden="true" />
            </button>
            <button
              v-if="!p.is_system"
              type="button"
              class="pages-nav__menu"
              :aria-expanded="openMenuSlug === p.slug"
              aria-label="Page actions"
              @click.stop="openMenuSlug = openMenuSlug === p.slug ? null : p.slug"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="3" cy="7" r="1" fill="currentColor"/>
                <circle cx="7" cy="7" r="1" fill="currentColor"/>
                <circle cx="11" cy="7" r="1" fill="currentColor"/>
              </svg>
            </button>
            <div v-if="openMenuSlug === p.slug" class="pages-nav__menu-pop" @click.stop>
              <button type="button" class="pages-nav__menu-item" @click="openRename(p)">Rename…</button>
              <button type="button" class="pages-nav__menu-item pages-nav__menu-item--danger" @click="openDelete(p)">Delete…</button>
            </div>
          </li>
        </ul>
        <button
          type="button"
          class="pages-nav__add"
          @click="openNewPage"
        >+ New page</button>
      </aside>

      <!-- Block list -->
      <section class="list">
        <!-- Per-page SEO — always visible at the top of the block editor. -->
        <details class="seo-card" open>
          <summary class="seo-card__head">
            <span class="seo-card__label">SEO</span>
            <span class="seo-card__title">Meta title &amp; description</span>
            <span class="seo-card__hint">Blank fields fall back to the site default and then to the club name.</span>
            <svg class="seo-card__chev" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3.5 5.5L7 9L10.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </summary>
          <div class="seo-card__body">
            <label class="seo-field">
              <span class="seo-field__label">Meta title</span>
              <input
                v-model="state.meta.title"
                type="text"
                :maxlength="META_TITLE_MAX + 20"
                :placeholder="`${pageLabel(currentPage)} — ${clubStore.current?.name ?? 'Your club'}`"
              />
              <span class="seo-field__counter" :class="{ 'seo-field__counter--over': metaTitleRemaining < 0 }">{{ metaTitleRemaining }}</span>
            </label>
            <label class="seo-field">
              <span class="seo-field__label">Meta description</span>
              <textarea
                v-model="state.meta.description"
                rows="2"
                :maxlength="META_DESC_MAX + 40"
                :placeholder="pageSubtitle(currentPage)"
              />
              <span class="seo-field__counter" :class="{ 'seo-field__counter--over': metaDescRemaining < 0 }">{{ metaDescRemaining }}</span>
            </label>
          </div>
        </details>

        <!-- Loading — skeleton block cards until the fetch lands. -->
        <div v-if="loading && state.blocks.length === 0" class="blocks-skel" aria-busy="true" aria-label="Loading page">
          <article v-for="n in 3" :key="`skel-${n}`" class="block block--skel">
            <div class="block__handle" />
            <div class="block__body">
              <Skeleton width="70px" />
              <Skeleton :width="`${70 - n * 8}%`" height-variant="lg" style="margin-top: 8px;" />
            </div>
          </article>
        </div>

        <div v-else-if="state.blocks.length === 0" class="empty">
          <div class="empty__title">Empty page.</div>
          <div class="empty__hint">Pick your first block to get started.</div>
          <button type="button" class="btn btn--primary" @click="paletteOpen = { after: null }">+ Add block</button>
        </div>

        <template v-for="(block, i) in state.blocks" :key="block.id">
          <!-- Insert-here slot above every block -->
          <div class="inserter" :class="{ 'inserter--open': paletteOpen?.after === (state.blocks[i - 1]?.id ?? null) && i === 0 }">
            <button v-if="i === 0" type="button" class="inserter__btn" @click="paletteOpen = { after: null }">+ Add block</button>
          </div>

          <!-- Block card -->
          <article
            class="block"
            :class="{ 'block--selected': selectedId === block.id }"
            @click="selectedId = block.id"
          >
            <div class="block__handle">
              <button type="button" class="block__arrow" :disabled="i === 0" @click.stop="moveBlock(block.id, -1)" aria-label="Move up">▲</button>
              <button type="button" class="block__arrow" :disabled="i === state.blocks.length - 1" @click.stop="moveBlock(block.id, 1)" aria-label="Move down">▼</button>
            </div>
            <div class="block__body">
              <div class="block__type">{{ BLOCK_LABEL[block.type] }}</div>
              <div class="block__summary">{{ blockSummary(block) }}</div>
            </div>
            <button type="button" class="block__delete" @click.stop="removeBlock(block.id)" aria-label="Delete">×</button>
          </article>

          <!-- Insert-here slot below every block -->
          <div class="inserter">
            <button type="button" class="inserter__btn" @click="paletteOpen = { after: block.id }">+ Add block</button>
          </div>
        </template>
      </section>

      <BlockPaletteDialog
        :open="paletteOpen !== null"
        :items="paletteFor(currentPage)"
        @close="paletteOpen = null"
        @select="(t) => addBlock(t, paletteOpen?.after ?? null)"
      />

      <!-- Inspector -->
      <aside class="inspector">
        <div v-if="!selectedBlock" class="inspector__empty">
          <div class="inspector__empty-title">Nothing selected</div>
          <div class="inspector__empty-hint">Click a block on the left to edit its content.</div>
        </div>

        <template v-else>
          <div class="inspector__head">
            <div class="inspector__head-text">
              <div class="inspector__label">Editing</div>
              <div class="inspector__title">{{ BLOCK_LABEL[selectedBlock.type] }}</div>
            </div>
            <button
              type="button"
              class="inspector__reset"
              @click="resetBlock(selectedBlock.id)"
              title="Reset this block to the template defaults"
            >
              ↺ Reset
            </button>
          </div>

          <!-- Hero -->
          <template v-if="selectedBlock.type === 'hero'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as HeroProps).eyebrow" type="text" placeholder="Est. 1953 · Hutt Valley" />
              <span class="field__hint">Small label above the heading. Mono, uppercase.</span>
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock!.props as HeroProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Description</span>
              <textarea v-model="(selectedBlock!.props as HeroProps).description" rows="3" placeholder="A paragraph under the heading." />
            </label>
            <div class="field">
              <ImagePicker
                v-model="(selectedBlock!.props as HeroProps).imageUrl"
                :image-id="(selectedBlock!.props as HeroProps).imageId ?? null"
                @update:image-id="(v) => (selectedBlock!.props as HeroProps).imageId = v"
                :page-slug="currentPage"
                :block-id="selectedBlock!.id"
                label="Media image (optional)"
                aspect="1 / 1"
                hint="Fills the right side. Leave empty for a gradient."
              />
            </div>
            <label class="field">
              <span class="field__label">Media caption</span>
              <input v-model="(selectedBlock!.props as HeroProps).mediaCaption" type="text" placeholder="Green A · Friday twilight" />
              <span class="field__hint">Pill on the media panel. Leave empty to hide.</span>
            </label>
            <div class="field__group">
              <div class="field__group-title">Primary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as HeroProps).primaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).primaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as HeroProps).primaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as HeroProps).primaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).primaryCta = { label: (selectedBlock!.props as HeroProps).primaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" placeholder="/membership" />
              </label>
            </div>
            <div class="field__group">
              <div class="field__group-title">Secondary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as HeroProps).secondaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).secondaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as HeroProps).secondaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as HeroProps).secondaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as HeroProps).secondaryCta = { label: (selectedBlock!.props as HeroProps).secondaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" placeholder="/events" />
              </label>
            </div>
          </template>

          <!-- Rich text -->
          <template v-else-if="selectedBlock.type === 'richText'">
            <label class="field">
              <span class="field__label">HTML</span>
              <textarea v-model="(selectedBlock.props as RichTextProps).html" rows="8" class="field__mono" />
              <span class="field__hint">Rich text editor coming — for now, paste HTML. Basic tags only.</span>
            </label>
          </template>

          <!-- Event list -->
          <template v-else-if="selectedBlock.type === 'eventList'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as EventListProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Limit (max events shown)</span>
              <input v-model.number="(selectedBlock.props as EventListProps).limit" type="number" min="1" max="20" />
            </label>
            <label class="switch-row">
              <div>
                <div class="switch-row__label">Upcoming only</div>
                <div class="switch-row__hint">Hide past events even if the calendar has them.</div>
              </div>
              <button
                type="button"
                class="switch"
                :class="{ 'is-on': (selectedBlock.props as EventListProps).upcomingOnly !== false }"
                @click="(selectedBlock.props as EventListProps).upcomingOnly = !(selectedBlock.props as EventListProps).upcomingOnly"
              ><span class="switch__knob" /></button>
            </label>
          </template>

          <!-- Honour board -->
          <template v-else-if="selectedBlock.type === 'honourBoard'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).eyebrow" type="text" placeholder="Honour board · Since 1953" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).heading" type="text" placeholder="Champions." />
            </label>
            <label class="field">
              <span class="field__label">Description</span>
              <textarea v-model="(selectedBlock.props as HonourBoardProps).description" rows="3" placeholder="One or two lines of context above the champion." />
            </label>
            <label class="field">
              <span class="field__label">Category slug</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).categorySlug" type="text" placeholder="champion-of-champions" />
              <span class="field__hint">Which honour-board category to feature. Leave blank to pull from all.</span>
            </label>
            <label class="field">
              <span class="field__label">Recent winners to show</span>
              <input v-model.number="(selectedBlock.props as HonourBoardProps).yearsToShow" type="number" min="1" max="12" />
              <span class="field__hint">Sits below the reigning champion feature card.</span>
            </label>
            <div class="field__group">
              <div class="field__group-title">CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input v-model="(selectedBlock.props as HonourBoardProps).ctaLabel" type="text" placeholder="See the whole honour board" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input v-model="(selectedBlock.props as HonourBoardProps).ctaHref" type="text" placeholder="/honour-board" />
              </label>
            </div>
          </template>

          <!-- Honour board — full searchable page (brief 31) -->
          <template v-else-if="selectedBlock.type === 'honourBoardSearch'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock.props as HonourBoardSearchProps).eyebrow" type="text" placeholder="Leave blank for auto-count · year range" />
              <span class="field__hint">Overrides the auto-generated "N categories · YYYY–YYYY" line.</span>
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as HonourBoardSearchProps).heading" type="text" placeholder="The honour board." />
            </label>
            <label class="field">
              <span class="field__label">Description</span>
              <textarea v-model="(selectedBlock.props as HonourBoardSearchProps).description" rows="3" placeholder="One line of context above the search." />
            </label>
            <label class="field">
              <span class="field__label">Page size</span>
              <input v-model.number="(selectedBlock.props as HonourBoardSearchProps).pageSize" type="number" min="10" max="100" step="10" />
              <span class="field__hint">Rows per "Load older" page. 50 is a sensible default.</span>
            </label>
          </template>

          <!-- Contact form -->
          <template v-else-if="selectedBlock.type === 'contactForm'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as ContactFormProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Submit button label</span>
              <input v-model="(selectedBlock.props as ContactFormProps).submitLabel" type="text" placeholder="Send" />
            </label>
            <label class="field">
              <span class="field__label">Success message</span>
              <textarea v-model="(selectedBlock.props as ContactFormProps).successMessage" rows="2" placeholder="Thanks — we'll be in touch." />
            </label>
          </template>

          <!-- Membership CTA -->
          <template v-else-if="selectedBlock.type === 'membershipCta'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Body</span>
              <textarea v-model="(selectedBlock.props as MembershipCtaProps).body" rows="3" />
            </label>
            <label class="field">
              <span class="field__label">Button label</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).ctaLabel" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Button link</span>
              <input v-model="(selectedBlock.props as MembershipCtaProps).ctaHref" type="text" placeholder="/membership" />
            </label>
          </template>

          <!-- CTA banner -->
          <template v-else-if="selectedBlock.type === 'ctaBanner'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Body (optional)</span>
              <textarea v-model="(selectedBlock.props as CtaBannerProps).body" rows="2" />
            </label>
            <label class="field">
              <span class="field__label">Button label</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).ctaLabel" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Button link</span>
              <input v-model="(selectedBlock.props as CtaBannerProps).ctaHref" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Tone</span>
              <select v-model="(selectedBlock.props as CtaBannerProps).tone">
                <option value="accent">Accent</option>
                <option value="ink">Ink (dark)</option>
                <option value="surface">Surface (light)</option>
              </select>
            </label>
          </template>

          <!-- Gallery -->
          <template v-else-if="selectedBlock.type === 'gallery'">
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock.props as GalleryProps).heading" type="text" />
            </label>
            <div class="field">
              <span class="field__label">Images ({{ (selectedBlock.props as GalleryProps).images.length }})</span>
              <div v-for="(img, ii) in (selectedBlock.props as GalleryProps).images" :key="ii" class="gallery-item">
                <ImagePicker v-model="img.url" content-type="gallery" aspect="4 / 3" />
                <input v-model="img.alt" placeholder="Alt text (for screen readers)" type="text" class="gallery-item__alt" />
                <button type="button" class="gallery-item__remove" @click="(selectedBlock!.props as GalleryProps).images.splice(ii, 1)">Remove</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock!.props as GalleryProps).images.push({ url: '', alt: '' })">+ Add image</button>
            </div>
          </template>

          <!-- Media split -->
          <template v-else-if="selectedBlock.type === 'mediaSplit'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as MediaSplitProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <textarea v-model="(selectedBlock!.props as MediaSplitProps).heading" rows="2" />
            </label>
            <div class="field">
              <span class="field__label">Body paragraphs</span>
              <textarea
                v-for="(_, pi) in (selectedBlock!.props as MediaSplitProps).bodyParagraphs ?? []"
                :key="pi"
                v-model="(selectedBlock!.props as MediaSplitProps).bodyParagraphs![pi]"
                rows="3"
              />
              <button type="button" class="gallery-add" @click="((selectedBlock!.props as MediaSplitProps).bodyParagraphs ??= []).push('')">+ Add paragraph</button>
            </div>
            <label class="field">
              <span class="field__label">Media side</span>
              <select v-model="(selectedBlock!.props as MediaSplitProps).mediaSide">
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label class="field">
              <span class="field__label">Background</span>
              <select v-model="(selectedBlock!.props as MediaSplitProps).background">
                <option value="ground">White</option>
                <option value="surface">Surface</option>
              </select>
            </label>
            <div class="field">
              <ImagePicker
                v-model="(selectedBlock!.props as MediaSplitProps).imageUrl"
                :page-slug="currentPage"
                :block-id="selectedBlock!.id"
                label="Media image"
                aspect="7 / 6"
              />
            </div>
            <label class="field">
              <span class="field__label">Media caption</span>
              <input v-model="(selectedBlock!.props as MediaSplitProps).mediaCaption" type="text" />
            </label>
            <div class="field__group">
              <div class="field__group-title">Primary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as MediaSplitProps).primaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as MediaSplitProps).primaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as MediaSplitProps).primaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as MediaSplitProps).primaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as MediaSplitProps).primaryCta = { label: (selectedBlock!.props as MediaSplitProps).primaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" />
              </label>
            </div>
            <div class="field__group">
              <div class="field__group-title">Secondary CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as MediaSplitProps).secondaryCta?.label ?? ''"
                       @input="e => (selectedBlock!.props as MediaSplitProps).secondaryCta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as MediaSplitProps).secondaryCta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as MediaSplitProps).secondaryCta?.href ?? ''"
                       @input="e => (selectedBlock!.props as MediaSplitProps).secondaryCta = { label: (selectedBlock!.props as MediaSplitProps).secondaryCta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" />
              </label>
            </div>
          </template>

          <!-- Section title -->
          <template v-else-if="selectedBlock.type === 'sectionTitle'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as SectionTitleProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <textarea v-model="(selectedBlock!.props as SectionTitleProps).heading" rows="3" />
            </label>
            <label class="field">
              <span class="field__label">Body</span>
              <textarea v-model="(selectedBlock!.props as SectionTitleProps).body" rows="3" />
            </label>
            <label class="field">
              <span class="field__label">Alignment</span>
              <select v-model="(selectedBlock!.props as SectionTitleProps).align">
                <option value="center">Center</option>
                <option value="left">Left</option>
              </select>
            </label>
          </template>

          <!-- Pull quote -->
          <template v-else-if="selectedBlock.type === 'pullQuote'">
            <label class="field">
              <span class="field__label">Quote</span>
              <textarea v-model="(selectedBlock!.props as PullQuoteProps).quote" rows="4" />
            </label>
            <label class="field">
              <span class="field__label">Author name</span>
              <input v-model="(selectedBlock!.props as PullQuoteProps).authorName" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Author role</span>
              <input v-model="(selectedBlock!.props as PullQuoteProps).authorRole" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Author initials</span>
              <input v-model="(selectedBlock!.props as PullQuoteProps).authorInitials" type="text" maxlength="3" />
              <span class="field__hint">Used when no avatar image is set.</span>
            </label>
            <div class="field">
              <ImagePicker
                v-model="(selectedBlock!.props as PullQuoteProps).authorAvatarUrl"
                :page-slug="currentPage"
                :block-id="selectedBlock!.id"
                label="Author avatar (optional)"
                aspect="1 / 1"
              />
            </div>
          </template>

          <!-- Feature grid -->
          <template v-else-if="selectedBlock.type === 'featureGrid'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as FeatureGridProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock!.props as FeatureGridProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Columns</span>
              <select v-model.number="(selectedBlock!.props as FeatureGridProps).columns">
                <option :value="2">2</option>
                <option :value="3">3</option>
                <option :value="4">4</option>
              </select>
            </label>
            <div class="field">
              <span class="field__label">Features ({{ (selectedBlock!.props as FeatureGridProps).items.length }})</span>
              <div v-for="(item, fi) in (selectedBlock!.props as FeatureGridProps).items" :key="fi" class="field__group">
                <div class="field__group-title">#{{ fi + 1 }}</div>
                <input v-model="item.title" placeholder="Title" type="text" />
                <textarea v-model="item.body" placeholder="Body" rows="2" />
                <input v-model="item.linkLabel" placeholder="Link label" type="text" />
                <input v-model="item.linkHref" placeholder="Link href (e.g. /about)" type="text" />
                <select v-model="item.icon">
                  <option value="target">Target</option>
                  <option value="people">People</option>
                  <option value="star">Star</option>
                  <option value="calendar">Calendar</option>
                  <option value="trophy">Trophy</option>
                  <option value="sparkle">Sparkle</option>
                  <option value="coffee">Coffee</option>
                  <option value="bolt">Bolt</option>
                </select>
                <select v-model="item.iconTone">
                  <option value="accent">Accent (blue)</option>
                  <option value="mint">Mint</option>
                  <option value="tangerine">Tangerine</option>
                  <option value="violet">Violet</option>
                  <option value="sky">Sky</option>
                  <option value="amber">Amber</option>
                </select>
                <button type="button" class="gallery-item__remove" @click="(selectedBlock!.props as FeatureGridProps).items.splice(fi, 1)">Remove</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock!.props as FeatureGridProps).items.push({ title: 'New feature', body: '', icon: 'star', iconTone: 'accent' })">+ Add feature</button>
            </div>
          </template>

          <!-- FAQ accordion -->
          <template v-else-if="selectedBlock.type === 'faqAccordion'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as FaqAccordionProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <textarea v-model="(selectedBlock!.props as FaqAccordionProps).heading" rows="2" />
            </label>
            <label class="field">
              <span class="field__label">Support text</span>
              <textarea v-model="(selectedBlock!.props as FaqAccordionProps).supportText" rows="2" />
            </label>
            <div class="field__group">
              <div class="field__group-title">CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as FaqAccordionProps).cta?.label ?? ''"
                       @input="e => (selectedBlock!.props as FaqAccordionProps).cta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as FaqAccordionProps).cta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as FaqAccordionProps).cta?.href ?? ''"
                       @input="e => (selectedBlock!.props as FaqAccordionProps).cta = { label: (selectedBlock!.props as FaqAccordionProps).cta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" />
              </label>
            </div>
            <div class="field">
              <span class="field__label">Questions ({{ (selectedBlock!.props as FaqAccordionProps).items.length }})</span>
              <div v-for="(q, qi) in (selectedBlock!.props as FaqAccordionProps).items" :key="qi" class="field__group">
                <div class="field__group-title">#{{ qi + 1 }}</div>
                <input v-model="q.question" placeholder="Question" type="text" />
                <textarea v-model="q.answer" placeholder="Answer" rows="3" />
                <button type="button" class="gallery-item__remove" @click="(selectedBlock!.props as FaqAccordionProps).items.splice(qi, 1)">Remove</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock!.props as FaqAccordionProps).items.push({ question: 'New question', answer: '' })">+ Add question</button>
            </div>
          </template>

          <!-- Full-bleed image -->
          <template v-else-if="selectedBlock.type === 'fullBleedImage'">
            <div class="field">
              <ImagePicker
                v-model="(selectedBlock!.props as FullBleedImageProps).imageUrl"
                :page-slug="currentPage"
                :block-id="selectedBlock!.id"
                label="Background image"
                aspect="16 / 9"
              />
            </div>
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as FullBleedImageProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <textarea v-model="(selectedBlock!.props as FullBleedImageProps).heading" rows="2" />
            </label>
            <label class="field">
              <span class="field__label">Subheading</span>
              <textarea v-model="(selectedBlock!.props as FullBleedImageProps).subheading" rows="2" />
            </label>
            <label class="field">
              <span class="field__label">Overlay darkness</span>
              <input v-model.number="(selectedBlock!.props as FullBleedImageProps).overlayOpacity" type="number" min="0" max="1" step="0.05" />
              <span class="field__hint">0 = clear, 1 = solid.</span>
            </label>
            <div class="field__group">
              <div class="field__group-title">CTA</div>
              <label class="field">
                <span class="field__label">Label</span>
                <input :value="(selectedBlock!.props as FullBleedImageProps).cta?.label ?? ''"
                       @input="e => (selectedBlock!.props as FullBleedImageProps).cta = { label: (e.target as HTMLInputElement).value, href: (selectedBlock!.props as FullBleedImageProps).cta?.href ?? '' }"
                       type="text" />
              </label>
              <label class="field">
                <span class="field__label">Link</span>
                <input :value="(selectedBlock!.props as FullBleedImageProps).cta?.href ?? ''"
                       @input="e => (selectedBlock!.props as FullBleedImageProps).cta = { label: (selectedBlock!.props as FullBleedImageProps).cta?.label ?? '', href: (e.target as HTMLInputElement).value }"
                       type="text" />
              </label>
            </div>
            <label class="field">
              <span class="field__label">Top badge label</span>
              <input :value="(selectedBlock!.props as FullBleedImageProps).topBadge?.label ?? ''"
                     @input="e => (selectedBlock!.props as FullBleedImageProps).topBadge = { label: (e.target as HTMLInputElement).value, tone: (selectedBlock!.props as FullBleedImageProps).topBadge?.tone ?? 'green' }"
                     type="text" />
            </label>
            <label class="field">
              <span class="field__label">Bottom caption</span>
              <input v-model="(selectedBlock!.props as FullBleedImageProps).bottomCaption" type="text" />
            </label>
          </template>

          <!-- Timeline -->
          <template v-else-if="selectedBlock.type === 'timeline'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as TimelineProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock!.props as TimelineProps).heading" type="text" />
            </label>
            <div class="field">
              <span class="field__label">Entries ({{ (selectedBlock!.props as TimelineProps).entries.length }})</span>
              <div v-for="(entry, ei) in (selectedBlock!.props as TimelineProps).entries" :key="ei" class="field__group">
                <div class="field__group-title">#{{ ei + 1 }}</div>
                <input v-model="entry.year" placeholder="Year (e.g. 1953)" type="text" />
                <input v-model="entry.yearLabel" placeholder="Year label (e.g. Year one)" type="text" />
                <input v-model="entry.title" placeholder="Title" type="text" />
                <textarea v-model="entry.body" placeholder="Description" rows="2" />
                <input v-model="entry.tag" placeholder="Tag (e.g. Founding)" type="text" />
                <label class="field">
                  <span class="field__label">Highlight this entry</span>
                  <input v-model="entry.highlighted" type="checkbox" />
                </label>
                <input v-if="entry.highlighted" v-model="entry.avatarInitials" placeholder="Avatar initials" type="text" maxlength="3" />
                <button type="button" class="gallery-item__remove" @click="(selectedBlock!.props as TimelineProps).entries.splice(ei, 1)">Remove</button>
              </div>
              <button type="button" class="gallery-add" @click="(selectedBlock!.props as TimelineProps).entries.push({ year: '', title: '' })">+ Add entry</button>
            </div>
          </template>

          <!-- Two-column text -->
          <template v-else-if="selectedBlock.type === 'twoColumn'">
            <label class="field">
              <span class="field__label">Eyebrow</span>
              <input v-model="(selectedBlock!.props as TwoColumnProps).eyebrow" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Heading</span>
              <input v-model="(selectedBlock!.props as TwoColumnProps).heading" type="text" />
            </label>
            <label class="field">
              <span class="field__label">Background</span>
              <select v-model="(selectedBlock!.props as TwoColumnProps).background">
                <option value="surface">Surface</option>
                <option value="ground">White</option>
              </select>
            </label>
            <div v-for="(col, ci) in (selectedBlock!.props as TwoColumnProps).columns" :key="ci" class="field__group">
              <div class="field__group-title">Column {{ ci + 1 }}</div>
              <input v-model="col.eyebrow" placeholder="Eyebrow" type="text" />
              <input v-model="col.heading" placeholder="Heading" type="text" />
              <textarea
                v-for="(_, pi) in col.bodyParagraphs ?? []"
                :key="pi"
                v-model="col.bodyParagraphs![pi]"
                placeholder="Paragraph"
                rows="3"
              />
              <button type="button" class="gallery-add" @click="(col.bodyParagraphs ??= []).push('')">+ Paragraph</button>
            </div>
          </template>

          <!-- Divider -->
          <template v-else-if="selectedBlock.type === 'divider'">
            <label class="field">
              <span class="field__label">Style</span>
              <select v-model="(selectedBlock!.props as DividerProps).variant">
                <option value="hairline">Hairline</option>
                <option value="label">Label</option>
                <option value="dots">Dots</option>
                <option value="spacer">Spacer</option>
              </select>
            </label>
            <label v-if="(selectedBlock!.props as DividerProps).variant === 'label'" class="field">
              <span class="field__label">Label</span>
              <input v-model="(selectedBlock!.props as DividerProps).label" type="text" />
            </label>
            <label v-if="(selectedBlock!.props as DividerProps).variant === 'spacer'" class="field">
              <span class="field__label">Height (px)</span>
              <input v-model.number="(selectedBlock!.props as DividerProps).height" type="number" min="8" max="200" />
            </label>
          </template>
        </template>
      </aside>
    </div>

    <!-- ── New page modal ─────────────────────────────────────── -->
    <div v-if="newPageOpen" class="page-modal" role="dialog" aria-modal="true" aria-labelledby="new-page-title" @click.self="newPageOpen = false">
      <div class="page-modal__card">
        <header class="page-modal__head">
          <div>
            <div class="page-modal__eyebrow">Website</div>
            <h2 id="new-page-title" class="page-modal__title">New page</h2>
          </div>
          <button type="button" class="page-modal__close" aria-label="Close" @click="newPageOpen = false">×</button>
        </header>
        <form class="page-modal__body" @submit.prevent="submitNewPage">
          <label class="page-modal__field">
            <span class="page-modal__label">Title</span>
            <input
              :value="newPageForm.title"
              type="text"
              autofocus
              maxlength="80"
              placeholder="Coaching sessions"
              @input="onNewPageTitleInput"
            />
            <span class="page-modal__hint" :class="{ 'page-modal__hint--over': newPageForm.title.length > 80 }">{{ newPageForm.title.length }} / 80</span>
          </label>
          <label class="page-modal__field">
            <span class="page-modal__label">URL slug</span>
            <div class="page-modal__slug">
              <span class="page-modal__slug-prefix">/</span>
              <input
                :value="newPageForm.slug"
                type="text"
                maxlength="48"
                placeholder="coaching-sessions"
                spellcheck="false"
                @input="onNewPageSlugInput"
              />
            </div>
            <span class="page-modal__hint">
              <template v-if="newPageSlugStatus === 'reserved'"><span class="page-modal__hint--danger">Reserved — pick another.</span></template>
              <template v-else-if="newPageSlugStatus === 'invalid'"><span class="page-modal__hint--danger">Lowercase letters, digits, hyphens only.</span></template>
              <template v-else-if="newPageSlugStatus === 'conflict'"><span class="page-modal__hint--danger">Already in use on this club.</span></template>
              <template v-else>Public URL will be <code>/{{ newPageForm.slug || 'your-slug' }}</code></template>
            </span>
          </label>
          <div v-if="newPageError" class="page-modal__error">{{ newPageError }}</div>
        </form>
        <footer class="page-modal__foot">
          <button type="button" class="btn btn--outline" :disabled="newPageSubmitting" @click="newPageOpen = false">Cancel</button>
          <button type="button" class="btn btn--primary" :disabled="!newPageCanSubmit || newPageSubmitting" @click="submitNewPage">
            {{ newPageSubmitting ? 'Creating…' : 'Create page' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- ── Rename modal ───────────────────────────────────────── -->
    <div v-if="renameOpen" class="page-modal" role="dialog" aria-modal="true" aria-labelledby="rename-page-title" @click.self="renameOpen = false">
      <div class="page-modal__card">
        <header class="page-modal__head">
          <div>
            <div class="page-modal__eyebrow">Website</div>
            <h2 id="rename-page-title" class="page-modal__title">Rename page</h2>
          </div>
          <button type="button" class="page-modal__close" aria-label="Close" @click="renameOpen = false">×</button>
        </header>
        <form class="page-modal__body" @submit.prevent="submitRename">
          <label class="page-modal__field">
            <span class="page-modal__label">Title</span>
            <input v-model="renameForm.title" type="text" autofocus maxlength="80" />
          </label>
          <label class="page-modal__field">
            <span class="page-modal__label">
              URL slug
              <span v-if="renameForm.isSystem" class="page-modal__label-lock">System page — slug locked</span>
            </span>
            <div class="page-modal__slug" :class="{ 'page-modal__slug--locked': renameForm.isSystem }">
              <span class="page-modal__slug-prefix">/</span>
              <input
                v-model="renameForm.slug"
                type="text"
                maxlength="48"
                spellcheck="false"
                :disabled="renameForm.isSystem"
              />
            </div>
            <span class="page-modal__hint">
              <template v-if="renameSlugStatus === 'locked'"><span class="page-modal__hint--danger">System-page URLs can't change.</span></template>
              <template v-else-if="renameSlugStatus === 'reserved'"><span class="page-modal__hint--danger">Reserved — pick another.</span></template>
              <template v-else-if="renameSlugStatus === 'invalid'"><span class="page-modal__hint--danger">Lowercase letters, digits, hyphens only.</span></template>
              <template v-else-if="renameSlugStatus === 'conflict'"><span class="page-modal__hint--danger">Already in use on this club.</span></template>
              <template v-else-if="renameSlugChanged">Renaming the URL will break inbound links to <code>/{{ renameForm.originalSlug }}</code>.</template>
              <template v-else>Public URL: <code>/{{ renameForm.slug }}</code></template>
            </span>
          </label>
          <div v-if="renameError" class="page-modal__error">{{ renameError }}</div>
        </form>
        <footer class="page-modal__foot">
          <button type="button" class="btn btn--outline" :disabled="renameSubmitting" @click="renameOpen = false">Cancel</button>
          <button type="button" class="btn btn--primary" :disabled="!renameCanSubmit || renameSubmitting" @click="submitRename">
            {{ renameSubmitting ? 'Saving…' : 'Save changes' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- ── Delete modal ───────────────────────────────────────── -->
    <div v-if="deleteOpen && deleteTarget" class="page-modal" role="dialog" aria-modal="true" aria-labelledby="delete-page-title" @click.self="deleteOpen = false">
      <div class="page-modal__card page-modal__card--danger">
        <header class="page-modal__head">
          <div>
            <div class="page-modal__eyebrow page-modal__eyebrow--danger">Danger zone</div>
            <h2 id="delete-page-title" class="page-modal__title">Delete "{{ deleteTarget.title }}"?</h2>
          </div>
          <button type="button" class="page-modal__close" aria-label="Close" @click="deleteOpen = false">×</button>
        </header>
        <div class="page-modal__body">
          <p v-if="deleteTarget.is_system" class="page-modal__copy">
            <strong>This is a system page.</strong> The site's <code>/{{ deleteTarget.slug === 'home' ? '' : deleteTarget.slug }}</code>
            route will 404 until you recreate a page with this slug.
          </p>
          <p v-else-if="deleteTarget.is_published" class="page-modal__copy">
            This page is published. Inbound links to <code>/{{ deleteTarget.slug }}</code> will break immediately.
          </p>
          <p v-else class="page-modal__copy">
            This page is a draft — nothing on the public site will change.
          </p>
          <p class="page-modal__copy page-modal__copy--muted">You have 30 days to restore a deleted page (support-facing today).</p>
          <label v-if="deleteRequiresTypeToConfirm" class="page-modal__field">
            <span class="page-modal__label">Type the page name to confirm</span>
            <input v-model="deleteConfirmText" type="text" :placeholder="deleteTarget.title" spellcheck="false" />
          </label>
          <div v-if="deleteError" class="page-modal__error">{{ deleteError }}</div>
        </div>
        <footer class="page-modal__foot">
          <button type="button" class="btn btn--outline" :disabled="deleteSubmitting" @click="deleteOpen = false">Cancel</button>
          <button type="button" class="btn btn--danger" :disabled="!deleteCanSubmit || deleteSubmitting" @click="submitDelete">
            {{ deleteSubmitting ? 'Deleting…' : 'Delete page' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.web { max-width: 1280px; display: flex; flex-direction: column; gap: 20px; }

.web__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.web__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.web__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.web__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; max-width: 600px; }
.web__actions { display: flex; gap: 10px; align-items: center; }
.web__save-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-right: 6px; }
.web__live-link { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-accent); text-decoration: none; padding: 4px 10px; border-radius: 8px; }
.web__live-link:hover { background: var(--color-accent-soft); }

.btn { padding: 9px 16px; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; white-space: nowrap; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--outline:hover { background: var(--color-surface); }

/* Section tabs (pages + settings) */
.section-tabs { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.section-tabs__toggle { display: inline-flex; gap: 4px; padding: 4px; background: var(--color-ink); border-radius: 12px; flex-shrink: 0; }
.section-tabs__toggle-btn { padding: 8px 16px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.6); cursor: pointer; white-space: nowrap; transition: color 0.12s ease, background-color 0.12s ease; }
.section-tabs__toggle-btn:hover { background: #fff; color: var(--color-ink); }
.section-tabs__toggle-btn--active { background: #fff; color: var(--color-ink); }
.section-tabs__row { display: flex; gap: 4px; padding: 4px; background: var(--color-surface); border-radius: 12px; flex-wrap: wrap; }
.page-tab { padding: 8px 14px; background: transparent; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); cursor: pointer; white-space: nowrap; transition: color 0.12s ease, background-color 0.12s ease; }
.page-tab:hover { color: var(--color-ink); }
.page-tab--active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }

/* Three-column layout — pages sidebar | block list | inspector */
.web__body { display: grid; grid-template-columns: 220px 1fr 340px; gap: 20px; align-items: start; }

/* Pages sidebar */
.pages-nav {
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
}
.pages-nav__head { padding: 4px 8px 8px; }
.pages-nav__label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.pages-nav__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pages-nav__row { position: relative; display: flex; align-items: stretch; gap: 4px; border-radius: 8px; }
.pages-nav__row:hover .pages-nav__menu { opacity: 1; }
.pages-nav__row--active { background: var(--color-ink); }
.pages-nav__row--active .pages-nav__item { color: #fff; font-weight: 600; }
.pages-nav__row--active .pages-nav__item:hover { background: transparent; color: #fff; }
.pages-nav__row--active .pages-nav__menu { color: rgba(255, 255, 255, 0.7); }
.pages-nav__row--active .pages-nav__menu:hover { color: #fff; }
.pages-nav__row--active .pages-nav__draft { background: rgba(255, 255, 255, 0.14); color: #fff; }
.pages-nav__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-graphite);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.pages-nav__item:hover { background: var(--color-surface); color: var(--color-ink); }
.pages-nav__lock {
  display: inline-flex;
  align-items: center;
  color: var(--color-mute);
  flex-shrink: 0;
}
.pages-nav__draft {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--color-fog);
  text-transform: uppercase;
  flex-shrink: 0;
}
.pages-nav__menu {
  opacity: 0;
  width: 28px;
  border-radius: 6px;
  background: transparent;
  border: 0;
  color: var(--color-fog);
  cursor: pointer;
  padding: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background-color 0.12s ease;
  flex-shrink: 0;
}
.pages-nav__menu:hover { color: var(--color-ink); background: var(--color-surface); }
.pages-nav__menu-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 30;
  min-width: 160px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(10, 10, 11, 0.14);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.pages-nav__menu-item {
  padding: 8px 10px;
  border: 0;
  background: transparent;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}
.pages-nav__menu-item:hover { background: var(--color-surface); }
.pages-nav__menu-item--danger { color: var(--color-danger); }
.pages-nav__menu-item--danger:hover { background: #FEE2E2; }
/* Skeleton wrappers — shimmer lives in the shared `<Skeleton>` primitive.
   These rules just hide interactive affordances while loading. */
.pages-nav__row--skel { padding: 10px 12px; pointer-events: none; }
.blocks-skel { display: flex; flex-direction: column; gap: 12px; }
.block--skel { pointer-events: none; }
.block--skel .block__handle { visibility: hidden; }
.pages-nav__item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pages-nav__item-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}
.pages-nav__add {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px dashed var(--color-hairline);
  border-radius: 8px;
  background: transparent;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
  text-align: center;
  transition: color 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}
.pages-nav__add:hover { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }

/* Block list */
.list { display: flex; flex-direction: column; gap: 0; min-width: 0; }

/* Per-page SEO card at the top of the block editor */
.seo-card {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  margin-bottom: 16px;
  overflow: hidden;
}
.seo-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  list-style: none;
}
.seo-card__head::-webkit-details-marker { display: none; }
.seo-card__label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
  padding: 3px 8px;
  background: var(--color-surface);
  border-radius: 6px;
  flex-shrink: 0;
}
.seo-card__title {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  flex-shrink: 0;
}
.seo-card__hint {
  flex: 1;
  min-width: 0;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seo-card__chev {
  color: var(--color-fog);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}
.seo-card[open] .seo-card__chev { transform: rotate(180deg); color: var(--color-ink); }

.seo-card__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 16px 16px;
  border-top: 1px solid var(--color-hairline);
  padding-top: 14px;
}
.seo-field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.seo-field__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.seo-field input,
.seo-field textarea {
  width: 100%;
  padding: 9px 44px 9px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: #fff;
  resize: vertical;
}
.seo-field input:focus,
.seo-field textarea:focus {
  outline: none;
  border-color: var(--color-ink);
}
.seo-field__counter {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-fog);
  pointer-events: none;
}
.seo-field__counter--over { color: var(--color-danger); }

.empty { padding: 48px 32px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); }
.empty__hint { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* Inserter between blocks */
.inserter { display: flex; justify-content: center; padding: 4px 0; position: relative; }
.inserter__btn { padding: 4px 12px; background: transparent; border: 1px dashed transparent; border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); cursor: pointer; opacity: 0; transition: opacity 0.15s ease; }
.list:hover .inserter__btn { opacity: 1; }
.inserter__btn:hover { border-color: var(--color-accent); color: var(--color-accent); background: #fff; opacity: 1; }
.inserter--open .inserter__btn { opacity: 1; background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

/* Palette popover */
.palette { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); z-index: 10; margin-top: 6px; padding: 8px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; gap: 2px; min-width: 300px; }
.palette--top { position: static; transform: none; margin: 12px auto 0; }
.palette__item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: transparent; border: 0; border-radius: 8px; text-align: left; cursor: pointer; font-family: var(--font-body); }
.palette__item:hover { background: var(--color-surface); }
.palette__icon { width: 28px; height: 28px; border-radius: 6px; background: var(--color-surface); display: inline-flex; align-items: center; justify-content: center; font-size: 14px; color: var(--color-ink); flex-shrink: 0; }
.palette__label { display: flex; flex-direction: column; }
.palette__name { font-size: 13px; font-weight: 600; color: var(--color-ink); }
.palette__hint { font-size: 11px; color: var(--color-fog); }

/* Block card */
.block { display: flex; align-items: stretch; gap: 12px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; cursor: pointer; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.block:hover { border-color: var(--color-mute); }
.block--selected { border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-ink) 8%, transparent); }
.block__handle { display: flex; flex-direction: column; gap: 2px; }
.block__arrow { width: 22px; height: 22px; border: 1px solid var(--color-hairline); background: #fff; border-radius: 6px; font-size: 10px; color: var(--color-fog); cursor: pointer; }
.block__arrow:hover:not(:disabled) { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.block__arrow:disabled { opacity: 0.3; cursor: not-allowed; }
.block__body { flex: 1; min-width: 0; }
.block__type { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.block__summary { font-family: var(--font-display); font-size: 15px; font-weight: 500; color: var(--color-ink); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.block__delete { width: 28px; height: 28px; border: 1px solid var(--color-hairline); background: #fff; color: var(--color-fog); border-radius: 8px; font-size: 16px; cursor: pointer; align-self: center; flex-shrink: 0; }
.block__delete:hover { background: var(--color-danger); border-color: var(--color-danger); color: #fff; }

/* Inspector */
.inspector { padding: 20px 22px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 20px; display: flex; flex-direction: column; gap: 14px; max-height: calc(100vh - 60px); overflow-y: auto; }
.inspector__empty { text-align: center; padding: 20px 0; color: var(--color-fog); }
.inspector__empty-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.inspector__empty-hint { font-family: var(--font-body); font-size: 12px; margin-top: 4px; }

.inspector__head { padding-bottom: 12px; border-bottom: 1px solid var(--color-hairline); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.inspector__head-text { min-width: 0; }
.inspector__label { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.inspector__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-top: 4px; }
.inspector__reset { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 6px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; white-space: nowrap; transition: color 0.12s ease, border-color 0.12s ease, background-color 0.12s ease; }
.inspector__reset:hover { color: var(--color-ink); border-color: var(--color-ink); background: var(--color-surface); }

.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field textarea, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field textarea { line-height: 1.5; }
.field__mono { font-family: var(--font-mono); font-size: 12px; }
.field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.field__group { padding: 12px 14px; background: var(--color-surface); border-radius: 10px; display: flex; flex-direction: column; gap: 10px; }
.field__group-title { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }

.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; max-width: 220px; }
.switch { width: 34px; height: 20px; padding: 2px; background: var(--color-hairline); border: 0; border-radius: 999px; cursor: pointer; display: flex; justify-content: flex-start; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); justify-content: flex-end; }
.switch__knob { width: 16px; height: 16px; border-radius: 999px; background: #fff; }

.gallery-item { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; margin-top: 8px; }
.gallery-item__alt { padding: 8px 10px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-ink); background: #fff; }
.gallery-item__alt:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.gallery-item__remove { align-self: flex-start; background: transparent; border: 0; padding: 0; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-danger); cursor: pointer; }
.gallery-item__remove:hover { text-decoration: underline; }
.gallery-add { margin-top: 10px; padding: 8px 12px; background: transparent; border: 1px dashed var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-accent); cursor: pointer; }
.gallery-add:hover { background: var(--color-accent-soft); }

/* Tablet-ish: drop the inspector to the bottom, keep the pages sidebar. */
@media (max-width: 1279px) {
  .web__body { grid-template-columns: 200px 1fr; }
  .inspector { grid-column: 1 / -1; position: static; max-height: none; }
}

/* Phone: pages sidebar becomes a top scrollable row of chips. */
@media (max-width: 767px) {
  .web__body { grid-template-columns: 1fr; }
  .pages-nav {
    position: static;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding: 8px;
    overflow-x: auto;
  }
  .pages-nav__head { display: none; }
  .pages-nav__list {
    flex-direction: row;
    flex-wrap: nowrap;
    flex: 1;
  }
  .pages-nav__item { white-space: nowrap; }
  .pages-nav__add { flex-shrink: 0; margin-top: 0; padding: 8px 12px; }
}

/* ── Custom-page modals ────────────────────────────────────── */
.page-modal { position: fixed; inset: 0; z-index: 200; background: rgba(10, 10, 11, 0.48); display: flex; align-items: center; justify-content: center; padding: 24px; }
.page-modal__card { width: 100%; max-width: 480px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 64px rgba(10, 10, 11, 0.22); display: flex; flex-direction: column; }
.page-modal__card--danger { border-color: #FCA5A5; }
.page-modal__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 8px; }
.page-modal__eyebrow { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.page-modal__eyebrow--danger { color: var(--color-danger); }
.page-modal__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: var(--color-ink); margin: 4px 0 0; }
.page-modal__close { width: 30px; height: 30px; border-radius: 999px; background: var(--color-surface); border: 0; color: var(--color-ink); font-size: 18px; line-height: 1; cursor: pointer; padding: 0; flex-shrink: 0; }
.page-modal__close:hover { background: var(--color-hairline); }
.page-modal__body { display: flex; flex-direction: column; gap: 14px; padding: 12px 22px 6px; }
.page-modal__field { display: flex; flex-direction: column; gap: 6px; }
.page-modal__label { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.page-modal__label-lock { text-transform: none; letter-spacing: 0.02em; font-size: 11px; font-weight: 500; color: var(--color-mute); }
.page-modal__field input, .page-modal__field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); background: #fff; }
.page-modal__field input:focus, .page-modal__field textarea:focus { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-surface); }
.page-modal__slug { display: flex; align-items: center; padding-left: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; background: #fff; font-family: var(--font-mono); font-size: 14px; }
.page-modal__slug:focus-within { border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-surface); }
.page-modal__slug--locked { background: var(--color-surface); color: var(--color-mute); }
.page-modal__slug-prefix { color: var(--color-fog); padding-right: 2px; }
.page-modal__slug input { flex: 1; border: 0 !important; box-shadow: none !important; padding: 10px 12px 10px 4px !important; font-family: var(--font-mono); }
.page-modal__slug input:disabled { color: var(--color-mute); background: transparent; }
.page-modal__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.page-modal__hint code { font-family: var(--font-mono); font-size: 11px; color: var(--color-ink); background: var(--color-surface); padding: 1px 6px; border-radius: 4px; }
.page-modal__hint--danger { color: var(--color-danger); font-weight: 600; }
.page-modal__hint--over { color: var(--color-danger); }
.page-modal__error { padding: 10px 12px; background: #FEE2E2; color: #991B1B; border-radius: 10px; font-family: var(--font-body); font-size: 13px; margin: 0; }
.page-modal__copy { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); line-height: 1.5; margin: 0; }
.page-modal__copy code { font-family: var(--font-mono); font-size: 12px; background: var(--color-surface); padding: 1px 6px; border-radius: 4px; }
.page-modal__copy--muted { color: var(--color-fog); font-size: 12px; }
.page-modal__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 22px 20px; border-top: 1px solid var(--color-hairline); margin-top: 10px; }
.page-modal .btn--primary { background: var(--color-ink); color: #fff; border: 0; padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.page-modal .btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.page-modal .btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.page-modal .btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.page-modal .btn--outline:hover:not(:disabled) { background: var(--color-surface); }
.page-modal .btn--outline:disabled { opacity: 0.5; cursor: not-allowed; }
.page-modal .btn--danger { background: var(--color-danger); color: #fff; border: 0; padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.page-modal .btn--danger:hover:not(:disabled) { background: #B91C1C; }
.page-modal .btn--danger:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
