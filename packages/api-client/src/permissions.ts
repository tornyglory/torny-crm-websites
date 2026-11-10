// Scoped CRM access — permission strings + section bundles.
// Brief 94 §2.1 + §2.2 (allowlist and UI section → permission mapping).

/** Every string the backend accepts in `permissions[]`. Attempting to grant
 *  anything outside this list → 422 `invalid_permission` on invite send +
 *  member PATCH. See `docs/backend-briefs/94-scoped-crm-access-live.md`. */
export const ALL_PERMISSIONS = [
  'dashboard:view',

  'members:read',
  'members:read_pii',
  'members:write',
  'members:remove',
  'members:note',
  'payments:read',
  'payments:record',

  'applications:read',
  'applications:review',
  'enquiries:read',
  'enquiries:respond',
  'events:read',
  'events:write',
  'communications:read',
  'communications:send',
  'website:view',
  'website:edit',

  // Pro-only — server returns 422 permission_requires_plan when granted on
  // a Starter-plan club.
  'team_selections:read',
  'team_selections:edit',
  'tournaments:read',
  'tournaments:edit',
  'honour_board:read',
  'honour_board:edit',
  'venue_bookings:read',
  'venue_bookings:manage',
  'venue_packages:read',
  'venue_packages:edit',

  'settings:brand',
  'settings:membership',
  'settings:hours',
  'settings:enquiries',
  'settings:integrations',
] as const

export type Permission = (typeof ALL_PERMISSIONS)[number]

/** Permissions the backend gates by role (owner / admin), NOT grantable via
 *  the `permissions[]` field. Attempting to include any of these in an
 *  invite body → 422 `permission_not_grantable`. */
export const HARD_CODED_PERMISSIONS = [
  'settings:billing',    // owner only
  'settings:danger',     // owner only
  'settings:manage_team', // owner + admin
] as const

/** Pro-only permissions — gated by `plan === 'pro'` at the backend. Mirror
 *  the FE check by also hiding the corresponding sections on Starter clubs. */
export const PRO_PERMISSIONS = [
  'team_selections:read',
  'team_selections:edit',
  'tournaments:read',
  'tournaments:edit',
  'honour_board:read',
  'honour_board:edit',
  'venue_bookings:read',
  'venue_bookings:manage',
  'venue_packages:read',
  'venue_packages:edit',
] as const

export type ProPermission = (typeof PRO_PERMISSIONS)[number]

export function isProPermission(perm: string): perm is ProPermission {
  return (PRO_PERMISSIONS as readonly string[]).includes(perm)
}

/** UI section → canonical permission string mapping — brief 94 §2.2. Each
 *  checkbox in the invite / edit drawer corresponds to one row. `access`
 *  grants read-level entry. `edit` grants write-level entry (and depends on
 *  `access` being on; backend treats them as separate strings).
 *
 *  Notes:
 *  - `members` has an extra `pii` toggle (`members:read_pii`) that's only
 *    offered when `access` is on — Selectors / Coaches often shouldn't see
 *    contact details. See `SECTION_PII_PERMISSION`.
 *  - Settings sub-sections are handled separately via `SETTINGS_PERMISSIONS`.
 */
export interface SectionDef {
  key: SectionKey
  label: string
  access: Permission
  edit: Permission
  requiresPro?: boolean
  /** Extra perms to grant when the section is accessible (e.g. members:note,
   *  payments:read riding along with members access). Kept for lossless
   *  round-trip with the brief's bundle definition. */
  alsoAccess?: Permission[]
  /** Extra perms to grant when `edit` is on. */
  alsoEdit?: Permission[]
}

export type SectionKey =
  | 'members'
  | 'applications'
  | 'enquiries'
  | 'events'
  | 'team_selections'
  | 'tournaments'
  | 'honour_board'
  | 'venue_bookings'
  | 'venue_packages'
  | 'website'
  | 'communications'

