<script setup lang="ts">
/**
 * Meet the club — public members directory block (brief 35).
 *
 * Doubles as a curated block: set `positions` to a subset (e.g. `['staff']`)
 * and the block shows only those groups. Combine with `showFilterChips: false`
 * + `showSearch: false` for a static "Meet the staff" strip on any page.
 *
 * Reads brief 35's public endpoint via api-client. Card click routes to
 * /players/:userId (the profile page, task #109).
 */
import { computed, inject, isRef, onMounted, ref, watch, type Ref } from 'vue'
import {
  members as membersApi,
  type PublicMember,
  type PublicMembersResponse,
  type PositionGroup,
} from '@torny/api-client'
import Skeleton from '../components/Skeleton.vue'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type MembersSearchProps,
  type MemberPositionGroup,
} from '../types'

const props = withDefaults(defineProps<MembersSearchProps>(), {
  eyebrow: '',
  heading: 'Meet the club',
  description: '',
  positions: () => [],
  defaultPosition: 'all',
  showFilterChips: true,
  showSearch: true,
  pageSize: 24,
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')

// ── Position palette — shared with the honour-board / calendar system ─
const POSITION_META: Record<MemberPositionGroup, { label: string; from: string; to: string; ring: string }> = {
  board:     { label: 'Board',     from: '#F5A623', to: '#E85D5D', ring: '#F5A623' },
  staff:     { label: 'Staff',     from: '#0EA5E9', to: '#0369A1', ring: '#38BDF8' },
  committee: { label: 'Committee', from: '#7C3AED', to: '#DB2777', ring: '#A855F7' },
  member:    { label: 'Member',    from: '#10B981', to: '#0F766E', ring: '#34D399' },
}

/** Positions allowed for this block. Empty prop = all four. */
const allowedPositions = computed<MemberPositionGroup[]>(() => {
  if (props.positions && props.positions.length > 0) return props.positions
  return ['board', 'staff', 'committee', 'member']
})

const activePosition = ref<'all' | MemberPositionGroup>(
  allowedPositions.value.includes(props.defaultPosition as MemberPositionGroup) || props.defaultPosition === 'all'
    ? props.defaultPosition
    : 'all',
)
watch(allowedPositions, () => {
  // If the CRM narrows positions to a subset that excludes the current
  // chip, reset to 'all' inside the new subset.
  if (activePosition.value !== 'all' && !allowedPositions.value.includes(activePosition.value)) {
    activePosition.value = 'all'
  }
})

// ── Search (debounced) ────────────────────────────────────────
const searchQuery = ref('')
const debouncedSearch = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    debouncedSearch.value = q.trim()
  }, 250)
})

// ── Fetch — one request per (position × search × slug) ────────
const members = ref<PublicMember[]>([])
const total = ref(0)
/** Start `true` so skeleton is the first paint on client-side nav. */
const fetching = ref(true)
let fetchAbort: AbortController | null = null

const requestPosition = computed<PositionGroup | undefined>(() => {
  // If chip is 'all' but the block is scoped to ONE position via props.positions,
  // send that single position to the server (backend can't OR multiple values).
  // For multi-position scope + 'all' chip, we fetch all + client-filter.
  if (activePosition.value !== 'all') return activePosition.value
  if (allowedPositions.value.length === 1) return allowedPositions.value[0]
  return undefined
})

const fetchKey = computed(
  () => `${clubSlug.value ?? ''}|${requestPosition.value ?? ''}|${debouncedSearch.value}|${props.pageSize}`,
)

async function loadMembers() {
  if (!clubSlug.value) {
    fetching.value = false
    return
  }
  if (fetchAbort) fetchAbort.abort()
  fetchAbort = new AbortController()
  fetching.value = true
  try {
    const res: PublicMembersResponse = await membersApi.publicList(
      clubSlug.value,
      {
        position: requestPosition.value,
        search: debouncedSearch.value || undefined,
        limit: props.pageSize,
      },
      { signal: fetchAbort.signal },
    )
    // If the block scopes to a subset of positions AND the current chip is
    // 'all', we still need to filter client-side (backend returned everything).
    if (
      activePosition.value === 'all' &&
      allowedPositions.value.length > 0 &&
      allowedPositions.value.length < 4
    ) {
      members.value = res.members.filter((m) => allowedPositions.value.includes(m.position_group))
    } else {
      members.value = res.members
    }
    total.value = res.total
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    members.value = []
    total.value = 0
  } finally {
    fetching.value = false
  }
}

