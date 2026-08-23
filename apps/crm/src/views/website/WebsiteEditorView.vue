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
import BlockPaletteDialog from '@/components/BlockPaletteDialog.vue'
import WebsiteSettingsPanel, { type WebsiteSettingsSection } from '@/components/WebsiteSettingsPanel.vue'
import { ApiError, pages, type PageBlock } from '@torny/api-client'
import type {
  Block,
  BlockType,
  HeroProps,
  RichTextProps,
  EventListProps,
  HonourBoardProps,
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
type PageSlug = 'home' | 'about' | 'membership' | 'events' | 'honour-board' | 'contact'
const PAGE_SLUGS: PageSlug[] = ['home', 'about', 'membership', 'events', 'honour-board', 'contact']
const SETTINGS_SLUGS: WebsiteSettingsSection[] = ['navigation', 'brand', 'seo', 'domain', 'forms', 'analytics']
type Section = PageSlug | WebsiteSettingsSection

const PAGE_LABELS: Record<PageSlug, string> = {
  home: 'Home',
  about: 'About',
  membership: 'Membership',
  events: 'Events',
  'honour-board': 'Honour board',
  contact: 'Contact',
}
const PAGE_SUBTITLES: Record<PageSlug, string> = {
  home: 'The front door — hero, upcoming events, a nudge to join.',
  about: 'Who you are and what makes the club feel like home.',
  membership: 'Show your tiers and why someone would join.',
  events: 'What\'s coming up. Auto-pulled from the events calendar.',
  'honour-board': 'A century of results, category by category.',
  contact: 'How people reach the club — address, hours, contact form.',
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

function isPageSlug(s: string): s is PageSlug {
  return (PAGE_SLUGS as readonly string[]).includes(s)
}
function isSettingsSlug(s: string): s is WebsiteSettingsSection {
  return (SETTINGS_SLUGS as readonly string[]).includes(s)
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

const PALETTES: Record<PageSlug, PaletteItem[]> = {
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
    { type: 'honourBoard', label: 'Honour board', hint: 'Recent honour-board entries grouped by category', icon: '♛',
      defaults: (): HonourBoardProps => ({ heading: undefined, yearsToShow: 10 }) },
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

const SEEDS: Record<PageSlug, () => Block[]> = {
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
  'honour-board': () => seed(
    { type: 'hero', props: heroDefault('Honour board', 'A century of results.', ['Back to the club', '/']) },
    { type: 'honourBoard', props: { heading: undefined, yearsToShow: 10 } satisfies HonourBoardProps },
  ),
  contact: () => seed(
    { type: 'hero', props: heroDefault('Contact', 'Say hello. We\'ll get back to you.', ['Directions', '#directions']) },
    { type: 'contactForm', props: { heading: 'Drop us a note', submitLabel: 'Send', successMessage: 'Thanks — we\'ll be in touch.' } satisfies ContactFormProps },
  ),
}

// ── State ─────────────────────────────────────────────────
interface EditorState {
  blocks: Block[]
  publishedBlocks: Block[] | null
  draftUpdatedAt: string | null
  publishedAt: string | null
  hasUnpublishedChanges: boolean
}

const state = reactive<EditorState>({
  blocks: [],
  publishedBlocks: null,
  draftUpdatedAt: null,
  publishedAt: null,
  hasUnpublishedChanges: false,
})
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
      state.blocks = SEEDS[slug]()
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
  if (!isSettingsView.value) void load(currentPage.value)
})
watch([() => clubStore.current?.id, currentPage, isSettingsView], ([, slug, settingsActive]) => {
  if (settingsActive) return
  void load(slug)
})

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
    const res = await pages.patch(clubId, slug, {
      blocks: state.blocks as unknown as PageBlock[],
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

// ── Block ops ─────────────────────────────────────────────
function addBlock(type: BlockType, afterId: string | null): void {
  const palette = PALETTES[currentPage.value].find((p) => p.type === type)
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
  const palette = PALETTES[currentPage.value].find((p) => p.type === block.type)
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
    toast.success(`${PAGE_LABELS[slug]} page published.`)
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

const PREVIEW_PATHS: Record<PageSlug, string> = {
  home: '/',
  about: '/about',
  membership: '/membership',
  events: '/events',
  'honour-board': '/honour-board',
  contact: '/contact',
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
  const path = PREVIEW_PATHS[currentPage.value]
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
        <h1 v-else class="web__heading">{{ PAGE_LABELS[currentPage] }} page</h1>
        <p v-if="isSettingsView && currentSettings" class="web__sub">{{ SETTINGS_SUBTITLES[currentSettings] }}</p>
        <p v-else class="web__sub">{{ PAGE_SUBTITLES[currentPage] }}</p>
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
      <div class="section-tabs__row" role="group" :aria-label="isSettingsView ? 'Settings' : 'Pages'">
        <template v-if="isSettingsView">
          <button
            v-for="slug in SETTINGS_SLUGS"
            :key="slug"
            type="button"
            class="page-tab"
            :class="{ 'page-tab--active': currentSection === slug }"
            @click="switchSection(slug)"
          >{{ SETTINGS_LABELS[slug] }}</button>
        </template>
        <template v-else>
          <button
            v-for="slug in PAGE_SLUGS"
            :key="slug"
            type="button"
            class="page-tab"
            :class="{ 'page-tab--active': currentSection === slug }"
            @click="switchSection(slug)"
          >{{ PAGE_LABELS[slug] }}</button>
        </template>
      </div>
    </nav>

    <WebsiteSettingsPanel v-if="isSettingsView && currentSettings" :section="currentSettings" />

    <div v-else class="web__body">
      <!-- Block list -->
      <section class="list">
        <div v-if="state.blocks.length === 0" class="empty">
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
        :items="PALETTES[currentPage]"
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
              <span class="field__label">Heading (optional)</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).heading" type="text" placeholder="Leave blank for no heading" />
            </label>
            <label class="field">
              <span class="field__label">Category slug (optional)</span>
              <input v-model="(selectedBlock.props as HonourBoardProps).categorySlug" type="text" placeholder="e.g. mens-singles — leave blank for all" />
              <span class="field__hint">Show entries from one category only. Leave blank to group all categories.</span>
            </label>
            <label class="field">
              <span class="field__label">Years to show</span>
              <input v-model.number="(selectedBlock.props as HonourBoardProps).yearsToShow" type="number" min="1" max="100" />
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

/* Two-column layout */
.web__body { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; }

/* Block list */
.list { display: flex; flex-direction: column; gap: 0; min-width: 0; }
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

@media (max-width: 1100px) {
  .web__body { grid-template-columns: 1fr; }
  .inspector { position: static; max-height: none; }
}
</style>
