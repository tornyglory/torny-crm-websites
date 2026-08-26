<script setup lang="ts">
/**
 * Contact form — the public "Say hi" block. Matches the Paper design
 * "Contact · Full page (Desktop)". Reads contact + hours from
 * BlockContext (populated by /site.contact + /site.hours) and POSTs the
 * form to brief 41's public enquiries endpoint.
 */
import { computed, inject, isRef, ref, type Ref } from 'vue'
import { enquiries, ApiError, type CreateEnquiryInput, type EnquiryTopic } from '@torny/api-client'
import {
  BLOCK_CONTEXT_KEY,
  type BlockContext,
  type ContactFormProps,
} from '../types'

const props = withDefaults(defineProps<ContactFormProps>(), {
  eyebrow: 'CONTACT',
  heading: 'Say hi.',
  description: "Usually back within a day. Never share your details.",
  formHeading: 'Send us a note.',
  formHint: 'Usually back within a day. Never share your details.',
  submitLabel: 'Send message',
  successMessage: "Thanks — we'll be in touch shortly.",
  showContactRail: true,
  showHours: true,
  topics: () => ['Membership', 'Events & roll-ups', 'Facilities hire', 'General enquiry', 'Media'],
  messageMaxLength: 500,
  privacyHref: '',
})

const ctxRef = inject<Ref<BlockContext> | BlockContext | null>(BLOCK_CONTEXT_KEY, null)
const ctx = computed<BlockContext | null>(() => {
  if (!ctxRef) return null
  return isRef(ctxRef) ? ctxRef.value : ctxRef
})
const brand = computed(() => ctx.value?.brandPrimary ?? '#2563EB')
const clubSlug = computed<string | null>(() => ctx.value?.clubSlug ?? null)

const contact = computed(() => ctx.value?.contact ?? {})
const hours = computed(() => ctx.value?.hours ?? [])

// ── Hours formatting ──────────────────────────────────────────
const WEEK: Array<{ day: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; label: string }> = [
  { day: 'mon', label: 'Mon' },
  { day: 'tue', label: 'Tue' },
  { day: 'wed', label: 'Wed' },
  { day: 'thu', label: 'Thu' },
  { day: 'fri', label: 'Fri' },
  { day: 'sat', label: 'Sat' },
  { day: 'sun', label: 'Sun' },
]
const hoursByDay = computed(() => {
  const map = new Map<string, { open: string | null; close: string | null; is_open: boolean }>()
  for (const h of hours.value) map.set(h.day, { open: h.open, close: h.close, is_open: h.is_open })
  return map
})
function formatHour(h: string | null): string {
  if (!h) return ''
  // Accept "HH:MM" or "HH:MM:SS". Format as e.g. "12pm", "4:30pm".
  const [hh, mm = '00'] = h.split(':')
  const hourNum = Number(hh)
  if (Number.isNaN(hourNum)) return h
  const period = hourNum >= 12 ? 'pm' : 'am'
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12
  const minutes = mm === '00' ? '' : `:${mm}`
  return `${hour12}${minutes}${period}`
}
function hoursLabel(day: string): string {
  const row = hoursByDay.value.get(day)
  if (!row || !row.is_open) return 'CLOSED'
  const open = formatHour(row.open)
  const close = formatHour(row.close)
  if (!open || !close) return 'OPEN'
  return `${open.toUpperCase()} — ${close.toUpperCase()}`
}

/** Is the club open right now? Cheap — walks today's row and checks the current time. */
const openStatus = computed<{ isOpen: boolean; label: string }>(() => {
  const now = new Date()
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]!
  const row = hoursByDay.value.get(dayKey)
  if (!row || !row.is_open || !row.open || !row.close) return { isOpen: false, label: 'Closed today' }
  const [oh, om = '00'] = row.open.split(':')
  const [ch, cm = '00'] = row.close.split(':')
  const openMin = Number(oh) * 60 + Number(om)
  const closeMin = Number(ch) * 60 + Number(cm)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (nowMin >= openMin && nowMin < closeMin) return { isOpen: true, label: `Open now · closes ${formatHour(row.close)}` }
  if (nowMin < openMin) return { isOpen: false, label: `Opens ${formatHour(row.open)}` }
  return { isOpen: false, label: 'Closed for the day' }
})

// ── Form state ────────────────────────────────────────────────
const form = ref({
  name: '',
  email: '',
  phone: '',
  topic: (props.topics[0] ?? 'General enquiry'),
  message: '',
  consent: true,
})
const status = ref<'idle' | 'sending' | 'sent'>('idle')
const errorMessage = ref<string | null>(null)