onMounted(() => { if (clubSlug.value) void loadMembers() })
watch(fetchKey, () => { void loadMembers() })

// ── Derived counts + display helpers ──────────────────────────
const totalDisplayed = computed(() => members.value.length)

const countsByPosition = computed<Record<MemberPositionGroup, number>>(() => {
  const counts: Record<MemberPositionGroup, number> = { board: 0, staff: 0, committee: 0, member: 0 }
  for (const m of members.value) {
    if (m.position_group in counts) counts[m.position_group] += 1
  }
  return counts
})

/** Only render chips for groups actually present + allowed. */
const visibleChips = computed<MemberPositionGroup[]>(() =>
  allowedPositions.value.filter((p) => (countsByPosition.value[p] ?? 0) > 0),
)

function positionMeta(p: MemberPositionGroup) {
  return POSITION_META[p] ?? POSITION_META.member
}
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function avatarPalette(m: PublicMember) {
  // Position-based tint for consistency with the honour-board treatment,
  // but hash the name so people at the same position aren't a solid wall
  // of one colour.
  const seeds = [POSITION_META.board, POSITION_META.staff, POSITION_META.committee, POSITION_META.member]
  return seeds[hashCode(m.full_name) % seeds.length]!
}
</script>

<template>
  <section class="mem" :style="{ '--brand': brand } as any">
    <header class="mem__head">
      <div class="mem__eyebrow" v-if="props.eyebrow">
        <span class="mem__eyebrow-dot" />
        <span>{{ props.eyebrow }}</span>
      </div>
      <h2 class="mem__title">{{ props.heading }}</h2>
      <p v-if="props.description" class="mem__sub">{{ props.description }}</p>
    </header>

    <!-- CRM-preview placeholder — no clubSlug means no data. -->
    <div v-if="!clubSlug" class="mem__placeholder">
      <div class="mem__placeholder-title">Members directory</div>
      <p>Preview shows on the public site — this block renders a grid of members you can filter by position (board, staff, committee, members).</p>
    </div>

    <template v-else>
      <!-- Toolbar — same look + feel as HonourBoardSearchBlock: full-width
           search input on the left, Position dropdown on the right. -->
      <div v-if="props.showSearch || (props.showFilterChips && visibleChips.length > 1)" class="mem__toolbar">
        <div v-if="props.showSearch" class="mem__search">
          <svg class="mem__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            class="mem__search-input"
            :placeholder="`Search members — name or title…`"
            autocomplete="off"
          />
          <button v-if="searchQuery" type="button" class="mem__search-clear" @click="searchQuery = ''" aria-label="Clear search">×</button>
        </div>
        <div v-if="props.showFilterChips && visibleChips.length > 1" class="mem__filters">
          <label class="mem__select">
            <span>Position</span>
            <select v-model="activePosition">
              <option value="all">All ({{ totalDisplayed }})</option>
              <option v-for="p in visibleChips" :key="p" :value="p">
                {{ positionMeta(p).label }} ({{ countsByPosition[p] }})
              </option>
            </select>
          </label>
        </div>
      </div>

      <!-- Loading skeleton — first paint + refetch when list clears. -->
      <div v-if="fetching && members.length === 0" class="mem__grid" aria-busy="true" aria-label="Loading members">
        <div v-for="n in 6" :key="n" class="mc mc--skel">
          <Skeleton width="72px" height="72px" radius="pill" />
          <Skeleton :width="`${75 - n * 6}%`" height-variant="lg" style="margin-top: 12px;" />
          <Skeleton :width="`${55 - n * 4}%`" style="margin-top: 6px;" />
          <Skeleton width="60%" style="margin-top: 12px;" />
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="members.length === 0" class="mem__empty">
        <div class="mem__empty-title">Nobody to show yet.</div>
        <p v-if="debouncedSearch">Nobody matches "{{ debouncedSearch }}". Try a different search.</p>
        <p v-else>Members appear here once the club adds them and marks them visible.</p>
      </div>

      <!-- Grid of member cards -->
      <ul v-else class="mem__grid">
        <li v-for="m in members" :key="m.user_id">
          <a
            :href="`/players/${m.user_id}`"
            class="mc"
            :style="{
              '--mc-from': avatarPalette(m).from,
              '--mc-to': avatarPalette(m).to,
              '--mc-ring': avatarPalette(m).ring,
              '--mc-pos-from': positionMeta(m.position_group).from,
              '--mc-pos-to': positionMeta(m.position_group).to,
            } as any"
          >
            <div class="mc__avatar">
              <img v-if="m.avatar_url" :src="m.avatar_url" :alt="m.full_name" />
              <span v-else>{{ m.initials }}</span>
            </div>
            <div class="mc__name">{{ m.full_name }}</div>
            <div v-if="m.title" class="mc__title">{{ m.title }}</div>
            <div class="mc__foot">
              <span class="mc__position">{{ positionMeta(m.position_group).label }}</span>
              <span v-if="m.trophies_count > 0" class="mc__trophies" title="Wins on the honour board">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 6.9H21l-5.4 4 2 6.9L12 15.6l-6.6 4.2 2-6.9L2 8.9h6.6z"/></svg>
                <span>{{ m.trophies_count }}</span>
              </span>
              <span v-else-if="m.joined_year" class="mc__since">Since {{ m.joined_year }}</span>
            </div>
          </a>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.mem {
  display: flex;
  flex-direction: column;
  gap: 32px;
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
}

