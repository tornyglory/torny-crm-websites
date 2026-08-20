<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import CrmModal from '@/components/modals/CrmModal.vue'

interface Member {
  id: string
  name: string
  email: string
  phone: string
  role: string
  status: 'Active' | 'Pending' | 'Lapsed'
  membership: string
}

const search = ref('')
const members = ref<Member[]>([
  { id: '1', name: 'Marcus Tuilagi', email: 'marcus@example.com', phone: '021 555 0101', role: 'Player', status: 'Active', membership: 'Playing member' },
  { id: '2', name: 'Denise Peters', email: 'denise@example.com', phone: '022 555 0202', role: 'Committee', status: 'Active', membership: 'Life member' },
  { id: '3', name: 'Tama Wong', email: 'tama@example.com', phone: '027 555 0303', role: 'Player', status: 'Active', membership: 'Playing member' },
  { id: '4', name: 'Reggie Harris', email: 'reggie@example.com', phone: '021 555 0404', role: 'Player', status: 'Lapsed', membership: 'Playing member' },
  { id: '5', name: 'Jo Kirk', email: 'jo@example.com', phone: '022 555 0505', role: 'Player', status: 'Active', membership: 'Playing member' },
])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return members.value
  return members.value.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.email.toLowerCase().includes(q),
  )
})

function initials(m: Member) {
  return m.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const statusTone: Record<Member['status'], string> = {
  Active: 'ok',
  Pending: 'warn',
  Lapsed: 'danger',
}

// ── Add member modal ───────────────────────────────────────────
const addOpen = ref(false)
const emptyForm = () => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: 'Player',
  membership: 'Playing member' as 'Playing member' | 'Social member' | 'Life member' | 'Junior',
  sendInvite: true,
  markPending: true,
})
const form = reactive(emptyForm())

function openAdd() {
  Object.assign(form, emptyForm())
  addOpen.value = true
}
function closeAdd() {
  addOpen.value = false
}

const canSubmit = computed(
  () => form.firstName.trim().length > 0 && form.lastName.trim().length > 0 && form.email.trim().length > 0,
)

function submit() {
  if (!canSubmit.value) return
  members.value.unshift({
    id: `m${Date.now()}`,
    name: `${form.firstName.trim()} ${form.lastName.trim()}`,
    email: form.email.trim(),
    phone: form.phone.trim(),
    role: form.role,
    status: form.markPending ? 'Pending' : 'Active',
    membership: form.membership,
  })
  closeAdd()
}
</script>

