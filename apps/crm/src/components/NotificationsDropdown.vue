<script setup lang="ts">
/**
 * NotificationsDropdown
 * ---------------------
 * The panel that opens from the top-bar bell. On desktop it renders as
 * an anchored dropdown; on mobile it renders as a bottom sheet with the
 * same content. Rows carry a type-tinted icon, title + body, relative
 * time, and — when relevant — a one-tap inline action (Approve, Reply,
 * View) so the owner can clear low-friction tasks without opening the
 * full section.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClubStore } from '@/stores/club'
import { useNotificationsStore } from '@/stores/notifications'
import { useToast } from '@/composables/useToast'
import { ApiError, type Notification, type NotificationKind } from '@torny/api-client'

/** Local UI kind maps 1:1 to backend NotificationKind. `member_milestone`
 *  collapses to the existing `milestone` icon so we don't need to draw a
 *  new one. */
type Kind = 'application' | 'enquiry' | 'rsvp' | 'team' | 'publish' | 'payment' | 'milestone'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const router = useRouter()
const toast = useToast()
const clubStore = useClubStore()
const notificationsStore = useNotificationsStore()

/** Coerce a backend kind to the local UI kind (only `member_milestone` differs). */
function toUiKind(kind: NotificationKind): Kind {
  return kind === 'member_milestone' ? 'milestone' : kind
}

/** Relative time — the backend sends ISO 8601 UTC, we render short strings
 *  like `12m` / `2h` / `Yesterday` / `3d` to match the design. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 4) return `${wk}w`
  return new Date(iso).toLocaleDateString()
}

// ── Store bindings ────────────────────────────────────────────
const activeTab = computed<'all' | 'unread'>({
  get: () => notificationsStore.activeTab,
  set: (v) => notificationsStore.setTab(v),
})
const unreadCount = computed(() => notificationsStore.unreadCount)
const filtered = computed<Notification[]>(() => notificationsStore.filteredRows)

function close() {
  emit('update:open', false)
}

/** Fire-and-forget mark-read that swallows any error — the UI has already
 *  moved on and a red toast on a background action would surprise. */
async function markRead(n: Notification): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  if (!n.unread) return
  try {
    await notificationsStore.markRead(cid, n.id)
  } catch { /* silent — badge will self-correct on the next poll */ }
}

async function markAllRead(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  try {
    await notificationsStore.markAllRead(cid)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not mark all as read.')
  }
}

function openRow(n: Notification): void {
  void markRead(n)
  if (n.target?.destination_href) router.push(n.target.destination_href)
  close()
}
function runAction(n: Notification, ev: Event): void {
  ev.stopPropagation()
  void markRead(n)
  if (n.primary_action?.href) router.push(n.primary_action.href)
  close()
}

// Refetch the list every time the dropdown opens so we don't stare at
// stale rows from an hour ago.
watch(() => props.open, async (open) => {
  if (!open) return
  const cid = clubStore.current?.id
  if (typeof cid !== 'number') return
  try {
    await notificationsStore.fetchList(cid)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not load notifications.')
  }
})

// Dismiss on outside click / Esc
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}
function onDocClick(e: MouseEvent) {
  if (!props.open) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('[data-notif-anchor]')) return
  if (target.closest('.notif-dd')) return
  close()
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      window.addEventListener('keydown', onKey)
      // Delay the click listener a frame so the opening click itself
      // doesn't fire the outside-click dismiss.
      requestAnimationFrame(() => document.addEventListener('click', onDocClick))
    } else {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDocClick)
    }
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocClick)
})

const kindMeta: Record<Kind, { label: string; tone: 'accent' | 'mint' | 'tang' | 'violet' | 'ink' }> = {
  application: { label: 'Application', tone: 'accent' },
  enquiry: { label: 'Enquiry', tone: 'tang' },
  rsvp: { label: 'RSVPs', tone: 'mint' },
  team: { label: 'Team', tone: 'accent' },
  publish: { label: 'Website', tone: 'violet' },
  payment: { label: 'Payment', tone: 'mint' },
  milestone: { label: 'Milestone', tone: 'ink' },
}

