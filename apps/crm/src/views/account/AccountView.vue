<script setup lang="ts">
/**
 * Account — self-service name / email / password editor.
 *
 * Wired to brief 71's `/me` endpoints. The backend ships in pieces, so
 * each action surfaces a 404 as "Available soon — brief 71" rather than
 * a scary error. The read side (name + email + avatar + pending-email
 * banner) is live via `authStore.user` and `authStore.refresh()`.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { auth as authApi, media as mediaApi, ApiError } from '@torny/api-client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import CrmModal from '@/components/modals/CrmModal.vue'

const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()

const user = computed(() => authStore.user)

// Derived initial name — the stored user shape splits into first/last so
// recompose for the "full name" field in the edit modal.
const fullName = computed(() => {
  const u = user.value
  if (!u) return ''
  if (u.name) return u.name
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
})

// ── Pending email flag (brief 71 §6 extends AuthUser with
//    pending_email + pending_email_expires_at). Until the backend ships,
//    these fields won't be on the stored user — we treat `undefined` as
//    "no pending change". The cast keeps TS happy. ──────────────────
interface WithPending {
  pending_email?: string | null
  pending_email_expires_at?: string | null
}
const pendingEmail = computed(() => (user.value as (typeof user.value & WithPending) | null)?.pending_email ?? null)
const pendingExpiresAt = computed(() => (user.value as (typeof user.value & WithPending) | null)?.pending_email_expires_at ?? null)

// ── Modals ────────────────────────────────────────────────────────
const nameModalOpen = ref(false)
const emailModalOpen = ref(false)
const passwordModalOpen = ref(false)

const nameDraft = ref('')
const newEmail = ref('')
const currentPw = ref('')
const newPw = ref('')
const confirmPw = ref('')
const saving = ref(false)

function openNameModal() {
  nameDraft.value = fullName.value
  nameModalOpen.value = true
}
function openEmailModal() {
  newEmail.value = ''
  emailModalOpen.value = true
}
function openPasswordModal() {
  currentPw.value = ''
  newPw.value = ''
  confirmPw.value = ''
  passwordModalOpen.value = true
}

// ── Actions ───────────────────────────────────────────────────────
function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Available soon — brief 71 lands with this endpoint.'
    switch (err.code) {
      case 'invalid_name':             return 'Name must be between 1 and 120 characters.'
      case 'invalid_avatar':           return "Avatar URL isn't on the Torny media allowlist."
      case 'invalid_email':            return 'That doesn\'t look like a valid email.'
      case 'same_as_current':          return "That's already your current email."
      case 'email_in_use':             return 'Another account already uses that email.'
      case 'rate_limited':             return 'Too many change requests — try again in an hour.'
      case 'current_password_wrong':   return 'Current password is wrong.'
      case 'weak_password':            return 'Password needs ≥10 chars with at least one letter and one number.'
      default:                         return err.message || fallback
    }
  }
  return err instanceof Error ? err.message : fallback
}

async function saveName() {
  const trimmed = nameDraft.value.trim()
  if (!trimmed) {
    toast.error('Name can\'t be empty.')
    return
  }
  saving.value = true
  try {
    await authApi.patchMe({ name: trimmed })
    await authStore.refresh()
    nameModalOpen.value = false
    toast.success('Name updated.')
  } catch (err) {
    toast.error(friendlyError(err, 'Could not save name.'))
  } finally {
    saving.value = false
  }
}

async function requestEmailChange() {
  const email = newEmail.value.trim()
  if (!email) {
    toast.error('Enter a new email.')
    return
  }
  saving.value = true
  try {
    const res = await authApi.requestEmailChange(email)
    await authStore.refresh()
    emailModalOpen.value = false
    toast.success(`Check ${res.pending_email} for a confirmation link.`)
  } catch (err) {
    toast.error(friendlyError(err, 'Could not start email change.'))
  } finally {
    saving.value = false
  }
}

async function resendPendingEmail() {
  if (!pendingEmail.value) return
  saving.value = true
  try {
    const res = await authApi.requestEmailChange(pendingEmail.value)
    toast.success(`Resent confirmation link to ${res.pending_email}.`)
  } catch (err) {
    toast.error(friendlyError(err, 'Could not resend.'))
  } finally {
    saving.value = false
  }
}

async function cancelPendingEmail() {
  saving.value = true
  try {
    await authApi.cancelEmailChange()
    await authStore.refresh()
    toast.success('Email change cancelled.')
  } catch (err) {
    toast.error(friendlyError(err, 'Could not cancel.'))
  } finally {
    saving.value = false
  }
}

async function changePasswordSubmit() {
  if (newPw.value !== confirmPw.value) {
    toast.error('New password + confirmation don\'t match.')
    return
  }
  if (newPw.value.length < 10) {
    toast.error('Password needs ≥10 characters.')
    return
  }
  saving.value = true
  try {
    const res = await authApi.changePassword({
      current_password: currentPw.value,
      new_password: newPw.value,
    })
    passwordModalOpen.value = false
    const revoked = res.other_sessions_revoked
    toast.success(
      revoked > 0
        ? `Password changed · ${revoked} other session${revoked === 1 ? '' : 's'} signed out.`
        : 'Password changed.',
    )
  } catch (err) {
    toast.error(friendlyError(err, 'Could not change password.'))
  } finally {
    saving.value = false
  }
}

function back() { router.push({ name: 'dashboard' }) }

// ── Avatar upload ─────────────────────────────────────────────────
const avatarFileInput = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)

function triggerAvatarPicker() {
  avatarFileInput.value?.click()
}

async function onAvatarFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''                        // reset so re-picking the same file still fires
  if (!file) return
  if (!/^image\//.test(file.type)) {
    toast.error('Pick an image file.')
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.error('Image must be under 5 MB.')
    return
  }
  const uid = user.value?.id
  if (uid == null) return
  avatarUploading.value = true
  try {
    // Upload the file to Cloudflare via the existing /media/images/* dance.
    const confirmed = await mediaApi.uploadMemberAvatar(uid, file)
    const url = confirmed.avatar_url

    // Persist via patchMe (brief 71). If the backend endpoint 404s, keep the
    // optimistic update so the avatar lights up for the session; it'll reset
    // on next /me refresh once brief 71 ships.
    try {
      await authApi.patchMe({ avatar_url: url })
      await authStore.refresh()
      toast.success('Profile picture updated.')
    } catch (patchErr) {
      if (patchErr instanceof ApiError && patchErr.status === 404) {
        authStore.updateAvatarLocally(url)
        toast.info('Uploaded. Backend persistence lands with brief 71 — survives this session.')
      } else {
        throw patchErr
      }
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not upload profile picture.')
  } finally {
    avatarUploading.value = false
  }
}


function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const a = parts[0]?.[0] ?? ''
  const b = parts[parts.length - 1]?.[0] ?? ''
  return (a + (parts.length > 1 ? b : '')).toUpperCase() || '??'
}

function fmtExpires(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffH = Math.round((d.getTime() - Date.now()) / 3600000)
  if (diffH < 1) return 'expiring soon'
  if (diffH < 24) return `expires in ${diffH}h`
  return `expires in ${Math.round(diffH / 24)}d`
}
</script>

<template>
  <div v-if="user" class="acct">
    <!-- Topbar -->
    <header class="acct__topbar">
      <button type="button" class="acct__back" @click="back">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L4 8l6 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Back
      </button>
    </header>

    <!-- Hero -->
    <section class="acct__hero">
      <div class="acct__avatar-wrap">
        <button type="button" class="acct__avatar" :disabled="avatarUploading" @click="triggerAvatarPicker" :aria-label="user.avatarUrl ? 'Change profile picture' : 'Add profile picture'">
          <img v-if="user.avatarUrl" :src="user.avatarUrl" :alt="fullName" />
          <span v-else>{{ initials(fullName) }}</span>
          <span v-if="avatarUploading" class="acct__avatar-spin" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="8.5" stroke="rgba(255,255,255,0.25)" stroke-width="2.5"/>
              <path d="M11 2.5a8.5 8.5 0 0 1 8.5 8.5" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </span>
          <span v-else class="acct__avatar-overlay">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 2.5L13.5 5l-7.5 7.5-3 .5.5-3L11 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            <span class="acct__avatar-overlay-text">{{ user.avatarUrl ? 'Change' : 'Add' }}</span>
          </span>
        </button>
        <input
          ref="avatarFileInput"
          type="file"
          accept="image/*"
          class="acct__avatar-file"
          @change="onAvatarFileChosen"
        />
      </div>
      <div class="acct__hero-text">
        <div class="acct__eyebrow">Your account</div>
        <h1 class="acct__title">{{ fullName || '—' }}</h1>
        <div class="acct__meta">
          <span>{{ user.email }}</span>
          <span class="acct__dot">·</span>
          <span class="acct__role">{{ user.role }}</span>
        </div>
      </div>
    </section>

    <!-- Pending-email banner -->
    <div v-if="pendingEmail" class="acct__pending">
      <div class="acct__pending-text">
        <div class="acct__pending-title">
          <span class="acct__pending-dot"></span>
          Pending email change · <span class="mono">{{ pendingEmail }}</span>
        </div>
        <div class="acct__pending-sub">
          We sent a confirmation link to the new address — click it to switch over.
          <template v-if="pendingExpiresAt"> Link {{ fmtExpires(pendingExpiresAt) }}.</template>
        </div>
      </div>
      <div class="acct__pending-actions">
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="saving" @click="resendPendingEmail">
          Resend link
        </button>
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="saving" @click="cancelPendingEmail">
          Cancel change
        </button>
      </div>
    </div>

    <!-- Fields -->
    <section class="acct__card">
      <!-- Name -->
      <div class="acct__row">
        <div class="acct__row-text">
          <div class="acct__row-label">Name</div>
          <div class="acct__row-value">{{ fullName || '—' }}</div>
          <div class="acct__row-hint">Shown in the user menu and on anything you send from the CRM.</div>
        </div>
        <button type="button" class="pill-btn pill-btn--ghost" @click="openNameModal">Change</button>
      </div>

      <!-- Email -->
      <div class="acct__row">
        <div class="acct__row-text">
          <div class="acct__row-label">Email</div>
          <div class="acct__row-value mono">{{ user.email }}</div>
          <div class="acct__row-hint">
            Used to sign in. Changes require confirming from the new address.
          </div>
        </div>
        <button
          type="button"
          class="pill-btn pill-btn--ghost"
          :disabled="!!pendingEmail"
          :title="pendingEmail ? 'Cancel the pending change first' : undefined"
          @click="openEmailModal"
        >Change</button>
      </div>

      <!-- Password -->
      <div class="acct__row">
        <div class="acct__row-text">
          <div class="acct__row-label">Password</div>
          <div class="acct__row-value">••••••••••</div>
          <div class="acct__row-hint">
            Rotating signs out every other device. This one stays signed in.
          </div>
        </div>
        <button type="button" class="pill-btn pill-btn--ghost" @click="openPasswordModal">Change</button>
      </div>
    </section>

    <!-- Change-name modal -->
    <CrmModal
      :open="nameModalOpen"
      eyebrow="Account"
      title="Change your name"
      width="sm"
      @close="nameModalOpen = false"
    >
      <label class="acct-field">
        <span class="acct-field__label">Full name</span>
        <input v-model="nameDraft" type="text" class="acct-field__input" maxlength="120" placeholder="e.g. Grace Whittaker" />
      </label>
      <template #footer>
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="saving" @click="nameModalOpen = false">Cancel</button>
        <button type="button" class="pill-btn pill-btn--ink" :disabled="saving" @click="saveName">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </template>
    </CrmModal>

    <!-- Change-email modal -->
    <CrmModal
      :open="emailModalOpen"
      eyebrow="Account"
      title="Change your email"
      width="sm"
      @close="emailModalOpen = false"
    >
      <p class="acct-modal__text">
        We'll email a confirmation link to the <strong>new</strong> address. Your email only changes once you click it.
        <br>
        Your current address also gets a notice so you know a change was requested.
      </p>
      <label class="acct-field">
        <span class="acct-field__label">New email</span>
        <input v-model="newEmail" type="email" class="acct-field__input mono" placeholder="you@newaddress.co.nz" />
      </label>
      <template #footer>
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="saving" @click="emailModalOpen = false">Cancel</button>
        <button type="button" class="pill-btn pill-btn--ink" :disabled="saving" @click="requestEmailChange">
          {{ saving ? 'Sending…' : 'Send confirmation link' }}
        </button>
      </template>
    </CrmModal>

    <!-- Change-password modal -->
    <CrmModal
      :open="passwordModalOpen"
      eyebrow="Account"
      title="Change your password"
      width="sm"
      @close="passwordModalOpen = false"
    >
      <label class="acct-field">
        <span class="acct-field__label">Current password</span>
        <input v-model="currentPw" type="password" class="acct-field__input" autocomplete="current-password" />
      </label>
      <label class="acct-field">
        <span class="acct-field__label">New password</span>
        <input v-model="newPw" type="password" class="acct-field__input" autocomplete="new-password" />
        <span class="acct-field__hint">At least 10 characters with one letter and one number.</span>
      </label>
      <label class="acct-field">
        <span class="acct-field__label">Confirm new password</span>
        <input v-model="confirmPw" type="password" class="acct-field__input" autocomplete="new-password" />
      </label>
      <template #footer>
        <button type="button" class="pill-btn pill-btn--ghost" :disabled="saving" @click="passwordModalOpen = false">Cancel</button>
        <button type="button" class="pill-btn pill-btn--ink" :disabled="saving" @click="changePasswordSubmit">
          {{ saving ? 'Changing…' : 'Change password' }}
        </button>
      </template>
    </CrmModal>
  </div>

  <div v-else class="acct__empty">
    <h1>Not signed in</h1>
    <p>You need to be signed in to see your account.</p>
  </div>
</template>

<style scoped>
.acct { display: flex; flex-direction: column; gap: 24px; max-width: 1280px; }
.mono { font-family: var(--font-mono); }

.acct__topbar { display: flex; align-items: center; }
.acct__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.acct__back:hover { background: var(--color-surface); }

.acct__hero {
  display: flex;
  align-items: center;
  gap: 20px;
}
.acct__avatar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.acct__avatar {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  flex-shrink: 0;
  overflow: hidden;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.acct__avatar:disabled { cursor: wait; }
.acct__avatar img { width: 100%; height: 100%; object-fit: cover; }
.acct__avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: rgba(10, 10, 11, 0.65);
  color: #fff;
  opacity: 0;
  transition: opacity 0.12s ease;
  font-family: var(--font-body);
}
.acct__avatar:hover .acct__avatar-overlay,
.acct__avatar:focus-visible .acct__avatar-overlay,
.acct__avatar:disabled .acct__avatar-overlay { opacity: 1; }
.acct__avatar-overlay-text {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.acct__avatar-file { display: none; }
.acct__avatar-spin {
  position: absolute;
  inset: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 11, 0.55);
  border-radius: 999px;
  animation: acct__avatar-spin 0.8s linear infinite;
}
@keyframes acct__avatar-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.acct__hero-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.acct__eyebrow {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.acct__title {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--color-ink);
  margin: 0;
}
.acct__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-fog);
}
.acct__dot { color: var(--color-mute); }
.acct__role { text-transform: capitalize; }

/* Pending banner */
.acct__pending {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  background: #FFF7E6;
  border: 1px solid #FFECB3;
  border-radius: 14px;
  flex-wrap: wrap;
}
.acct__pending-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.acct__pending-title { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; font-weight: 600; color: var(--color-ink); }
.acct__pending-dot { width: 7px; height: 7px; border-radius: 999px; background: #F59E0B; }
.acct__pending-sub { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); line-height: 1.5; }
.acct__pending-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* Field rows */
.acct__card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 16px;
  overflow: hidden;
}
.acct__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--color-hairline);
}
.acct__row:last-child { border-bottom: 0; }
.acct__row-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.acct__row-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.acct__row-value {
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink);
}
.acct__row-value.mono { font-family: var(--font-mono); font-size: 13px; }
.acct__row-hint {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  line-height: 1.4;
  margin-top: 2px;
}