/* Head */
.mem__head { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.mem__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.mem__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); }
.mem__title { font-family: var(--font-display); font-size: clamp(32px, 4vw, 48px); font-weight: 700; letter-spacing: -0.02em; margin: 0; color: var(--color-ink); line-height: 1.05; }
.mem__sub { font-family: var(--font-body); font-size: 15px; color: var(--color-graphite); margin: 0; max-width: 560px; line-height: 1.55; }

.mem__placeholder { padding: 40px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-graphite); }
.mem__placeholder-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }

/* Toolbar — matches HonourBoardSearchBlock exactly */
.mem__toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mem__search { position: relative; flex: 1; min-width: 280px; }
.mem__search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--color-fog); pointer-events: none; }
.mem__search-input { width: 100%; padding: 12px 44px 12px 42px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; background: #fff; color: var(--color-ink); box-sizing: border-box; }
.mem__search-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 15%, transparent); }
.mem__search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: 0; font-size: 20px; color: var(--color-fog); cursor: pointer; padding: 0 6px; line-height: 1; }
.mem__filters { display: flex; gap: 10px; }
.mem__select { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.mem__select span { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.mem__select select { border: 0; background: transparent; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 600; cursor: pointer; }
.mem__select select:focus { outline: none; }

/* Empty */
.mem__empty { padding: 40px; text-align: center; background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 16px; font-family: var(--font-body); color: var(--color-fog); }
.mem__empty-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin-bottom: 6px; }
.mem__empty p { margin: 0; }

/* Grid */
.mem__grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

/* Member card */
.mc { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 20px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 16px; text-decoration: none; color: inherit; transition: transform 160ms, box-shadow 160ms, border-color 160ms; overflow: hidden; text-align: center; }
.mc::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--mc-pos-from, var(--brand)), var(--mc-pos-to, var(--brand))); }
.mc:hover { transform: translateY(-2px); border-color: transparent; box-shadow: 0 10px 30px color-mix(in oklab, var(--mc-ring, var(--brand)) 22%, transparent); }

.mc__avatar { width: 72px; height: 72px; border-radius: 999px; overflow: hidden; background-image: linear-gradient(160deg, var(--mc-from, #F5A623) 0%, var(--mc-to, #E85D5D) 100%); box-shadow: 0 4px 12px color-mix(in oklab, var(--mc-ring, #F5A623) 30%, transparent); display: inline-flex; align-items: center; justify-content: center; color: #fff; font-family: var(--font-display); font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.mc__avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.mc__name { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.01em; margin-top: 8px; }
.mc__title { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: -2px; }

.mc__foot { display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--color-hairline); width: 100%; justify-content: center; flex-wrap: wrap; }
.mc__position { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: color-mix(in oklab, var(--mc-pos-from, var(--brand)) 12%, #fff); color: var(--mc-pos-from, var(--color-ink)); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.mc__trophies { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: color-mix(in oklab, #F5A623 12%, #fff); color: #B45309; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
.mc__since { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); letter-spacing: 0.06em; }

/* Skeleton — same shape as the real card. */
.mc--skel { pointer-events: none; }
.mc--skel::before { display: none; }

@media (max-width: 1023px) {
  .mem__grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 767px) {
  .mem__grid { grid-template-columns: repeat(2, 1fr); }
  .mem__toolbar { flex-direction: column; align-items: stretch; }
}
@media (max-width: 420px) {
  .mem__grid { grid-template-columns: 1fr; }
}
</style>
