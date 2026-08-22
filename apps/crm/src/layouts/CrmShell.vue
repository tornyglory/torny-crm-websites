<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { members as membersApi } from '@torny/api-client'
import NotificationsDropdown from '@/components/NotificationsDropdown.vue'
import NewMenu from '@/components/NewMenu.vue'
import UserMenu from '@/components/UserMenu.vue'
import CrmToast from '@/components/CrmToast.vue'

const auth = useAuthStore()
const club = useClubStore()
const route = useRoute()
const moreOpen = ref(false)
const notifsOpen = ref(false)
const newMenuOpen = ref(false)
const userMenuOpen = ref(false)
const drawerOpen = ref(false)

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
  if (drawerOpen.value) {
    notifsOpen.value = false
    newMenuOpen.value = false
    userMenuOpen.value = false
    moreOpen.value = false
  }
}
function closeDrawer() {
  drawerOpen.value = false
}

// Close the drawer whenever the route changes — RouterLinks inside it
// otherwise leave the drawer open over the newly-navigated page.
watch(() => route.fullPath, closeDrawer)

// Escape key closes the drawer for keyboard users.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && drawerOpen.value) closeDrawer()
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydown)
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}

function toggleNotifs() {
  notifsOpen.value = !notifsOpen.value
  if (notifsOpen.value) { newMenuOpen.value = false; userMenuOpen.value = false }
}
function toggleNewMenu() {
  newMenuOpen.value = !newMenuOpen.value
  if (newMenuOpen.value) { notifsOpen.value = false; userMenuOpen.value = false }
}
function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
  if (userMenuOpen.value) { notifsOpen.value = false; newMenuOpen.value = false }
}

const initials = computed(() => {
  if (!auth.user) return '—'
  return `${auth.user.firstName?.[0] ?? ''}${auth.user.lastName?.[0] ?? ''}`.toUpperCase()
})
const clubInitials = computed(() => {
  const name = club.current?.name ?? ''
  return name.split(/\s+/).map(w => w[0]).slice(0, 3).join('').toUpperCase() || '—'
})
const crumbTitle = computed(() => String(route.name ?? '').replace(/-/g, ' '))

type NavIcon =
  | 'dashboard' | 'members' | 'applications' | 'enquiries'
  | 'website' | 'events' | 'teams' | 'honour' | 'achievements'
  | 'communications' | 'site-settings' | 'settings'

interface NavItem {
  to: string
  label: string
  icon: NavIcon
  count?: number | string
  /** `accent` = draw-attention pill (unhandled items); `neutral` = informational. */
  countTone?: 'accent' | 'neutral'
}
// Live counts pulled once per active club. Falls back to '—' while loading
// so the sidebar never flashes stale numbers when the user switches clubs.
const memberCount = ref<number | null>(null)

async function loadMemberCount(clubId: number) {
  try {
    // limit=1 keeps the payload tiny — we only need counts.total which is
    // returned regardless of how many rows come back.
    const res = await membersApi.listRoster(clubId, { limit: 1, include_invites: false })
    memberCount.value = res.counts.total
  } catch {
    memberCount.value = null
  }
}

watch(
  () => club.current?.id,
  (id) => {
    if (id != null && typeof id === 'number') loadMemberCount(id)
    else memberCount.value = null
  },
  { immediate: true },
)

// MembersView broadcasts the fresh count after every add / remove / update so
// the sidebar doesn't lag behind actions.
function onRosterCountUpdate(e: Event) {
  const detail = (e as CustomEvent).detail
  if (typeof detail === 'number') memberCount.value = detail
}
if (typeof window !== 'undefined') {
  window.addEventListener('torny:roster-count', onRosterCountUpdate)
  onBeforeUnmount(() => window.removeEventListener('torny:roster-count', onRosterCountUpdate))
}

const manageNav = computed<NavItem[]>(() => [
  { to: '/crm/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/crm/members', label: 'Members', icon: 'members', count: memberCount.value ?? '—', countTone: 'neutral' },
  { to: '/crm/applications', label: 'Applications', icon: 'applications', count: 3, countTone: 'accent' },
  { to: '/crm/enquiries', label: 'Enquiries', icon: 'enquiries', count: 2, countTone: 'accent' },
])
const contentNav: NavItem[] = [
  { to: '/crm/website', label: 'Website', icon: 'website' },
  { to: '/crm/events', label: 'Events', icon: 'events', count: 12, countTone: 'neutral' },
  { to: '/crm/teams', label: 'Team selections', icon: 'teams', count: 4, countTone: 'neutral' },
  { to: '/crm/honour-board', label: 'Honour board', icon: 'honour', count: 11, countTone: 'neutral' },
  { to: '/crm/achievements', label: 'Achievements', icon: 'achievements' },
]
const accountNav: NavItem[] = [
  { to: '/crm/communications', label: 'Communications', icon: 'communications' },
  { to: '/crm/settings', label: 'Settings', icon: 'settings' },
]