/* Pill buttons */
.pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-hairline);
  background: #fff;
  color: var(--color-ink);
  white-space: nowrap;
}
.pill-btn:hover:not(:disabled) { background: var(--color-surface); }
.pill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pill-btn--ghost { background: #fff; }
.pill-btn--ink {
  background: var(--color-ink);
  color: #fff;
  border-color: var(--color-ink);
}
.pill-btn--ink:hover:not(:disabled) { background: var(--color-graphite); }

/* Modal fields */
.acct-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.acct-field__label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.acct-field__input {
  padding: 10px 14px;
  border: 1px solid var(--color-hairline);
  border-radius: 10px;
  background: #fff;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
}
.acct-field__input:focus { outline: none; border-color: var(--color-ink); }
.acct-field__input.mono { font-family: var(--font-mono); font-size: 13px; }
.acct-field__hint { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); }

.acct-modal__text {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
  line-height: 1.55;
  margin: 0 0 12px;
}
.acct-modal__text strong { font-weight: 600; }

/* Empty */
.acct__empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 48px 32px;
}
.acct__empty h1 { font-family: var(--font-display); font-size: 24px; color: var(--color-ink); margin: 0; }
.acct__empty p { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); }

@media (max-width: 640px) {
  .acct__hero { flex-direction: column; align-items: flex-start; gap: 12px; }
  .acct__avatar { width: 56px; height: 56px; font-size: 20px; }
  .acct__title { font-size: 24px; }
  .acct__row { flex-direction: column; align-items: stretch; gap: 10px; }
  .acct__row > .pill-btn { align-self: flex-start; }
}
</style>
