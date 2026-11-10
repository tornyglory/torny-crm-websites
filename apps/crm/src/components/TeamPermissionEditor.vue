<script setup lang="ts">
/**
 * TeamPermissionEditor — permission picker used in the invite + edit-member
 * drawers on Settings → Team access.
 *
 * Sections are grouped (People / Play / Venue / Reach) with two checkboxes
 * per row: Access (grants the read permission + any always-with-access perms
 * like payments:read) and Edit (grants the write permission). Members gets
 * an extra PII sub-toggle below the grid.
 *
 * Pro-only sections (Team selections, Tournaments, Honour board, Venue
 * bookings, Venue packages) show an inline "Pro" chip and gray out on
 * Starter — the checkboxes are disabled so a Starter-plan admin can't
 * accidentally grant a permission the backend will 422-reject.
 *
 * v-model shape: `{ preset, sections, settings }`. Caller composes the
 * final permissions[] via `toggleStateToPermissions()` before POST.
 */
import { computed, watch } from 'vue'
import {
  SECTIONS,
  SETTINGS_PERMISSIONS,
  PRESETS,
  type PermissionPreset,
  type PlanKey,
  type SectionDef,
  type SectionKey,
  type SectionToggleMap,
  type SettingsSectionDef,
} from '@torny/api-client'
import TornySelect from '@/components/TornySelect.vue'

/** Preset dropdown options — flattened into TornySelect's shape. The hint
 *  renders as the secondary line under each option, so the admin sees the
 *  effect of each preset without opening the editor. */
const presetOptions = PRESETS.map((p) => ({
  value: p.key,
  label: p.label,
  hint: p.description,
}))

export interface EditorState {
  preset: PermissionPreset['key']
  sections: SectionToggleMap
  settings: Record<SettingsSectionDef['key'], boolean>
}

const props = defineProps<{
  modelValue: EditorState
  plan: PlanKey
  /** When 'admin', hide the per-section grid — admins always get the full
   *  bundle (brief 94 §2.1). Caller shows a note instead. */
  role: 'admin' | 'member'
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: EditorState): void }>()

const isPro = computed(() => props.plan === 'pro')

interface SectionGroup {
  label: string
  sections: SectionDef[]
}

/** Group sections into clusters matching the CrmShell sidebar so the picker
 *  feels like the live nav structure. */
const GROUPS: SectionGroup[] = [
  {
    label: 'People',
    sections: SECTIONS.filter((s) => ['members', 'applications', 'enquiries'].includes(s.key)),
  },
  {
    label: 'Play',
    sections: SECTIONS.filter((s) =>
      ['events', 'team_selections', 'tournaments', 'honour_board'].includes(s.key),
    ),
  },
  {
    label: 'Venue',
    sections: SECTIONS.filter((s) => ['venue_bookings', 'venue_packages'].includes(s.key)),
  },
  {
    label: 'Reach',
    sections: SECTIONS.filter((s) => ['website', 'communications'].includes(s.key)),
  },
]

const currentPreset = computed(() =>
  PRESETS.find((p) => p.key === props.modelValue.preset),
)

function applyPreset(presetKey: PermissionPreset['key']) {
  const preset = PRESETS.find((p) => p.key === presetKey)
  if (!preset) return
  const built = preset.build()
  emit('update:modelValue', {
    preset: presetKey,
    sections: built.sections,
    settings: built.settings,
  })
}

function toggleSection(key: SectionKey, field: 'access' | 'edit', value: boolean) {
  const sections = { ...props.modelValue.sections }
  const current = sections[key] ?? { access: false, edit: false }
  const next = { ...current, [field]: value }
  // Edit implies access.
  if (field === 'edit' && value) next.access = true
  // Dropping access drops edit + PII.
  if (field === 'access' && !value) {
    next.edit = false
    if (key === 'members') next.pii = false
  }
  sections[key] = next
  emit('update:modelValue', { ...props.modelValue, preset: 'custom', sections })
}

function togglePii(value: boolean) {
  const sections = { ...props.modelValue.sections }
  sections.members = { ...sections.members, pii: value }
  emit('update:modelValue', { ...props.modelValue, preset: 'custom', sections })
}