function signOut() {
  auth.clearSession()
  closeDrawer()
}

interface TabItem { to: string; label: string; count?: number; icon: 'home' | 'members' | 'apps' | 'enquiries' | 'more' }
const bottomTabs = computed<TabItem[]>(() => [
  { to: '/crm/dashboard', label: 'Home', icon: 'home' },
  { to: '/crm/members', label: 'Members', icon: 'members', count: memberCount.value ?? undefined },
  { to: '/crm/applications', label: 'Apps', count: 3, icon: 'apps' },
  { to: '/crm/enquiries', label: 'Enquiries', count: 2, icon: 'enquiries' },
])
</script>

<template>
  <div class="shell">
    <!-- Backdrop for the mobile / tablet drawer. -->
    <div
      v-if="drawerOpen"
      class="drawer-backdrop"
      aria-hidden="true"
      @click="closeDrawer"
    />

    <!-- Sidebar. Sticky column on desktop (≥1024). Off-canvas drawer
         with a slide-in transform below that, opened by the hamburger. -->
    <aside class="sidebar" :class="{ 'is-open': drawerOpen }">
      <div class="sidebar__brand">
        <span class="sidebar__brand-inner">
          <span class="sidebar__dot" />
          <span class="sidebar__wordmark">Torny</span>
          <span class="sidebar__tag">CRM</span>
        </span>
        <button
          class="sidebar__close"
          type="button"
          aria-label="Close menu"
          @click="closeDrawer"
        >
          <svg viewBox="0 0 12 12" fill="none" width="12" height="12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <button type="button" class="sidebar__club">
        <div class="sidebar__club-badge">{{ clubInitials }}</div>
        <div class="sidebar__club-info">
          <div class="sidebar__club-label">Current club</div>
          <div class="sidebar__club-name">{{ club.current?.name ?? 'Select a club' }}</div>
        </div>
        <svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true" class="sidebar__club-chev">
          <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <nav class="sidebar__nav">
        <div class="sidebar__section-label">Manage</div>
        <RouterLink
          v-for="item in manageNav"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          active-class="is-active"
        >
          <span class="sidebar__link-icon" aria-hidden="true">
            <component :is="'nav-icon-slot'" />
            <svg v-if="item.icon === 'dashboard'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else-if="item.icon === 'members'" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M13 5a2.5 2.5 0 1 1 0 5M2 15v-1a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v1M14 10a3 3 0 0 1 3 3v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.icon === 'applications'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 2H5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 5 16h8a1.5 1.5 0 0 0 1.5-1.5V5.5L11 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 2v3.5h3.5M6.5 9.5h5M6.5 12h5M6.5 7h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.icon === 'enquiries'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 11V4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </span>
          <span class="sidebar__link-label">{{ item.label }}</span>
          <span
            v-if="item.count !== undefined"
            class="sidebar__link-count"
            :class="`sidebar__link-count--${item.countTone ?? 'neutral'}`"
          >{{ item.count }}</span>
        </RouterLink>

        <div class="sidebar__section-label">Content</div>
        <RouterLink
          v-for="item in contentNav"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          active-class="is-active"
        >
          <span class="sidebar__link-icon" aria-hidden="true">
            <svg v-if="item.icon === 'website'" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 9h13M9 2.5c1.8 2.2 2.7 4.3 2.7 6.5s-.9 4.3-2.7 6.5C7.2 13.3 6.3 11.2 6.3 9S7.2 4.7 9 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else-if="item.icon === 'events'" width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.5" y="4" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 7.5h13M6 2.5v3M12 2.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.icon === 'teams'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 3.5h6a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5z" stroke="currentColor" stroke-width="1.5"/><path d="M7 2.5h4v2H7zM7 8h4M7 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.icon === 'honour'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 2.5h8v5.5a4 4 0 1 1-8 0V2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 4.5H3v2a2 2 0 0 0 2 2M13 4.5h2v2a2 2 0 0 1-2 2M6 15.5h6M9 11.5v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <svg v-else-if="item.icon === 'achievements'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M12 3H6v3a3 3 0 1 0 6 0V3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 8.5A3.5 3.5 0 1 1 4 15.5M14 8.5A3.5 3.5 0 1 0 14 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <span class="sidebar__link-label">{{ item.label }}</span>
          <span
            v-if="item.count !== undefined"
            class="sidebar__link-count"
            :class="`sidebar__link-count--${item.countTone ?? 'neutral'}`"
          >{{ item.count }}</span>
        </RouterLink>

        <div class="sidebar__section-label">Account</div>
        <RouterLink
          v-for="item in accountNav"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          active-class="is-active"
        >
          <span class="sidebar__link-icon" aria-hidden="true">
            <svg v-if="item.icon === 'communications'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.5 3.5 8 11M15.5 3.5l-4.5 12L8 11 3.5 8l12-4.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg v-else-if="item.icon === 'site-settings'" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="5" r="1.5" fill="var(--color-ground)" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="9" r="1.5" fill="var(--color-ground)" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="13" r="1.5" fill="var(--color-ground)" stroke="currentColor" stroke-width="1.5"/></svg>
            <svg v-else-if="item.icon === 'settings'" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M9 1.5v2M9 14.5v2M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4M16.5 9h-2M3.5 9h-2M14.3 14.3l-1.4-1.4M5.1 5.1 3.7 3.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <span class="sidebar__link-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar__user">
        <div class="sidebar__user-avatar">{{ initials }}</div>
        <div class="sidebar__user-info">
          <div class="sidebar__user-name">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</div>
          <div v-if="auth.user?.email" class="sidebar__user-email">{{ auth.user.email }}</div>
          <div v-if="auth.role" class="sidebar__user-role">{{ auth.role }}<template v-if="club.current?.name"> · {{ club.current.name }}</template></div>
        </div>
        <button
          class="sidebar__signout"
          type="button"
          aria-label="Sign out"
          @click="signOut"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6.5 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h2.5M10 5l3 3-3 3M13 8H6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>

    <div class="main">
      <!-- Mobile top nav. Brand on the left; bell + hamburger on the
           right. Account info + sign-out live inside the drawer. -->
      <header class="mobile-top">
        <div class="mobile-top__brand">
          <span class="mobile-top__dot" aria-hidden="true"></span>
          <span class="mobile-top__wordmark">Torny</span>
          <span class="mobile-top__tag">CRM</span>
        </div>
        <div class="mobile-top__actions">
          <button
            class="mobile-top__bell"
            data-notif-anchor
            aria-label="Notifications"
            @click="toggleNotifs"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span class="mobile-top__bell-dot" />
          </button>
          <button
            class="hamburger hamburger--mobile"
            type="button"
            aria-label="Open navigation menu"
            :aria-expanded="drawerOpen"
            @click="toggleDrawer"
          >
            <svg viewBox="0 0 18 18" fill="none" width="18" height="18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <!-- Desktop / tablet topbar. Brand shows at ≤1023px; hamburger
           shows at ≤1023px as the last action so it mirrors mobile. -->
      <header class="topbar">
        <div class="topbar__brand">
          <span class="topbar__brand-dot" aria-hidden="true"></span>
          <span class="topbar__brand-wordmark">Torny</span>
          <span class="topbar__brand-tag">CRM</span>
        </div>
        <div class="topbar__crumbs">
          <span class="topbar__crumb-muted">{{ club.current?.name ?? '' }}</span>
          <span class="topbar__crumb-divider">/</span>
          <span class="topbar__crumb-strong">{{ crumbTitle }}</span>
        </div>
        <div class="topbar__search">
          <svg class="topbar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input class="topbar__search-input" placeholder="Search members, events, pages…" />
          <span class="topbar__search-kbd">⌘K</span>
        </div>
        <div class="topbar__actions">
          <button
            class="topbar__bell"
            data-notif-anchor
            aria-label="Notifications"
            @click="toggleNotifs"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span class="topbar__bell-dot" />
          </button>
          <button
            class="topbar__new"
            data-newmenu-anchor
            :aria-expanded="newMenuOpen"
            @click="toggleNewMenu"
          >
            + New
            <span class="topbar__new-kbd" aria-hidden="true">⌘N</span>
          </button>
          <button
            class="topbar__avatar"
            data-usermenu-anchor
            :aria-expanded="userMenuOpen"
            aria-label="Account menu"
            @click="toggleUserMenu"
          >
            <span>{{ initials }}</span>
          </button>
          <button
            class="hamburger hamburger--topbar"
            type="button"
            aria-label="Open navigation menu"
            :aria-expanded="drawerOpen"
            @click="toggleDrawer"
          >
            <svg viewBox="0 0 18 18" fill="none" width="18" height="18" aria-hidden="true">
              <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <!-- Shared notifications dropdown — mounted at shell level so both
           the mobile bell and the desktop bell can open it. -->
      <NotificationsDropdown v-model:open="notifsOpen" />
      <!-- Quick-create menu anchored to the "+ New" button. -->
      <NewMenu v-model:open="newMenuOpen" />
      <!-- Account menu anchored to the avatar (desktop) or mobile top strip. -->
      <UserMenu v-model:open="userMenuOpen" />
      <!-- Global toast — any view can call useToast().success(...) etc. -->
      <CrmToast />

      <div class="page">
        <RouterView />
      </div>

      <!-- Mobile bottom tab nav -->
      <nav class="tabbar">
        <RouterLink v-for="tab in bottomTabs" :key="tab.to" :to="tab.to" class="tabbar__item" active-class="is-active">
          <div class="tabbar__icon">
            <svg v-if="tab.icon === 'home'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></svg>
            <svg v-else-if="tab.icon === 'members'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="9" cy="8" r="4" /><path d="M17 11a3 3 0 1 0 0-6" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /></svg>
            <svg v-else-if="tab.icon === 'apps'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span v-if="tab.count" class="tabbar__badge">{{ tab.count }}</span>
          </div>
          <span class="tabbar__label">{{ tab.label }}</span>
        </RouterLink>
        <button class="tabbar__item" :class="{ 'is-active': moreOpen }" @click="moreOpen = !moreOpen">
          <div class="tabbar__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
          </div>
          <span class="tabbar__label">More</span>
        </button>
      </nav>

      <!-- Mobile "More" sheet -->
      <div v-if="moreOpen" class="sheet" @click.self="moreOpen = false">
        <div class="sheet__inner">
          <div class="sheet__grabber" />
          <div class="sheet__section-label">Content</div>
          <RouterLink v-for="item in contentNav" :key="item.to" :to="item.to" class="sheet__link" @click="moreOpen = false">
            <span>{{ item.label }}</span>
            <span v-if="item.count !== undefined" class="sheet__link-count">{{ item.count }}</span>
          </RouterLink>
          <div class="sheet__section-label">Account</div>
          <RouterLink v-for="item in accountNav" :key="item.to" :to="item.to" class="sheet__link" @click="moreOpen = false">
            <span>{{ item.label }}</span>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }

