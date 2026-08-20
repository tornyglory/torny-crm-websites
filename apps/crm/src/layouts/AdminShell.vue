<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'
import { useClaimsStore } from '@/stores/claims'
import { usePlatformUsersStore } from '@/stores/platformUsers'
import CrmToast from '@/components/CrmToast.vue'

const auth = useAuthStore()
const club = useClubStore()
const claims = useClaimsStore()
const platformUsers = usePlatformUsersStore()
const router = useRouter()

interface NavItem { to: string; label: string; count?: number | string; tone?: 'danger' }
const nav = computed<NavItem[]>(() => [
  { to: '/admin', label: 'Overview' },
  { to: '/admin/claims', label: 'Claims', count: claims.pendingCount || undefined },
  { to: '/admin/users', label: 'Users', count: platformUsers.flagged.length || undefined, tone: platformUsers.flagged.length ? 'danger' : undefined },
  { to: '/admin/clubs', label: 'Clubs' },
  { to: '/admin/members', label: 'Members' },
])

const initials = computed(() => {
  if (!auth.user) return '—'
  return `${auth.user.firstName?.[0] ?? ''}${auth.user.lastName?.[0] ?? ''}`.toUpperCase()
})

function signOut() {
  auth.clearSession()
  club.clear()
  router.push({ name: 'sign-in' })
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__dot" />
        <span class="sidebar__wordmark">Torny</span>
        <span class="sidebar__tag">Admin</span>
      </div>
      <div class="sidebar__badge">
        <div class="sidebar__badge-eyebrow">Platform</div>
        <div class="sidebar__badge-name">Owner console</div>
      </div>
      <nav class="sidebar__nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="sidebar__link"
          :class="{ 'is-active': item.to === '/admin' ? $route.path === '/admin' : $route.path.startsWith(item.to) }"
        >
          <span class="sidebar__link-label">{{ item.label }}</span>
          <span
            v-if="item.count !== undefined"
            class="sidebar__link-count"
            :class="{ 'sidebar__link-count--danger': item.tone === 'danger' }"
          >{{ item.count }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar__user">
        <div class="sidebar__user-avatar">{{ initials }}</div>
        <div class="sidebar__user-info">
          <div class="sidebar__user-name">{{ auth.user?.firstName }} {{ auth.user?.lastName }}</div>
          <div class="sidebar__user-role">Platform · {{ auth.user?.email }}</div>
        </div>
        <button class="sidebar__signout" title="Sign out" @click="signOut">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
    <CrmToast />
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; background: var(--color-ink); }

.sidebar {
  width: 260px;
  background: #0F1013;
  color: #fff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255,255,255,0.06);
  position: sticky; top: 0; height: 100vh;
}
.sidebar__brand { padding: 24px 24px 20px; display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.sidebar__dot { width: 10px; height: 10px; border-radius: 999px; background: var(--color-accent); align-self: center; }
.sidebar__wordmark { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
.sidebar__tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.5); font-weight: 700; margin-left: 4px; }

.sidebar__badge { margin: 16px; padding: 14px 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; }
.sidebar__badge-eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent); font-weight: 700; }
.sidebar__badge-name { font-family: var(--font-display); font-size: 14px; font-weight: 600; color: #fff; margin-top: 2px; }

.sidebar__nav { flex: 1; padding: 8px; overflow-y: auto; }
.sidebar__link { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 8px; margin-bottom: 2px; font-family: var(--font-body); font-size: 13px; color: rgba(255,255,255,0.7); text-decoration: none; }
.sidebar__link:hover { background: rgba(255,255,255,0.04); color: #fff; }
.sidebar__link.is-active { background: #fff; color: var(--color-ink); font-weight: 600; }
.sidebar__link-count { font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; background: var(--color-accent); color: #fff; border-radius: 6px; font-weight: 700; }
.sidebar__link-count--danger { background: var(--color-danger); }
.sidebar__link.is-active .sidebar__link-count { background: var(--color-ink); color: #fff; }
.sidebar__link.is-active .sidebar__link-count--danger { background: var(--color-danger); color: #fff; }

.sidebar__user { padding: 16px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 12px; }
.sidebar__user-avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--color-accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 11px; font-weight: 700; flex-shrink: 0; }
.sidebar__user-info { flex: 1; min-width: 0; }
.sidebar__user-name { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar__user-role { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.4); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar__signout { background: transparent; border: 0; color: rgba(255,255,255,0.5); cursor: pointer; padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sidebar__signout:hover { background: rgba(255,255,255,0.06); color: #fff; }

.main { flex: 1; background: var(--color-surface); min-width: 0; }

@media (max-width: 767px) {
  .shell { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: static; }
  .sidebar__nav { display: flex; overflow-x: auto; padding: 8px; }
  .sidebar__link { flex-shrink: 0; }
  .sidebar__badge { display: none; }
}
</style>
