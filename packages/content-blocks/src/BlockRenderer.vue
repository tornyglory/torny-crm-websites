<script setup lang="ts">
import type { Block } from './types'
import HeroBlock from './blocks/HeroBlock.vue'
import RichTextBlock from './blocks/RichTextBlock.vue'
import EventListBlock from './blocks/EventListBlock.vue'
import HonourBoardBlock from './blocks/HonourBoardBlock.vue'
import GalleryBlock from './blocks/GalleryBlock.vue'
import ContactFormBlock from './blocks/ContactFormBlock.vue'
import MembershipCtaBlock from './blocks/MembershipCtaBlock.vue'
import CtaBannerBlock from './blocks/CtaBannerBlock.vue'

defineProps<{ block: Block }>()
</script>

<template>
  <HeroBlock v-if="block.type === 'hero'" v-bind="block.props" />
  <RichTextBlock v-else-if="block.type === 'richText'" v-bind="block.props" />
  <EventListBlock v-else-if="block.type === 'eventList'" v-bind="block.props" />
  <HonourBoardBlock v-else-if="block.type === 'honourBoard'" v-bind="block.props" />
  <GalleryBlock v-else-if="block.type === 'gallery'" v-bind="block.props" />
  <ContactFormBlock v-else-if="block.type === 'contactForm'" v-bind="block.props" />
  <MembershipCtaBlock v-else-if="block.type === 'membershipCta'" v-bind="block.props" />
  <CtaBannerBlock v-else-if="block.type === 'ctaBanner'" v-bind="block.props" />
</template>
