<script setup lang="ts">
const club = useClub()
const { data: site } = await useSite()

if (import.meta.server && site.value && !site.value.pages_enabled.events) {
  throw createError({ statusCode: 404, statusMessage: 'Events not published' })
}

const events = computed(() => site.value?.events_upcoming ?? [])
const accent = computed(() => site.value?.club.brand_primary ?? club.value?.brand_primary ?? '#2563EB')

useSeoMeta({ title: () => `Events — ${club.value?.name ?? 'Torny'}` })

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${DAY_ABBR[d.getDay()]} ${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m ? `${h}:${m.toString().padStart(2, '0')} ${ampm}` : `${h}${ampm}`
}
</script>

<template>
  <div class="events" :style="{ '--brand': accent } as any">
    <header class="page-head">
      <div class="page-head__eyebrow">What's on</div>
      <h1 class="page-head__title">Events</h1>
      <p class="page-head__sub">Everything coming up at the club — tournaments, roll-ups, training nights.</p>
    </header>

    <div v-if="events.length === 0" class="empty">
      <div class="empty__title">Nothing scheduled just yet.</div>
      <p>Check back soon — new events show up here as they're announced.</p>
    </div>

    <ul v-else class="list">
      <li v-for="e in events" :key="e.id" class="row">
        <div class="row__date">
          <div class="row__day">{{ new Date(e.starts_at).getDate() }}</div>
          <div class="row__month">{{ MONTH_ABBR[new Date(e.starts_at).getMonth()] }}</div>
        </div>
        <div class="row__body">
          <div class="row__title-row">
            <h2 class="row__title">{{ e.title }}</h2>
            <span v-if="e.event_type" class="row__pill">{{ e.event_type }}</span>
          </div>
          <div class="row__meta">
            {{ fmtDate(e.starts_at) }} · {{ fmtTime(e.starts_at) }}<template v-if="e.ends_at"> – {{ fmtTime(e.ends_at) }}</template><template v-if="e.location"> · {{ e.location }}</template>
          </div>
          <p v-if="e.excerpt" class="row__excerpt">{{ e.excerpt }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.events { display: flex; flex-direction: column; gap: 32px; padding: 40px 24px 80px; max-width: 900px; margin: 0 auto; }
.page-head__eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.page-head__title { font-family: var(--font-display); font-size: clamp(36px, 5vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 8px 0 12px; color: var(--color-ink); }
.page-head__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; }

.empty { padding: 48px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.empty__title { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); margin-bottom: 6px; }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: flex-start; gap: 20px; padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; }
.row__date { width: 64px; height: 64px; border-radius: 14px; background: var(--brand); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; }
.row__day { font-family: var(--font-display); font-size: 26px; font-weight: 700; line-height: 1; }
.row__month { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 4px; }
.row__body { flex: 1; min-width: 0; }
.row__title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.row__title { font-family: var(--font-display); font-size: 22px; font-weight: 600; color: var(--color-ink); margin: 0; }
.row__pill { font-family: var(--font-mono); font-size: 10px; padding: 3px 10px; background: var(--color-surface); color: var(--color-fog); border-radius: 6px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.row__meta { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 6px; }
.row__excerpt { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); line-height: 1.6; margin: 12px 0 0; }
</style>
