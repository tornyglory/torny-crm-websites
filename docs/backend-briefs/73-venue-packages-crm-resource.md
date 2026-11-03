# Venue packages — CRM resource + club venue settings

**Feature:** admins manage venue packages (slots + add-ons + images) through a dedicated CRM screen at `/crm/venue-packages`, with a club-level settings page controlling the deposit %, Torny platform fee %, and balance-due offset. Replaces the current situation where package data is edited as block props inside `WebsiteEditorView` and lives inside the published page JSON — moving it to a first-class resource that every venue block (`venueBooking`, `venuePackages`, `venueSpaces`) reads from.

**Status:** backend not started. Brief 62 (venue bookings resource) sketched the schema and listed per-slot / per-addon CRUD endpoints. This brief **supersedes brief 62 §3's "Package / slot / addon CRUD" subsection** with the final shape — nested PATCH on the package instead of separate endpoints, plus the club-level settings resource, platform fee math, image wiring, and migration from the current block-props world. FE will build the CRM screen in parallel from the shapes below.

**Related briefs:**
- **Brief 62** (venue bookings) — this brief extends the CRM endpoints section. Public submit flow, state transitions, booking email flavours all stay in 62.
- **Brief 72** (Stripe Connect for venue deposits) — reads `venue_platform_fee_percent` from here to set `application_fee_amount` on each PaymentIntent.
- **Brief 60** (page-slug allowlist on media uploads) — same media pipeline reused for package hero images.
- **Brief 44** (venue-hire blocks) — the `venueBooking`/`venuePackages`/`venueSpaces` blocks become fetch-driven once this ships.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

CRM endpoints: owner or admin on `club_members` (brief 39 permission: `venue:manage`). Public endpoints: no auth, rate-limited by IP.

---

## 1. Supersedes + schema deltas

### 1a. Supersedes

Brief 62 §3 listed:

```
POST   /clubs/:cid/venue-packages/:packageId/slots
PATCH  /clubs/:cid/venue-slots/:slotId
DELETE /clubs/:cid/venue-slots/:slotId
POST   /clubs/:cid/venue-packages/:packageId/addons
PATCH  /clubs/:cid/venue-addons/:addonId
DELETE /clubs/:cid/venue-addons/:addonId
```

**Drop these.** Replace with the nested PATCH on the package (§3b below). Slots + addon lists are small (<10 typical, hard-capped at 20) and always edited together — one request per save is cleaner for the FE and keeps the backend simpler (no partial-save race conditions).

### 1b. Schema deltas on top of brief 62

**New columns on `venue_packages`:**
```
hero_image_url   VARCHAR  NULL          -- package hero shown on the CRM list + inside the booking wizard
hero_image_alt   VARCHAR  NULL
description      TEXT     NULL          -- long-form description shown on the showcase block
```

**New table `club_venue_settings`:**
```
club_id                       INTEGER   PK   REFERENCES clubs(id)
deposit_percent               INTEGER   NOT NULL  DEFAULT 15     -- admin-adjustable 0..100
balance_due_days_before       INTEGER   NOT NULL  DEFAULT 14     -- admin-adjustable 0..60
platform_fee_percent          NUMERIC(5,2) NOT NULL DEFAULT 5.00 -- platform-controlled, admin read-only
is_active                     BOOLEAN   NOT NULL  DEFAULT TRUE   -- turn off public submits globally
stripe_account_status         VARCHAR   NULL                     -- 'none' | 'onboarding' | 'ready' | 'restricted' — mirrored from brief 72
updated_at                    TIMESTAMP NOT NULL  DEFAULT NOW()
```

Seed one row per club on first read (lazy upsert) so admins don't need to click "enable venue hire" before packages become editable.

### 1c. Addendum to `venue_bookings` for platform fee