defineExpose({ unreadCount })
</script>

<template>
  <transition name="notif-fade">
    <div v-if="open" class="notif-dd" role="dialog" aria-label="Notifications">
      <header class="notif-dd__head">
        <div>
          <div class="notif-dd__eyebrow">Notifications</div>
          <h3 class="notif-dd__title">
            <span v-if="unreadCount > 0">{{ unreadCount }} new</span>
            <span v-else>You're up to date</span>
          </h3>
        </div>
        <button
          class="notif-dd__mark"
          :disabled="unreadCount === 0"
          @click="markAllRead"
        >Mark all read</button>
      </header>

      <div class="notif-dd__tabs" role="tablist">
        <button
          class="notif-dd__tab"
          :class="{ 'is-active': activeTab === 'all' }"
          @click="activeTab = 'all'"
        >All</button>
        <button
          class="notif-dd__tab"
          :class="{ 'is-active': activeTab === 'unread' }"
          @click="activeTab = 'unread'"
        >
          <span>Unread</span>
          <span class="notif-dd__tab-count">{{ unreadCount }}</span>
        </button>
      </div>

      <ul class="notif-dd__list" v-if="filtered.length">
        <li
          v-for="n in filtered"
          :key="n.id"
          class="notif-dd__row"
          :class="{ 'is-unread': n.unread }"
          @click="openRow(n)"
        >
          <div class="notif-dd__icon" :class="`t-${kindMeta[toUiKind(n.kind)].tone}`" aria-hidden="true">
            <!-- application: person plus -->
            <svg v-if="n.kind === 'application'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="8" cy="6" r="3" stroke="currentColor" stroke-width="1.6"/>
              <path d="M2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M15 8v4M13 10h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <!-- enquiry: speech -->
            <svg v-else-if="n.kind === 'enquiry'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M3 4.5C3 3.7 3.7 3 4.5 3h11c.8 0 1.5.7 1.5 1.5v8c0 .8-.7 1.5-1.5 1.5H8L4 17v-2.5C3.4 14.5 3 14 3 13.5v-9z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>
            <!-- rsvp: calendar tick -->
            <svg v-else-if="n.kind === 'rsvp'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="5" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M3 8h14M7 3v4M13 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M7 12.5l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <!-- team: people -->
            <svg v-else-if="n.kind === 'team'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.6"/>
              <circle cx="13.5" cy="8.5" r="2" stroke="currentColor" stroke-width="1.6"/>
              <path d="M2.5 16c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M12 15.5c0-1.6 1.2-3 2.8-3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <!-- publish: rocket-ish -->
            <svg v-else-if="n.kind === 'publish'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M14 2c-4 0-8 4-8 8l4 4c4 0 8-4 8-8l-4-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <circle cx="12" cy="8" r="1.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M6 14l-2 4 4-2M6 10l-2 2M10 14l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <!-- payment: card -->
            <svg v-else-if="n.kind === 'payment'" width="16" height="16" viewBox="0 0 20 20" fill="none">
              <rect x="2.5" y="5" width="15" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M2.5 9h15M6 13h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <!-- milestone: trophy -->
            <svg v-else width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M6 4h8v3a4 4 0 0 1-8 0V4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M4 4H2v2a2 2 0 0 0 2 2M16 4h2v2a2 2 0 0 1-2 2M10 11v4M7 15h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="notif-dd__body">
            <div class="notif-dd__row-title">{{ n.title }}</div>
            <div v-if="n.body" class="notif-dd__row-desc">{{ n.body }}</div>
            <div class="notif-dd__row-meta">
              <span class="notif-dd__row-kind" :class="`t-${kindMeta[toUiKind(n.kind)].tone}`">{{ kindMeta[toUiKind(n.kind)].label }}</span>
              <span class="notif-dd__row-dot">·</span>
              <span class="notif-dd__row-when">{{ relativeTime(n.created_at) }}</span>
            </div>
          </div>
          <div class="notif-dd__right">
            <span v-if="n.unread" class="notif-dd__unread-dot" aria-label="Unread" />
            <button
              v-if="n.primary_action"
              class="notif-dd__action"
              @click="runAction(n, $event)"
            >{{ n.primary_action.label }}</button>
          </div>
        </li>
      </ul>
      <div v-else class="notif-dd__empty">
        <div class="notif-dd__empty-dot" aria-hidden="true" />
        Nothing here yet.
      </div>
    </div>
  </transition>
