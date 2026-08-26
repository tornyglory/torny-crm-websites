# Venue-Hire Marketing Blocks — Whitelist

**Feature:** whitelist three new block types (`venueHireHero`, `venueSpaces`, `venuePackages`) on the backend's page-layout validator. Same structural pattern as brief 43 (`peopleGrid` + gallery). All three are owner-authored marketing blocks — no data-hydration, no new endpoints.

**Status:** frontend shipped 2026-08-27. The published-blocks validator currently strips unknown types on save, so an owner adding any of these through the CRM Website editor won't have their changes persist until this brief lands. Existing whitelist infra from briefs 32 (`honourBoardSearch`), 34 (`eventsCalendar`), and 43 (`peopleGrid` + gallery) is the pattern to copy.

**Related briefs:**
- brief 16 (published block layouts) — the underlying `PATCH /clubs/:club_id/pages/:slug` endpoint that this brief extends.
- brief 43 — same shape; three new whitelist rows in `KNOWN_BLOCKS`.

**Not covered by this brief** (separate follow-up):
- The actual booking flow (calendar + slot picker + details form). These need real availability data + booking creation endpoints — see the "Future — brief 45" note at the bottom.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT. No new endpoints — just three additions to the validator behind the existing page-layout PATCH.

---

## Shared enum — `VenueTone`

All three blocks reuse the six-slug tone palette from brief 43 §1.2:

```
accent | ink | mint | tangerine | violet | sky
```

Unknown tone → 400 `bad_tone`. Consistent across every venue-hire block so the validator can share a single helper.

---

## 1. `venueHireHero` — split hero with feature card

### 1.1 Whitelist entry

```js
venueHireHero: {
  requiredProps: ['heading'],
  optionalProps: [
    'eyebrow', 'description', 'stats',
    'primaryCta', 'secondaryCta',
    'cardEyebrow', 'cardBadge', 'cardTone', 'cardImageUrl',
    'testimonial',
  ],
  propTypes: {
    eyebrow: 'string',           // max 120
    heading: 'string',           // max 200 (required; empty → 400 missing_heading)
    description: 'string',       // max 800
    stats: 'array',              // see §1.2
    primaryCta: 'object',        // see §1.3
    secondaryCta: 'object',      // see §1.3
    cardEyebrow: 'string',       // max 120
    cardBadge: 'string',         // max 60
    cardTone: 'string',          // VenueTone
    cardImageUrl: 'string',      // https URL, same validator as hero.imageUrl
    testimonial: 'object',       // see §1.4
  },
},
```

### 1.2 `stats[]` items

| Key | Type | Notes |
|---|---|---|
| `value` | `string` (required) | Max 12 chars — `"$40"`, `"140"`, `"12hr"` |
| `label` | `string` (required) | Max 60 chars |

Hard-cap **6 stats**. 7th entry → 400 `too_many_stats`.

### 1.3 `primaryCta` / `secondaryCta` shape

Both objects, both optional. If present:

| Key | Type | Notes |
|---|---|---|
| `label` | `string` (required within the object) | Max 60 chars |
| `href`  | `string` (required within the object) | URL — internal path or full https URL. Same validator as `hero.primaryCta.href` |

Empty `label` → treat the object as absent (frontend hides the CTA).

### 1.4 `testimonial` shape

| Key | Type | Notes |
|---|---|---|
| `quote`            | `string` (required within the object) | Max 400 chars |
| `authorName`       | `string` (required within the object) | Max 120 chars |
| `authorRole`       | `string` (optional)                   | Max 120 chars |
| `authorInitials`   | `string` (optional)                   | Max 4 chars   |
| `authorAvatarUrl`  | `string` (optional)                   | https URL     |

Empty `quote` → treat testimonial as absent.

### 1.5 Error codes

| HTTP | code | Cause |
|---|---|---|
| 400 | `missing_heading` | Root `heading` empty |
| 400 | `bad_tone` | `cardTone` not in the enum |
| 400 | `bad_url` | `cardImageUrl` / `primaryCta.href` / `secondaryCta.href` / `testimonial.authorAvatarUrl` doesn't parse |
| 400 | `too_many_stats` | > 6 stats |
| 400 | `bad_stat` | Empty `value` or `label` on a stat entry |