Add two columns:
```
platform_fee_cents            INTEGER   NOT NULL  DEFAULT 0      -- Torny's cut at submit time (snapshot of the % × total)
platform_fee_percent_snapshot NUMERIC(5,2) NOT NULL              -- what the % was when this booking was created
```

Reasoning: the % is global today but may become per-club (e.g. volume discounts) later. Snapshotting on the booking means historical bookings don't rewrite when a club's % changes.

---

## 2. CRM endpoints — packages

### `GET /clubs/:cid/venue-packages`

List all packages for the club, including archived rows. Used by the CRM list screen.

**Query params:**
- `status` (optional) — `all | active | archived`. Default `all`. The CRM renders a filter chip row that maps to this.
- `search` (optional) — substring match on `name` / `slug` / `description`.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "packages": [
      {
        "id": 12,
        "slug": "the-clubhouse",
        "name": "The clubhouse",
        "sub": "Timber-lined main room · seated 80 · standing 140",
        "description": "Our main indoor space. Oak-lined ceiling, long tables, bar access.",
        "hero_image_url": "https://imagedelivery.net/.../clubhouse-hero.jpg",
        "hero_image_alt": "The clubhouse interior with long tables set for a wedding",
        "bond_cents": 30000,
        "bond_label": "Refundable bond",
        "is_active": true,
        "display_order": 10,
        "slot_count": 4,
        "addon_count": 3,
        "last_booked_at": "2026-11-01T03:14:21Z",  // nullable — populated once brief 62 ships
        "created_at": "2026-10-15T22:14:03Z",
        "updated_at": "2026-10-28T09:40:00Z"
      }
    ],
    "counts": { "all": 3, "active": 2, "archived": 1 }
  }
}
```

### `GET /clubs/:cid/venue-packages/:packageId`

Full detail including slots + addons. Used by the editor screen.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "id": 12,
    "slug": "the-clubhouse",
    "name": "The clubhouse",
    "sub": "Timber-lined main room · seated 80 · standing 140",
    "description": "Our main indoor space.",
    "hero_image_url": "https://imagedelivery.net/.../clubhouse-hero.jpg",
    "hero_image_alt": "...",
    "bond_cents": 30000,
    "bond_label": "Refundable bond",
    "is_active": true,
    "display_order": 10,
    "slots": [
      {
        "id": 101,
        "label": "Morning · 9am – 1pm",
        "sub": "4 hours · $720",
        "price_cents": 72000,
        "duration_hours": 4,
        "default_start_time": "09:00",
        "is_disabled": false,
        "display_order": 10
      }
    ],
    "addons": [
      {
        "id": 201,
        "name": "Grazing platters",
        "description": "Locally sourced, catered by Naenae Cafe · Serves 8 per platter",
        "price_cents": 8500,
        "price_suffix": "/ platter",
        "countable": true,
        "default_quantity": 6,
        "default_selected": true,
        "display_order": 10
      }
    ],
    "created_at": "2026-10-15T22:14:03Z",
    "updated_at": "2026-10-28T09:40:00Z"
  }
}
```

### `POST /clubs/:cid/venue-packages`

Create with nested slots + addons in one shot. `slug` is admin-authored but server auto-slugifies if omitted. Uniqueness is `(club_id, slug)`.

**Request:**
```jsonc
{
  "name": "The clubhouse",
  "slug": "the-clubhouse",                      // optional — server generates from name if omitted
  "sub": "Timber-lined main room",
  "description": "...",
  "hero_image_url": "https://imagedelivery.net/.../clubhouse.jpg",   // nullable
  "hero_image_alt": "...",
  "bond_cents": 30000,
  "bond_label": "Refundable bond",
  "display_order": 10,                           // optional — server appends to end if omitted
  "slots": [
    { "label": "Morning · 9am – 1pm", "sub": "4 hours · $720", "price_cents": 72000, "duration_hours": 4, "default_start_time": "09:00" }
  ],
  "addons": [
    { "name": "Grazing platters", "description": "...", "price_cents": 8500, "price_suffix": "/ platter", "countable": true, "default_quantity": 6, "default_selected": true }
  ]
}
```

