<script setup lang="ts">
/**
 * Action bar on the account detail page — hosts the three admin
 * actions (impersonate, comp plan, suspend/unsuspend) and their
 * confirmation modals. Parent re-fetches the account after each
 * `done` emit to reflect the state change.
 */
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { AdminAccountRow, AdminImpersonateResult } from '@torny/api-client'
import { start as startImpersonation, stop as stopImpersonation } from '@/composables/useImpersonation'
import { useToast } from '@/composables/useToast'
import AdminImpersonateModal from './AdminImpersonateModal.vue'
import AdminCompPlanModal from './AdminCompPlanModal.vue'
import AdminSuspendModal from './AdminSuspendModal.vue'

const props = defineProps<{ account: AdminAccountRow }>()
const emit = defineEmits<{ (e: 'done'): void }>()

const router = useRouter()
const route = useRoute()
const toast = useToast()

const impersonateOpen = ref(false)
const compOpen = ref(false)
const suspendOpen = ref(false)

const isSuspended = computed(() => props.account.flags.suspended)

async function onImpersonateDone(result: AdminImpersonateResult) {
  try {
    await startImpersonation(result, {
      account_id: props.account.id,
      account_name: props.account.name,
      return_path: route.fullPath,
    })
    await router.push('/crm')
  } catch (err) {
    // Session swap failed somewhere — roll back so the admin isn't
    // left in a half-impersonated state. Surface the error so they can
    // retry (or ping support).
    await stopImpersonation()
    toast.error(err instanceof Error ? err.message : 'Could not start impersonation.')
  }
}
</script>

<template>
  <div class="actions">
    <button type="button" class="actions__btn actions__btn--primary" @click="impersonateOpen = true">
      Impersonate
    </button>
    <button type="button" class="actions__btn" @click="compOpen = true">
      Comp plan
    </button>
    <button
      type="button"
      class="actions__btn"
      :class="isSuspended ? 'actions__btn--accent' : 'actions__btn--danger'"
      @click="suspendOpen = true"
    >
      {{ isSuspended ? 'Unsuspend' : 'Suspend' }}
    </button>

    <AdminImpersonateModal
      :open="impersonateOpen"
      :account-id="account.id"
      :account-name="account.name"
      @close="impersonateOpen = false"
      @done="onImpersonateDone"
    />
    <AdminCompPlanModal
      :open="compOpen"
      :account-id="account.id"
      :account-name="account.name"
      :current-plan="account.plan"
      @close="compOpen = false"
      @done="emit('done')"
    />
    <AdminSuspendModal
      :open="suspendOpen"
      :account-id="account.id"
      :account-name="account.name"
      :mode="isSuspended ? 'unsuspend' : 'suspend'"
      @close="suspendOpen = false"
      @done="emit('done')"
    />
  </div>
</template>

<style scoped>
.actions { display: inline-flex; gap: 10px; flex-wrap: wrap; }
.actions__btn {
  padding: 10px 18px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 600;
  background: var(--color-ground);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline);
  border-radius: 999px;
  cursor: pointer;
}
.actions__btn:hover { background: var(--color-surface); }
.actions__btn--primary { background: var(--color-ink); color: #fff; border-color: var(--color-ink); }
.actions__btn--primary:hover { background: #000; }
.actions__btn--danger { color: var(--color-danger); border-color: color-mix(in oklab, var(--color-danger) 40%, transparent); }
.actions__btn--danger:hover { background: color-mix(in oklab, var(--color-danger) 6%, var(--color-ground)); }
.actions__btn--accent { color: var(--color-accent); border-color: color-mix(in oklab, var(--color-accent) 40%, transparent); }
.actions__btn--accent:hover { background: color-mix(in oklab, var(--color-accent) 6%, var(--color-ground)); }
</style>
