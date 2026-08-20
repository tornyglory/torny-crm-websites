<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '@/composables/useToast'
import CrmModal from '@/components/modals/CrmModal.vue'

const toast = useToast()

type Status = 'new' | 'replied' | 'closed'
type Source = 'contact_form' | 'membership_page' | 'events_page'

interface Enquiry {
  id: string
  from: string
  email: string
  subject: string
  message: string
  status: Status
  source: Source
  when: string
  page: string
}

const enquiries = ref<Enquiry[]>([
  {
    id: 'e1',
    from: 'Jamila Otto',
    email: 'jamila.otto@example.com',
    subject: 'New to bowls — where do I start?',
    message: "Hi team, my partner and I are keen to try lawn bowls. We're both in our 40s, no experience. Do you run beginners nights? Kind regards, Jamila.",
    status: 'new',
    source: 'contact_form',
    when: '2h ago',
    page: '/contact',
  },
  {
    id: 'e2',
    from: 'Peter Harding',
    email: 'peter.h@example.com',
    subject: 'Function hire — 80th birthday',
    message: "Hi, considering the club for my dad's 80th on Sat 15 Nov. Approx 60 people, catered. Is the lounge available and what's the hire cost?",
    status: 'new',
    source: 'contact_form',
    when: 'Yesterday',
    page: '/contact',
  },
  {
    id: 'e3',
    from: 'Sione Faleafa',
    email: 'sione@example.com',
    subject: 'Membership transfer from Kelburn BC',
    message: 'Moved into the area last month. Currently a playing member at Kelburn BC — how do I transfer without losing my playing rating?',
    status: 'new',
    source: 'membership_page',
    when: '2 days ago',
    page: '/membership',
  },
  {
    id: 'e4',
    from: 'Ella Weir',
    email: 'ella@example.com',
    subject: 'Twilight roll-up — turn up rules',
    message: 'Do you need to book or can I just turn up?',
    status: 'replied',
    source: 'events_page',
    when: '4 days ago',
    page: '/events/twilight-roll-up',
  },
  {
    id: 'e5',
    from: 'Ken Withers',
    email: 'ken@example.com',
    subject: 'Groundsman position',
    message: 'Saw your notice board post. My CV attached below.',
    status: 'closed',
    source: 'contact_form',
    when: '2 weeks ago',
    page: '/contact',
  },
])

const activeTab = ref<Status>('new')
const selected = ref<Enquiry | null>(enquiries.value[0] ?? null)

const counts = computed(() => ({
  new: enquiries.value.filter((e) => e.status === 'new').length,
  replied: enquiries.value.filter((e) => e.status === 'replied').length,
  closed: enquiries.value.filter((e) => e.status === 'closed').length,
}))

const filtered = computed(() =>
  enquiries.value.filter((e) => e.status === activeTab.value),
)

function selectEnquiry(e: Enquiry) {
  selected.value = e
}

function markReplied() {
  if (!selected.value) return
  selected.value.status = 'replied'
  toast.success(`Reply sent to ${selected.value.from}`)
}
function markClosed() {
  if (!selected.value) return
  selected.value.status = 'closed'
  toast.info('Enquiry closed without reply.')
}
function exportEnquiries() {
  toast.info(`Exporting ${enquiries.value.length} enquiries — check your email in a minute.`)
}

// ── Auto-reply modal ───────────────────────────────────────────
const autoReplyOpen = ref(false)
const autoReply = ref({
  enabled: true,
  subject: 'Thanks — we got your message',
  body: `Kia ora,\n\nThanks for reaching out. A committee member will reply within two working days.\n\nNgā mihi,\nThe Kelburn Bowls committee`,
})

function openAutoReply() { autoReplyOpen.value = true }
function closeAutoReply() { autoReplyOpen.value = false }
function saveAutoReply() {
  autoReplyOpen.value = false
  toast.success('Auto-reply saved.')
}
</script>

