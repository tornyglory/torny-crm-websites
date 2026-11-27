<script setup lang="ts">
/**
 * Platform users — brief 123 §6.6 (list) + §6.7 (platform_owner toggle)
 * + brief 126 (ban / unban).
 *
 * Wires the real `admin.listUsers` endpoint. Every human on Torny,
 * across every club. Each row surfaces their role per-club via the
 * `club_memberships` array, their platform_owner flag, their ban
 * state, and (on expand) the actions bar.
 *
 * Note: brief 126's ban endpoints aren't shipped yet (backend-proposed
 * only). The Ban button fires `admin.banUser` which 404s until the
 * endpoint lands — error surfaces inline in the modal. Users with
 * `banned_at` set show the Unban variant.
 */
import { ref, computed, watch } from 'vue'
import {
  admin,
  ApiError,
  type AdminUser,
  type AdminUsersList,
  type AdminListUsersParams,
} from '@torny/api-client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminBanUserModal from '@/components/admin/AdminBanUserModal.vue'

const auth = useAuthStore()
const toast = useToast()

const query = ref('')
const filter = ref<'all' | 'banned' | 'active' | 'platform_owners' | 'multi_club'>('all')
const expandedId = ref<number | null>(null)

const data = ref<AdminUsersList | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let inFlight: AbortController | null = null

const banModal = ref<{ userId: number; userLabel: string; mode: 'ban' | 'unban' } | null>(null)

async function load() {
  inFlight?.abort()
  const ctrl = new AbortController()
  inFlight = ctrl
  loading.value = true
  error.value = null
  try {
    const params: AdminListUsersParams = {
      q: query.value.trim() || undefined,
      signal: ctrl.signal,
    }
    const f: NonNullable<AdminListUsersParams['filter']> = {}
    if (filter.value === 'platform_owners') f.is_platform_owner = true
    else if (filter.value === 'multi_club') f.multi_club = true
    else if (filter.value === 'banned') f.banned = true
    else if (filter.value === 'active') f.banned = false
    if (Object.keys(f).length > 0) params.filter = f
    const res = await admin.listUsers(params)
    if (ctrl.signal.aborted) return
    data.value = res
  } catch (err) {
    if (ctrl.signal.aborted) return
    error.value = err instanceof ApiError ? err.message : 'Could not load users.'
  } finally {
    if (!ctrl.signal.aborted) loading.value = false
  }
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => void load(), 300)
})
watch(filter, () => void load(), { immediate: true })

// ── Derived stats (from loaded rows — not platform-wide totals) ──
const tiles = computed(() => {
  const items = data.value?.items ?? []
  return {
    total: data.value?.total_count ?? items.length,
    platformOwners: items.filter((u) => u.is_platform_owner).length,
    banned: items.filter((u) => u.banned_at).length,
    multiClub: items.filter((u) => u.club_memberships.length > 1).length,
  }
})

