<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'

type ViewMode = 'timeline' | 'table' | 'by-player'

interface Category {
  id: string
  name: string
  count: number | string
  status?: 'draft'
}

interface WinnerCard {
  year: number
  initials?: string
  name?: string
  score?: string
  isGold?: boolean
  isCurrent?: boolean
  note?: string
  photoMissing?: boolean
  notHeld?: boolean
}

interface Decade {
  label: string
  meta: string
  cards: WinnerCard[]
}

const categories = ref<Category[]>([
  { id: 'cc', name: 'Champion of Champions', count: 42 },
  { id: 'ms', name: "Men's Singles", count: 38 },
  { id: 'mp', name: "Men's Pairs", count: 35 },
  { id: 'mt', name: "Men's Triples", count: 28 },
  { id: 'mf', name: "Men's Fours", count: 22 },
  { id: 'ls', name: 'Ladies Singles', count: 18 },
  { id: 'lp', name: 'Ladies Pairs', count: 14 },
  { id: 'lf', name: 'Ladies Fours', count: 9 },
  { id: 'mx', name: 'Mixed Pairs', count: 6 },
  { id: 'jc', name: 'Junior Champion', count: 2 },
  { id: 'lm', name: 'Life Members', count: 'Draft', status: 'draft' },
])

const activeCategoryId = ref<string>('cc')
const viewMode = ref<ViewMode>('timeline')
const filter = ref('')

const activeCategory = computed(
  () => categories.value.find(c => c.id === activeCategoryId.value)!,
)

// ── New category modal ─────────────────────────────────────────
const createOpen = ref(false)
const emptyForm = () => ({
  name: '',
  format: 'singles' as 'singles' | 'pairs' | 'triples' | 'fours' | 'other',
  gender: 'open' as 'mens' | 'ladies' | 'mixed' | 'open',
  startYear: '',
  saveAsDraft: true,
})
const form = reactive(emptyForm())

function openCreate() {
  Object.assign(form, emptyForm())
  createOpen.value = true
}
function closeCreate() { createOpen.value = false }

const canSubmit = computed(() => form.name.trim().length > 0)

function submit() {
  if (!canSubmit.value) return
  const id = `cat-${Date.now()}`
  categories.value.push({
    id,
    name: form.name.trim(),
    count: form.saveAsDraft ? 'Draft' : 0,
    status: form.saveAsDraft ? 'draft' : undefined,
  })
  activeCategoryId.value = id
  closeCreate()
}

const decades: Decade[] = [
  {
    label: '2020s',
    meta: '7 champions · 3 unique winners',
    cards: [
      { year: 2026, initials: 'MT', name: 'M. Tuilagi', score: '21–14', isGold: true, isCurrent: true },
      { year: 2025, initials: 'DP', name: 'D. Peters', score: '21–16' },
      { year: 2024, initials: 'MT', name: 'M. Tuilagi', score: '21–11', isGold: true },
      { year: 2023, initials: 'DP', name: 'D. Peters', score: '21–18' },
      { year: 2022, initials: 'MT', name: 'M. Tuilagi', score: '21–20', isGold: true },
      { year: 2021, initials: 'TW', name: 'T. Wong', score: '21–19' },
      { year: 2020, notHeld: true, note: 'Covid' },
    ],
  },
  {
    label: '2010s',
    meta: '10 champions · 5 unique winners',
    cards: [
      { year: 2019, initials: 'TW', name: 'T. Wong', score: '21–17' },
      { year: 2018, initials: 'RH', name: 'R. Harris', score: '21–15' },
      { year: 2017, initials: 'TW', name: 'T. Wong', score: '21–13' },
      { year: 2016, initials: 'RH', name: 'R. Harris', score: '21–19' },
      { year: 2015, initials: 'JB', name: 'J. Bell', score: '21–12' },
      { year: 2014, initials: 'RH', name: 'R. Harris', score: '21–18' },
      { year: 2013, initials: 'SO', name: 'S. Olsen', photoMissing: true },
    ],
  },
]
</script>