---

## 2. `venueSpaces` — grid of hire-able spaces

### 2.1 Whitelist entry

```js
venueSpaces: {
  requiredProps: [],
  optionalProps: ['eyebrow', 'heading', 'ctaLabel', 'ctaHref', 'spaces'],
  propTypes: {
    eyebrow: 'string',      // max 120
    heading: 'string',      // max 200
    ctaLabel: 'string',     // max 60
    ctaHref: 'string',      // URL
    spaces: 'array',        // see §2.2
  },
},
```

### 2.2 `spaces[]` items

| Key | Type | Notes |
|---|---|---|
| `name`         | `string` (required)  | Max 80 chars. Empty → 400 `bad_space_name` |
| `badge`        | `string` (optional)  | Max 40 chars |
| `tone`         | `string` (optional)  | VenueTone enum |
| `imageUrl`     | `string` (optional)  | https URL |
| `description`  | `string` (optional)  | Max 300 chars |
| `capacity`     | `string` (optional)  | Max 200 chars |
| `availability` | `string` (optional)  | Max 200 chars |
| `included`     | `string` (optional)  | Max 200 chars |
| `price`        | `string` (optional)  | Max 40 chars — `"$180"`, `"$1,600"` |
| `priceUnit`    | `string` (optional)  | Max 40 chars — `"/ half day"` |
| `ctaLabel`     | `string` (optional)  | Max 60 chars |
| `ctaHref`      | `string` (optional)  | URL |

Hard-cap **12 spaces**. 13th → 400 `too_many_spaces`.

### 2.3 Error codes

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_space_name` | Empty `name` on a space |
| 400 | `bad_tone` | Unknown tone |
| 400 | `bad_url` | Bad `imageUrl` / `ctaHref` on a space, or root `ctaHref` |
| 400 | `too_many_spaces` | > 12 spaces |

---

## 3. `venuePackages` — corporate tier packages

### 3.1 Whitelist entry

```js
venuePackages: {
  requiredProps: [],
  optionalProps: ['eyebrow', 'heading', 'description', 'packages', 'footer'],
  propTypes: {
    eyebrow: 'string',      // max 120
    heading: 'string',      // max 200
    description: 'string',  // max 600
    packages: 'array',      // see §3.2
    footer: 'object',       // see §3.3
  },
},
```

### 3.2 `packages[]` items

| Key | Type | Notes |
|---|---|---|
| `name`         | `string` (required)  | Max 80 chars. Empty → 400 `bad_package_name` |
| `eyebrow`      | `string` (optional)  | Max 40 chars — e.g. `"HALF DAY"` |
| `badge`        | `string` (optional)  | Max 40 chars — e.g. `"MOST POPULAR"` |
| `price`        | `string` (optional)  | Max 40 chars |
| `priceSuffix`  | `string` (optional)  | Max 80 chars — e.g. `"up to 20 people"` |
| `includes`     | `array<string>` (optional) | Each item ≤ 200 chars. Hard-cap 15 items per package → 400 `too_many_includes` |
| `smallPrint`   | `string` (optional)  | Max 200 chars |
| `ctaLabel`     | `string` (optional)  | Max 60 chars |
| `ctaHref`      | `string` (optional)  | URL |
| `featured`     | `boolean` (optional) | Marks this package as the ink-on-white hero. Only **one** package per block can be `featured: true` — 2nd `true` → 400 `too_many_featured` |

Hard-cap **6 packages**. 7th → 400 `too_many_packages`.

### 3.3 `footer` shape

Object, all fields optional. When every listed field is empty, the frontend doesn't render the footer strip.

| Key | Type | Notes |
|---|---|---|
| `eyebrow`           | `string` | Max 60 chars |
| `text`              | `string` | Max 300 chars |
| `ctaLabel`          | `string` | Max 60 chars |
| `ctaHref`           | `string` | URL |
| `contactName`       | `string` | Max 80 chars |
| `contactRole`       | `string` | Max 80 chars — e.g. `"EXT 143"` |
| `contactInitials`   | `string` | Max 4 chars |
| `contactAvatarUrl`  | `string` | https URL |

### 3.4 Error codes

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_package_name` | Empty `name` on a package |
| 400 | `too_many_packages` | > 6 packages |
| 400 | `too_many_includes` | > 15 includes on any package |
| 400 | `too_many_featured` | > 1 package with `featured: true` |
| 400 | `bad_url` | Bad URL on `packages[].ctaHref` or `footer.ctaHref` or `footer.contactAvatarUrl` |