function initials(u: AdminUser): string {
  const source = u.name ?? u.email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return (parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?').slice(0, 2)
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function toggleExpand(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

async function togglePlatformOwner(u: AdminUser) {
  if (u.id === auth.user?.id && u.is_platform_owner) {
    toast.error("You can't revoke your own platform-owner flag.")
    return
  }
  const next = !u.is_platform_owner
  try {
    await admin.updateUser(u.id, { is_platform_owner: next })
    toast.success(next ? `${u.email} granted platform-owner access.` : `${u.email} removed from platform owners.`)
    void load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not update user.')
  }
}

function openBan(u: AdminUser) {
  banModal.value = {
    userId: u.id,
    userLabel: u.name ?? u.email,
    mode: u.banned_at ? 'unban' : 'ban',
  }
}
</script>

<template>
  <div class="users">
    <header class="users__head">
      <div>
        <div class="users__eyebrow">PLATFORM · USERS &amp; MODERATION</div>
        <h1 class="users__title">Users</h1>
        <p class="users__sub">Every account on Torny — club owners, admins, committee, and players. Platform-owner grant + ban actions are audit-logged.</p>
      </div>
    </header>

    <!-- Summary tiles -->
    <section class="users__tiles">
      <div class="users__tile users__tile--active">
        <div class="users__tile-label">Total (window)</div>
        <div class="users__tile-value">{{ tiles.total }}</div>
      </div>
      <div class="users__tile users__tile--owner">
        <div class="users__tile-label">Platform owners</div>
        <div class="users__tile-value">{{ tiles.platformOwners }}</div>
      </div>
      <div class="users__tile users__tile--banned">
        <div class="users__tile-label">Banned</div>
        <div class="users__tile-value">{{ tiles.banned }}</div>
      </div>
      <div class="users__tile users__tile--multi">
        <div class="users__tile-label">Multi-club</div>
        <div class="users__tile-value">{{ tiles.multiClub }}</div>
      </div>
    </section>

    <!-- Controls -->
    <section class="users__controls">
      <input
        v-model="query"
        type="search"
        class="users__search"
        placeholder="Search by name, email, or club…"
      />
      <div class="users__filters">
        <button
          v-for="f in [
            { value: 'all',             label: 'All' },
            { value: 'active',          label: 'Active' },
            { value: 'banned',          label: 'Banned' },
            { value: 'platform_owners', label: 'Platform owners' },
            { value: 'multi_club',      label: 'Multi-club' },
          ]"
          :key="f.value"
          type="button"
          class="users__filter"
          :class="{ 'users__filter--active': filter === f.value }"
          @click="filter = f.value as typeof filter"
        >{{ f.label }}</button>
      </div>
    </section>

    <AdminEmptyState
      v-if="error"
      tone="error"
      title="Could not load users"
      :detail="error"
      @retry="load"
    />

    <AdminEmptyState
      v-else-if="data && data.items.length === 0"
      tone="no-results"
      title="No users matched"
      detail="Clear the search or widen the filter."
    />

    <ul v-else class="users__list">
      <li
        v-for="u in data?.items"
        :key="u.id"
        class="user-row"
        :class="{ 'user-row--expanded': expandedId === u.id, 'user-row--banned': !!u.banned_at }"
      >
        <button type="button" class="user-row__head" @click="toggleExpand(u.id)">
          <div class="user-row__avatar">{{ initials(u) }}</div>
          <div class="user-row__who">
            <div class="user-row__name-row">
              <span class="user-row__name">{{ u.name ?? u.email.split('@')[0] }}</span>
              <span v-if="u.is_platform_owner" class="chip chip--owner">PLATFORM OWNER</span>
              <span v-if="u.banned_at" class="chip chip--banned">BANNED</span>
              <span v-else-if="u.club_memberships.length === 0" class="chip chip--muted">NO CLUBS</span>
            </div>
            <div class="user-row__meta">
              <span class="user-row__email">{{ u.email }}</span>
              <template v-if="u.club_memberships.length > 0">
                <span class="user-row__dot">·</span>
                <span class="user-row__club">{{ u.club_memberships[0]?.club_name }}<span v-if="u.club_memberships.length > 1"> +{{ u.club_memberships.length - 1 }}</span></span>
              </template>
              <span class="user-row__dot">·</span>
              <span class="user-row__last-login">Active {{ timeAgo(u.last_login_at) }}</span>
            </div>
          </div>
          <div class="user-row__chevron" :class="{ 'user-row__chevron--open': expandedId === u.id }">⌄</div>
        </button>

        <div v-if="expandedId === u.id" class="user-row__detail">
          <div class="user-row__cols">
            <div>
              <div class="user-row__col-label">Account</div>
              <div class="user-row__col-body">
                <div>{{ u.email }}</div>
                <div class="user-row__muted">Joined {{ formatDate(u.signup_at) }}</div>
                <div class="user-row__muted">Last active {{ timeAgo(u.last_login_at) }}</div>
              </div>
            </div>
            <div>
              <div class="user-row__col-label">Club memberships</div>
              <div class="user-row__col-body">
                <template v-if="u.club_memberships.length > 0">
                  <div v-for="m in u.club_memberships" :key="m.club_id" class="user-row__club-row">
                    <span class="chip chip--role">{{ m.role }}</span>
                    {{ m.club_name }}
                  </div>
                </template>
                <div v-else class="user-row__muted">No clubs</div>
              </div>
            </div>
            <div>
              <div class="user-row__col-label">Moderation</div>
              <div class="user-row__col-body">
                <div v-if="u.banned_at" class="user-row__ban-detail">
                  <div class="user-row__danger">Banned {{ timeAgo(u.banned_at) }}</div>
                  <div v-if="u.banned_reason" class="user-row__muted">Reason: {{ u.banned_reason }}</div>
                </div>
                <div v-else class="user-row__muted">No active moderation actions.</div>
              </div>
            </div>
          </div>

          <div class="user-row__actions">
            <button
              type="button"
              class="action-btn"
              :disabled="u.id === auth.user?.id && u.is_platform_owner"
              :title="u.id === auth.user?.id && u.is_platform_owner ? 'You can\'t revoke your own platform-owner flag' : undefined"
              @click="togglePlatformOwner(u)"
            >
              {{ u.is_platform_owner ? 'Revoke platform owner' : 'Make platform owner' }}
            </button>
            <button
              type="button"
              class="action-btn"
              :class="u.banned_at ? 'action-btn--primary' : 'action-btn--danger'"
              :disabled="u.id === auth.user?.id"
              :title="u.id === auth.user?.id ? 'You can\'t ban yourself' : undefined"
              @click="openBan(u)"
            >
              {{ u.banned_at ? 'Unban user' : 'Ban user' }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- Ban / unban modal -->
    <AdminBanUserModal
      v-if="banModal"
      :open="!!banModal"
      :user-id="banModal.userId"
      :user-label="banModal.userLabel"
      :mode="banModal.mode"
      @close="banModal = null"
      @done="load"
    />
  </div>
</template>

<style scoped>
.users { padding: 32px 40px 48px; display: flex; flex-direction: column; gap: 24px; max-width: 1280px; }

.users__eyebrow { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--color-fog); }
.users__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 8px 0 6px; }
.users__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 60ch; }