function toggleSetting(key: SettingsSectionDef['key'], value: boolean) {
  emit('update:modelValue', {
    ...props.modelValue,
    preset: 'custom',
    settings: { ...props.modelValue.settings, [key]: value },
  })
}

// Starter-plan safety net: when the plan drops mid-session, scrub Pro-only
// grants silently so Save doesn't 422 permission_requires_plan.
watch(
  () => props.plan,
  (plan) => {
    if (plan === 'pro') return
    const sections = { ...props.modelValue.sections }
    let touched = false
    for (const s of SECTIONS) {
      if (!s.requiresPro) continue
      const row = sections[s.key]
      if (row && (row.access || row.edit)) {
        sections[s.key] = { ...row, access: false, edit: false }
        touched = true
      }
    }
    if (touched) emit('update:modelValue', { ...props.modelValue, sections })
  },
)

/** How many sections currently grant any access — drives the bottom counter. */
const grantedCount = computed(() => {
  let n = 0
  for (const s of SECTIONS) {
    const row = props.modelValue.sections[s.key]
    if (row?.access) n += 1
  }
  return n
})

const settingsCount = computed(() =>
  SETTINGS_PERMISSIONS.filter((s) => props.modelValue.settings[s.key]).length,
)
</script>

<template>
  <div v-if="role === 'admin'" class="editor-admin-note">
    <strong>Admins get the full CRM bundle automatically.</strong> Every section
    except billing, danger zone, and team management (all owner-only). Only the
    owner can invite another admin.
  </div>

  <div v-else class="editor">
    <!-- Preset picker: stacked label + description row for consistency
         with every other labelled input in the modal. -->
    <div class="editor__preset">
      <span class="editor__preset-label">Start from a preset</span>
      <TornySelect
        :model-value="modelValue.preset"
        :options="presetOptions"
        @update:model-value="(v: PermissionPreset['key']) => applyPreset(v)"
      />
      <p v-if="currentPreset" class="editor__preset-hint">{{ currentPreset.description }}</p>
    </div>

    <!-- Section groups -->
    <div class="editor__groups">
      <div v-for="group in GROUPS" :key="group.label" class="editor__group">
        <div class="editor__group-head">
          <span class="editor__group-label">{{ group.label }}</span>
          <div class="editor__col-heads">
            <span class="editor__col-head">Access</span>
            <span class="editor__col-head">Edit</span>
          </div>
        </div>
        <ul class="editor__rows">
          <li
            v-for="section in group.sections"
            :key="section.key"
            class="editor__row"
            :class="{ 'editor__row--pro-locked': section.requiresPro && !isPro }"
          >
            <span class="editor__row-name">
              {{ section.label }}
              <span v-if="section.requiresPro && !isPro" class="editor__pro-chip">Pro</span>
            </span>
            <label class="editor__cell">
              <input
                type="checkbox"
                :checked="modelValue.sections[section.key]?.access ?? false"
                :disabled="section.requiresPro && !isPro"
                @change="toggleSection(section.key, 'access', ($event.target as HTMLInputElement).checked)"
              />
            </label>
            <label class="editor__cell">
              <input
                type="checkbox"
                :checked="modelValue.sections[section.key]?.edit ?? false"
                :disabled="(section.requiresPro && !isPro) || !modelValue.sections[section.key]?.access"
                @change="toggleSection(section.key, 'edit', ($event.target as HTMLInputElement).checked)"
              />
            </label>
          </li>
        </ul>
      </div>
    </div>

    <!-- Members PII sub-toggle — only meaningful when members:access is on -->
    <div
      class="editor__pii"
      :class="{ 'editor__pii--disabled': !modelValue.sections.members?.access }"
    >
      <label class="editor__pii-label">
        <input
          type="checkbox"
          :checked="modelValue.sections.members?.pii ?? false"
          :disabled="!modelValue.sections.members?.access"
          @change="togglePii(($event.target as HTMLInputElement).checked)"
        />
        <span>
          <strong>Can see member contact details</strong>
          <span class="editor__pii-hint">Email, phone, date of birth, address, and internal notes.</span>
        </span>
      </label>
    </div>

    <!-- Settings sub-sections -->
    <div class="editor__settings">
      <div class="editor__settings-head">Settings access</div>
      <ul class="editor__settings-grid">
        <li v-for="s in SETTINGS_PERMISSIONS" :key="s.key">
          <label class="editor__cell editor__cell--inline">
            <input
              type="checkbox"
              :checked="modelValue.settings[s.key] ?? false"
              @change="toggleSetting(s.key, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ s.label }}</span>
          </label>
        </li>
      </ul>
    </div>

    <!-- Summary + footnote -->
    <div class="editor__summary">
      <div class="editor__count">
        <strong>{{ grantedCount }}</strong> {{ grantedCount === 1 ? 'section' : 'sections' }}
        <span v-if="settingsCount"> · <strong>{{ settingsCount }}</strong> settings</span>
      </div>
      <p class="editor__footnote">
        Billing, Team access, and Danger zone stay owner-only — they can't be
        assigned here.
      </p>
    </div>
  </div>