**201 response:** the full package detail (same shape as GET). `is_active` defaults to `true`.

### `PATCH /clubs/:cid/venue-packages/:packageId`

Whole-shape replace. The entire `slots[]` + `addons[]` arrays are the new truth — server diffs against the stored rows:

- Slots/addons in the request with an existing `id` → UPDATE.
- Without `id` → INSERT.
- Stored slots/addons whose `id` isn't in the request → SOFT-delete (`is_disabled = true`) if referenced by any booking, else physical delete.

Reasons for nested-replace rather than diff-on-wire: admins only ever submit via the editor, which has the whole shape in memory. Keeps the FE from having to track dirty state per row.

**Request:** same shape as POST, with optional `id` on each slot/addon. Any field omitted at the top level is left unchanged (standard PATCH semantics).

**200 response:** the full package detail.

### `POST /clubs/:cid/venue-packages/:packageId/archive`

Soft-archive. Flips `is_active = false`. Package disappears from the public endpoint but stays in the CRM list under the "Archived" filter. Idempotent.

### `POST /clubs/:cid/venue-packages/:packageId/unarchive`

Reverses the above. Idempotent.

### `POST /clubs/:cid/venue-packages/reorder`

Admin drag-and-drop reorder on the list screen. Body: `{ order: [{ "id": 12, "display_order": 10 }, { "id": 15, "display_order": 20 }] }`. Server updates each row's `display_order` atomically. Any id not present in the request is left alone.

### Error codes (packages)

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_name` | Name blank or >120 chars |
| 400 | `bad_slug` | Slug fails `^[a-z0-9-]{1,80}$` |
| 400 | `slug_conflict` | Another active package on this club already uses this slug |
| 400 | `bad_bond` | Bond cents < 0 or > 100,000 |
| 400 | `too_many_slots` | More than 20 slots in one package |
| 400 | `too_many_addons` | More than 20 addons in one package |
| 400 | `bad_slot_price` | Slot `price_cents` < 100 or > 10,000,000 |
| 400 | `bad_addon_price` | Addon `price_cents` < 0 or > 10,000,000 |
| 404 | `not_found` | Package id doesn't exist on this club |

---

## 3. CRM endpoints — availability blocks

Per brief 62 §3; nothing changes here. Repeating for completeness:

```
GET    /clubs/:cid/venue-availability-blocks
POST   /clubs/:cid/venue-availability-blocks     // body: { starts_on, ends_on, package_id?, reason? }
DELETE /clubs/:cid/venue-availability-blocks/:id
```

CRM availability tab lists them in a timeline + lets admins add/remove.

---

## 4. CRM endpoints — club venue settings

### `GET /clubs/:cid/venue-settings`

Lazy-upserts if the row doesn't exist (returns the defaults).

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "deposit_percent": 15,
    "balance_due_days_before": 14,
    "platform_fee_percent": 5.00,     // read-only for admins
    "is_active": true,
    "stripe_account_status": "ready",
    "updated_at": "2026-10-28T09:40:00Z"
  }
}
```

### `PATCH /clubs/:cid/venue-settings`

Admin updates the writable fields.

**Request:**
```jsonc
{
  "deposit_percent": 20,              // 0..100
  "balance_due_days_before": 21,      // 0..60
  "is_active": true
}
```

**200 response:** full settings (same shape as GET).