<template>
  <div class="enq">
    <header class="enq__header">
      <div>
        <div class="enq__eyebrow">From the public site</div>
        <h1 class="enq__heading">Enquiries</h1>
        <p class="enq__sub">Site contact form + membership + event pages land here. {{ counts.new }} unread.</p>
      </div>
      <div class="enq__toolbar">
        <button class="btn btn--outline" @click="openAutoReply">Auto-reply</button>
        <button class="btn btn--outline" @click="exportEnquiries">Export</button>
      </div>
    </header>

    <div class="enq__tabs">
      <button
        v-for="tab in (['new', 'replied', 'closed'] as Status[])"
        :key="tab"
        class="tab"
        :class="{ 'is-active': activeTab === tab }"
        @click="activeTab = tab"
      >
        <span class="tab__label">{{ tab }}</span>
        <span class="tab__count">{{ counts[tab] }}</span>
      </button>
    </div>

    <div class="enq__pane">
      <ul class="list" v-if="filtered.length">
        <li
          v-for="e in filtered"
          :key="e.id"
          class="row"
          :class="{ 'is-selected': selected?.id === e.id, 'is-new': e.status === 'new' }"
          @click="selectEnquiry(e)"
        >
          <div class="row__top">
            <div class="row__from">{{ e.from }}</div>
            <div class="row__when">{{ e.when }}</div>
          </div>
          <div class="row__subject">{{ e.subject }}</div>
          <div class="row__preview">{{ e.message }}</div>
          <div class="row__foot">
            <span class="tag" :class="`tag--${e.source}`">{{ e.source.replace('_', ' ') }}</span>
            <span class="row__page">{{ e.page }}</span>
          </div>
        </li>
      </ul>
      <div v-else class="empty">Inbox zero — nothing in this bucket.</div>

      <aside v-if="selected" class="detail">
        <header class="detail__head">
          <div>
            <div class="detail__name">{{ selected.from }}</div>
            <a class="detail__email" :href="`mailto:${selected.email}`">{{ selected.email }}</a>
          </div>
          <span class="tag" :class="`tag--${selected.source}`">{{ selected.source.replace('_', ' ') }}</span>
        </header>
        <div class="detail__meta">
          <span>{{ selected.when }}</span>
          <span class="dot">·</span>
          <span>{{ selected.page }}</span>
        </div>
        <h3 class="detail__subject">{{ selected.subject }}</h3>
        <p class="detail__body">{{ selected.message }}</p>

        <div class="detail__composer">
          <label class="composer__label">Reply</label>
          <textarea
            class="composer__input"
            rows="4"
            placeholder="Type a reply — the sender's name auto-inserts."
          />
          <div class="composer__actions">
            <button class="btn btn--outline" @click="markClosed">Close without reply</button>
            <button class="btn btn--primary" @click="markReplied">Send reply</button>
          </div>
        </div>
      </aside>
    </div>

    <CrmModal
      :open="autoReplyOpen"
      eyebrow="Enquiries"
      title="Auto-reply"
      width="md"
      @close="closeAutoReply"
    >
      <div class="switch-row switch-row--top">
        <div>
          <div class="switch-row__label">Send an instant reply</div>
          <div class="switch-row__hint">Everyone who submits an enquiry gets this straight away.</div>
        </div>
        <button type="button" class="switch" :class="{ 'is-on': autoReply.enabled }" @click="autoReply.enabled = !autoReply.enabled"><span class="switch__knob" /></button>
      </div>
      <form class="form" @submit.prevent="saveAutoReply">
        <label class="field">
          <span class="field__label">Subject</span>
          <input v-model="autoReply.subject" type="text" :disabled="!autoReply.enabled" />
        </label>
        <label class="field">
          <span class="field__label">Body</span>
          <textarea v-model="autoReply.body" rows="6" :disabled="!autoReply.enabled" />
        </label>
      </form>
      <template #footer>
        <button type="button" class="modal-btn modal-btn--outline" @click="closeAutoReply">Cancel</button>
        <button type="button" class="modal-btn modal-btn--primary" @click="saveAutoReply">Save auto-reply</button>
      </template>
    </CrmModal>
  </div>
</template>

<style scoped>
.enq { max-width: 1280px; }
.enq__header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.enq__eyebrow { font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); }
.enq__heading { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--color-ink); }
.enq__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-graphite); margin: 0; }
.enq__toolbar { display: flex; gap: 8px; }

