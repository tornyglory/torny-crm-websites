<script setup lang="ts">
/**
 * MemberPicker — single-slot typeahead for the private-tournament roster.
 *
 * Captain types a name or handle, we hit `members.publicSearch()` (brief
 * 78 §5), captain picks a match. Emits the resolved member so the parent
 * can slot the `user_id` into its submit payload.
 *
 * - Collapsed when no selection: shows a dashed "+ pick a {position}" row.
 * - Expanded on click: input + result list underneath.
 * - Selected: shows the member chip with a Swap affordance.
 *
 * Debounces search to 250ms. Discards stale responses via an AbortSignal
 * tied to the latest query.
 */
import { members, type PublicMemberMatch } from '@torny/api-client'

interface Props {
  clubSlug: string
  modelValue: PublicMemberMatch | null
  /** Shown above the row in the collapsed state — e.g. "Lead", "Skip". */
  position: string
  /** "You" when the slot is the signed-in captain's own (optional UX). */
  isCaptain?: boolean
  /** Hide rows whose user_id is already picked elsewhere on the roster. */
  excludeUserIds?: number[]
}

const props = withDefaults(defineProps<Props>(), {
  isCaptain: false,
  excludeUserIds: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: PublicMemberMatch | null): void
}>()

const query = ref('')
const matches = ref<PublicMemberMatch[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const expanded = ref(false)

// Debounce + abort stale requests.
let debounceHandle: ReturnType<typeof setTimeout> | null = null
let activeController: AbortController | null = null

function runSearch(q: string) {
  if (activeController) activeController.abort()
  const controller = new AbortController()
  activeController = controller

  searching.value = true
  searchError.value = null
  members
    .publicSearch(props.clubSlug, q, { signal: controller.signal })
    .then((results) => {
      // Ignore results from a superseded request.
      if (controller.signal.aborted) return
      matches.value = results.filter((m) => !props.excludeUserIds.includes(m.user_id))
    })
    .catch((err) => {
      if (controller.signal.aborted) return
      searchError.value = err instanceof Error ? err.message : 'Search failed. Try again.'
      matches.value = []
    })
    .finally(() => {
      if (controller.signal.aborted) return
      searching.value = false
    })
}

watch(query, (q) => {
  if (debounceHandle) clearTimeout(debounceHandle)
  const trimmed = q.trim()
  if (trimmed.length < 2) {
    matches.value = []
    searching.value = false
    return
  }
  debounceHandle = setTimeout(() => runSearch(trimmed), 250)
})

function pick(match: PublicMemberMatch) {
  emit('update:modelValue', match)
  query.value = ''
  matches.value = []
  expanded.value = false
}

function clear() {
  emit('update:modelValue', null)
  query.value = ''
  matches.value = []
  expanded.value = true
  nextTick(() => {
    const el = inputRef.value
    if (el) el.focus()
  })
}

function openPicker() {
  expanded.value = true
  nextTick(() => inputRef.value?.focus())
}

const inputRef = ref<HTMLInputElement | null>(null)

const positionLower = computed(() => props.position.toLowerCase())
</script>

<template>
  <div class="mp">
    <!-- Selected state -->
    <div v-if="modelValue" class="mp__picked">
      <div class="mp__avatar">{{ modelValue.initials }}</div>
      <div class="mp__picked-body">
        <div class="mp__picked-name">
          {{ modelValue.first_name }} {{ modelValue.last_name }}
          <span v-if="isCaptain" class="mp__picked-tag">CAPTAIN · YOU</span>
          <span v-else class="mp__picked-tag mp__picked-tag--mint">CONFIRMED</span>
        </div>
        <div class="mp__picked-meta">
          <template v-if="modelValue.handle">@{{ modelValue.handle }} · club member</template>
          <template v-else>club member</template>
        </div>
      </div>
      <button type="button" class="mp__chip" @click="clear">Swap</button>
    </div>

    <!-- Empty / search state -->
    <div v-else>
      <button
        v-if="!expanded"
        type="button"
        class="mp__empty"
        @click="openPicker"
      >
        <div class="mp__empty-avatar">+</div>
        <div class="mp__empty-body">
          <div class="mp__empty-title">Pick your {{ positionLower }}</div>
          <div class="mp__empty-meta">Search the club's member list.</div>
        </div>
      </button>

      <div v-else class="mp__search">
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="mp__input"
          :placeholder="`Search ${positionLower}s by name or handle…`"
          autocomplete="off"
        />
        <div v-if="query.trim().length > 0 && query.trim().length < 2" class="mp__hint">
          Type at least 2 letters.
        </div>
        <div v-else-if="searching" class="mp__hint">Searching…</div>
        <div v-else-if="searchError" class="mp__hint mp__hint--err">{{ searchError }}</div>
        <ul v-else-if="matches.length > 0" class="mp__list">
          <li
            v-for="m in matches"
            :key="m.user_id"
            class="mp__item"
            @click="pick(m)"
          >
            <div class="mp__avatar mp__avatar--sm">{{ m.initials }}</div>
            <div class="mp__item-body">
              <div class="mp__item-name">{{ m.first_name }} {{ m.last_name }}</div>
              <div class="mp__item-meta">
                <template v-if="m.handle">@{{ m.handle }}</template>
                <template v-else>Club member</template>
              </div>
            </div>
          </li>
        </ul>
        <div v-else-if="query.trim().length >= 2" class="mp__hint">
          No matches. Only current club members can enter.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp { display: flex; flex-direction: column; gap: 10px; width: 100%; }

.mp__picked {
  display: flex; align-items: center; gap: 14px; width: 100%;
}
.mp__picked-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mp__picked-name {
  font-family: var(--font-display, sans-serif);
  font-weight: 700; font-size: 17px; letter-spacing: -0.01em;
  color: var(--color-ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.mp__picked-tag {
  padding: 2px 8px; background: var(--color-surface, #F5F5F2);
  border-radius: 999px; font-family: var(--font-mono, monospace);
  font-size: 9px; letter-spacing: 0.14em; color: var(--color-fog); font-weight: 700;
}
.mp__picked-tag--mint { background: rgba(22,163,74,0.14); color: #16A34A; }
.mp__picked-meta { font-family: var(--font-body, sans-serif); font-size: 12px; color: var(--color-fog); }

.mp__chip {
  padding: 8px 14px; background: transparent; border: 1px solid var(--color-hairline);
  border-radius: 999px; font-family: var(--font-body, sans-serif);
  font-size: 12px; color: var(--color-graphite); font-weight: 500; cursor: pointer;
}
.mp__chip:hover { border-color: var(--color-ink); color: var(--color-ink); }

.mp__empty {
  display: flex; align-items: center; gap: 14px; width: 100%;
  padding: 10px 14px; background: transparent;
  border: 1.5px dashed var(--color-mute, #CECEC4); border-radius: 12px;
  cursor: pointer; text-align: left;
}
.mp__empty:hover { border-color: var(--color-ink); background: #FAFAF8; }
.mp__empty-avatar {
  width: 44px; height: 44px; border-radius: 12px; background: #F5F5F2;
  border: 1.5px dashed var(--color-mute); color: var(--color-mute);
  font-size: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.mp__empty-body { flex: 1; min-width: 0; }
.mp__empty-title { font-family: var(--font-display); font-weight: 700; font-size: 15px; color: var(--color-ink); letter-spacing: -0.01em; }
.mp__empty-meta { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; }

.mp__search { display: flex; flex-direction: column; gap: 10px; }
.mp__input {
  width: 100%; padding: 12px 14px; background: white;
  border: 1px solid var(--color-hairline); border-radius: 12px;
  font-family: var(--font-body); font-size: 15px; color: var(--color-ink); outline: none;
  box-sizing: border-box;
}
.mp__input:focus { border-color: var(--color-ink); }

.mp__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); padding: 0 4px; }
.mp__hint--err { color: #DC2F3B; }

.mp__list {
  list-style: none; margin: 0; padding: 4px;
  background: white; border: 1px solid var(--color-hairline); border-radius: 12px;
  display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow-y: auto;
}
.mp__item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
}
.mp__item:hover { background: var(--color-surface, #F5F5F2); }
.mp__item-body { flex: 1; min-width: 0; }
.mp__item-name { font-family: var(--font-display); font-weight: 600; font-size: 14px; color: var(--color-ink); }
.mp__item-meta { font-family: var(--font-body); font-size: 11px; color: var(--color-fog); margin-top: 1px; }

.mp__avatar {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #2563EB 0%, #7C3AED 100%);
  color: white; font-family: var(--font-display); font-weight: 700; font-size: 15px;
  display: flex; align-items: center; justify-content: center;
}
.mp__avatar--sm { width: 36px; height: 36px; font-size: 13px; border-radius: 10px; }
</style>