**Errors:**
| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_deposit_percent` | Not integer 0..100 |
| 400 | `bad_due_days` | Not integer 0..60 |
| 400 | `platform_fee_readonly` | Admin tried to PATCH `platform_fee_percent`. Return the current value in the error body. |

**`platform_fee_percent` is platform-controlled.** Admins can read it (to understand what Torny takes), but can't change it via this endpoint. A separate platform-admin endpoint (brief TBD) handles rate changes if we ever need per-club rates.

---

## 5. Public endpoints

### `GET /public/clubs/:slug/venue-packages`

Already specified in brief 62 §2. Augmentation for this brief:

- Response now includes `settings`:
  ```jsonc
  {
    "data": {
      "packages": [ ... ],
      "settings": {
        "deposit_percent": 15,
        "balance_due_days_before": 14,
        "is_active": true
      }
    }
  }
  ```
- Only `is_active = true` packages are returned (archived ones excluded).
- Package list is sorted by `display_order`, then `name` as a tiebreaker.
- Hero image + description are included.
- `platform_fee_percent` is NOT returned on the public endpoint — customers don't need to see it.

### `GET /public/clubs/:slug/venue-packages/:packageSlug/availability`

Unchanged from brief 62 §2.

---

## 6. Platform fee — server-authoritative math

Every `venue_bookings` row gets its platform fee computed server-side at submit time:

```js
const totalCents = slotPriceCents + addonsTotalCents + bondCents
const feeCents   = Math.round(totalCents * (settings.platform_fee_percent / 100))
const depositCents = Math.round(totalCents * (settings.deposit_percent / 100))

