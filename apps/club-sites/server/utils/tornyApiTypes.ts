/**
 * Types referenced by the pure helpers in tornyApiHelpers.ts. Kept in a
 * separate file so the helpers can be imported by test code without
 * pulling the Nuxt `#imports` graph that tornyApi.ts depends on.
 *
 * tornyApi.ts re-exports these for backward compatibility; this file is
 * the source of truth.
 */

export type FacetInputType =
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'checkboxes'
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'boolean'

export interface FacetOption {
  value: string
  label: string
}

export interface CustomFacet {
  facet_id: number
  slug: string
  label: string
  helper_text: string | null
  input_type: FacetInputType
  options: FacetOption[]
  required: boolean
  searchable: boolean
  section_key: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}