export const SECTIONS: SectionDef[] = [
  {
    key: 'members',
    label: 'Members',
    access: 'members:read',
    edit: 'members:write',
    alsoAccess: ['payments:read'],
    alsoEdit: ['members:remove', 'members:note', 'payments:record'],
  },
  { key: 'applications', label: 'Applications', access: 'applications:read', edit: 'applications:review' },
  { key: 'enquiries', label: 'Enquiries', access: 'enquiries:read', edit: 'enquiries:respond' },
  { key: 'events', label: 'Events', access: 'events:read', edit: 'events:write' },
  { key: 'team_selections', label: 'Team selections', access: 'team_selections:read', edit: 'team_selections:edit', requiresPro: true },
  { key: 'tournaments', label: 'Tournaments', access: 'tournaments:read', edit: 'tournaments:edit', requiresPro: true },
  { key: 'honour_board', label: 'Honour board', access: 'honour_board:read', edit: 'honour_board:edit', requiresPro: true },
  { key: 'venue_bookings', label: 'Venue bookings', access: 'venue_bookings:read', edit: 'venue_bookings:manage', requiresPro: true },
  { key: 'venue_packages', label: 'Venue packages', access: 'venue_packages:read', edit: 'venue_packages:edit', requiresPro: true },
  { key: 'website', label: 'Website', access: 'website:view', edit: 'website:edit' },
  { key: 'communications', label: 'Communications', access: 'communications:read', edit: 'communications:send' },
]

/** Extra PII permission on the Members section — surfaced as a sub-toggle in
 *  the UI, only meaningful when `members:read` is already granted. */
export const SECTION_PII_PERMISSION: Permission = 'members:read_pii'

/** Grantable settings sub-sections. Billing / Danger / Team access are
 *  hard-coded and don't appear here. */
export interface SettingsSectionDef {
  key: 'brand' | 'membership' | 'hours' | 'enquiries' | 'integrations'
  label: string
  permission: Permission
}

export const SETTINGS_PERMISSIONS: SettingsSectionDef[] = [
  { key: 'brand', label: 'Club & brand', permission: 'settings:brand' },
  { key: 'membership', label: 'Membership types', permission: 'settings:membership' },
  { key: 'hours', label: 'Opening hours', permission: 'settings:hours' },
  { key: 'enquiries', label: 'Enquiries', permission: 'settings:enquiries' },
  { key: 'integrations', label: 'Integrations', permission: 'settings:integrations' },
]

/** Admin-UI state for one section row — `access` / `edit` / PII flags. */
export interface SectionToggleState {
  access: boolean
  edit: boolean
  /** Only populated for the `members` section — subtoggle for PII access. */
  pii?: boolean
}

export type SectionToggleMap = Record<SectionKey, SectionToggleState>

/** Convert the admin UI's checkbox state → the canonical `permissions[]`
 *  array we POST to the backend. Always includes `dashboard:view` since every
 *  team member sees the dashboard. */
export function toggleStateToPermissions(
  sections: SectionToggleMap,
  settings: Partial<Record<SettingsSectionDef['key'], boolean>> = {},
): string[] {
  const out = new Set<string>(['dashboard:view'])

  for (const section of SECTIONS) {
    const state = sections[section.key]
    if (!state || !state.access) continue
    out.add(section.access)
    section.alsoAccess?.forEach((p) => out.add(p))
    if (section.key === 'members' && state.pii) out.add(SECTION_PII_PERMISSION)
    if (state.edit) {
      out.add(section.edit)
      section.alsoEdit?.forEach((p) => out.add(p))
    }
  }

  for (const s of SETTINGS_PERMISSIONS) {
    if (settings[s.key]) out.add(s.permission)
  }

  return Array.from(out)
}

/** Reverse of `toggleStateToPermissions` — derive checkbox state from an
 *  existing permissions array. Used when prefilling the edit drawer. */
export function permissionsToToggleState(perms: readonly string[]): {
  sections: SectionToggleMap
  settings: Record<SettingsSectionDef['key'], boolean>
} {
  const set = new Set(perms)
  const sections = {} as SectionToggleMap
  for (const section of SECTIONS) {
    sections[section.key] = {
      access: set.has(section.access),
      edit: set.has(section.edit),
      ...(section.key === 'members' ? { pii: set.has(SECTION_PII_PERMISSION) } : {}),
    }
  }
  const settings = {} as Record<SettingsSectionDef['key'], boolean>
  for (const s of SETTINGS_PERMISSIONS) {
    settings[s.key] = set.has(s.permission)
  }
  return { sections, settings }
}

