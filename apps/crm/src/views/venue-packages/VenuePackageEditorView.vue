<script setup lang="ts">
/**
 * Venue package editor — create + edit modes.
 *
 * Two routes drive this view:
 *   /crm/venue-packages/new   → create mode, empty form
 *   /crm/venue-packages/:id   → edit mode, hydrated from the server
 *
 * The form carries whole package shape in memory (identity + pricing +
 * slot list + addon list). Save goes through POST on create, nested
 * PATCH on edit — the backend handles the slot/addon diff by `id`
 * presence (brief 73 §4).
 *
 * Dollar inputs: admins type dollars, the form stores cents on the
 * wire. `100` × 100 → `10000` cents round-trip.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClubStore } from '@/stores/club'
import { useToast } from '@/composables/useToast'
import {
  venuePackages as venuePackagesApi,
  ApiError,
  type VenuePackage,
  type VenueSlot,
  type VenueAddon,
} from '@torny/api-client'
import HeroImageUploader from './HeroImageUploader.vue'

const route = useRoute()
const router = useRouter()
const clubStore = useClubStore()
const toast = useToast()

const packageIdParam = computed(() => {
  const raw = route.params.id
  if (typeof raw !== 'string') return null
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? null : parsed
})
const isCreateMode = computed(() => packageIdParam.value == null)

// ── Form state ───────────────────────────────────────────────
interface SlotForm {
  id?: number
  label: string
  sub: string
  price_dollars: string            // admins type dollars — convert on save
  duration_hours: string
  default_start_time: string
  is_disabled: boolean
}

interface AddonForm {
  id?: number
  name: string
  description: string
  price_dollars: string
  price_suffix: string
  countable: boolean
  default_quantity: string
  default_selected: boolean
}

interface PackageForm {
  name: string
  slug: string
  sub: string
  description: string
  hero_image_url: string | null
  hero_image_alt: string | null
  bond_dollars: string
  bond_label: string
  is_active: boolean
  slots: SlotForm[]
  addons: AddonForm[]
}

function emptyPackageForm(): PackageForm {
  return {
    name: '',
    slug: '',
    sub: '',
    description: '',
    hero_image_url: null,
    hero_image_alt: null,
    bond_dollars: '',
    bond_label: 'Refundable bond',
    is_active: true,
    slots: [],
    addons: [],
  }
}

const form = ref<PackageForm>(emptyPackageForm())
const loading = ref(false)
const saving = ref(false)
const notFound = ref(false)

// Hydrate from server when in edit mode
async function loadPackage(): Promise<void> {
  const cid = clubStore.current?.id
  const pid = packageIdParam.value
  if (typeof cid !== 'number' || pid == null) return
  loading.value = true
  notFound.value = false
  try {
    const pkg = await venuePackagesApi.get(cid, pid)
    hydrateFromServer(pkg)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound.value = true
    } else {
      toast.error(err instanceof ApiError ? err.message : 'Could not load package.')
      notFound.value = true
    }
  } finally {
    loading.value = false
  }
}

function hydrateFromServer(pkg: VenuePackage): void {
  form.value = {
    name: pkg.name,
    slug: pkg.slug,
    sub: pkg.sub ?? '',
    description: pkg.description ?? '',
    hero_image_url: pkg.hero_image_url,
    hero_image_alt: pkg.hero_image_alt,
    bond_dollars: pkg.bond_cents > 0 ? String(pkg.bond_cents / 100) : '',
    bond_label: pkg.bond_label ?? 'Refundable bond',
    is_active: pkg.is_active,
    slots: pkg.slots.map((s) => ({
      id: s.id,
      label: s.label,
      sub: s.sub ?? '',
      price_dollars: String((s.price_cents ?? 0) / 100),
      duration_hours: s.duration_hours != null ? String(s.duration_hours) : '',
      default_start_time: s.default_start_time ?? '',
      is_disabled: s.is_disabled ?? false,
    })),
    addons: pkg.addons.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? '',
      price_dollars: String((a.price_cents ?? 0) / 100),
      price_suffix: a.price_suffix ?? '',
      countable: a.countable ?? false,
      default_quantity: a.default_quantity != null ? String(a.default_quantity) : '',
      default_selected: a.default_selected ?? false,
    })),
  }
}

onMounted(() => {
  if (!isCreateMode.value) void loadPackage()
})
watch(() => clubStore.current?.id, () => { if (!isCreateMode.value) void loadPackage() })
watch(packageIdParam, () => { if (!isCreateMode.value) void loadPackage() })

// ── Slot + addon helpers ──────────────────────────────────────
function addSlot(): void {
  form.value.slots.push({
    label: '',
    sub: '',
    price_dollars: '',
    duration_hours: '',
    default_start_time: '',
    is_disabled: false,
  })
}

function removeSlot(idx: number): void {
  form.value.slots.splice(idx, 1)
}

function addAddon(): void {
  form.value.addons.push({
    name: '',
    description: '',
    price_dollars: '',
    price_suffix: '',
    countable: false,
    default_quantity: '',
    default_selected: false,
  })
}

function removeAddon(idx: number): void {
  form.value.addons.splice(idx, 1)
}

// ── Serialise + save ──────────────────────────────────────────
function toCents(dollars: string): number {
  const parsed = Number(dollars.replace(/[^0-9.-]/g, ''))
  if (Number.isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

function slotToWire(s: SlotForm): VenueSlot {
  const base: VenueSlot = {
    label: s.label.trim(),
    sub: s.sub.trim() || null,
    price_cents: toCents(s.price_dollars),
    duration_hours: s.duration_hours.trim() ? Number(s.duration_hours) : null,
    default_start_time: s.default_start_time.trim() || null,
    is_disabled: s.is_disabled,
  }
  if (s.id != null) base.id = s.id
  return base
}

function addonToWire(a: AddonForm): VenueAddon {
  const base: VenueAddon = {
    name: a.name.trim(),
    description: a.description.trim() || null,
    price_cents: toCents(a.price_dollars),
    price_suffix: a.price_suffix.trim() || null,
    countable: a.countable,
    default_quantity: a.default_quantity.trim() ? Number(a.default_quantity) : null,
    default_selected: a.default_selected,
  }
  if (a.id != null) base.id = a.id
  return base
}

const canSave = computed(() =>
  form.value.name.trim().length > 0 && !saving.value,
)

async function save(): Promise<void> {
  const cid = clubStore.current?.id
  if (typeof cid !== 'number' || !canSave.value) return
  saving.value = true
  try {
    const body = {
      name: form.value.name.trim(),
      slug: form.value.slug.trim() || undefined,
      sub: form.value.sub.trim() || null,
      description: form.value.description.trim() || null,
      hero_image_url: form.value.hero_image_url,
      hero_image_alt: form.value.hero_image_alt,
      bond_cents: form.value.bond_dollars.trim() ? toCents(form.value.bond_dollars) : 0,
      bond_label: form.value.bond_label.trim() || null,
      is_active: form.value.is_active,
      slots: form.value.slots.map(slotToWire),
      addons: form.value.addons.map(addonToWire),
    }
    if (isCreateMode.value) {
      const created = await venuePackagesApi.create(cid, body)
      toast.success('Package created.')
      router.replace(`/crm/venue-packages/${created.id}`)
    } else {
      const updated = await venuePackagesApi.update(cid, packageIdParam.value!, body)
      hydrateFromServer(updated)
      toast.success('Package saved.')
    }
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not save package.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="pe">
    <header class="pe__head">
      <RouterLink to="/crm/venue-packages" class="back">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5l-5 5 5 5" />
        </svg>
        <span>All packages</span>
      </RouterLink>
      <div class="pe__title-row">
        <h1 class="pe__title">
          {{ isCreateMode ? 'New package' : form.name || 'Edit package' }}
        </h1>
      </div>
      <p class="pe__sub">
        {{ isCreateMode
          ? 'Create a bookable package — slots, add-ons, and bond.'
          : 'Edit the identity, pricing, slots, and add-ons for this package.' }}
      </p>
    </header>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="notFound" class="empty">
      <div class="empty__title">Package not found</div>
      <RouterLink to="/crm/venue-packages" class="btn btn--ghost">Back to packages</RouterLink>
    </div>

    <form v-else class="pe__form" @submit.prevent="save">
      <!-- Identity -->
      <section class="card">
        <h2 class="card__title">Identity</h2>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Package name</span>
            <input v-model="form.name" type="text" maxlength="120" placeholder="The clubhouse" required />
          </label>
          <label class="field">
            <span class="field__label">Slug <em class="field__optional">(auto)</em></span>
            <input v-model="form.slug" type="text" maxlength="80" placeholder="the-clubhouse" />
          </label>
        </div>
        <label class="field">
          <span class="field__label">Sub-line (short description)</span>
          <input v-model="form.sub" type="text" placeholder="Timber-lined main room · seated 80" />
        </label>
        <label class="field">
          <span class="field__label">Description</span>
          <textarea v-model="form.description" rows="3" placeholder="Oak-lined ceiling, long tables, bar access." />
        </label>
        <div class="field">
          <span class="field__label">Hero image</span>
          <HeroImageUploader
            :package-id="packageIdParam"
            :model-value="form.hero_image_url"
            :alt="form.hero_image_alt"
            :disabled="isCreateMode"
            @update:model-value="(url) => form.hero_image_url = url"
            @update:alt="(alt) => form.hero_image_alt = alt"
          />
          <span v-if="isCreateMode" class="field__hint">
            Save the package first — hero upload needs a saved package to attach to.
          </span>
        </div>
      </section>

      <!-- Pricing -->
      <section class="card">
        <h2 class="card__title">Pricing</h2>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Bond amount</span>
            <div class="field__input-row">
              <span class="field__prefix">$</span>
              <input v-model="form.bond_dollars" type="text" inputmode="decimal" placeholder="300" />
            </div>
            <span class="field__hint">Refundable bond added to every booking. Leave blank for no bond.</span>
          </label>
          <label class="field">
            <span class="field__label">Bond label</span>
            <input v-model="form.bond_label" type="text" placeholder="Refundable bond" />
          </label>
        </div>
      </section>

      <!-- Slots -->
      <section class="card">
        <div class="card__head">
          <h2 class="card__title">Slots</h2>
          <button type="button" class="btn btn--ghost btn--sm" @click="addSlot">+ Add slot</button>
        </div>
        <p v-if="form.slots.length === 0" class="card__empty">
          No slots yet — add one so customers can pick a time.
        </p>
        <ol v-else class="rows">
          <li v-for="(slot, idx) in form.slots" :key="idx" class="row">
            <div class="row__head">
              <div class="row__num">{{ idx + 1 }}</div>
              <button type="button" class="row__remove" :aria-label="`Remove slot ${idx + 1}`" @click="removeSlot(idx)">
                Remove slot
              </button>
            </div>
            <div class="field-row">
              <label class="field">
                <span class="field__label">Slot label</span>
                <input v-model="slot.label" type="text" placeholder="Morning · 9am – 1pm" required />
              </label>
              <label class="field">
                <span class="field__label">Sub-line</span>
                <input v-model="slot.sub" type="text" placeholder="4 hours · $720" />
              </label>
            </div>
            <div class="field-row">
              <label class="field">
                <span class="field__label">Slot price</span>
                <div class="field__input-row">
                  <span class="field__prefix">$</span>
                  <input v-model="slot.price_dollars" type="text" inputmode="decimal" placeholder="720" required />
                </div>
              </label>
              <label class="field">
                <span class="field__label">Duration (hours)</span>
                <input v-model="slot.duration_hours" type="text" inputmode="decimal" placeholder="4" />
              </label>
              <label class="field">
                <span class="field__label">Default start time</span>
                <input v-model="slot.default_start_time" type="text" placeholder="09:00" pattern="^\d{2}:\d{2}$" />
              </label>
            </div>
          </li>
        </ol>
      </section>

      <!-- Addons -->
      <section class="card">
        <div class="card__head">
          <h2 class="card__title">Add-ons</h2>
          <button type="button" class="btn btn--ghost btn--sm" @click="addAddon">+ Add add-on</button>
        </div>
        <p v-if="form.addons.length === 0" class="card__empty">
          Add-ons are optional extras customers can tick on top of the base slot.
        </p>
        <ol v-else class="rows">
          <li v-for="(addon, idx) in form.addons" :key="idx" class="row">
            <div class="row__head">
              <div class="row__num">{{ idx + 1 }}</div>
              <button type="button" class="row__remove" :aria-label="`Remove add-on ${idx + 1}`" @click="removeAddon(idx)">
                Remove add-on
              </button>
            </div>
            <div class="field-row">
              <label class="field">
                <span class="field__label">Add-on name</span>
                <input v-model="addon.name" type="text" placeholder="Grazing platters" required />
              </label>
              <label class="field">
                <span class="field__label">Add-on price</span>
                <div class="field__input-row">
                  <span class="field__prefix">$</span>
                  <input v-model="addon.price_dollars" type="text" inputmode="decimal" placeholder="85" required />
                </div>
              </label>
            </div>
            <label class="field">
              <span class="field__label">Description</span>
              <input v-model="addon.description" type="text" placeholder="Locally sourced, catered by Naenae Cafe" />
            </label>
            <div class="field-row">
              <label class="field">
                <span class="field__label">Price suffix</span>
                <input v-model="addon.price_suffix" type="text" placeholder="/ platter" />
              </label>
              <label class="field">
                <span class="field__label">Default quantity</span>
                <input v-model="addon.default_quantity" type="text" inputmode="numeric" placeholder="6" />
              </label>
            </div>
            <div class="row__toggles">
              <label class="checkbox">
                <input v-model="addon.countable" type="checkbox" />
                <span>Countable (customer picks quantity)</span>
              </label>
              <label class="checkbox">
                <input v-model="addon.default_selected" type="checkbox" />
                <span>Pre-selected on booking form</span>
              </label>
            </div>
          </li>
        </ol>
      </section>

      <!-- Save bar -->
      <div class="pe__actions">
        <RouterLink to="/crm/venue-packages" class="btn btn--ghost">Cancel</RouterLink>
        <button type="submit" class="btn btn--ink" :disabled="!canSave">
          {{ saving ? 'Saving…' : isCreateMode ? 'Create package' : 'Save package' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.pe { max-width: 1280px; display: flex; flex-direction: column; gap: 24px; }

.pe__head { display: flex; flex-direction: column; gap: 0; }
.back { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-fog); text-decoration: none; width: fit-content; }
.back:hover { color: var(--color-ink); }
.pe__title-row { display: flex; align-items: center; gap: 12px; margin: 10px 0 6px; }
.pe__title { font-family: var(--font-display); font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--color-ink); margin: 0; line-height: 1.05; }
.pe__sub { font-family: var(--font-body); font-size: 14px; color: var(--color-fog); margin: 0; }

.empty { padding: 48px; text-align: center; font-family: var(--font-body); color: var(--color-fog); background: #fff; border: 1px dashed var(--color-hairline); border-radius: 14px; }
.empty__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-ink); margin-bottom: 16px; }

.pe__form { display: flex; flex-direction: column; gap: 16px; }

.card { background: #fff; border: 1px solid var(--color-hairline); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.card__head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.card__title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-ink); margin: 0; }
.card__empty { font-family: var(--font-body); font-size: 13px; color: var(--color-fog); margin: 0; padding: 12px; background: var(--color-surface); border-radius: 8px; }

.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-family: var(--font-body); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-fog); }
.field__optional { font-weight: 400; letter-spacing: normal; text-transform: lowercase; opacity: 0.7; }
.field__hint { font-family: var(--font-body); font-size: 12px; color: var(--color-fog); margin-top: 2px; line-height: 1.4; }
.field input, .field textarea, .field select { padding: 10px 12px; border: 1px solid var(--color-hairline); border-radius: 10px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); background: #fff; }
.field input:focus, .field textarea:focus, .field select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__input-row { display: flex; align-items: center; gap: 0; background: #fff; border: 1px solid var(--color-hairline); border-radius: 10px; }
.field__input-row:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.field__input-row input { border: 0; flex: 1; }
.field__input-row input:focus { box-shadow: none; }
.field__prefix { padding: 0 12px; font-family: var(--font-body); font-size: 14px; color: var(--color-fog); }

.rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
.row { background: var(--color-surface); border: 1px solid var(--color-hairline); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.row__head { display: flex; justify-content: space-between; align-items: center; }
.row__num { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: var(--color-fog); background: #fff; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--color-hairline); }
.row__remove { background: transparent; border: 0; color: var(--color-fog); font-family: var(--font-body); font-size: 12px; cursor: pointer; }
.row__remove:hover { color: var(--color-danger); text-decoration: underline; }
.row__toggles { display: flex; gap: 24px; flex-wrap: wrap; padding-top: 4px; }

.checkbox { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body); font-size: 13px; color: var(--color-ink); cursor: pointer; }
.checkbox input { width: auto; }

.btn { padding: 10px 18px; border: none; border-radius: 999px; font-family: var(--font-body); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
.btn--sm { padding: 7px 14px; font-size: 12px; }
.btn--ink { background: var(--color-ink); color: #fff; }
.btn--ink:hover:not(:disabled) { background: var(--color-graphite); }
.btn--ink:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: #fff; color: var(--color-ink); border: 1px solid var(--color-hairline); }
.btn--ghost:hover { background: var(--color-surface); }

.pe__actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 4px; position: sticky; bottom: 16px; }

@media (max-width: 767px) {
  .field-row { grid-template-columns: 1fr; }
  .row__toggles { gap: 12px; }
}
</style>
