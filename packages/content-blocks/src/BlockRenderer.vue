<script setup lang="ts">
import type { Block } from './types'
import HeroBlock from './blocks/HeroBlock.vue'
import RichTextBlock from './blocks/RichTextBlock.vue'
import EventListBlock from './blocks/EventListBlock.vue'
import HonourBoardBlock from './blocks/HonourBoardBlock.vue'
import HonourBoardSearchBlock from './blocks/HonourBoardSearchBlock.vue'
import GalleryBlock from './blocks/GalleryBlock.vue'
import ContactFormBlock from './blocks/ContactFormBlock.vue'
import MembershipCtaBlock from './blocks/MembershipCtaBlock.vue'
import CtaBannerBlock from './blocks/CtaBannerBlock.vue'
import MediaSplitBlock from './blocks/MediaSplitBlock.vue'
import SectionTitleBlock from './blocks/SectionTitleBlock.vue'
import PullQuoteBlock from './blocks/PullQuoteBlock.vue'
import FeatureGridBlock from './blocks/FeatureGridBlock.vue'
import FaqAccordionBlock from './blocks/FaqAccordionBlock.vue'
import FullBleedImageBlock from './blocks/FullBleedImageBlock.vue'
import TimelineBlock from './blocks/TimelineBlock.vue'
import TwoColumnBlock from './blocks/TwoColumnBlock.vue'
import DividerBlock from './blocks/DividerBlock.vue'

defineProps<{ block: Block }>()
</script>

<template>
  <HeroBlock v-if="block.type === 'hero'" v-bind="block.props" />
  <RichTextBlock v-else-if="block.type === 'richText'" v-bind="block.props" />
  <EventListBlock v-else-if="block.type === 'eventList'" v-bind="block.props" />
  <HonourBoardBlock v-else-if="block.type === 'honourBoard'" v-bind="block.props" />
  <HonourBoardSearchBlock v-else-if="block.type === 'honourBoardSearch'" v-bind="block.props" />
  <GalleryBlock v-else-if="block.type === 'gallery'" v-bind="block.props" />
  <ContactFormBlock v-else-if="block.type === 'contactForm'" v-bind="block.props" />
  <MembershipCtaBlock v-else-if="block.type === 'membershipCta'" v-bind="block.props" />
  <CtaBannerBlock v-else-if="block.type === 'ctaBanner'" v-bind="block.props" />
  <MediaSplitBlock v-else-if="block.type === 'mediaSplit'" v-bind="block.props" />
  <SectionTitleBlock v-else-if="block.type === 'sectionTitle'" v-bind="block.props" />
  <PullQuoteBlock v-else-if="block.type === 'pullQuote'" v-bind="block.props" />
  <FeatureGridBlock v-else-if="block.type === 'featureGrid'" v-bind="block.props" />
  <FaqAccordionBlock v-else-if="block.type === 'faqAccordion'" v-bind="block.props" />
  <FullBleedImageBlock v-else-if="block.type === 'fullBleedImage'" v-bind="block.props" />
  <TimelineBlock v-else-if="block.type === 'timeline'" v-bind="block.props" />
  <TwoColumnBlock v-else-if="block.type === 'twoColumn'" v-bind="block.props" />
  <DividerBlock v-else-if="block.type === 'divider'" v-bind="block.props" />
</template>