/** Convenience presets — brief 94 §2.3. Not stored by the backend; purely a
 *  UX helper that pre-fills the checkbox grid before send. */
export interface PermissionPreset {
  key: 'custom' | 'membership_officer' | 'content_editor' | 'treasurer' | 'selector' | 'coach' | 'committee'
  label: string
  description: string
  build(): { sections: SectionToggleMap; settings: Record<SettingsSectionDef['key'], boolean> }
}

function blankState(): { sections: SectionToggleMap; settings: Record<SettingsSectionDef['key'], boolean> } {
  const sections = {} as SectionToggleMap
  for (const s of SECTIONS) {
    sections[s.key] = { access: false, edit: false, ...(s.key === 'members' ? { pii: false } : {}) }
  }
  const settings = {} as Record<SettingsSectionDef['key'], boolean>
  for (const s of SETTINGS_PERMISSIONS) settings[s.key] = false
  return { sections, settings }
}

function set(state: ReturnType<typeof blankState>, key: SectionKey, cfg: Partial<SectionToggleState>): ReturnType<typeof blankState> {
  Object.assign(state.sections[key], cfg)
  return state
}

export const PRESETS: PermissionPreset[] = [
  {
    key: 'custom',
    label: 'Custom',
    description: 'Start empty and tick what they need.',
    build: () => blankState(),
  },
  {
    key: 'membership_officer',
    label: 'Membership officer',
    description: 'Members, applications, enquiries, communications.',
    build: () => {
      const s = blankState()
      set(s, 'members', { access: true, edit: true, pii: true })
      set(s, 'applications', { access: true, edit: true })
      set(s, 'enquiries', { access: true, edit: true })
      set(s, 'communications', { access: true, edit: true })
      s.settings.membership = true
      return s
    },
  },
  {
    key: 'content_editor',
    label: 'Content editor',
    description: 'Website + events + honour board + communications. No member PII.',
    build: () => {
      const s = blankState()
      set(s, 'website', { access: true, edit: true })
      set(s, 'events', { access: true, edit: true })
      set(s, 'honour_board', { access: true, edit: true })
      set(s, 'communications', { access: true, edit: true })
      set(s, 'enquiries', { access: true, edit: true })
      s.settings.brand = true
      s.settings.hours = true
      return s
    },
  },
  {
    key: 'treasurer',
    label: 'Treasurer',
    description: 'Members (read + record payments), applications (read).',
    build: () => {
      const s = blankState()
      set(s, 'members', { access: true, edit: false, pii: true })
      set(s, 'applications', { access: true, edit: false })
      return s
    },
  },
  {
    key: 'selector',
    label: 'Selector',
    description: 'Team selections (edit). Members list (no PII). Events (read).',
    build: () => {
      const s = blankState()
      set(s, 'members', { access: true, edit: false, pii: false })
      set(s, 'events', { access: true, edit: false })
      set(s, 'team_selections', { access: true, edit: true })
      return s
    },
  },
  {
    key: 'coach',
    label: 'Coach',
    description: 'Members list (no PII). Events + team selections (read). Communications.',
    build: () => {
      const s = blankState()
      set(s, 'members', { access: true, edit: false, pii: false })
      set(s, 'events', { access: true, edit: false })
      set(s, 'team_selections', { access: true, edit: false })
      set(s, 'communications', { access: true, edit: true })
      return s
    },
  },
  {
    key: 'committee',
    label: 'Committee',
    description: 'Read-only across every section.',
    build: () => {
      const s = blankState()
      for (const section of SECTIONS) {
        set(s, section.key, { access: true, edit: false, ...(section.key === 'members' ? { pii: false } : {}) })
      }
      return s
    },
  },
]

/** Match an existing permissions array against the presets. Returns the
 *  preset key whose build() produces an identical set, or `'custom'` when
 *  nothing matches. Used in the edit drawer to show the current label. */
export function matchPreset(perms: readonly string[]): PermissionPreset['key'] {
  const target = new Set(perms)
  for (const preset of PRESETS) {
    if (preset.key === 'custom') continue
    const builtPerms = toggleStateToPermissions(preset.build().sections, preset.build().settings)
    if (builtPerms.length !== target.size) continue
    if (builtPerms.every((p) => target.has(p))) return preset.key
  }
  return 'custom'
}
