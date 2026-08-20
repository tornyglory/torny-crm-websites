<script setup lang="ts">
import { ref, computed } from 'vue'
import { useToast } from '@/composables/useToast'

const toast = useToast()

type Status = 'pending' | 'approved' | 'declined'

interface Application {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  membershipType: string
  submittedAt: string
  status: Status
  notes?: string
}

const applications = ref<Application[]>([
  { id: 'a1', firstName: 'Aroha', lastName: 'Ngata', email: 'aroha@example.com', phone: '021 555 0101', membershipType: 'Playing member', submittedAt: '2 hours ago', status: 'pending', notes: 'Referred by Marcus Tuilagi.' },
  { id: 'a2', firstName: 'Sam', lastName: 'Harding', email: 'sam.h@example.com', phone: '022 555 0202', membershipType: 'Playing member', submittedAt: 'Yesterday', status: 'pending' },
  { id: 'a3', firstName: 'Priya', lastName: 'Kaur', email: 'priya.kaur@example.com', phone: '027 555 0303', membershipType: 'Social', submittedAt: '2 days ago', status: 'pending', notes: 'Interested in coaching.' },
  { id: 'a4', firstName: 'Jack', lastName: 'O\'Connor', email: 'jack@example.com', phone: '021 555 0404', membershipType: 'Playing member', submittedAt: 'Last week', status: 'approved' },
  { id: 'a5', firstName: 'Meredith', lastName: 'Cole', email: 'meredith@example.com', phone: '022 555 0505', membershipType: 'Social', submittedAt: '2 weeks ago', status: 'declined' },
])

const activeTab = ref<Status>('pending')

const counts = computed(() => ({
  pending: applications.value.filter(a => a.status === 'pending').length,
  approved: applications.value.filter(a => a.status === 'approved').length,
  declined: applications.value.filter(a => a.status === 'declined').length,
}))

const filtered = computed(() => applications.value.filter(a => a.status === activeTab.value))

function initials(a: Application) {
  return `${a.firstName[0]}${a.lastName[0]}`.toUpperCase()
}

function updateStatus(a: Application, next: Status) {
  a.status = next
  const verb = next === 'approved' ? 'Approved' : next === 'declined' ? 'Declined' : 'Reopened'
  toast.success(`${verb} ${a.firstName} ${a.lastName}`)
}

function exportCsv() {
  toast.info(`Exporting ${applications.value.length} applications — check your email in a minute.`)
}
</script>

<template>
  <div class="apps">
    <header class="apps__header">
      <div>
        <div class="apps__eyebrow">New arrivals</div>
        <h1 class="apps__heading">Applications</h1>
        <p class="apps__sub">Review and approve people applying to join {{ counts.pending }} pending.</p>
      </div>
      <button class="apps__btn" @click="exportCsv">Export CSV</button>
    </header>

    <div class="tabs">
      <button
        v-for="tab in (['pending', 'approved', 'declined'] as Status[])"
        :key="tab"
        class="tab"
        :class="{ 'is-active': activeTab === tab }"
        @click="activeTab = tab"
      >
        <span class="tab__label">{{ tab }}</span>
        <span class="tab__count">{{ counts[tab] }}</span>
      </button>
    </div>

    <ul v-if="filtered.length" class="list">
      <li v-for="a in filtered" :key="a.id" class="row">
        <div class="row__avatar">{{ initials(a) }}</div>
        <div class="row__body">
          <div class="row__name">{{ a.firstName }} {{ a.lastName }}</div>
          <div class="row__meta">
            <span>{{ a.membershipType }}</span>
            <span class="row__sep">·</span>
            <span>{{ a.email }}</span>
            <span class="row__sep">·</span>
            <span>{{ a.phone }}</span>
          </div>
          <div v-if="a.notes" class="row__notes">{{ a.notes }}</div>
        </div>
        <div class="row__time">{{ a.submittedAt }}</div>
        <div class="row__actions">
          <template v-if="a.status === 'pending'">
            <button class="btn btn--decline" @click="updateStatus(a, 'declined')">Decline</button>
            <button class="btn btn--approve" @click="updateStatus(a, 'approved')">Approve</button>
          </template>
          <template v-else>
            <button class="btn btn--ghost" @click="updateStatus(a, 'pending')">Reopen</button>
          </template>
        </div>
      </li>
    </ul>
    <div v-else class="empty">Nothing here yet.</div>
  </div>
</template>

<style scoped>
.apps { max-width: 1080px; }
.apps__header { display: flex; align-items: end; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.apps__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.apps__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.apps__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.apps__btn { padding: 9px 14px; background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 500; cursor: pointer; }

.tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); text-transform: capitalize; }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.tab.is-active .tab__count { background: var(--color-accent-soft); color: var(--color-accent); }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.row__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 14px; font-weight: 700; flex-shrink: 0; }
.row__body { flex: 1; min-width: 0; }
.row__name { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); }
.row__meta { display: flex; gap: 8px; font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.row__sep { opacity: 0.5; }
.row__notes { font-family: var(--font-body); font-size: 13px; color: var(--color-graphite); margin-top: 6px; font-style: italic; }
.row__time { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); white-space: nowrap; }
.row__actions { display: flex; gap: 8px; flex-shrink: 0; }

.btn { padding: 8px 14px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 12px; font-weight: 600; cursor: pointer; }
.btn--approve { background: var(--color-ink); color: #fff; }
.btn--decline { background: transparent; color: var(--color-graphite); border: 1px solid var(--color-hairline); }
.btn--ghost { background: transparent; color: var(--color-accent); border: 1px solid var(--color-accent-soft); }

.empty { padding: 40px; text-align: center; font-family: var(--font-body); color: var(--color-fog); background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; }

@media (max-width: 767px) {
  .apps__header { flex-direction: column; align-items: stretch; gap: 12px; }
  .apps__btn { align-self: flex-start; }
  .apps__heading { font-size: 28px; }
  .tabs { width: 100%; justify-content: space-between; }
  .tab { flex: 1; justify-content: center; padding: 8px 10px; font-size: 12px; }
  .row { flex-wrap: wrap; padding: 14px 16px; gap: 12px; }
  .row__body { flex-basis: calc(100% - 60px); min-width: 0; }
  .row__avatar { width: 40px; height: 40px; font-size: 13px; }
  .row__name { font-size: 15px; }
  .row__meta { flex-wrap: wrap; gap: 6px; font-size: 11px; }
  .row__notes { font-size: 12px; }
  .row__time { flex-basis: auto; margin-left: 52px; }
  .row__actions { flex-basis: 100%; justify-content: flex-end; }
}
</style>