.enq__tabs { display: flex; gap: 6px; margin-bottom: 20px; padding: 4px; background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 999px; width: fit-content; }
.tab { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; border-radius: 999px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-fog); text-transform: capitalize; }
.tab.is-active { background: #fff; color: var(--color-ink); font-weight: 600; box-shadow: var(--shadow-sm); }
.tab__count { font-family: var(--font-mono); font-size: 11px; padding: 1px 7px; background: var(--color-hairline); color: var(--color-graphite); border-radius: 999px; }
.tab.is-active .tab__count { background: var(--color-accent-soft); color: var(--color-accent); }

.enq__pane { display: grid; grid-template-columns: minmax(0, 380px) minmax(0, 1fr); gap: 12px; align-items: start; }

.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.row { padding: 14px 16px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 12px; cursor: pointer; transition: box-shadow 0.15s ease, border-color 0.15s ease; }
.row:hover { border-color: var(--color-mute); }
.row.is-selected { border-color: var(--color-ink); box-shadow: 0 0 0 3px var(--color-hairline); }
.row.is-new { border-left: 3px solid var(--color-accent); }
.row__top { display: flex; justify-content: space-between; align-items: baseline; }
.row__from { font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--color-ink); }
.row__when { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }
.row__subject { font-family: var(--font-body); font-size: 13px; color: var(--color-ink); margin-top: 4px; }
.row__preview { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row__foot { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.row__page { font-family: var(--font-mono); font-size: 10px; color: var(--color-mute); }

.tag { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-family: var(--font-body); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tag--contact_form { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.tag--membership_page { background: #DCFCE7; color: #166534; }
.tag--events_page { background: #FEF3C7; color: #92400E; }

.detail { padding: 24px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; position: sticky; top: 24px; }
.detail__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.detail__name { font-family: var(--font-display); font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--color-ink); }
.detail__email { font-family: var(--font-body); font-size: 13px; color: var(--color-accent); text-decoration: none; }
.detail__meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 8px; display: flex; gap: 6px; }
.detail__meta .dot { opacity: 0.5; }
.detail__subject { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 16px 0 12px; color: var(--color-ink); }
.detail__body { font-family: var(--font-body); font-size: 14px; line-height: 1.6; color: var(--color-graphite); margin: 0 0 20px; white-space: pre-line; }
.detail__composer { border-top: 1px solid var(--color-hairline); padding-top: 16px; }
.composer__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-fog); }
.composer__input { margin-top: 6px; width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--color-hairline); font-family: var(--font-body); font-size: 14px; color: var(--color-ink); resize: vertical; }
.composer__input:focus { outline: none; border-color: var(--color-ink); }
.composer__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

.btn { padding: 9px 14px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
.btn--primary { background: var(--color-ink); color: #fff; }
.btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }

.empty { padding: 40px; text-align: center; font-family: var(--font-body); color: var(--color-fog); background: var(--color-surface); border: 1px dashed var(--color-hairline); border-radius: 14px; }

@media (max-width: 900px) {
  .enq__pane { grid-template-columns: 1fr; }
  .detail { position: static; }
}

/* Auto-reply modal */
.form { display: flex; flex-direction: column; gap: 14px; margin-top: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field input, .field textarea { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; resize: vertical; }
.field input:focus, .field textarea:focus { outline: none; border-color: var(--color-ink); }
.field input:disabled, .field textarea:disabled { opacity: 0.5; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--color-hairline); }
.switch-row--top { border-top: 0; padding-top: 0; margin-bottom: 4px; }
.switch-row__label { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.switch-row__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }
.switch { width: 40px; height: 24px; padding: 3px; border-radius: 999px; background: var(--color-hairline); border: 0; display: flex; cursor: pointer; flex-shrink: 0; }
.switch.is-on { background: var(--color-ink); }
.switch__knob { width: 18px; height: 18px; border-radius: 999px; background: #fff; transition: transform 0.15s ease; }
.switch.is-on .switch__knob { transform: translateX(16px); }
.modal-btn { padding: 9px 16px; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; }
.modal-btn--primary { background: var(--color-ink); color: #fff; }
.modal-btn--primary:hover:not(:disabled) { background: var(--color-graphite); }
.modal-btn--outline { background: transparent; color: var(--color-ink); border: 1px solid var(--color-hairline); }
</style>
