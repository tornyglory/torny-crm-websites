export { default as BlockRenderer } from './BlockRenderer.vue'
export { default as HeroBlock } from './blocks/HeroBlock.vue'
export { default as RichTextBlock } from './blocks/RichTextBlock.vue'
export { default as EventListBlock } from './blocks/EventListBlock.vue'
export { default as HonourBoardBlock } from './blocks/HonourBoardBlock.vue'
export { default as GalleryBlock } from './blocks/GalleryBlock.vue'
export { default as ContactFormBlock } from './blocks/ContactFormBlock.vue'
export { default as MembershipCtaBlock } from './blocks/MembershipCtaBlock.vue'
export { default as CtaBannerBlock } from './blocks/CtaBannerBlock.vue'

// Site chrome — same shell on every club site, tenant data (name, logo,
// --color-accent) plumbed via props. Clubs vary content, not chrome.
export { default as SiteHeader } from './chrome/SiteHeader.vue'
export { default as SiteMobileDrawer } from './chrome/SiteMobileDrawer.vue'
export { default as SiteFooter } from './chrome/SiteFooter.vue'

export * from './types'