<template>
  <div class="hb">
    <header class="hb__header">
      <div>
        <div class="hb__eyebrow">Clubroom wall · Digital edition</div>
        <h1 class="hb__heading">Honour board</h1>
        <p class="hb__sub">11 categories · 214 entries · shown on your public site</p>
      </div>
      <div class="hb__actions">
        <button class="btn btn--ghost">Preview site</button>
        <button class="btn btn--primary" @click="openCreate">+ Add category</button>
      </div>
    </header>

    <CrmModal
      :open="createOpen"
      eyebrow="Honour board"
      title="Add a category"
      width="md"
      @close="closeCreate"
    >
      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span class="field__label">Name</span>
          <input v-model="form.name" type="text" placeholder="Champion of Champions" autofocus />
        </label>
        <div class="form__row">
          <label class="field">
            <span class="field__label">Format</span>
            <select v-model="form.format">
              <option value="singles">Singles</option>
              <option value="pairs">Pairs</option>
              <option value="triples">Triples</option>
              <option value="fours">Fours</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">Grade</span>
            <select v-model="form.gender">
              <option value="mens">Men's</option>
              <option value="ladies">Ladies</option>
              <option value="mixed">Mixed</option>
              <option value="open">Open</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">First year contested (optional)</span>
          <input v-model="form.startYear" type="text" placeholder="1968" />
        </label>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Save as draft</div>
            <div class="switch-row__hint">Hidden from the public site until you add entries and publish.</div>
          </div>
          <button type="button" class="switch" :class="{ 'is-on': form.saveAsDraft }" @click="form.saveAsDraft = !form.saveAsDraft"><span class="switch__knob" /></button>
        </div>
      </form>

      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeCreate">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" :disabled="!canSubmit" @click="submit">Add category</button>
      </template>
    </CrmModal>

    <div class="grid">
      <!-- Categories rail -->
      <aside class="cats">
        <div class="cats__header">
          <div class="cats__label">Categories</div>
          <button class="cats__new">+ New</button>
        </div>
        <div class="cats__list">
          <button
            v-for="c in categories"
            :key="c.id"
            class="cat"
            :class="{ 'is-active': activeCategoryId === c.id, 'is-draft': c.status === 'draft' }"
            @click="activeCategoryId = c.id"
          >
            <span class="cat__dot" />
            <span class="cat__name">{{ c.name }}</span>
            <span class="cat__count">{{ c.count }}</span>
          </button>
        </div>
        <div class="cats__footer">
          <span>Drag to reorder</span>
          <span>{{ categories.length }} total</span>
        </div>
      </aside>

      <!-- Featured category -->
      <section class="feature">
        <!-- Champion hero card -->
        <div class="hero">
          <div class="hero__medallion">
            <div class="hero__medallion-inner">MT</div>
            <div class="hero__star">
              <svg viewBox="0 0 24 24" fill="#fff" width="16" height="16"><path d="M12 2l2.4 6.9H21l-5.4 4 2 6.9L12 15.6l-5.6 4.2 2-6.9L3 8.9h6.6z"/></svg>
            </div>
          </div>
          <div class="hero__body">
            <div class="hero__eyebrow">Reigning champion · 2026</div>
            <div class="hero__name">Marcus Tuilagi</div>
            <div class="hero__cat">{{ activeCategory.name }} · Naenae BC</div>
            <div class="hero__stats">
              <div class="hero__stat">
                <div class="hero__stat-value">3</div>
                <div class="hero__stat-label">Titles held</div>
              </div>
              <div class="hero__stat">
                <div class="hero__stat-value">21–14</div>
                <div class="hero__stat-label">Final score</div>
              </div>
              <div class="hero__stat">
                <div class="hero__stat-value">14</div>
                <div class="hero__stat-label">Seasons played</div>
              </div>
              <div class="hero__stat">
                <div class="hero__stat-value">Mar '26</div>
                <div class="hero__stat-label">Awarded</div>
              </div>
            </div>
          </div>
          <div class="hero__actions">
            <button class="hero__btn hero__btn--solid">Edit champion</button>
            <button class="hero__btn hero__btn--ghost">Share to site</button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="toolbar">
          <div class="segmented">
            <button
              v-for="m in (['timeline', 'table', 'by-player'] as ViewMode[])"
              :key="m"
              class="segmented__btn"
              :class="{ 'is-active': viewMode === m }"
              @click="viewMode = m"
            >
              {{ m === 'by-player' ? 'By player' : m[0]!.toUpperCase() + m.slice(1) }}
            </button>
          </div>
          <div class="toolbar__right">
            <input v-model="filter" class="filter" placeholder="Filter winners…" />
            <button class="btn btn--primary">+ Add entry</button>
          </div>
        </div>

        <!-- Decade rows -->
        <div class="decades">
          <div v-for="d in decades" :key="d.label" class="decade">
            <div class="decade__header">
              <div class="decade__title-row">
                <h2 class="decade__title">{{ d.label }}</h2>
                <span class="decade__meta">{{ d.meta }}</span>
              </div>
              <button class="decade__view">View decade</button>
            </div>
            <div class="year-grid">
              <div
                v-for="c in d.cards"
                :key="c.year"
                class="year-card"
                :class="{ 'is-current': c.isCurrent, 'is-not-held': c.notHeld }"
              >
                <div class="year-card__year">{{ c.year }}</div>
                <div
                  v-if="c.notHeld"
                  class="year-card__avatar year-card__avatar--empty"
                >—</div>
                <div
                  v-else
                  class="year-card__avatar"
                  :class="{ 'is-gold': c.isGold }"
                >{{ c.initials }}</div>
                <div class="year-card__name" :class="{ 'is-muted': c.notHeld }">
                  {{ c.notHeld ? 'Not held' : c.name }}
                </div>
                <div v-if="c.score" class="year-card__score">{{ c.score }}</div>
                <div v-else-if="c.photoMissing" class="year-card__flag">Photo missing</div>
                <div v-else-if="c.note" class="year-card__note">{{ c.note }}</div>
              </div>
            </div>
          </div>

          <div class="load-more">
            <div class="load-more__label">
              <span class="load-more__icon">+</span>
              25 more winners between <strong>1984–2009</strong>
            </div>
            <button class="btn btn--ghost">Load earlier years</button>
          </div>
        </div>

        <!-- Data quality strip -->
        <div class="quality">
          <div class="quality__card">
            <div class="quality__label quality__label--warn">Needs attention</div>
            <div class="quality__value">6 entries</div>
            <div class="quality__body">Missing photos or scores.</div>
          </div>
          <div class="quality__card">
            <div class="quality__label quality__label--ok">Published</div>
            <div class="quality__value">Live on site</div>
            <div class="quality__body">Last synced 2 hours ago.</div>
          </div>
          <div class="quality__card">
            <div class="quality__label quality__label--auto">Auto-add</div>
            <div class="quality__value">Champs event</div>
            <div class="quality__body">Winners linked from March comp.</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hb { max-width: 1280px; }