const messageLen = computed(() => form.value.message.length)
const messageOverLimit = computed(() => props.messageMaxLength > 0 && messageLen.value > props.messageMaxLength)

function topicSlug(topic: string): EnquiryTopic {
  const s = topic.toLowerCase()
  if (s.includes('membership')) return 'membership'
  if (s.includes('event')) return 'events'
  if (s.includes('facilit')) return 'facilities'
  if (s.includes('media')) return 'media'
  return 'general'
}

async function submit(evt: Event) {
  evt.preventDefault()
  errorMessage.value = null
  if (messageOverLimit.value) {
    errorMessage.value = `Message is over ${props.messageMaxLength} characters — trim it a little.`
    return
  }
  if (!clubSlug.value) {
    errorMessage.value = 'This preview isn\'t connected to a live club. Publish the site to enable submissions.'
    return
  }
  status.value = 'sending'
  try {
    const payload: CreateEnquiryInput = {
      full_name: form.value.name.trim(),
      email: form.value.email.trim(),
      phone: form.value.phone.trim() || null,
      topic: topicSlug(form.value.topic),
      message: form.value.message.trim(),
      consent_reply: form.value.consent,
    }
    // Server returns enquiry_id: 0 when it silently drops a honeypot hit —
    // we still show success so bots don't learn anything from the response.
    await enquiries.create(clubSlug.value, payload)
    status.value = 'sent'
  } catch (e) {
    status.value = 'idle'
    errorMessage.value = enquiryErrorMessage(e)
  }
}

function enquiryErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'We couldn\'t send that. Please try again.'
  const body = (err.body ?? {}) as { code?: string }
  switch (body.code) {
    case 'enquiries_closed': return 'The club has paused the contact form for now — try the phone number instead.'
    case 'rate_limited': return 'Too many messages from this address. Please wait an hour before trying again.'
    case 'consent_required': return 'Please tick the reply-by-email consent before sending.'
    case 'bad_email': return 'That email address doesn\'t look right — double-check it.'
    case 'bad_message': return 'Message needs to be at least a few characters.'
    case 'missing_required': return 'Name, email, and message are all required.'
    default: return err.message || 'We couldn\'t send that. Please try again.'
  }
}
</script>