// Written to the booking:
booking.total_cents                   = totalCents
booking.deposit_cents                 = depositCents
booking.balance_cents                 = totalCents - depositCents
booking.platform_fee_cents            = feeCents
booking.platform_fee_percent_snapshot = settings.platform_fee_percent
```

**Rounding:** `Math.round` on the cent value. If a $1,000 booking is 5% platform fee, that's $50 exactly, no rounding ambiguity. For odd amounts (e.g. $1,003.77) → `.rounding half-up` on cents. Document the rule so the CRM can display matching numbers.

**Bond note:** the bond is included in the `total_cents` for fee math because the Torny platform fee is on the gross booking value, even though the bond is refundable. If this is wrong for your business logic (fee only on the hire + addons), flip the base of the calculation and update this brief before deploying — but confirm with Nev first.

**Stripe destination charge (brief 72 §3 pattern):**
```js
stripe.paymentIntents.create({
  amount: booking.deposit_cents,
  currency: 'nzd',
  application_fee_amount: Math.round(booking.deposit_cents * (settings.platform_fee_percent / 100)),
  on_behalf_of: club.stripe_account_id,
  transfer_data: { destination: club.stripe_account_id },
  metadata: { booking_id, booking_ref, club_id }
})
```

The `application_fee_amount` on the deposit charge is **5% of the deposit** (not 5% of the total), because the balance charge will carry its own 5%. Net result: Torny takes 5% of what actually flows through Stripe, per transaction.

**Refunds:** when `/venue-bookings/:id/refund` fires, the Stripe refund includes `refund_application_fee: true` so Torny proportionally returns its fee for the refunded portion.

---

## 7. Images

Hero images use the existing media pipeline (brief 60: "page-slug allowlist on media uploads"):

- Admin clicks "Upload hero" in the CRM editor.
- CRM calls `POST /clubs/:cid/media/upload-url` with `kind: 'venue_package_hero'` and `package_id: 12`.
- Backend returns a signed Cloudflare Images upload URL + the eventual delivery URL.
- Admin uploads directly to Cloudflare; CRM then calls `PATCH /clubs/:cid/venue-packages/12` with `hero_image_url` set to the delivery URL.

**Allowlist delta on brief 60:** add `venue_package_hero` as a valid `kind`. Images are 2048px max side, served through Cloudflare's variants (`public` for cards, `hero` for the full width).

---

## 8. Migration from block JSON

**User-driven, no server job.**

When an admin lands on `/crm/venue-packages` and the server returns `packages: []`:

1. CRM calls `GET /clubs/:cid/pages` and scans published pages for any block of `type: 'venueBooking'`.
2. If found, CRM parses the block's `props.packages[]` client-side and shows a one-time card: *"Found 3 packages on your /venue-hire/book page — import them?"*
3. On click, CRM iterates the local packages and POSTs each to `POST /clubs/:cid/venue-packages`.
4. Server returns 201 for each. Standard `slug_conflict` 400 if a package with the same slug already exists.

**Backend has nothing to do for this migration** — it just serves the normal POST endpoint. The CRM owns the one-time ingestion flow.

**Follow-up:** once a club has imported, the `venueBooking` block switches to fetch-mode (reads from `/public/clubs/:slug/venue-packages` instead of its own props). Props-mode stays available behind a flag for clubs that want to keep their custom overrides — stub this but don't ship it on day one.

---

## 9. Access control

| Action | Required role on `club_members` |
|---|---|
| `GET /clubs/:cid/venue-packages` (list) | `owner`, `admin`, `committee` |
| `GET /clubs/:cid/venue-packages/:id` (detail) | `owner`, `admin`, `committee` |
| `POST / PATCH / archive / unarchive / reorder` | `owner`, `admin` |
| `GET /clubs/:cid/venue-settings` | `owner`, `admin`, `committee` |
| `PATCH /clubs/:cid/venue-settings` | `owner`, `admin` |
| Availability block CRUD | `owner`, `admin` |

**Reasoning:** committee members can view the setup (to understand what the club offers) but only admins + owners can change money-impacting fields. Matches the pattern on membership tiers (brief 36).

---

## 10. CRM screen — brief for the FE engineer

(For reference while the backend builds. FE implementation lives in `apps/crm/src/views/venue-packages/`.)

### List screen `/crm/venue-packages`

Sidebar item under "Content" group (not Settings — it's a workflow). Shows:

- Hero row with title, subtitle, "+ New package" primary CTA, "Edit club settings" secondary CTA, filter chips (`All` / `Active` / `Archived`).
- One card per package: hero image thumbnail, name, slug (mono), slot count · addon count · bond badge, "Last booked X ago" (grey when `last_booked_at = null`), overflow menu (Duplicate / Archive / Delete).
- Drag handle for reorder → fires `POST /reorder` on drop.
- Empty state with the migration prompt (§8) when `packages: []` and the admin has a venue block published.

### Editor screen `/crm/venue-packages/:id`

Full-page editor. Four sections, each collapsed into its own card:

1. **Identity** — name, slug (auto-generated, admin-editable), sub-line, description, hero image uploader, is_active toggle.
2. **Pricing** — bond_amount input, bond_label input. (Deposit % + platform fee shown read-only here as a "charged by Torny" preview line.)
3. **Slots** — ordered list, drag to reorder, "+ Add slot" button. Each slot inline-edits label / sub / price / duration / default_start_time / is_disabled.
4. **Add-ons** — ordered list, drag to reorder, "+ Add add-on" button. Each add-on inline-edits name / description / price / price_suffix / countable / default_quantity / default_selected.

Right rail: live preview of the package card as it'll render inside the booking wizard. Uses the same `VenueBookingBlock` component with props plumbed from the editor state.

### Availability screen `/crm/venue-packages/availability`

Timeline view with month-navigation. Admin drags across cells to create a block, picks "all packages" or a specific one, writes a reason.

### Settings screen `/crm/venue-packages/settings`

- Deposit % stepper (0..100 in 5% increments).
- Balance due offset (number of days before booking, 0..60).
- Is-active toggle (turns off public submits globally — venue booking block shows "temporarily unavailable" instead).
- Platform fee display (read-only): *"Torny collects 5% of every booking total. This fee goes toward hosting, payment processing, and ongoing development."*
- Stripe account status: badge mirroring `stripe_account_status`, with a "Connect Stripe" CTA when `none`.

---

## 11. Verification

- ✓ `GET /venue-packages` on an empty club → `{ packages: [], counts: { all: 0, ... } }`
- ✓ `POST /venue-packages` with valid shape → 201 + full detail
- ✓ `POST` with duplicate slug on same club → 400 `slug_conflict`
- ✓ `PATCH` with a slot `id` from a different package → 400 (or server rebuilds; either, document which)
- ✓ `PATCH` deletes a slot that's referenced by a booking → slot `is_disabled = true` instead of physical delete; booking's slot ref unchanged
- ✓ `POST /archive` → `is_active = false` + 204 or 200 echoing updated row
- ✓ `GET /public/.../venue-packages` → only active packages, no `platform_fee_percent` in payload
- ✓ Non-admin `PATCH` → 403
- ✓ Admin `PATCH` with `platform_fee_percent` in body → 400 `platform_fee_readonly`
- ✓ Fee math: $1000 booking × 15% deposit × 5% fee → `deposit_cents=15000`, `platform_fee_cents=5000`, Stripe PaymentIntent `application_fee_amount=750` (5% of the deposit)
- ✓ Refund fires with `refund_application_fee: true`
- ✓ Lazy-upsert on first GET of `/venue-settings`

---

## 12. Non-goals (v1)

- **No per-package deposit %.** All packages inherit the club-level setting. If a club wants "no deposit for small bookings" we'll add a per-package override in a follow-up.
- **No per-package fee %.** Torny's platform fee is global.
- **No image gallery.** One hero image per package. Multi-image gallery is a follow-up.
- **No slot-level availability.** Availability blocks apply to a whole package (or all packages). Per-slot blocking (e.g. "no evening slots on Mondays") is a follow-up.
- **No approvals.** Admin edits publish immediately; no workflow / draft state.
- **No archive history.** The archive is a soft delete, not an undo log. Un-archive restores the row as-is.
- **No per-day pricing.** Weekend vs. weekday pricing done via separate slots (admin creates "Weekend afternoon" and "Weekday afternoon" as different slot rows).

---

## 13. Frontend contract summary

`packages/api-client/src/resources/venuePackages.ts` (new) exports:

```ts
export interface VenuePackage { ... }           // GET detail shape
export interface VenuePackageListItem { ... }   // GET list row
export interface VenueSettings { ... }
export interface VenueSlotInput { ... }
export interface VenueAddonInput { ... }
export interface CreateVenuePackageInput { ... }
export interface UpdateVenuePackageInput { ... }

