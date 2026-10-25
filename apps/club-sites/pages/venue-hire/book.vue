<script setup lang="ts">
/**
 * `/venue-hire/book` — the booking wizard landing page.
 *
 * The VenuePackages block CTAs across the site point here with
 * `?package=` + `?space=` query params. The VenueBookingBlock reads
 * those from the URL and pre-selects a package.
 *
 * Admins can override this page's layout via the CRM page editor
 * (`site.pages["venue-hire/book"]`) and drop a configured
 * VenueBookingBlock to replace the fallback below — same pattern as
 * every other page in this app.
 */
import { VenueBookingBlock } from '@torny/content-blocks'

const route = useRoute()
const slug = computed(() => {
  const raw = route.params.slug
  const joined = Array.isArray(raw) ? raw.join('/') : (raw ?? '')
  return joined || 'venue-hire/book'
})

usePageMeta('venue-hire/book')
</script>

<template>
  <PageRenderer :slug="slug">
    <!-- Fallback — rendered when the admin hasn't published a layout
         for this page. Ships a sensible default so the CTAs on the
         venue packages block work out of the box. Admins who want to
         change packages / add-ons / host should publish the CRM page. -->
    <VenueBookingBlock
      eyebrow="VENUE HIRE"
      heading="Book the venue"
      :deposit-percent="25"
      :lead-time-days="14"
      host-name="Grace Whittaker"
      host-role="YOUR HOST · CLUB PRESIDENT"
      host-initials="GW"
      host-phone="027 341 2020"
      submit-label="Confirm booking"
      :packages="[
        {
          slug: 'the-clubhouse',
          name: 'The clubhouse',
          sub: 'Timber-lined main room · seated 80 · standing 140',
          slots: [
            { label: 'Morning · 9am – 1pm', sub: '4 hours · $720', price: 720 },
            { label: 'Afternoon · 2pm – 6pm', sub: '4 hours · $720 · Most booked', price: 720, defaultSelected: true },
            { label: 'Evening · 6pm – 11pm', sub: '5 hours · $900 · Bar staff incl.', price: 900 },
            { label: 'Full day · 9am – 11pm', sub: '14 hours · $2,340 · Save 15%', price: 2340 },
          ],
          addons: [
            { name: 'Grazing platters', description: 'Locally sourced, catered by Naenae Cafe · Serves 8 per platter', price: 85, priceSuffix: '/ platter', countable: true, defaultQuantity: 6, defaultSelected: true },
            { name: 'Bowls on the green', description: 'Coach + all equipment · 90 min session · Ideal for corporate', price: 180, priceSuffix: '/ session' },
            { name: 'Bar tab · Prepaid', description: 'Set an amount for the bar. Anything unused refunded.', price: 400, defaultSelected: true },
          ],
          bondAmount: 300,
          bondLabel: 'Refundable bond',
        },
        {
          slug: 'green-bbq',
          name: 'Green + BBQ',
          sub: 'Green A plus the covered BBQ area',
          slots: [
            { label: 'Weekend morning · 9am – 1pm', sub: '4 hours · $220', price: 220, defaultSelected: true },
            { label: 'Weekend afternoon · 2pm – 6pm', sub: '4 hours · $220', price: 220 },
            { label: 'Full day · 9am – 6pm', sub: '9 hours · $400', price: 400 },
          ],
          addons: [
            { name: 'BBQ pack', description: 'Fire-up kit + gas + utensils', price: 60, defaultSelected: true },
            { name: 'Coach for the hour', description: 'A friendly intro to lawn bowls for your group', price: 90, priceSuffix: '/ hour' },
          ],
          bondAmount: 150,
          bondLabel: 'Refundable bond',
        },
        {
          slug: 'whole-shebang',
          name: 'Whole shebang',
          sub: 'Exclusive-use all day · three greens, clubhouse, catering, host',
          slots: [
            { label: 'One Saturday a month', sub: 'Full day · $1,600 · Host included', price: 1600, defaultSelected: true },
          ],
          addons: [
            { name: 'Full catering', description: 'Lunch + dinner + bar for up to 150', price: 2800 },
            { name: 'Photographer for the day', description: '8 hours, final edit within 10 days', price: 950 },
          ],
          bondAmount: 500,
          bondLabel: 'Refundable bond',
        },
      ]"
    />
  </PageRenderer>
</template>
