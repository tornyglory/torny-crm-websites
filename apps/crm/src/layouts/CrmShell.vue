<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
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

interface NavItem { to: string; label: string; count?: number | string }
const manageNav: NavItem[] = [
  { to: '/crm/dashboard', label: 'Dashboard' },
  { to: '/crm/members', label: 'Members', count: 142 },
  { to: '/crm/applications', label: 'Applications', count: 3 },
  { to: '/crm/enquiries', label: 'Enquiries', count: 2 },
]
const contentNav: NavItem[] = [
  { to: '/crm/website', label: 'Website' },
  { to: '/crm/events', label: 'Events', count: 12 },
  { to: '/crm/teams', label: 'Team selections', count: 4 },
  { to: '/crm/honour-board', label: 'Honour board', count: 11 },
  { to: '/crm/achievements', label: 'Achievements' },
]
const accountNav: NavItem[] = [
  { to: '/crm/communications', label: 'Communications' },
  { to: '/crm/site-settings', label: 'Site settings' },
  { to: '/crm/settings', label: 'Settings' },
]

interface TabItem { to: string; label: string; count?: number; icon: 'home' | 'members' | 'apps' | 'enquiries' | 'more' }
const bottomTabs: TabItem[] = [
  { to: '/crm/dashboard', label: 'Home', icon: 'home' },
  { to: '/crm/members', label: 'Members', icon: 'members' },
  { to: '/crm/applications', label: 'Apps', count: 3, icon: 'apps' },
  { to: '/crm/enquiries', label: 'Enquiries', count: 2, icon: 'enquiries' },
]
</script>

<template>
  <div class="shell">
    <!-- Desktop sidebar -->
    <aside class="sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__dot" />
        <span class="sidebar__wordmark">Torny</span>
        <span class="sidebar__tag">CRM</span>
      </div>
      <div class="sidebar__club">
        <div class="sidebar__club-badge">{{ clubInitials }}</div>
        <div class="sidebar__club-info">
          <div class="sidebar__club-label">Club</div>
          <div class="sidebar__club-name">{{ club.current?.name ?? 'Select a club' }}</div>
        </div>
      </div>
      <nav class="sidebar__nav">
        <div class="sidebar__section-label">Manage</div>
        <RouterLink v-for="item in manageNav" :key="item.to" :to="item.to" class="sidebar__link" active-class="is-active">
          <span class="sidebar__link-label">{{ item.label }}</span>
          <span v-if="item.count !== undefined" class="sidebar__link-count">{{ item.count }}</span>
        </RouterLink>
        <div class="sidebar__section-label">Content</div>
        <RouterLink v-for="item in contentNav" :key="item.to" :to="item.to" class="sidebar__link" active-class="is-active">
          <span class="sidebar__link-label">{{ item.label }}</span>
          <span v-if="item.count !== undefined" class="sidebar__link-count">{{ item.count }}</span>
        </RouterLink>
        <div class="sidebar__section-label">Account</div>
        <RouterLink v-for="item in accountNav" :key="item.to" :to="item.to" class="sidebar__link" active-class="is-active">
          <span class="sidebar__link-label">{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar__user">
        <div class="sidebar__user-avatar">{{ initials }}</div>
        <div class="sidebar__user-info">
          <div class="sidebar__user-name">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</div>
          <div class="sidebar__user-role">{{ auth.role ?? '' }}</div>
        </div>
      </div>
    </aside>

    <div class="main">
      <!-- Mobile top nav -->
      <header class="mobile-top">
        <button class="mobile-top__club">
          <div class="mobile-top__club-badge">{{ clubInitials }}</div>
          <span class="mobile-top__club-name">{{ club.current?.name ?? 'Select a club' }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="m7 10 5 5 5-5" />
          </svg>
        </button>
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
          class="mobile-top__avatar"
          data-usermenu-anchor
          aria-label="Account menu"
          @click="toggleUserMenu"
        >{{ initials }}</button>
      </header>

      <!-- Desktop topbar -->
      <header class="topbar">
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
.sidebar { width: 240px; background: #fff; border-right: 1px solid var(--color-hairline); display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
.sidebar__brand { padding: 20px 20px 24px; display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--color-hairline); }
.sidebar__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); }
.sidebar__wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); }
.sidebar__tag { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; margin-left: 4px; }

.sidebar__club { margin: 12px; padding: 8px 10px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--color-hairline); border-radius: 10px; background: var(--color-surface); }
.sidebar__club-badge { width: 28px; height: 28px; border-radius: 6px; background: var(--color-accent); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 11px; font-weight: 700; }
.sidebar__club-info { flex: 1; min-width: 0; }
.sidebar__club-label { font-family: var(--font-body); font-size: 9px; font-weight: 600; letter-spacing: 0.14em; color: var(--color-fog); text-transform: uppercase; }
.sidebar__club-name { font-family: var(--font-display); font-size: 13px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.sidebar__user-role { font-family: var(--font-body); font-size: 10px; font-weight: 500; color: var(--color-fog); letter-spacing: 0.06em; text-transform: uppercase; }

.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* -------- Desktop topbar -------- */
.topbar { display: flex; align-items: center; gap: 24px; padding: 14px 32px; border-bottom: 1px solid var(--color-hairline); background: #fff; position: sticky; top: 0; z-index: 5; }
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
.mobile-top { display: none; padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--color-hairline); align-items: center; gap: 12px; position: sticky; top: 0; z-index: 5; }
.mobile-top__club { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 8px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 12px; cursor: pointer; }
.mobile-top__club-badge { width: 26px; height: 26px; border-radius: 6px; background: var(--color-accent); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 10px; font-weight: 700; }
.mobile-top__club-name { flex: 1; font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-top__bell { position: relative; width: 36px; height: 36px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; color: var(--color-ink); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.mobile-top__bell-dot { position: absolute; top: 8px; right: 8px; width: 7px; height: 7px; border-radius: 999px; background: var(--color-danger); border: 2px solid #fff; }
.mobile-top__avatar { width: 36px; height: 36px; border-radius: 999px; background: var(--color-graphite); color: #fff; border: 0; padding: 0; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; cursor: pointer; }
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
@media (max-width: 767px) {
  .sidebar { display: none; }
  .topbar { display: none; }
  .mobile-top { display: flex; }
  .tabbar { display: flex; }
  .page { padding: 20px 16px 24px; background: var(--color-surface); }
}
</style>
