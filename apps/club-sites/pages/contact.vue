<script setup lang="ts">
import { ContactFormBlock } from '@torny/content-blocks'

const club = useClub()
const { data: site } = await useSite()

const contact = computed(() => site.value?.contact)
const hours = computed(() => site.value?.hours ?? [])
const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

usePageMeta('contact')

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

const mapsUrl = computed(() => {
  if (contact.value?.google_maps_url) return contact.value.google_maps_url
  if (contact.value?.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.value.address)}`
  return null
})
</script>

<template>
  <PageRenderer slug="contact">
  <div class="contact" :style="{ '--brand': accent } as any">
    <header class="page-head">
      <div class="page-head__eyebrow">Get in touch</div>
      <h1 class="page-head__title">Contact</h1>
    </header>

    <div class="grid">
      <section class="details">
        <div v-if="contact?.address" class="detail">
          <div class="detail__label">Where</div>
          <div class="detail__value">{{ contact.address }}</div>
          <a v-if="mapsUrl" :href="mapsUrl" target="_blank" rel="noopener" class="detail__link">Open in Google Maps →</a>
        </div>
        <div v-if="contact?.email" class="detail">
          <div class="detail__label">Email</div>
          <a :href="`mailto:${contact.email}`" class="detail__link">{{ contact.email }}</a>
        </div>
        <div v-if="contact?.phone" class="detail">
          <div class="detail__label">Phone</div>
          <a :href="`tel:${contact.phone.replace(/\s+/g, '')}`" class="detail__link">{{ contact.phone }}</a>
        </div>

        <div v-if="hours.length > 0" class="detail">
          <div class="detail__label">Opening hours</div>
          <ul class="hours">
            <li v-for="d in hours" :key="d.day" class="hour" :class="{ 'hour--closed': !d.is_open }">
              <span class="hour__day">{{ DAY_LABELS[d.day] ?? d.day }}</span>
              <span v-if="d.is_open" class="hour__time">{{ d.open }} – {{ d.close }}</span>
              <span v-else class="hour__time hour__time--closed">Closed</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="form">
        <ContactFormBlock heading="Drop us a note" />
      </section>
    </div>
  </div>
  </PageRenderer>
</template>

<style scoped>
.contact { display: flex; flex-direction: column; gap: 32px; padding: 40px 24px 80px; max-width: 1080px; margin: 0 auto; }
.page-head__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.page-head__title { font-family: var(--font-display); font-size: clamp(36px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 12px; color: var(--color-ink); }

.grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 32px; align-items: start; }
.details { display: flex; flex-direction: column; gap: 20px; padding: 28px; background: var(--color-surface); border-radius: 16px; }
.detail__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 6px; }
.detail__value { font-family: var(--font-body); font-size: 15px; color: var(--color-ink); line-height: 1.55; }
.detail__link { display: inline-block; margin-top: 4px; font-family: var(--font-body); font-size: 14px; color: var(--brand); text-decoration: none; font-weight: 500; }
.detail__link:hover { text-decoration: underline; }

.hours { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.hour { display: flex; justify-content: space-between; gap: 20px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); }
.hour--closed { color: var(--color-fog); }
.hour__day { font-weight: 500; }
.hour__time { font-family: var(--font-mono); font-size: 13px; }
.hour__time--closed { font-style: italic; }

.form { padding: 28px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