.hb__header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.hb__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.hb__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.hb__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.hb__actions { display: flex; gap: 8px; }

.btn { padding: 9px 14px; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--ghost { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.grid { display: grid; grid-template-columns: 280px 1fr; gap: 28px; align-items: start; }

/* Categories rail */
.cats { border: 1px solid var(--color-hairline); border-radius: 16px; background: #fff; overflow: hidden; position: sticky; top: 108px; }
.cats__header { padding: 16px 18px; border-bottom: 1px solid var(--color-hairline); display: flex; align-items: center; justify-content: space-between; }
.cats__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.cats__new { padding: 5px 9px; border: 1px solid var(--color-hairline); background: #fff; border-radius: 999px; font-family: var(--font-body); font-size: 11px; color: var(--color-ink); cursor: pointer; }
.cats__list { padding: 10px 8px; display: flex; flex-direction: column; gap: 1px; }
.cat { display: flex; align-items: center; gap: 10px; padding: 9px 12px; background: transparent; border: none; border-radius: 8px; cursor: pointer; text-align: left; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.cat.is-active { background: var(--color-accent-soft); font-weight: 600; }
.cat__dot { width: 6px; height: 6px; border-radius: 999px; background: var(--color-hairline); }
.cat.is-active .cat__dot { background: var(--color-accent); }
.cat.is-draft .cat__dot { background: var(--color-feature-tangerine); }
.cat__name { flex: 1; }
.cat__count { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.cat.is-active .cat__count { color: var(--color-graphite); }
.cats__footer { padding: 12px 16px; border-top: 1px solid var(--color-hairline); display: flex; justify-content: space-between; background: var(--color-surface); font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

/* Feature */
.feature { display: flex; flex-direction: column; gap: 24px; min-width: 0; }

/* Hero */
.hero { position: relative; padding: 32px; border-radius: 20px; background: linear-gradient(135deg, #0F1930 0%, #1E3A8A 100%); color: #fff; display: flex; gap: 28px; align-items: center; overflow: hidden; }
.hero__medallion { position: relative; flex-shrink: 0; }
.hero__medallion-inner { width: 120px; height: 120px; border-radius: 999px; background: linear-gradient(135deg, #D97706 0%, #F59E0B 60%, #FCD34D 100%); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.02em; box-shadow: 0 8px 24px rgba(0,0,0,0.35); border: 4px solid #fff; }
.hero__star { position: absolute; bottom: -4px; right: -4px; width: 36px; height: 36px; border-radius: 999px; background: #F59E0B; border: 3px solid #0F1930; display: flex; align-items: center; justify-content: center; }
.hero__body { flex: 1; min-width: 0; }
.hero__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: rgba(255,255,255,0.6); text-transform: uppercase; margin-bottom: 8px; }
.hero__name { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 6px; }
.hero__cat { font-family: var(--font-display); font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.7); margin-bottom: 16px; }
.hero__stats { display: flex; gap: 20px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.14); flex-wrap: wrap; }
.hero__stat-value { font-family: var(--font-mono); font-size: 22px; font-weight: 700; }
.hero__stat-label { font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.12em; color: rgba(255,255,255,0.55); text-transform: uppercase; margin-top: 2px; }
.hero__actions { display: flex; flex-direction: column; gap: 8px; align-self: flex-start; }
.hero__btn { padding: 8px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; border: none; }
.hero__btn--solid { background: #fff; color: var(--color-ink); }
.hero__btn--ghost { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.24); }

/* Toolbar */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.segmented { display: flex; gap: 6px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; }
.segmented__btn { padding: 7px 14px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.segmented__btn.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.toolbar__right { display: flex; gap: 10px; align-items: center; }
.filter { padding: 9px 14px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; min-width: 200px; }

/* Decade rows */
.decades { border: 1px solid var(--color-hairline); border-radius: 16px; background: #fff; overflow: hidden; }
.decade { padding: 20px 24px; border-bottom: 1px solid var(--color-hairline); }
.decade__header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.decade__title-row { display: flex; align-items: baseline; gap: 12px; }
.decade__title { font-family: var(--font-display); font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); }
.decade__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.decade__view { background: transparent; border: none; color: var(--color-accent); font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }

.year-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; }
.year-card { padding: 14px 12px; background: var(--color-surface); border-radius: 12px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.year-card.is-current { background: var(--color-accent-soft); }
.year-card__year { font-family: var(--font-mono); font-size: 11px; color: var(--color-fog); }
.year-card.is-current .year-card__year { color: var(--color-graphite); }
.year-card__avatar { width: 40px; height: 40px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 12px; font-weight: 700; margin: 4px 0; }
.year-card__avatar.is-gold { background: linear-gradient(135deg, #D97706, #FCD34D); }
.year-card__avatar--empty { background: repeating-linear-gradient(45deg, var(--color-hairline), var(--color-hairline) 4px, #fff 4px, #fff 8px); color: var(--color-fog); font-family: var(--font-body); font-size: 12px; font-weight: 500; }
.year-card__name { font-family: var(--font-body); font-size: 11px; font-weight: 600; color: var(--color-ink); line-height: 1.3; }
.year-card__name.is-muted { color: var(--color-fog); }
.year-card__score { font-family: var(--font-body); font-size: 9px; color: var(--color-fog); }
.year-card__flag { font-family: var(--font-body); font-size: 9px; color: var(--color-feature-tangerine); font-weight: 600; }
.year-card__note { font-family: var(--font-body); font-size: 9px; color: var(--color-fog); font-style: italic; }

.load-more { padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface); }
.load-more__label { display: flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.load-more__icon { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: 1px solid var(--color-hairline); border-radius: 999px; font-size: 11px; color: var(--color-fog); }

/* Data quality strip */
.quality { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.quality__card { padding: 16px; border: 1px solid var(--color-hairline); border-radius: 14px; background: #fff; }
.quality__label { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; margin-bottom: 6px; }
.quality__label--warn { color: var(--color-feature-tangerine); }
.quality__label--ok { color: var(--color-accent); }
.quality__label--auto { color: var(--color-graphite); }
.quality__value { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-ink); margin-bottom: 4px; }
.quality__body { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); }

@media (max-width: 767px) {
  .hb__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .hb__heading { font-size: 26px; }
  .hb__actions { display: flex; gap: 8px; }
  .hb__actions .btn { flex: 1; text-align: center; justify-content: center; }

  /* One-column stack */
  .grid { grid-template-columns: 1fr; gap: 16px; }

  /* Categories become a horizontal scroll pill row */
  .cats { position: static; border-radius: 14px; overflow: hidden; }
  .cats__header { padding: 14px 16px; }
  .cats__list { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 12px; gap: 8px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
  .cats__list::-webkit-scrollbar { display: none; }
  .cat { flex-shrink: 0; padding: 8px 14px; border: 1px solid var(--color-hairline); border-radius: 999px; scroll-snap-align: start; background: #fff; }
  .cat.is-active { background: var(--color-ink); border-color: var(--color-ink); }
  .cat.is-active .cat__name { color: #fff; }
  .cat.is-active .cat__count { color: rgba(255,255,255,0.7); }
  .cat.is-active .cat__dot { display: none; }
  .cat__dot { display: none; }
  .cats__footer { display: none; }

  /* Hero card compact */
  .hero { flex-direction: column; align-items: flex-start; padding: 24px; gap: 20px; text-align: left; }
  .hero__medallion-inner { width: 88px; height: 88px; font-size: 24px; }
  .hero__star { width: 30px; height: 30px; }
  .hero__name { font-size: 28px; }
  .hero__cat { font-size: 13px; }
  .hero__stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; width: 100%; }
  .hero__stat-value { font-size: 18px; }
  .hero__actions { flex-direction: row; width: 100%; }
  .hero__btn { flex: 1; text-align: center; justify-content: center; }

  /* Toolbar */
  .toolbar { flex-direction: column; align-items: stretch; gap: 10px; }
  .segmented { justify-content: space-between; }
  .segmented__btn { flex: 1; text-align: center; }
  .toolbar__right { flex-direction: column; align-items: stretch; }
  .filter { min-width: 0; width: 100%; }

  /* Decade year grid: 3 columns instead of 7 */
  .decade { padding: 16px 18px; }
  .decade__title { font-size: 20px; }
  .decade__meta { font-size: 11px; }
  .year-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .year-card { padding: 10px 8px; }
  .year-card__avatar { width: 34px; height: 34px; font-size: 11px; }
  .year-card__name { font-size: 10px; }

  .load-more { flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px 18px; }

  /* Data quality strip */
  .quality { grid-template-columns: 1fr; gap: 10px; }
  .quality__card { padding: 14px; }
  .quality__value { font-size: 20px; }
}

@media (max-width: 420px) {
  .year-grid { grid-template-columns: repeat(2, 1fr); }
  .hero__stats { grid-template-columns: 1fr 1fr; }
}

/* Modal form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field select:focus { outline: none; border-color: var(--color-ink); }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
</style>