---

## 4. Migration

None. Same storage as brief 43 (`pages.blocks_json`). Just extend the validator + tests.

---

## 5. Verification (please attach outputs)

### `venueHireHero`
- ✓ PATCH with `heading` populated + all optional fields → 200, GET returns intact.
- ✓ PATCH with `heading: ""` → 400 `missing_heading`.
- ✓ PATCH with `cardTone: "cerulean"` → 400 `bad_tone`.
- ✓ PATCH with 7 stats → 400 `too_many_stats`.
- ✓ PATCH with a stat missing `label` → 400 `bad_stat`.
- ✓ PATCH with `primaryCta: { label: "", href: "" }` → 200, echoed back with empty strings (frontend hides).

### `venueSpaces`
- ✓ PATCH with three spaces, each fully populated → 200, GET intact.
- ✓ PATCH with 13 spaces → 400 `too_many_spaces`.
- ✓ PATCH with a space `name: ""` → 400 `bad_space_name`.
- ✓ PATCH with a space `tone: "cerulean"` → 400 `bad_tone`.
- ✓ PATCH with an unknown per-space key (`sqmt: 120`) → 200, unknown key stripped on read.

### `venuePackages`
- ✓ PATCH with three packages, middle one `featured: true` → 200, GET intact.
- ✓ PATCH with two packages `featured: true` → 400 `too_many_featured`.
- ✓ PATCH with a package `includes` of 20 lines → 400 `too_many_includes`.
- ✓ PATCH with 7 packages → 400 `too_many_packages`.
- ✓ PATCH with an empty `footer: {}` → 200 (frontend hides the strip).
- ✓ PATCH with `footer.ctaHref: "not a url"` → 400 `bad_url`.

---

## 6. Frontend contract

- No new endpoints. Same `PATCH /clubs/:id/pages/:slug` as brief 16.
- TS types already live in `packages/content-blocks/src/types.ts` (`VenueHireHeroProps`, `VenueSpacesProps`, `VenuePackagesProps`, plus item + shared enum types).
- Once this brief ships, the CRM Website editor will actually persist every prop; today it renders and previews correctly but the PATCH silently drops all three unknown block types on save.

---

## 7. Non-goals (v1)

- No booking backend. All three blocks are marketing-only; every CTA on them points at an owner-authored href (typically `/venue-hire/book` or `/contact`) with nothing behind it yet.
- No auto-derived price / capacity from any club-level venue config. Owners author every string per block instance.
- No image processing endpoint changes — `imageUrl` / `cardImageUrl` / `contactAvatarUrl` follow the existing block-images upload path.
- No CRM-side derivation of packages from Stripe products or similar. Bespoke marketing content per club.

---

## 8. Future — brief 45 (venue booking flow)

Screenshots 3 + 4 from the Paper set (calendar + slot picker, then the details form) are deferred to a follow-up brief that also ships:

- `GET /clubs/:id/venue-hire/availability?from=&to=` — free/some/booked matrix per day.
- `POST /clubs/:id/venue-hire/holds` — 15-minute soft hold on a slot + return a hold_id.
- `POST /clubs/:id/venue-hire/bookings` — commit the hold with contact details + add-ons.
- Backend fires brief 40 `kind: 'enquiry'` (or a new `kind: 'venue_booking'`) so the CRM inbox lights up.

Not scoped for this brief — mentioning here so the design intent is on the record.

---

## 9. Contact

Same as prior briefs. If we widen the tone palette on the frontend, coordinate the whitelist — otherwise those tones will 400 on save.