</template>

<style scoped>
.notif-dd {
  /* Anchored top-right on desktop — matches the topbar bell column. */
  position: fixed;
  top: 68px;
  right: 20px;
  width: 420px;
  max-height: min(560px, calc(100vh - 88px));
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.28), 0 8px 16px rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 60;
}

.notif-dd__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-hairline);
}
.notif-dd__eyebrow {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.notif-dd__title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-ink);
  margin: 4px 0 0;
}
.notif-dd__mark {
  background: transparent;
  border: 0;
  padding: 6px 10px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent);
  cursor: pointer;
  border-radius: 8px;
}
.notif-dd__mark:hover:not(:disabled) { background: var(--color-accent-soft); }
.notif-dd__mark:disabled { color: var(--color-mute); cursor: not-allowed; }

.notif-dd__tabs {
  display: flex;
  gap: 4px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-hairline);
}
.notif-dd__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fog);
  cursor: pointer;
}
.notif-dd__tab.is-active { background: var(--color-surface); color: var(--color-ink); font-weight: 600; }
.notif-dd__tab-count {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.notif-dd__list {
  list-style: none;
  padding: 4px 8px;
  margin: 0;
  overflow-y: auto;
  flex: 1;
}
.notif-dd__row {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 12px;
  padding: 12px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.notif-dd__row:hover { background: var(--color-surface); }
.notif-dd__row.is-unread { background: color-mix(in srgb, var(--color-accent-soft) 55%, #fff 45%); }
.notif-dd__row.is-unread:hover { background: var(--color-accent-soft); }

.notif-dd__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.t-accent { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.t-mint   { background: #DCFCE7; color: #166534; }
.t-tang   { background: #FEF3C7; color: #92400E; }
.t-violet { background: #EDE9FE; color: var(--color-feature-violet); }
.t-ink    { background: var(--color-hairline); color: var(--color-graphite); }

.notif-dd__body { min-width: 0; }
.notif-dd__row-title {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  line-height: 1.35;
}
.notif-dd__row-desc {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-graphite);
  line-height: 1.4;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.notif-dd__row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
}
.notif-dd__row-kind {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: currentColor;
  background: transparent !important;
  padding: 0;
}
.notif-dd__row-dot { opacity: 0.6; }
.notif-dd__row-when { font-variant-numeric: tabular-nums; }

.notif-dd__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.notif-dd__unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-accent);
}
.notif-dd__action {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  cursor: pointer;
}
.notif-dd__action:hover { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }

.notif-dd__empty {
  padding: 32px 20px;
  text-align: center;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
}
.notif-dd__empty-dot {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--color-surface);
  margin: 0 auto 10px;
}

/* Anim */
.notif-fade-enter-active, .notif-fade-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.notif-fade-enter-from, .notif-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* Mobile — anchored dropdown gracefully becomes a bottom sheet */
@media (max-width: 767px) {
  .notif-dd {
    position: fixed;
    inset: auto 0 0 0;
    width: auto;
    max-width: 100%;
    max-height: 82vh;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -24px 60px -20px rgba(15, 23, 42, 0.28);
  }
  .notif-fade-enter-from, .notif-fade-leave-to {
    opacity: 0;
    transform: translateY(24px);
  }
}
</style>