</template>

<style scoped>
.editor-admin-note {
  background: var(--color-accent-soft);
  color: var(--color-ink);
  padding: 16px 18px;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.55;
}

.editor { display: flex; flex-direction: column; gap: 24px; }

/* ── Preset ────────────────────────────────────────────────── */
.editor__preset { display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
.editor__preset-label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.editor__preset-hint {
  margin: 4px 0 0;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  line-height: 1.5;
}

/* ── Section groups ─────────────────────────────────────────── */
.editor__groups {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.editor__group {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 14px 16px 10px;
}
.editor__group-head {
  display: grid;
  grid-template-columns: 1fr 60px 60px;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-hairline);
}
.editor__group-label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fog);
}
.editor__col-heads {
  display: contents;
}
.editor__col-head {
  text-align: center;
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-fog, #9ca3af);
}

.editor__rows { list-style: none; padding: 0; margin: 0; }
.editor__row {
  display: grid;
  grid-template-columns: 1fr 60px 60px;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid transparent;
}
.editor__row + .editor__row { border-top: 1px solid var(--color-hairline); }
.editor__row--pro-locked { opacity: 0.55; }
.editor__row-name {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor__pro-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.editor__cell { display: flex; justify-content: center; align-items: center; }
.editor__cell input {
  width: 20px;
  height: 20px;
  accent-color: var(--color-accent, #E96D2A);
  cursor: pointer;
  margin: 0;
}
.editor__cell input:disabled { cursor: not-allowed; opacity: 0.4; }

/* ── PII sub-toggle ─────────────────────────────────────────── */
.editor__pii {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 14px 16px;
}
.editor__pii--disabled { opacity: 0.55; }
.editor__pii-label {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 12px;
  cursor: pointer;
}
.editor__pii-label input {
  width: 20px;
  height: 20px;
  accent-color: var(--color-accent, #E96D2A);
  margin: 2px 0 0;
}
.editor__pii-label strong {
  display: block;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}
.editor__pii-hint {
  display: block;
  margin-top: 2px;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  line-height: 1.5;
}

/* ── Settings access ────────────────────────────────────────── */
.editor__settings {
  background: #fff;
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 14px 16px 16px;
}
.editor__settings-head {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-fog);
  margin-bottom: 10px;
}
.editor__settings-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 20px;
}
.editor__cell--inline {
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  padding: 4px 0;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-ink);
}
.editor__cell--inline input {
  width: 18px;
  height: 18px;
}

/* ── Summary ────────────────────────────────────────────────── */
.editor__summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 2px 2px 0;
}
.editor__count {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--color-ink);
}
.editor__count strong { font-weight: 700; }
.editor__footnote {
  margin: 0;
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--color-fog);
  text-align: right;
  max-width: 420px;
  line-height: 1.5;
}

/* ── Responsive ─────────────────────────────────────────────── */
@media (max-width: 860px) {
  .editor__groups { grid-template-columns: 1fr; }
  .editor__preset-row { grid-template-columns: 1fr; gap: 6px; }
  .editor__summary { flex-direction: column; align-items: flex-start; }
  .editor__footnote { text-align: left; max-width: none; }
}
</style>