.users__tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.users__tile { padding: 20px; background: var(--color-ground); border: 1px solid var(--color-hairline); border-radius: 14px; }
.users__tile-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); }
.users__tile-value { font-family: var(--font-display); font-size: 36px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin-top: 6px; line-height: 1; }
.users__tile--active { background: color-mix(in oklab, var(--color-feature-mint) 6%, var(--color-ground)); }
.users__tile--owner { background: color-mix(in oklab, var(--color-accent) 6%, var(--color-ground)); }
.users__tile--banned { background: color-mix(in oklab, var(--color-danger) 6%, var(--color-ground)); }
.users__tile--multi { background: color-mix(in oklab, var(--color-feature-violet) 6%, var(--color-ground)); }
@media (max-width: 900px) { .users__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.users__controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.users__search {
  flex: 1;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 16px;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  background: var(--color-ground);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  outline: none;
}
.users__search:focus { border-color: var(--color-ink); }
.users__search::placeholder { color: var(--color-fog); }
.users__filters { display: flex; gap: 6px; flex-wrap: wrap; }
.users__filter {
  padding: 8px 16px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  background: var(--color-ground);
  color: var(--color-graphite);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  cursor: pointer;
}
.users__filter:hover { border-color: var(--color-ink); color: var(--color-ink); }
.users__filter--active { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }

.users__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }

.user-row { background: var(--color-ground); border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.user-row--expanded { border-color: var(--color-ink); }
.user-row--banned { background: color-mix(in oklab, var(--color-danger) 3%, var(--color-ground)); }

.user-row__head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  width: 100%;
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.user-row__head:hover { background: var(--color-surface); }

.user-row__avatar {
  width: 40px; height: 40px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--color-accent) 15%, #fff);
  color: var(--color-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.user-row--banned .user-row__avatar { background: color-mix(in oklab, var(--color-danger) 15%, #fff); color: var(--color-danger); }

.user-row__who { flex: 1; min-width: 0; }
.user-row__name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.user-row__name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.user-row__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; display: flex; gap: 6px; flex-wrap: wrap; }
.user-row__email { font-family: var(--font-mono); font-size: 11px; color: var(--color-graphite); }
.user-row__dot { color: var(--color-hairline); }

.user-row__chevron {
  font-size: 18px;
  color: var(--color-fog);
  width: 24px;
  text-align: center;
  transition: transform 200ms ease;
}
.user-row__chevron--open { transform: rotate(180deg); }

.user-row__detail { padding: 0 18px 18px; display: flex; flex-direction: column; gap: 16px; border-top: 1px solid var(--color-hairline); margin-top: 0; padding-top: 16px; }
.user-row__cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
@media (max-width: 900px) { .user-row__cols { grid-template-columns: 1fr; gap: 16px; } }

.user-row__col-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fog); margin-bottom: 8px; }
.user-row__col-body { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); display: flex; flex-direction: column; gap: 4px; }
.user-row__muted { color: var(--color-fog); font-size: 12px; }
.user-row__danger { color: var(--color-danger); font-weight: 600; }
.user-row__ban-detail { display: flex; flex-direction: column; gap: 4px; }
.user-row__club-row { display: flex; align-items: center; gap: 8px; }

.user-row__actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }

.action-btn {
  padding: 8px 16px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  background: var(--color-ground);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  cursor: pointer;
}
.action-btn:hover:not(:disabled) { background: var(--color-surface); border-color: var(--color-ink); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.action-btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.action-btn--primary:hover:not(:disabled) { background: #000; }
.action-btn--danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
.action-btn--danger:hover:not(:disabled) { background: color-mix(in oklab, var(--color-danger) 85%, #000); }

.chip { display: inline-flex; align-items: center; padding: 2px 8px; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 999px; }
.chip--owner { background: color-mix(in oklab, var(--color-accent) 15%, #fff); color: var(--color-accent); }
.chip--banned { background: color-mix(in oklab, var(--color-danger) 15%, #fff); color: var(--color-danger); }
.chip--role { background: var(--color-surface); color: var(--color-graphite); font-size: 9px; padding: 1px 7px; }
.chip--muted { background: var(--color-surface); color: var(--color-fog); }
</style>