/* -------- Sidebar (desktop only) -------- */
.sidebar { width: 240px; background: #fff; border-right: 1px solid var(--color-hairline); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; z-index: 30; }
.sidebar__brand-inner { display: inline-flex; align-items: baseline; gap: 8px; }
.sidebar__close { display: none; width: 32px; height: 32px; border-radius: 999px; border: 0; background: var(--color-surface); color: var(--color-ink); cursor: pointer; align-items: center; justify-content: center; padding: 0; }
.sidebar__close:hover { background: var(--color-hairline); }
.sidebar__club-chev { color: var(--color-fog); flex-shrink: 0; }

.sidebar__link { text-decoration: none; }
.sidebar__link-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--color-graphite); flex-shrink: 0; }
.sidebar__link.is-active .sidebar__link-icon { color: #fff; }

.sidebar__link-count { padding: 2px 8px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.02em; flex-shrink: 0; }
.sidebar__link-count--neutral { background: var(--color-surface); color: var(--color-graphite); }
.sidebar__link-count--accent { background: var(--color-accent-soft); color: var(--color-accent); font-weight: 700; }
.sidebar__link.is-active .sidebar__link-count--neutral { background: rgba(255, 255, 255, 0.14); color: rgba(255, 255, 255, 0.82); }
.sidebar__link.is-active .sidebar__link-count--accent { background: rgba(255, 255, 255, 0.16); color: #fff; }

.sidebar__signout { width: 36px; height: 36px; border-radius: 10px; background: var(--color-surface); border: 1px solid var(--color-hairline); color: var(--color-graphite); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; flex-shrink: 0; }
.sidebar__signout:hover { background: var(--color-hairline); color: var(--color-ink); }

/* -------- Hamburger + drawer backdrop -------- */
.hamburger { width: 36px; height: 36px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; color: var(--color-ink); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.hamburger:hover { background: var(--color-surface); }
.hamburger:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.hamburger--topbar { display: none; margin-right: 4px; }

.drawer-backdrop { position: fixed; inset: 0; background: rgba(10, 10, 11, 0.4); z-index: 25; animation: drawer-fade 0.15s ease-out; }
@keyframes drawer-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.sidebar__brand { padding: 18px 20px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sidebar__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); }
.sidebar__wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.sidebar__tag { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; margin-left: 4px; }

.sidebar__club { margin: 4px 16px 8px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--color-hairline); border-radius: 16px; background: var(--color-surface); cursor: pointer; text-align: left; color: var(--color-ink); font: inherit; width: calc(100% - 32px); }
.sidebar__club:hover { border-color: var(--color-mute); }
.sidebar__club-badge { width: 36px; height: 36px; border-radius: 10px; background: var(--color-accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 12px; font-weight: 700; flex-shrink: 0; }
.sidebar__club-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sidebar__club-label { font-family: var(--font-body); font-size: 9px; font-weight: 600; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.sidebar__club-name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -0.01em; }

.sidebar__nav { flex: 1; overflow-y: auto; padding-bottom: 12px; }
.sidebar__section-label { padding: 12px 20px 6px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-mute); text-transform: uppercase; }
.sidebar__link { margin: 0 8px 1px; padding: 9px 12px; display: flex; align-items: center; gap: 10px; border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); text-decoration: none; }
.sidebar__link.is-active { background: var(--color-ink); color: #fff; font-weight: 600; }
.sidebar__link-label { flex: 1; }
.sidebar__link-count { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); }
.sidebar__link.is-active .sidebar__link-count { color: rgba(255,255,255,0.7); }

