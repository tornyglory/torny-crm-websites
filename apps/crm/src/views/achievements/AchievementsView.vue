<script setup lang="ts">
import { computed, ref } from 'vue'

type Category = 'championship' | 'service' | 'milestone' | 'special'

interface Achievement {
  id: string
  name: string
  category: Category
  criteria: string
  issuedCount: number
  activeMembersHolding: number
  latestAwardee?: string
  latestAwardedAt?: string
  isRetired: boolean
}

interface Recipient {
  id: string
  achievementId: string
  memberName: string
  year: number
  note?: string
}

const activeTab = ref<'catalogue' | 'recent'>('catalogue')
const search = ref('')

const achievements = ref<Achievement[]>([
  { id: 'ach-1', name: 'Champion of Champions', category: 'championship', criteria: 'Winner of the club Champion of Champions singles.', issuedCount: 42, activeMembersHolding: 12, latestAwardee: 'Marcus Tuilagi', latestAwardedAt: '2026', isRetired: false },
  { id: 'ach-2', name: 'Fours Champion', category: 'championship', criteria: 'Winning skip of the club fours championship.', issuedCount: 36, activeMembersHolding: 8, latestAwardee: 'Reggie Marcs', latestAwardedAt: '2026', isRetired: false },
  { id: 'ach-3', name: 'Pairs Champion', category: 'championship', criteria: 'Winning pair of the club pairs championship.', issuedCount: 30, activeMembersHolding: 6, latestAwardee: 'D. Peters + T. Wong', latestAwardedAt: '2026', isRetired: false },
  { id: 'ach-4', name: '10 Years', category: 'service', criteria: 'Continuous playing membership for 10 seasons.', issuedCount: 88, activeMembersHolding: 24, latestAwardee: 'Karen Watson', latestAwardedAt: '2026', isRetired: false },
  { id: 'ach-5', name: '25 Years', category: 'service', criteria: 'Continuous playing membership for 25 seasons.', issuedCount: 34, activeMembersHolding: 9, latestAwardee: 'Peter Harding', latestAwardedAt: '2025', isRetired: false },
  { id: 'ach-6', name: '500 Games', category: 'milestone', criteria: 'Player has recorded 500 official club matches.', issuedCount: 12, activeMembersHolding: 5, latestAwardee: 'Denise Peters', latestAwardedAt: '2026', isRetired: false },
  { id: 'ach-7', name: 'Life Member', category: 'special', criteria: 'Committee-voted lifetime membership for service to the club.', issuedCount: 7, activeMembersHolding: 3, latestAwardee: 'John Prescott', latestAwardedAt: '2023', isRetired: false },
  { id: 'ach-8', name: 'President’s Cup', category: 'special', criteria: 'Annual sportsmanship award — chosen by the outgoing president.', issuedCount: 14, activeMembersHolding: 14, latestAwardee: 'Sione Vagana', latestAwardedAt: '2025', isRetired: false },
  { id: 'ach-9', name: 'Junior Development', category: 'special', criteria: 'Under-25 player of the season.', issuedCount: 2, activeMembersHolding: 2, latestAwardee: 'Aroha Ngata', latestAwardedAt: '2026', isRetired: false },
])

const recent = ref<Recipient[]>([
  { id: 'g1', achievementId: 'ach-1', memberName: 'Marcus Tuilagi', year: 2026, note: 'Beat D. Peters 21-14 in the final.' },
  { id: 'g2', achievementId: 'ach-6', memberName: 'Denise Peters', year: 2026, note: '500 games as of 18 Aug 2026.' },
  { id: 'g3', achievementId: 'ach-2', memberName: 'Reggie Marcs', year: 2026 },
  { id: 'g4', achievementId: 'ach-4', memberName: 'Karen Watson', year: 2026 },
  { id: 'g5', achievementId: 'ach-9', memberName: 'Aroha Ngata', year: 2026, note: 'First season — averaged 15.2 shots/game.' },
])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return achievements.value
  return achievements.value.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.criteria.toLowerCase().includes(q),
  )
})

const grouped = computed(() => {
  const buckets: Record<Category, Achievement[]> = {
    championship: [],
    service: [],
    milestone: [],
    special: [],
  }
  filtered.value.forEach((a) => buckets[a.category].push(a))
  return buckets
})

const categoryMeta: Record<Category, { label: string; tint: string }> = {
  championship: { label: 'Championships', tint: 'gold' },
  service: { label: 'Service', tint: 'mint' },
  milestone: { label: 'Milestones', tint: 'accent' },
  special: { label: 'Special awards', tint: 'violet' },
}

function achievementFor(id: string): Achievement | null {
  return achievements.value.find((a) => a.id === id) ?? null
}
</script>