<template>
  <section class="cf" :style="{ '--brand': brand } as any">
    <header class="cf__head">
      <div v-if="props.eyebrow" class="cf__eyebrow">
        <span class="cf__eyebrow-dot" />
        <span>{{ props.eyebrow }}</span>
      </div>
      <h1 class="cf__title">{{ props.heading }}</h1>
      <p v-if="props.description" class="cf__sub">{{ props.description }}</p>
    </header>

    <div v-if="status === 'sent'" class="cf__success">
      <div class="cf__success-eyebrow">
        <span class="cf__eyebrow-dot" />
        <span>MESSAGE SENT</span>
      </div>
      <h2 class="cf__success-title">Thanks!</h2>
      <p class="cf__success-body">{{ props.successMessage }}</p>
    </div>

    <form v-else class="cf__body" @submit="submit">
      <!-- Left rail — reach us + find us + hours. Owner can hide this. -->
      <aside v-if="props.showContactRail" class="cf__rail">
        <div class="cf__card cf__card--surface">
          <div class="cf__card-eyebrow">
            <span class="cf__eyebrow-dot" />
            <span>REACH US</span>
          </div>
          <div v-if="contact.email" class="cf__contact-row">
            <div class="cf__icon-square">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="14" height="10" rx="1.5" /><path d="M3 6l7 5 7-5" />
              </svg>
            </div>
            <div class="cf__contact-copy">
              <span class="cf__contact-label">EMAIL</span>
              <a class="cf__contact-value" :href="`mailto:${contact.email}`">{{ contact.email }}</a>
            </div>
          </div>
          <div v-if="contact.phone" class="cf__contact-row">
            <div class="cf__icon-square">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h3l2 4-2 1.5c1 2 3 4 5 5L13 12.5l4 2v3c0 1-.8 1.5-1.5 1.5C9 19 3 13 3 5.5 3 4.8 3.5 4 4 4z" />
              </svg>
            </div>
            <div class="cf__contact-copy">
              <span class="cf__contact-label">CLUBHOUSE</span>
              <a class="cf__contact-value" :href="`tel:${(contact.phone ?? '').replace(/\s+/g, '')}`">{{ contact.phone }}</a>
            </div>
          </div>
        </div>

        <div v-if="contact.address || contact.google_maps_url" class="cf__card cf__card--ink">
          <div class="cf__card-eyebrow cf__card-eyebrow--light">
            <span class="cf__eyebrow-dot" />
            <span>FIND US</span>
          </div>
          <div v-if="contact.address" class="cf__address">{{ contact.address }}</div>
          <div class="cf__map">
            <div class="cf__map-grid" />
            <div class="cf__map-road cf__map-road--a" />
            <div class="cf__map-road cf__map-road--b" />
            <div class="cf__map-pin">
              <div class="cf__map-pin-dot" />
              <div class="cf__map-pin-stem" />
            </div>
          </div>
          <a
            v-if="contact.google_maps_url"
            class="cf__map-link"
            :href="contact.google_maps_url"
            target="_blank"
            rel="noopener"
          >
            <span>Open in Google Maps</span>
            <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5h7v7M15 5l-8 8" /></svg>
          </a>
        </div>

        <div v-if="props.showHours && hours.length" class="cf__card cf__card--white">
          <div class="cf__hours-eyebrow" :class="{ 'is-open': openStatus.isOpen }">
            <span class="cf__hours-dot" />
            <span>{{ openStatus.label.toUpperCase() }}</span>
          </div>
          <ul class="cf__hours">
            <li v-for="d in WEEK" :key="d.day" class="cf__hours-row" :class="{ 'is-closed': !hoursByDay.get(d.day)?.is_open }">
              <span class="cf__hours-day">{{ d.label }}</span>
              <span class="cf__hours-time">{{ hoursLabel(d.day) }}</span>
            </li>
          </ul>
        </div>
      </aside>

      <!-- Right — the form card -->
      <div class="cf__form" :class="{ 'cf__form--full': !props.showContactRail }">
        <header class="cf__form-head">
          <h2>{{ props.formHeading }}</h2>
          <p v-if="props.formHint">{{ props.formHint }}</p>
        </header>

        <div v-if="props.topics.length > 0" class="cf__group">
          <div class="cf__group-head">
            <span class="cf__label">What's this about?</span>
            <span class="cf__group-hint">Helps us route it faster</span>
          </div>
          <div class="cf__chips">
            <button
              v-for="t in props.topics"
              :key="t"
              type="button"
              class="cf__chip"
              :class="{ 'cf__chip--on': form.topic === t }"
              @click="form.topic = t"
            >{{ t }}</button>
          </div>
        </div>

        <div class="cf__row">
          <label class="cf__field">
            <span>Your name</span>
            <input v-model="form.name" type="text" autocomplete="name" required />
          </label>
          <label class="cf__field">
            <span>Email</span>
            <input v-model="form.email" type="email" autocomplete="email" required />
          </label>
        </div>

        <label class="cf__field cf__field--half">
          <span>Phone <em>(optional)</em></span>
          <input v-model="form.phone" type="tel" autocomplete="tel" placeholder="If you'd prefer a call back" />
        </label>

        <label class="cf__field">
          <div class="cf__group-head">
            <span>Your message</span>
            <span
              class="cf__counter"
              :class="{ 'cf__counter--over': messageOverLimit }"
            >{{ messageLen }} / {{ props.messageMaxLength }}</span>
          </div>
          <textarea v-model="form.message" rows="6" required :placeholder="topicSlug(form.topic) === 'membership' ? 'Tell us a bit about your bowls experience — new to the sport, playing socially, wanting pennant? Anything helps.' : 'What can we help with?'" />
        </label>

        <label class="cf__consent">
          <input type="checkbox" v-model="form.consent" />
          <span class="cf__consent-copy">
            <span>Fine to reply by email. Your details stay with the club — never shared.</span>
            <a v-if="props.privacyHref" :href="props.privacyHref" target="_blank" rel="noopener" class="cf__consent-link">Read the privacy policy.</a>
          </span>
        </label>

        <p v-if="errorMessage" class="cf__error">{{ errorMessage }}</p>

        <div class="cf__actions">
          <button type="submit" class="cf__submit" :disabled="status === 'sending'">
            <span>{{ status === 'sending' ? 'Sending…' : props.submitLabel }}</span>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>
          </button>
          <div v-if="contact.phone" class="cf__ring">
            <span>Or ring the clubhouse</span>
            <a :href="`tel:${(contact.phone ?? '').replace(/\s+/g, '')}`">{{ contact.phone }}</a>
          </div>
          <span class="cf__encrypted">
            <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="8" width="11" height="8" rx="1.5"/><path d="M7 8V6a3 3 0 016 0v2"/></svg>
            <span>ENCRYPTED</span>
          </span>
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.cf {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  padding: 96px max(48px, calc((100vw - var(--container-content, 1280px)) / 2));
  box-sizing: border-box;
  background: var(--color-ground);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: 72px;
}