.sidebar__user { padding: 12px; border-top: 1px solid var(--color-hairline); display: flex; align-items: center; gap: 10px; }
.sidebar__user-avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 11px; font-weight: 700; }
.sidebar__user-info { flex: 1; min-width: 0; }
.sidebar__user-name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar__user-email { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.sidebar__user-role { font-family: var(--font-mono); font-size: 9px; font-weight: 600; color: var(--color-graphite); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* -------- Desktop topbar -------- */
.topbar { display: flex; align-items: center; gap: 24px; padding: 14px 32px; border-bottom: 1px solid var(--color-hairline); background: #fff; position: sticky; top: 0; z-index: 5; }
.topbar__brand { display: none; align-items: baseline; gap: 8px; flex-shrink: 0; }
.topbar__brand-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); align-self: center; }
.topbar__brand-wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 100%; }
.topbar__brand-tag { font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.topbar__crumbs { font-family: var(--font-body); font-size: 11px; display: flex; gap: 8px; align-items: center; letter-spacing: 0.14em; text-transform: uppercase; flex-shrink: 0; }
.topbar__crumb-muted { color: var(--color-fog); }
.topbar__crumb-divider { color: var(--color-hairline); }
.topbar__crumb-strong { color: var(--color-ink); font-weight: 600; }
.topbar__search { flex: 1; max-width: 520px; position: relative; display: flex; align-items: center; }
.topbar__search-icon { position: absolute; left: 14px; color: var(--color-fog); pointer-events: none; }
.topbar__search-input { width: 100%; padding: 9px 44px 9px 40px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; background: var(--color-surface); color: var(--color-ink); }
.topbar__search-input:focus { outline: none; border-color: var(--color-accent); background: #fff; box-shadow: 0 0 0 3px var(--color-accent-soft); }
.topbar__search-kbd { position: absolute; right: 12px; font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); padding: 2px 6px; border: 1px solid var(--color-hairline); border-radius: 4px; background: #fff; }
.topbar__actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: auto; }
.topbar__bell { position: relative; width: 34px; height: 34px; background: transparent; border: 1px solid var(--color-hairline); border-radius: 10px; color: var(--color-ink); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.topbar__bell-dot { position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 999px; background: var(--color-danger); border: 2px solid #fff; }
.topbar__new { display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; background: var(--color-ink); color: #fff; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 0.15s ease; }
.topbar__new:hover { background: var(--color-graphite); }
.topbar__new-kbd { font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; border-radius: 5px; background: rgba(255, 255, 255, 0.14); color: rgba(255, 255, 255, 0.7); letter-spacing: 0.02em; }
.topbar__avatar { width: 34px; height: 34px; border-radius: 999px; background: var(--color-ink); color: #fff; border: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-family: var(--font-body); font-size: 12px; font-weight: 700; transition: background-color 0.15s ease; }
.topbar__avatar:hover { background: var(--color-graphite); }
.topbar__avatar:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

/* -------- Mobile top nav -------- */
.mobile-top { display: none; padding: 10px 16px; background: #fff; border-bottom: 1px solid var(--color-hairline); align-items: center; justify-content: space-between; gap: 10px; position: sticky; top: 0; z-index: 5; }
.mobile-top__brand { display: inline-flex; align-items: baseline; gap: 8px; }
.mobile-top__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); align-self: center; }
.mobile-top__wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); line-height: 100%; }
.mobile-top__tag { font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.mobile-top__actions { display: flex; align-items: center; gap: 8px; }
.hamburger--mobile { width: 40px; height: 40px; border-radius: 12px; }
.mobile-top__bell { position: relative; width: 40px; height: 40px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; color: var(--color-ink); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; }
.mobile-top__bell:hover { background: var(--color-surface); }
.mobile-top__bell-dot { position: absolute; top: 6px; right: 6px; width: 8px; height: 8px; border-radius: 999px; background: var(--color-danger); border: 2px solid #fff; }
.mobile-top__avatar { width: 40px; height: 40px; border-radius: 999px; background: var(--color-graphite); color: #fff; border: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
.mobile-top__avatar:hover { background: var(--color-ink); }

/* -------- Page area -------- */
.page { flex: 1; padding: 32px 40px; background: var(--color-surface); }

/* -------- Bottom tabbar -------- */
.tabbar { display: none; position: sticky; bottom: 0; background: #fff; border-top: 1px solid var(--color-hairline); padding: 8px 4px calc(8px + env(safe-area-inset-bottom, 0)); z-index: 5; justify-content: space-around; }
.tabbar__item { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 10px; text-decoration: none; color: var(--color-fog); background: transparent; border: none; cursor: pointer; flex: 1; }
.tabbar__item.is-active { color: var(--color-ink); }
.tabbar__icon { position: relative; display: flex; align-items: center; justify-content: center; height: 22px; }
.tabbar__label { font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.tabbar__badge { position: absolute; top: -4px; right: -8px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--color-accent); color: #fff; font-family: var(--font-body); font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }

/* -------- Sheet (mobile More menu) -------- */
.sheet { position: fixed; inset: 0; background: rgba(10, 10, 11, 0.4); z-index: 20; display: flex; align-items: flex-end; }
.sheet__inner { width: 100%; background: #fff; border-radius: 20px 20px 0 0; padding: 12px 20px 32px; max-height: 70vh; overflow-y: auto; }
.sheet__grabber { width: 40px; height: 4px; background: var(--color-hairline); border-radius: 999px; margin: 0 auto 12px; }
.sheet__section-label { padding: 12px 0 6px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-mute); text-transform: uppercase; }
.sheet__link { display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; border-bottom: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 15px; color: var(--color-ink); text-decoration: none; }
.sheet__link-count { font-family: var(--font-mono); font-size: 12px; color: var(--color-fog); }

/* -------- Responsive breakpoints -------- */

/* Tablet + mobile: sidebar becomes an off-canvas drawer opened by the
   hamburger button in the top bar. */
@media (max-width: 1023px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    width: 296px;
    height: 100dvh;
    border-right: 0;
    border-top-right-radius: 24px;
    border-bottom-right-radius: 24px;
    transform: translateX(-100%);
    transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1);
    box-shadow: 12px 0 40px rgba(10, 10, 11, 0.24);
    /* `display: none` would kill the transition — keep it in flow but
       slide it out. Content inside is still keyboard-reachable when
       open; when closed the transform hides it visually and we could
       set `visibility: hidden` on close, but the transform alone stops
       tab focus from landing on it in every browser we support. */
  }
  .sidebar.is-open {
    transform: translateX(0);
  }
  .sidebar__close { display: inline-flex; }

  .topbar__crumbs { display: none; }
  .topbar__avatar { display: none; }
  .topbar__brand { display: inline-flex; }
  .hamburger--topbar { display: inline-flex; }
}

/* Mobile-only: switch to the compact top strip + bottom tabbar. */
@media (max-width: 767px) {
  .topbar { display: none; }
  .mobile-top { display: flex; }
  .tabbar { display: flex; }
  .page { padding: 20px 16px 24px; background: var(--color-surface); }
}

/* Desktop: sidebar is in-flow so backdrop / drawer state doesn't apply. */
@media (min-width: 1024px) {
  .drawer-backdrop { display: none; }
}
</style>
