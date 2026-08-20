<script setup lang="ts">
/**
 * UserMenu
 * --------
 * Avatar-triggered dropdown that opens from the top-right, matching the
 * NotificationsDropdown / NewMenu language. Header shows the current
 * user's name + email; body has "My profile", "Settings", and a
 * destructive "Sign out". Sign-out clears the auth session and routes
 * to the sign-in view.
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClubStore } from '@/stores/club'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const router = useRouter()
const auth = useAuthStore()
const club = useClubStore()

const displayName = computed(() => {
  if (!auth.user) return 'Signed out'
  return `${auth.user.firstName ?? ''} ${auth.user.lastName ?? ''}`.trim() || 'You'
})
const displayEmail = computed(() => auth.user?.email ?? '')
const roleLabel = computed(() => {
  const r = auth.user?.role
  if (!r) return null
  return r.charAt(0).toUpperCase() + r.slice(1)
})

function close() {
  emit('update:open', false)
}

function goProfile() {
  close()
  router.push({ name: 'settings' })
}
function goSettings() {
  close()
  router.push({ name: 'settings' })
}
async function signOut() {
  close()
  auth.clearSession()
  club.clear()
  await router.push({ name: 'sign-in' })
}

function onKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
function onDocClick(e: MouseEvent) {
  if (!props.open) return
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('[data-usermenu-anchor]')) return
  if (target.closest('.user-menu')) return
  close()
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      window.addEventListener('keydown', onKey)
      requestAnimationFrame(() => document.addEventListener('click', onDocClick))
    } else {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDocClick)
    }
  },
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <transition name="user-menu-fade">
    <div v-if="open" class="user-menu" role="menu" aria-label="Account">
      <header class="user-menu__head">
        <div class="user-menu__avatar" aria-hidden="true">
          {{ displayName ? displayName.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase() : '?' }}
        </div>
        <div class="user-menu__id">
          <div class="user-menu__name">{{ displayName }}</div>
          <div v-if="displayEmail" class="user-menu__email">{{ displayEmail }}</div>
          <div v-if="roleLabel" class="user-menu__role">{{ roleLabel }} · {{ club.current?.name ?? 'No club' }}</div>
        </div>
      </header>

      <ul class="user-menu__list">
        <li
          class="user-menu__row"
          role="menuitem"
          @click="goProfile"
        >
          <span class="user-menu__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.6"/>
              <path d="M3.5 17c0-3 3-5 6.5-5s6.5 2 6.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="user-menu__label">My profile</span>
        </li>
        <li
          class="user-menu__row"
          role="menuitem"
          @click="goSettings"
        >
          <span class="user-menu__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="2.4" stroke="currentColor" stroke-width="1.6"/>
              <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.4 5.4l1.4 1.4M13.2 13.2l1.4 1.4M5.4 14.6l1.4-1.4M13.2 6.8l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="user-menu__label">Settings</span>
        </li>
      </ul>

      <div class="user-menu__divider" aria-hidden="true" />

      <ul class="user-menu__list">
        <li
          class="user-menu__row user-menu__row--danger"
          role="menuitem"
          @click="signOut"
        >
          <span class="user-menu__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path d="M13 6.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              <path d="M8 10h9M14 7l3 3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="user-menu__label">Sign out</span>
        </li>
      </ul>

      <footer class="user-menu__foot">
        <span class="user-menu__foot-brand">Torny CRM</span>
        <span class="user-menu__foot-sep">·</span>
        <span>v0.0.1</span>
      </footer>
    </div>
  </transition>
</template>

<style scoped>
.user-menu {
  position: fixed;
  top: 68px;
  right: 20px;
  width: 300px;
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 14px;
  box-shadow: 0 20px 44px -18px rgba(15, 23, 42, 0.28), 0 6px 12px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  z-index: 60;
}

.user-menu__head {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  align-items: flex-start;
  border-bottom: 1px solid var(--color-hairline);
  background: var(--color-surface);
}
.user-menu__avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--color-ink);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}
.user-menu__id { min-width: 0; }
.user-menu__name {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-menu__email {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--color-fog);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-menu__role {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-graphite);
  margin-top: 4px;
}

.user-menu__list {
  list-style: none;
  padding: 6px 8px;
  margin: 0;
}
.user-menu__row {
  display: grid;
  grid-template-columns: 28px 1fr;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  align-items: center;
  transition: background-color 0.1s ease;
}
.user-menu__row:hover { background: var(--color-surface); }
.user-menu__icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-graphite);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.user-menu__row:hover .user-menu__icon { background: #fff; color: var(--color-ink); }
.user-menu__label {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
}

.user-menu__row--danger .user-menu__icon {
  background: rgba(220, 47, 59, 0.08);
  color: var(--color-danger);
}
.user-menu__row--danger .user-menu__label { color: var(--color-danger); font-weight: 600; }
.user-menu__row--danger:hover { background: rgba(220, 47, 59, 0.05); }
.user-menu__row--danger:hover .user-menu__icon { background: rgba(220, 47, 59, 0.12); color: var(--color-danger); }

.user-menu__divider {
  height: 1px;
  background: var(--color-hairline);
  margin: 0 8px;
}

.user-menu__foot {
  padding: 8px 14px;
  border-top: 1px solid var(--color-hairline);
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-fog);
  display: flex;
  align-items: center;
  gap: 6px;
}
.user-menu__foot-brand { font-weight: 700; letter-spacing: 0.02em; }
.user-menu__foot-sep { opacity: 0.5; }

.user-menu-fade-enter-active, .user-menu-fade-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.32, 0.72, 0, 1);
}
.user-menu-fade-enter-from, .user-menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 767px) {
  .user-menu {
    position: fixed;
    inset: auto 0 0 0;
    width: auto;
    max-width: 100%;
    border-radius: 20px 20px 0 0;
    top: auto;
    right: 0;
    box-shadow: 0 -20px 60px -20px rgba(15, 23, 42, 0.28);
  }
  .user-menu-fade-enter-from, .user-menu-fade-leave-to {
    opacity: 0;
    transform: translateY(24px);
  }
}
</style>