<template>
  <div class="ach">
    <header class="ach__header">
      <div>
        <div class="ach__eyebrow">Awards catalogue</div>
        <h1 class="ach__heading">Achievements</h1>
        <p class="ach__sub">The trophies, badges, and milestones you recognise. {{ achievements.length }} in the catalogue.</p>
      </div>
      <button class="btn btn--primary">+ New achievement</button>
    </header>

    <div class="ach__toolbar">
      <div class="ach__tabs">
        <button class="tab" :class="{ 'is-active': activeTab === 'catalogue' }" @click="activeTab = 'catalogue'">Catalogue</button>
        <button class="tab" :class="{ 'is-active': activeTab === 'recent' }" @click="activeTab = 'recent'">Recent awards</button>
      </div>
      <div class="ach__search" v-if="activeTab === 'catalogue'">
        <input v-model="search" class="ach__search-input" placeholder="Search catalogue…" />
      </div>
    </div>

    <template v-if="activeTab === 'catalogue'">
      <section
        v-for="(items, cat) in grouped"
        :key="cat"
        class="section"
      >
        <h2 class="section__label" v-if="items.length">
          {{ categoryMeta[cat as Category].label }}
          <span class="section__count">{{ items.length }}</span>
        </h2>
        <div class="grid" v-if="items.length">
          <article
            v-for="a in items"
            :key="a.id"
            class="card"
          >
            <div class="card__crest" :class="`crest--${categoryMeta[cat as Category].tint}`" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M8 4h8v3a4 4 0 0 1-8 0V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M5 4H3v2a2 2 0 0 0 2 2M19 4h2v2a2 2 0 0 1-2 2M10 14v5h4v-5M8 20h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="card__body">
              <h3 class="card__name">{{ a.name }}</h3>
              <p class="card__criteria">{{ a.criteria }}</p>
              <div class="card__stats">
                <div class="stat">
                  <div class="stat__val">{{ a.issuedCount }}</div>
                  <div class="stat__lbl">Issued</div>
                </div>
                <div class="stat">
                  <div class="stat__val">{{ a.activeMembersHolding }}</div>
                  <div class="stat__lbl">Active holders</div>
                </div>
                <div class="stat">
                  <div class="stat__val">{{ a.latestAwardedAt ?? '—' }}</div>
                  <div class="stat__lbl">Latest</div>
                </div>
              </div>
              <div v-if="a.latestAwardee" class="card__latest">
                Latest: <b>{{ a.latestAwardee }}</b>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <ul class="timeline">
        <li v-for="r in recent" :key="r.id" class="timeline__item">
          <div class="timeline__dot" />
          <div class="timeline__body">
            <div class="timeline__ach">{{ achievementFor(r.achievementId)?.name }}</div>
            <div class="timeline__member">{{ r.memberName }} <span class="timeline__year">· {{ r.year }}</span></div>
            <div v-if="r.note" class="timeline__note">{{ r.note }}</div>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.ach { max-width: 1080px; }
.ach__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.ach__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.ach__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.ach__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }

.ach__toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; }
.ach__tabs { display: flex; gap: 4px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.tab { padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }

.ach__search-input { width: 280px; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.ach__search-input:focus { outline: none; border-color: var(--color-ink); }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }

.section { margin-bottom: 28px; }
.section__label { display: flex; align-items: center; gap: 10px; font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); margin: 0 0 12px; }
.section__count { font-family: var(--font-mono); font-size: 10px; padding: 1px 8px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; letter-spacing: 0; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card { display: flex; gap: 14px; padding: 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.card__crest { width: 44px; height: 44px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.crest--gold { background: #FEF3C7; color: #92400E; }
.crest--mint { background: #DCFCE7; color: #166534; }
.crest--accent { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.crest--violet { background: #EDE9FE; color: var(--color-feature-violet); }
.card__body { flex: 1; min-width: 0; }
.card__name { font-family: var(--font-display); font-size: 17px; font-weight: 700; letter-spacing: -0.005em; margin: 0 0 4px; color: var(--color-ink); }
.card__criteria { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); line-height: 1.5; margin: 0 0 12px; }
.card__stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.stat { padding: 6px 0; }
.stat__val { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); }
.stat__lbl { font-family: var(--font-body); font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.card__latest { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); border-top: 1px solid var(--color-hairline); padding-top: 10px; }
.card__latest b { color: var(--color-ink); font-weight: 600; }

.timeline { list-style: none; padding: 0; margin: 0; }
.timeline__item { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--color-hairline); }
.timeline__item:last-child { border-bottom: 0; }
.timeline__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-ink); margin-top: 8px; flex-shrink: 0; }
.timeline__body { flex: 1; }
.timeline__ach { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.timeline__member { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.005em; color: var(--color-ink); margin: 2px 0; }
.timeline__year { color: var(--color-fog); font-weight: 400; }
.timeline__note { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 2px; }

@media (max-width: 767px) {
  .ach__toolbar { flex-direction: column; align-items: stretch; }
  .ach__search-input { width: 100%; }
  .grid { grid-template-columns: 1fr; }
}
</style>
