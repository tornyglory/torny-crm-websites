<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usePlatformUsersStore, type PlatformUser, type UserStatus, type UserPlatformRole } from '@/stores/platformUsers'
import { SPORTS, SPORT_CODES, sportShort, type SportCode } from '@/stores/sports'
import { useToast } from '@/composables/useToast'
import CrmModal from '@/components/modals/CrmModal.vue'

const auth = useAuthStore()
const users = usePlatformUsersStore()
const toast = useToast()

const query = ref('')
const statusFilter = ref<'all' | UserStatus>('all')
const roleFilter = ref<'all' | UserPlatformRole>('all')
const sportFilter = ref<'all' | SportCode>('all')
const expandedId = ref<string | null>(null)

type ActionKind = 'suspend' | 'ban' | 'restore'
const pending = ref<{ kind: ActionKind; user: PlatformUser } | null>(null)
const reason = ref('')
const suspendDays = ref(7)

const decidedBy = computed(() => {
  if (!auth.user) return 'Platform admin'
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || auth.user.email
})

const filtered = computed<PlatformUser[]>(() => {
  const q = query.value.trim().toLowerCase()
  return users.users.filter(u => {
    if (statusFilter.value !== 'all' && u.status !== statusFilter.value) return false
    if (roleFilter.value !== 'all' && u.role !== roleFilter.value) return false
    if (sportFilter.value !== 'all' && !u.memberships.some(m => m.sport === sportFilter.value)) return false
    if (q) {
      const hay = `${u.firstName} ${u.lastName} ${u.email} ${u.memberships.map(m => `${m.clubName} ${m.sport}`).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }).sort((a, b) => {
    // Flagged/reported first, then banned, then suspended, then active
    const weight = (u: PlatformUser) => {
      if (u.reportsCount > 0 && u.status === 'active') return 0
      if (u.status === 'suspended') return 1
      if (u.status === 'banned') return 2
      if (u.status === 'pending') return 3
      return 4
    }
    return weight(a) - weight(b)
  })
})

function initials(u: PlatformUser): string {
  return `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase() || '?'
}

function timeAgo(iso: string): string {
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function openAction(kind: ActionKind, user: PlatformUser) {
  pending.value = { kind, user }
  reason.value = ''
  suspendDays.value = 7
}
function cancelAction() {
  pending.value = null
  reason.value = ''
}
function confirmAction() {
  if (!pending.value) return
  const { kind, user } = pending.value
  const name = `${user.firstName} ${user.lastName}`

  if (kind === 'suspend') {
    if (!reason.value.trim()) return
    users.suspend(user.id, decidedBy.value, reason.value.trim(), suspendDays.value)
    toast.info(`Suspended ${name} for ${suspendDays.value} day${suspendDays.value === 1 ? '' : 's'}`)
  } else if (kind === 'ban') {
    if (!reason.value.trim()) return
    users.ban(user.id, decidedBy.value, reason.value.trim())
    toast.error(`Banned ${name}`)
  } else {
    users.restore(user.id, decidedBy.value)
    toast.success(`Restored ${name}`)
  }
  cancelAction()
}

const modalConfig = computed(() => {
  if (!pending.value) return null
  const name = `${pending.value.user.firstName} ${pending.value.user.lastName}`
  const map = {
    suspend: { eyebrow: 'Suspend user', title: `Suspend ${name}?`, cta: 'Suspend account', tone: 'warn' as const },
    ban: { eyebrow: 'Permanent ban', title: `Ban ${name}?`, cta: 'Ban permanently', tone: 'danger' as const },
    restore: { eyebrow: 'Restore access', title: `Restore ${name}?`, cta: 'Restore access', tone: 'ok' as const },
  }
  return map[pending.value.kind]
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <div class="head__eyebrow">Platform · Users &amp; moderation</div>
        <h1 class="head__title">Users</h1>
        <p class="head__sub">
          Every account on Torny — club owners, admins, committee, and players.
          Suspend or ban for repeated abuse or spam. Flagged accounts sort to the top.
        </p>
      </div>
    </header>

    <section class="stats">
      <div class="stat"><div class="stat__label">Active</div><div class="stat__value">{{ users.active }}</div></div>
      <div class="stat stat--warn"><div class="stat__label">Suspended</div><div class="stat__value">{{ users.suspended }}</div></div>
      <div class="stat stat--danger"><div class="stat__label">Banned</div><div class="stat__value">{{ users.banned }}</div></div>
      <div class="stat stat--flag"><div class="stat__label">Flagged (reported)</div><div class="stat__value">{{ users.flagged.length }}</div></div>
    </section>

    <div class="filters">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input v-model="query" type="search" placeholder="Search by name, email, or club…" />
      </div>
      <div class="segmented">
        <button :class="{ 'is-on': statusFilter === 'all' }" @click="statusFilter = 'all'">All</button>
        <button :class="{ 'is-on': statusFilter === 'active' }" @click="statusFilter = 'active'">Active</button>
        <button :class="{ 'is-on': statusFilter === 'suspended' }" @click="statusFilter = 'suspended'">Suspended</button>
        <button :class="{ 'is-on': statusFilter === 'banned' }" @click="statusFilter = 'banned'">Banned</button>
        <button :class="{ 'is-on': statusFilter === 'pending' }" @click="statusFilter = 'pending'">Pending</button>
      </div>
      <select v-model="roleFilter" class="select">
        <option value="all">All roles</option>
        <option value="platform">Platform</option>
        <option value="owner">Owner</option>
        <option value="admin">Admin</option>
        <option value="committee">Committee</option>
        <option value="player">Player</option>
      </select>
      <select v-model="sportFilter" class="select">
        <option value="all">All sports</option>
        <option v-for="code in SPORT_CODES" :key="code" :value="code">{{ SPORTS[code].label }}</option>
      </select>
    </div>

    <ul v-if="filtered.length" class="rows">
      <li v-for="u in filtered" :key="u.id" class="row" :class="{ 'is-open': expandedId === u.id }">
        <div class="row__head" @click="expandedId = expandedId === u.id ? null : u.id">
          <div class="row__avatar" :class="`row__avatar--${u.status}`">
            {{ initials(u) }}
            <span v-if="u.reportsCount > 0 && u.status === 'active'" class="row__flag" :title="`${u.reportsCount} reports`">{{ u.reportsCount }}</span>
          </div>
          <div class="row__body">
            <div class="row__name">
              {{ u.firstName }} {{ u.lastName }}
              <span class="role role" :class="`role--${u.role}`">{{ u.role }}</span>
            </div>
            <div class="row__meta">
              <span>{{ u.email }}</span>
              <template v-if="u.memberships[0]">
                <span class="row__sep">·</span>
                <span class="sport-chip">{{ sportShort(u.memberships[0].sport) }}</span>
                <span>{{ u.memberships[0].clubName }}{{ u.memberships.length > 1 ? ` +${u.memberships.length - 1}` : '' }}</span>
              </template>
              <span class="row__sep">·</span>
              <span>Active {{ timeAgo(u.lastActiveAt) }}</span>
            </div>
          </div>
          <div class="row__status" :class="`row__status--${u.status}`">{{ u.status }}</div>
          <button class="row__chevron" :class="{ 'is-open': expandedId === u.id }" aria-label="Toggle details">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m7 10 5 5 5-5" /></svg>
          </button>
        </div>

        <div v-if="expandedId === u.id" class="row__detail">
          <div class="detail-grid">
            <div>
              <div class="detail__label">Account</div>
              <div class="detail__val">{{ u.email }}</div>
              <div class="detail__val detail__val--muted">Joined {{ formatDate(u.joinedAt) }}</div>
              <div class="detail__val detail__val--muted">Last active {{ timeAgo(u.lastActiveAt) }}</div>
            </div>
            <div>
              <div class="detail__label">Club memberships</div>
              <template v-if="u.memberships.length">
                <div v-for="m in u.memberships" :key="m.clubName" class="detail__val">
                  <span class="sport-chip sport-chip--detail">{{ sportShort(m.sport) }}</span>
                  {{ m.clubName }} <span class="detail__val--muted">· {{ m.role }}</span>
                </div>
              </template>
              <div v-else class="detail__val detail__val--muted">No club memberships</div>
            </div>
            <div>
              <div class="detail__label">Signals</div>
              <div class="detail__val" v-if="u.reportsCount > 0" :style="{ color: 'var(--color-danger)' }">
                {{ u.reportsCount }} unresolved report{{ u.reportsCount === 1 ? '' : 's' }}
              </div>
              <div v-else class="detail__val detail__val--muted">No reports on file</div>
              <div v-if="u.suspendedUntil" class="detail__val" :style="{ color: '#92400E' }">
                Suspended until {{ formatDate(u.suspendedUntil) }}
              </div>
            </div>
          </div>

          <div v-if="u.moderation.length" class="log">
            <div class="detail__label">Moderation log</div>
            <ul class="log__list">
              <li v-for="(m, i) in u.moderation" :key="i" class="log__item">
                <span class="log__badge" :class="`log__badge--${m.action}`">{{ m.action }}</span>
                <div class="log__body">
                  <div v-if="m.reason" class="log__reason">{{ m.reason }}</div>
                  <div class="log__meta">
                    {{ timeAgo(m.ts) }} · by {{ m.by }}
                    <template v-if="m.until"> · until {{ formatDate(m.until) }}</template>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div class="detail__actions">
            <template v-if="u.status === 'active'">
              <button class="btn-warn" @click.stop="openAction('suspend', u)">Suspend</button>
              <button class="btn-danger" @click.stop="openAction('ban', u)">Ban permanently</button>
            </template>
            <template v-else-if="u.status === 'suspended'">
              <button class="btn-ghost" @click.stop="openAction('restore', u)">Restore access</button>
              <button class="btn-danger" @click.stop="openAction('ban', u)">Escalate to ban</button>
            </template>
            <template v-else-if="u.status === 'banned'">
              <button class="btn-ghost" @click.stop="openAction('restore', u)">Unban</button>
            </template>
            <template v-else-if="u.status === 'pending'">
              <span class="detail__val detail__val--muted">Waiting on claim review — action from the Claims tab.</span>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <div v-else class="empty">
      <div class="empty__title">No users match.</div>
      <div class="empty__sub">Try clearing filters or search.</div>
    </div>

    <CrmModal
      :open="!!pending"
      :eyebrow="modalConfig?.eyebrow"
      :title="modalConfig?.title ?? ''"
      width="sm"
      @close="cancelAction"
    >
      <template v-if="pending?.kind === 'suspend'">
        <p class="modal-body">
          This blocks <strong>{{ pending.user.firstName }} {{ pending.user.lastName }}</strong> from posting or reacting.
          They can still read. Suspension lifts automatically on the end date.
        </p>
        <div class="modal-row">
          <label class="modal-field">
            <span>Duration</span>
            <select v-model.number="suspendDays" class="select">
              <option :value="1">1 day</option>
              <option :value="3">3 days</option>
              <option :value="7">7 days</option>
              <option :value="14">14 days</option>
              <option :value="30">30 days</option>
            </select>
          </label>
        </div>
        <label class="modal-field">
          <span>Reason (visible to user)</span>
          <textarea v-model="reason" rows="3" class="modal-textarea" placeholder="e.g. Repeated abusive comments on match reports." />
        </label>
      </template>
      <template v-else-if="pending?.kind === 'ban'">
        <p class="modal-body modal-body--danger">
          <strong>Permanent.</strong> Bans <strong>{{ pending.user.firstName }} {{ pending.user.lastName }}</strong>
          from every part of Torny and revokes their sessions. They can appeal via support.
        </p>
        <label class="modal-field">
          <span>Reason (internal + user notice)</span>
          <textarea v-model="reason" rows="3" class="modal-textarea" placeholder="e.g. Coordinated spam across multiple clubs." />
        </label>
      </template>
      <template v-else-if="pending?.kind === 'restore'">
        <p class="modal-body">
          Reactivates <strong>{{ pending.user.firstName }} {{ pending.user.lastName }}</strong> immediately and clears
          <template v-if="pending.user.reportsCount > 0">their {{ pending.user.reportsCount }} pending report{{ pending.user.reportsCount === 1 ? '' : 's' }}</template>
          <template v-else>the suspension</template>.
        </p>
      </template>
      <template #footer>
        <button class="btn-ghost" @click="cancelAction">Cancel</button>
        <button
          class="btn-confirm"
          :class="{ 'btn-confirm--danger': modalConfig?.tone === 'danger', 'btn-confirm--warn': modalConfig?.tone === 'warn', 'btn-confirm--ok': modalConfig?.tone === 'ok' }"
          :disabled="pending?.kind !== 'restore' && !reason.trim()"
          @click="confirmAction"
        >{{ modalConfig?.cta }}</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.page { padding: 32px 40px 60px; }

.head { margin-bottom: 24px; }
.head__eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.head__title { font-family: var(--font-display); font-size: 40px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1.05; margin: 8px 0 12px; }
.head__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; max-width: 640px; line-height: 1.5; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.stat { padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; }
.stat--warn { background: #FFFBEB; border-color: #FDE68A; }
.stat--danger { background: #FEF2F2; border-color: #FECACA; }
.stat--flag { background: #EFF6FF; border-color: #BFDBFE; }
.stat__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; }
.stat__value { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.02em; margin-top: 6px; }

.filters { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; }
.search { flex: 1; min-width: 240px; position: relative; display: flex; align-items: center; }
.search svg { position: absolute; left: 14px; color: var(--color-fog); pointer-events: none; }
.search input { width: 100%; padding: 11px 14px 11px 40px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.search input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.segmented { display: inline-flex; padding: 4px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.segmented button { padding: 7px 12px; background: transparent; border: 0; border-radius: 6px; font-family: var(--font-body); font-size: 12px; font-weight: 500; color: var(--color-fog); cursor: pointer; }
.segmented button.is-on { background: var(--color-ink); color: #fff; font-weight: 600; }
.select { padding: 10px 12px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.sport-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 4px; font-family: var(--font-body); font-size: 10px; font-weight: 600; color: var(--color-graphite); letter-spacing: 0.02em; }
.sport-chip--detail { padding: 2px 8px; font-size: 11px; margin-right: 4px; }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; overflow: hidden; }
.row.is-open { border-color: var(--color-ink); box-shadow: 0 12px 30px -12px rgba(15,23,42,0.15); }
.row__head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; cursor: pointer; }
.row__head:hover { background: var(--color-surface); }
.row.is-open .row__head { background: var(--color-surface); }

.row__avatar { width: 40px; height: 40px; border-radius: 999px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 12px; font-weight: 700; flex-shrink: 0; position: relative; }
.row__avatar--suspended { background: #F59E0B; }
.row__avatar--banned { background: var(--color-danger); }
.row__avatar--pending { background: var(--color-fog); }
.row__flag { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--color-danger); color: #fff; font-family: var(--font-mono); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; border: 2px solid #fff; }

.row__body { flex: 1; min-width: 0; }
.row__name { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.role { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: var(--color-surface); color: var(--color-graphite); }
.role--platform { background: var(--color-ink); color: #fff; }
.role--owner { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.role--admin { background: #EDE9FE; color: #5B21B6; }
.role--committee { background: #DCFCE7; color: #166534; }
.role--player { background: var(--color-surface); color: var(--color-fog); }
.row__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; }
.row__sep { opacity: 0.5; }

.row__status { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; padding: 4px 10px; border-radius: 6px; flex-shrink: 0; }
.row__status--active { background: #DCFCE7; color: #166534; }
.row__status--suspended { background: #FEF3C7; color: #92400E; }
.row__status--banned { background: #FEE2E2; color: #991B1B; }
.row__status--pending { background: var(--color-surface); color: var(--color-fog); }

.row__chevron { background: transparent; border: 0; padding: 6px; color: var(--color-fog); cursor: pointer; transition: transform 0.15s ease; }
.row__chevron.is-open { transform: rotate(180deg); color: var(--color-ink); }

.row__detail { padding: 8px 20px 24px; border-top: 1px solid var(--color-hairline); }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 20px 0; }
.detail__label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); font-weight: 700; margin-bottom: 8px; }
.detail__val { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); font-weight: 500; margin-bottom: 4px; }
.detail__val--muted { color: var(--color-fog); font-size: 12px; font-weight: 400; }

.log { margin-top: 16px; padding: 16px; background: var(--color-surface); border-radius: 12px; }
.log__list { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 12px; }
.log__item { display: flex; gap: 12px; align-items: flex-start; }
.log__badge { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; padding: 3px 8px; border-radius: 4px; flex-shrink: 0; margin-top: 2px; }
.log__badge--suspend { background: #FEF3C7; color: #92400E; }
.log__badge--ban { background: #FEE2E2; color: #991B1B; }
.log__badge--restore, .log__badge--unban { background: #DCFCE7; color: #166534; }
.log__badge--warn { background: #EFF6FF; color: #1E40AF; }
.log__body { flex: 1; }
.log__reason { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); }
.log__meta { font-family: var(--font-mono); font-size: 10px; color: var(--color-fog); margin-top: 4px; letter-spacing: 0.06em; text-transform: uppercase; }

.detail__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn-warn { padding: 10px 18px; background: transparent; color: #92400E; border: 1px solid #FDE68A; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-warn:hover { background: #FFFBEB; }
.btn-danger { padding: 10px 18px; background: var(--color-danger); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-danger:hover { background: #B91C1C; }
.btn-ghost { padding: 10px 18px; background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; }
.btn-ghost:hover { border-color: var(--color-ink); }

.empty { padding: 60px 20px; text-align: center; background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--color-ink); }
.empty__sub { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin-top: 4px; }

/* Modal internals */
.modal-body { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); line-height: 1.55; margin: 0 0 16px; }
.modal-body strong { color: var(--color-ink); font-weight: 700; }
.modal-body--danger { padding: 12px; background: #FEF2F2; border-left: 3px solid var(--color-danger); border-radius: 4px 10px 10px 4px; }
.modal-row { margin-bottom: 12px; }
.modal-field { display: flex; flex-direction: column; gap: 8px; }
.modal-field span { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.modal-textarea { padding: 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 14px; resize: vertical; color: var(--color-ink); line-height: 1.5; }
.modal-textarea:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.btn-confirm { padding: 10px 18px; background: var(--color-ink); color: #fff; border: 0; border-radius: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-confirm--warn { background: #F59E0B; }
.btn-confirm--warn:hover:not(:disabled) { background: #D97706; }
.btn-confirm--danger { background: var(--color-danger); }
.btn-confirm--danger:hover:not(:disabled) { background: #B91C1C; }
.btn-confirm--ok { background: #16A34A; }
.btn-confirm--ok:hover:not(:disabled) { background: #15803D; }

@media (max-width: 900px) {
  .page { padding: 20px; }
  .head__title { font-size: 32px; }
  .stats { grid-template-columns: 1fr 1fr; }
  .detail-grid { grid-template-columns: 1fr; }
}
</style>