export const venuePackages = {
  list(clubId: number, params?: { status?, search? }): Promise<ListResponse>,
  get(clubId: number, packageId: number): Promise<VenuePackage>,
  create(clubId: number, input: CreateVenuePackageInput): Promise<VenuePackage>,
  update(clubId: number, packageId: number, input: UpdateVenuePackageInput): Promise<VenuePackage>,
  archive(clubId: number, packageId: number): Promise<void>,
  unarchive(clubId: number, packageId: number): Promise<void>,
  reorder(clubId: number, order: Array<{ id: number; display_order: number }>): Promise<void>,

  getSettings(clubId: number): Promise<VenueSettings>,
  updateSettings(clubId: number, input: Partial<VenueSettings>): Promise<VenueSettings>,

  listAvailability(clubId: number): Promise<AvailabilityBlock[]>,
  createAvailability(clubId: number, input): Promise<AvailabilityBlock>,
  deleteAvailability(clubId: number, id: number): Promise<void>,
}

export const publicVenuePackages = {
  list(slug: string): Promise<{ packages: PublicVenuePackage[]; settings: PublicVenueSettings }>,
  availability(slug: string, packageSlug: string, year: number, month: number): Promise<AvailabilityMap>,
}
```

Error codes land in a shared `VenuePackageErrorCode` union so the CRM can translate them to user-facing toasts.

---

## 14. Contact

Frontend: this working directory. Spec lives in `docs/backend-briefs/73-venue-packages-crm-resource.md`. Ping if the response shape needs tweaking before deploy — the CRM is being built in parallel with graceful fallbacks for the fields marked "nullable until this ships" (`last_booked_at`, `stripe_account_status`).