/* Header */
.cf__head { display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center; padding-bottom: 64px; border-bottom: 1px solid var(--color-hairline); }
.cf__eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cf__eyebrow-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--brand); flex-shrink: 0; }
.cf__title { font-family: var(--font-display); font-size: clamp(48px, 7vw, 88px); font-weight: 700; line-height: 1; letter-spacing: -0.02em; margin: 0; }
.cf__sub { font-family: var(--font-body); font-size: 18px; line-height: 150%; color: var(--color-fog); margin: 0; max-width: 620px; }

/* Body layout */
.cf__body { display: grid; grid-template-columns: 380px 1fr; gap: 80px; align-items: flex-start; }

/* Rail cards */
.cf__rail { display: flex; flex-direction: column; gap: 32px; }
.cf__card { display: flex; flex-direction: column; gap: 20px; padding: 28px; border-radius: 20px; }
.cf__card--surface { background: var(--color-surface); }
.cf__card--ink { background: var(--color-ink); color: #fff; gap: 16px; }
.cf__card--white { background: #fff; border: 1px solid var(--color-hairline); }
.cf__card-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cf__card-eyebrow--light { color: rgba(255,255,255,0.6); }

/* Reach us rows */
.cf__contact-row { display: flex; align-items: center; gap: 14px; }
.cf__icon-square { width: 40px; height: 40px; border-radius: 12px; background: var(--color-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cf__contact-copy { display: flex; flex-direction: column; gap: 2px; }
.cf__contact-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cf__contact-value { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.01em; text-decoration: none; }
.cf__contact-value:hover { text-decoration: underline; text-underline-offset: 3px; }

/* Address / map */
.cf__address { font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 130%; letter-spacing: -0.02em; color: #fff; white-space: pre-line; }
.cf__map { position: relative; height: 148px; border-radius: 12px; background: linear-gradient(135deg, #2a3d5f 0%, #1a2540 100%); border: 1px solid rgba(255,255,255,0.06); overflow: hidden; }
.cf__map-grid { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, transparent 0, transparent 22px, rgba(255,255,255,0.04) 22px, rgba(255,255,255,0.04) 23px), repeating-linear-gradient(90deg, transparent 0, transparent 22px, rgba(255,255,255,0.04) 22px, rgba(255,255,255,0.04) 23px); }
.cf__map-road { position: absolute; height: 3px; background: rgba(255,255,255,0.14); border-radius: 999px; }
.cf__map-road--a { top: 40%; left: 30%; width: 40%; transform: rotate(-12deg); }
.cf__map-road--b { top: 55%; left: 20%; width: 55%; height: 2px; background: rgba(255,255,255,0.1); transform: rotate(8deg); }
.cf__map-pin { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; }
.cf__map-pin-dot { width: 28px; height: 28px; border-radius: 999px; background: var(--brand); border: 3px solid #fff; box-shadow: 0 4px 12px color-mix(in oklab, var(--brand) 40%, transparent); }
.cf__map-pin-stem { width: 2px; height: 8px; background: #fff; }
.cf__map-link { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 14px; font-weight: 600; color: #fff; text-decoration: underline; text-underline-offset: 4px; }

/* Hours */
.cf__hours-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cf__hours-eyebrow.is-open { color: var(--color-ink); }
.cf__hours-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-mute); box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-mute) 20%, transparent); }
.cf__hours-eyebrow.is-open .cf__hours-dot { background: #16A34A; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15); }
.cf__hours { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.cf__hours-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid var(--color-hairline); }
.cf__hours-row:last-child { border-bottom: 0; }
.cf__hours-day { font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.cf__hours-row.is-closed .cf__hours-day { font-weight: 500; color: var(--color-graphite); }
.cf__hours-time { font-family: var(--font-mono); font-size: 12px; color: var(--color-ink); }
.cf__hours-row.is-closed .cf__hours-time { color: var(--color-mute); }

/* Form card */
.cf__form { display: flex; flex-direction: column; gap: 28px; padding: 40px; background: #fff; border: 1px solid var(--color-hairline); border-radius: 24px; box-shadow: 0 20px 40px -20px rgba(15, 23, 42, 0.08); }
.cf__form--full { grid-column: 1 / -1; }
.cf__form-head { display: flex; flex-direction: column; gap: 6px; }
.cf__form-head h2 { font-family: var(--font-display); font-size: 32px; font-weight: 700; line-height: 105%; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; }
.cf__form-head p { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; line-height: 150%; }

/* Field primitives */
.cf__group { display: flex; flex-direction: column; gap: 12px; }
.cf__group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.cf__label { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.cf__group-hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.cf__counter { font-family: var(--font-mono); font-size: 11px; color: var(--color-mute); }
.cf__counter--over { color: var(--color-danger, #DC2F3B); }

.cf__row { display: flex; flex-direction: row; gap: 16px; }
.cf__field { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.cf__field--half { max-width: 320px; }
.cf__field > span { font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); }
.cf__field em { font-style: normal; color: var(--color-mute); font-weight: 400; }
.cf__field input, .cf__field textarea {
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 15px;
  color: var(--color-ink);
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.cf__field input:focus, .cf__field textarea:focus { outline: none; border-color: var(--color-ink); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand) 15%, transparent); }
.cf__field textarea { min-height: 160px; line-height: 155%; font-size: 16px; }
.cf__field input::placeholder, .cf__field textarea::placeholder { color: var(--color-mute); }

/* Chips */
.cf__chips { display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; }
.cf__chip {
  padding: 10px 16px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-graphite);
  cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms;
}
.cf__chip:not(.cf__chip--on):hover { border-color: var(--color-ink); color: var(--color-ink); }
.cf__chip--on { background: var(--color-ink); color: #fff; border-color: var(--color-ink); font-weight: 600; }
.cf__chip--on:hover { background: var(--color-graphite); }

/* Consent */
.cf__consent { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; background: var(--color-surface); border-radius: 12px; cursor: pointer; }
.cf__consent input[type="checkbox"] { appearance: none; -webkit-appearance: none; width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--color-hairline); background: #fff; flex-shrink: 0; margin-top: 1px; cursor: pointer; position: relative; }
.cf__consent input[type="checkbox"]:checked { background: var(--color-ink); border-color: var(--color-ink); }
.cf__consent input[type="checkbox"]:checked::after { content: ''; position: absolute; top: 4px; left: 7px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.cf__consent-copy { display: flex; flex-direction: column; gap: 3px; font-family: var(--font-body); font-size: 13px; font-weight: 500; color: var(--color-ink); line-height: 150%; }
.cf__consent-link { font-size: 12px; font-weight: 400; color: var(--color-fog); text-decoration: underline; text-underline-offset: 3px; }

/* Error */
.cf__error { padding: 12px 16px; background: color-mix(in oklab, var(--color-danger, #DC2F3B) 8%, #fff); color: var(--color-danger, #DC2F3B); border-radius: 12px; font-family: var(--font-body); font-size: 14px; font-weight: 500; margin: 0; }

/* Actions */
.cf__actions { display: flex; align-items: center; gap: 24px; padding-top: 12px; border-top: 1px solid var(--color-hairline); flex-wrap: wrap; }
.cf__submit { display: inline-flex; align-items: center; gap: 10px; padding: 18px 32px; background: var(--color-ink); color: #fff; border: 0; border-radius: 999px; font-family: var(--font-body); font-size: 15px; font-weight: 600; cursor: pointer; transition: background 120ms; }
.cf__submit:hover:not(:disabled) { background: var(--color-graphite); }
.cf__submit:disabled { opacity: 0.6; cursor: not-allowed; }
.cf__ring { display: flex; flex-direction: column; gap: 2px; }
.cf__ring span { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); }
.cf__ring a { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.01em; text-decoration: none; }
.cf__ring a:hover { text-decoration: underline; text-underline-offset: 3px; }
.cf__encrypted { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-mute); text-transform: uppercase; }

/* Success */
.cf__success { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; padding: 96px 24px; }
.cf__success-eyebrow { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.08em; color: var(--color-fog); text-transform: uppercase; }
.cf__success-title { font-family: var(--font-display); font-size: clamp(40px, 6vw, 72px); font-weight: 700; letter-spacing: -0.02em; margin: 0; }
.cf__success-body { font-family: var(--font-body); font-size: 16px; line-height: 150%; color: var(--color-fog); max-width: 520px; margin: 0; }

/* Responsive */
@media (max-width: 1023px) {
  .cf__body { grid-template-columns: 1fr; gap: 48px; }
  .cf__form { padding: 32px; }
  .cf__row { flex-direction: column; }
  .cf__actions { flex-wrap: wrap; }
  .cf__encrypted { margin-left: 0; }
}
</style>