<template>
  <div class="members">
    <header class="members__header">
      <div>
        <div class="members__eyebrow">Roster</div>
        <h1 class="members__heading">Members</h1>
        <p class="members__sub">{{ members.length }} total · {{ members.filter(m => m.status === 'Active').length }} active</p>
      </div>
      <div class="members__actions">
        <input v-model="search" placeholder="Search members…" class="members__search" />
        <button class="members__btn" @click="openAdd">+ Add member</button>
      </div>
    </header>

    <input v-model="search" placeholder="Search members…" class="members__search-mobile" />

    <!-- Desktop table -->
    <table class="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Membership</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in filtered" :key="m.id">
          <td>{{ m.name }}</td>
          <td>{{ m.email }}</td>
          <td>{{ m.role }}</td>
          <td>{{ m.membership }}</td>
          <td><span class="pill" :class="`pill--${statusTone[m.status]}`">{{ m.status }}</span></td>
        </tr>
      </tbody>
    </table>

    <!-- Mobile card list -->
    <ul class="cards">
      <li v-for="m in filtered" :key="m.id" class="card">
        <div class="card__avatar">{{ initials(m) }}</div>
        <div class="card__body">
          <div class="card__name-row">
            <div class="card__name">{{ m.name }}</div>
            <span class="pill" :class="`pill--${statusTone[m.status]}`">{{ m.status }}</span>
          </div>
          <div class="card__meta">{{ m.membership }} · {{ m.role }}</div>
          <div class="card__contact">{{ m.email }}</div>
        </div>
      </li>
    </ul>

    <button class="fab" @click="openAdd">+ Add member</button>

    <CrmModal
      :open="addOpen"
      eyebrow="Roster"
      title="Add a member"
      width="md"
      @close="closeAdd"
    >
      <form class="form" @submit.prevent="submit">
        <div class="form__row">
          <label class="field">
            <span class="field__label">First name</span>
            <input v-model="form.firstName" type="text" autofocus />
          </label>
          <label class="field">
            <span class="field__label">Last name</span>
            <input v-model="form.lastName" type="text" />
          </label>
        </div>
        <label class="field">
          <span class="field__label">Email</span>
          <input v-model="form.email" type="email" placeholder="member@example.com" />
        </label>
        <div class="form__row">
          <label class="field">
            <span class="field__label">Phone</span>
            <input v-model="form.phone" type="tel" placeholder="021 555 0000" />
          </label>
          <label class="field">
            <span class="field__label">Role</span>
            <select v-model="form.role">
              <option>Player</option>
              <option>Committee</option>
              <option>Coach</option>
              <option>Junior</option>
              <option>Volunteer</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Membership</span>
          <select v-model="form.membership">
            <option>Playing member</option>
            <option>Social member</option>
            <option>Life member</option>
            <option>Junior</option>
          </select>
        </label>

        <div class="switch-row">
          <div>
            <div class="switch-row__label">Send an email invite</div>
            <div class="switch-row__hint">Prompts them to set a password and download the Torny app.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': form.sendInvite }"
            @click="form.sendInvite = !form.sendInvite"
          ><span class="switch__knob" /></button>
        </div>
        <div class="switch-row">
          <div>
            <div class="switch-row__label">Mark as pending</div>
            <div class="switch-row__hint">They'll appear as pending until they confirm dues.</div>
          </div>
          <button
            type="button"
            class="switch"
            :class="{ 'is-on': form.markPending }"
            @click="form.markPending = !form.markPending"
          ><span class="switch__knob" /></button>
        </div>
      </form>

      <template #footer>
        <button type="button" class="btn btn--outline" @click="closeAdd">Cancel</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!canSubmit"
          @click="submit"
        >Add member</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.members { max-width: 1080px; display: flex; flex-direction: column; gap: 20px; }

.members__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.members__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--color-fog); text-transform: uppercase; }
.members__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.members__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }
.members__actions { display: flex; gap: 10px; align-items: center; }
.members__search { padding: 9px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; min-width: 220px; background: #fff; }
.members__search:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.members__btn { padding: 9px 14px; background: var(--color-ink); color: #fff; border: none; border-radius: 10px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; }
.members__btn:hover { background: var(--color-graphite); }

.members__search-mobile { display: none; padding: 11px 14px; border: 1px solid var(--color-hairline); border-radius: 12px; font-family: var(--font-body); font-size: 14px; background: #fff; }
.members__search-mobile:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

.table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; overflow: hidden; }
.table th { text-align: left; padding: 12px 16px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--color-fog); text-transform: uppercase; background: var(--color-surface); border-bottom: 1px solid var(--color-hairline); }
.table td { padding: 14px 16px; font-family: var(--font-body); font-size: 14px; color: var(--color-ink); border-bottom: 1px solid var(--color-hairline); }
.table tbody tr:last-child td { border-bottom: none; }

.cards { display: none; list-style: none; padding: 0; margin: 0; flex-direction: column; gap: 8px; }
.card { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; }
.card__avatar { width: 44px; height: 44px; border-radius: 999px; background: var(--color-graphite); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-body); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.card__body { flex: 1; min-width: 0; }
.card__name-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card__name { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-graphite); margin-top: 2px; }
.card__contact { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 11px; font-weight: 600; flex-shrink: 0; }
.pill--ok { background: #DCFCE7; color: #14532D; }
.pill--warn { background: var(--color-accent-soft); color: var(--color-accent); }
.pill--danger { background: #FEE2E2; color: #991B1B; }

.fab { display: none; position: fixed; right: 20px; bottom: 84px; padding: 14px 20px; background: var(--color-ink); color: #fff; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 14px; font-weight: 600; box-shadow: var(--shadow-lg); cursor: pointer; z-index: 10; }

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

.btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

@media (max-width: 767px) {
  .members__header { align-items: stretch; }
  .members__heading { font-size: 28px; }
  .members__actions { display: none; }
  .members__search-mobile { display: block; }
  .table { display: none; }
  .cards { display: flex; }
  .fab { display: inline-block; }
  .form__row { grid-template-columns: 1fr; }
}
</style>
