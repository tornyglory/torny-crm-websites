<script setup lang="ts">
const club = useClub()
const { data: site } = await useSite()

const tiers = computed(() => site.value?.membership_tiers ?? [])
const firstYearDiscount = computed(() => site.value?.first_year_discount ?? false)
const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

usePageMeta('membership')

const cadenceLabel = (c: string | null): string =>
  c === 'annual' ? 'year' : c === 'monthly' ? 'month' : c === 'season' ? 'season' : ''
</script>

<template>
  <PageRenderer slug="membership">
  <div class="membership" :style="{ '--brand': accent } as any">
    <header class="page-head">
      <div class="page-head__eyebrow">Join us</div>
      <h1 class="page-head__title">Membership</h1>
      <p class="page-head__sub">Choose the tier that fits how you play. Every level has full clubhouse access.</p>
    </header>

    <div v-if="firstYearDiscount" class="banner">
      <span class="banner__dot" />
      <span>First-year joiners get <strong>20% off</strong> their first membership year.</span>
    </div>

    <div v-if="tiers.length === 0" class="empty">
      <div class="empty__title">Membership setup in progress.</div>
      <p>Tiers show up here once the club has published them. Get in touch via <NuxtLink to="/contact" class="link">contact</NuxtLink> for now.</p>
    </div>

    <ul v-else class="tiers">
      <li v-for="t in tiers" :key="t.id" class="tier" :class="{ 'tier--default': t.is_default }">
        <div v-if="t.is_default" class="tier__flag">Most popular</div>
        <div class="tier__name">{{ t.type_name }}</div>
        <div class="tier__price">
          <span class="tier__price-currency">$</span>
          <span class="tier__price-amount">{{ t.fee ?? '—' }}</span>
          <span v-if="t.cadence" class="tier__price-cadence">/ {{ cadenceLabel(t.cadence) }}</span>
        </div>
        <p v-if="t.description" class="tier__desc">{{ t.description }}</p>
        <div class="tier__cta">
          <NuxtLink to="/contact" class="btn" :class="t.is_default ? 'btn--primary' : 'btn--ghost'">
            Apply for {{ t.type_name.toLowerCase() }}
          </NuxtLink>
        </div>
      </li>
    </ul>
  </div>
  </PageRenderer>
</template>

<style scoped>
.membership { display: flex; flex-direction: column; gap: 32px; padding: 40px max(48px, calc((100vw - var(--container-content, 1280px)) / 2)) 80px; }
.page-head__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.page-head__title { font-family: var(--font-display); font-size: clamp(36px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 12px; color: var(--color-ink); }
.page-head__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; }

.banner { display: inline-flex; align-items: center; gap: 12px; padding: 12px 20px; background: color-mix(in oklab, var(--brand) 12%, white); border-radius: 999px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); align-self: flex-start; }
.banner__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--brand); }
.banner strong { color: var(--brand); font-weight: 700; }

.empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }
.link { color: var(--brand); font-weight: 600; text-decoration: none; }
.link:hover { text-decoration: underline; }

.tiers { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.tier { padding: 28px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 20px; display: flex; flex-direction: column; gap: 12px; position: relative; }
.tier--default { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 20%, transparent); }
.tier__flag { position: absolute; top: -12px; left: 24px; background: var(--brand); color: #fff; font-family: var(--font-mono); font-size: 10px; padding: 4px 10px; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.tier__name { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.tier__price { display: baseline; align-items: baseline; font-family: var(--font-display); }
.tier__price-currency { font-size: 20px; color: var(--color-fog); vertical-align: super; }
.tier__price-amount { font-size: 44px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.tier__price-cadence { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin-left: 6px; }
.tier__desc { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.6; margin: 4px 0 0; }
.tier__cta { margin-top: auto; padding-top: 16px; }

.btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn--primary { background: var(--brand); color: #fff; border: 0; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }
</style>
