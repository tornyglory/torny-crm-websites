# PeopleGrid + Gallery — Block Whitelist Additions

**Feature:** whitelist a new `peopleGrid` block type on the backend's page-layout validator, and extend the existing `gallery` block's prop schema to cover the redesigned Paper layout. Same structural pattern as briefs 32 (`honourBoardSearch` whitelist) and 34 (`eventsCalendar` whitelist).

**Status:** frontend shipped 2026-08-27 (`PeopleGridBlock.vue`, `GalleryBlock.vue` rewritten to match the Paper design). The published-blocks validator currently strips unknown props / rejects unknown types, so an owner adding either block through the CRM editor won't have their changes persist until this brief lands.

**Related briefs:**
- brief 16 (published block layouts) — the underlying `PATCH /clubs/:club_id/pages/:slug` endpoint + validator that this brief extends.
- brief 32 (honourBoardSearch whitelist), brief 34 (eventsCalendar whitelist) — same pattern; copy-paste the row from either into the `KNOWN_BLOCKS` map + prop schema table.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT. No new endpoints — just extend the validator behind the existing page-layout PATCH endpoint.

---

## 1. `peopleGrid` — new block type

### 1.1 Whitelist entry

Add `peopleGrid` to `KNOWN_BLOCKS` (or wherever brief 34's `eventsCalendar` lives). Same pattern:

```js
peopleGrid: {
  requiredProps: [],           // every field is optional — the frontend renders an empty state
  optionalProps: [
    'eyebrow',
    'heading',
    'subheading',
    'people',
    'columns',
  ],
  propTypes: {
    eyebrow: 'string',         // max 120 chars
    heading: 'string',         // max 200 chars
    subheading: 'string',      // max 500 chars
    columns: 'integer',        // 2 | 3 | 4 — reject other values with 400 bad_columns
    people: 'array',           // see §1.2
  },
},
```

### 1.2 `people[]` item shape

Each entry in the `people` array is an object with the following schema. Unknown keys get stripped silently; known keys pass through untouched.

| Key | Type | Notes |
|---|---|---|
| `name` | `string` (required) | Max 120 chars. Empty string → 400 `bad_person_name` |
| `role` | `string` (optional) | Max 120 chars |
| `body` | `string` (optional) | Max 1000 chars |
| `email` | `string` (optional) | Must parse as an email if present → 400 `bad_person_email` |
| `initials` | `string` (optional) | Max 4 chars |
| `avatarUrl` | `string` (optional) | Must be an https URL if present. Same validator as `hero.imageUrl` |
| `tone` | `string` (optional) | One of `accent \| ink \| mint \| tangerine \| violet \| sky`. Unknown values → 400 `bad_person_tone` |

**Array size:** hard-cap at 24 people. 25th entry → 400 `too_many_people`.

### 1.3 Error codes

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_columns` | `columns` not 2 / 3 / 4 |
| 400 | `bad_person_name` | Any person's `name` empty |
| 400 | `bad_person_email` | Malformed email on a person |
| 400 | `bad_person_tone` | Unknown tone slug |
| 400 | `too_many_people` | > 24 entries |

---

## 2. `gallery` — extend the existing block

The `gallery` block type is already whitelisted. Extend its prop schema.

### 2.1 New top-level props

Add three optional strings alongside the existing `heading`:

| Key | Type | Notes |
|---|---|---|
| `eyebrow` | `string` (optional) | Max 120 chars — small mono line above the heading |
| `ctaLabel` | `string` (optional) | Max 60 chars — right-aligned CTA label. Empty = no link rendered |
| `ctaHref` | `string` (optional) | Same URL validator as `hero.primaryCta.href`. Empty allowed |

Existing `heading` stays as-is.

### 2.2 Extended per-image shape

The `images[]` array items already accept `url`, `alt`, `caption`. Add three new keys:

| Key | Type | Notes |
|---|---|---|
| `tone` | `string` (optional) | Same enum as PeopleGrid — `accent \| ink \| mint \| tangerine \| violet \| sky`. Used as a coloured placeholder when no `url`. Unknown values → 400 `bad_image_tone` |
| `wide` | `boolean` (optional) | Marks the tile as spanning 2 grid columns |
| `tall` | `boolean` (optional) | Marks the tile as spanning 2 grid rows |

`caption` cap: 80 chars → 400 `bad_image_caption` if longer.

**Array size:** hard-cap 40 images. 41st entry → 400 `too_many_images`.

### 2.3 Error codes

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_image_tone` | Unknown tone slug |
| 400 | `bad_image_caption` | Caption > 80 chars |
| 400 | `too_many_images` | > 40 images |

---

## 3. Migration

None needed. Both blocks live in the existing `pages.blocks_json` column — Postgres/MySQL doesn't care about extra keys. Just extend the validator + tests.

---

## 4. Verification (please attach outputs)

- ✓ `PATCH /clubs/:id/pages/:slug` with a body containing a `peopleGrid` block with every prop populated → 200, GET returns the block intact.
- ✓ Same PATCH with `columns: 5` → 400 `bad_columns`.
- ✓ PATCH with a person entry missing `name` → 400 `bad_person_name`.
- ✓ PATCH with a person entry `email: "not-an-email"` → 400 `bad_person_email`.
- ✓ PATCH with a person entry `tone: "orange"` → 400 `bad_person_tone`.
- ✓ PATCH with 25 people entries → 400 `too_many_people`.
- ✓ PATCH with unknown keys on a person (e.g. `nickname: "Fran"`) → 200, keys stripped silently on read.
- ✓ PATCH a `gallery` block with `eyebrow`, `ctaLabel`, `ctaHref` set → 200, echoed on GET.
- ✓ PATCH a gallery image with `tone: 'sky'`, `wide: true`, `tall: false` → 200, echoed on GET.
- ✓ PATCH gallery image `tone: "cerulean"` → 400 `bad_image_tone`.
- ✓ PATCH gallery image `caption` of 200 chars → 400 `bad_image_caption`.
- ✓ PATCH 41 gallery images → 400 `too_many_images`.
- ✓ Existing published pages with the old (bare) gallery shape still validate + render — the new fields default to absent, block still works.

---

## 5. Frontend contract summary

- No new endpoints. Same `PATCH /clubs/:id/pages/:slug` as brief 16 — just accepts two more block-type schemas.
- Frontend TS types are already in place (see `packages/content-blocks/src/types.ts` for `PeopleGridProps`, `PeopleGridPerson`, `PeopleGridTone`, `GalleryImage`, extended `GalleryProps`). Once this brief ships, the CRM's Website editor will actually persist the new fields; today it renders and previews correctly but the PATCH silently drops them.

---

## 6. Non-goals

- No public `/gallery` or `/team` route auto-generation — owners drop these blocks on whatever page they want, via the existing custom-page flow (brief 27).
- No image upload endpoint changes — gallery images still come through the existing block-images upload path (`/blocks/images`). PeopleGrid avatarUrls follow the same rule.
- No CRM-side derivation of the people list from the roster — owners author every field per person. If we want a "pull from members" option later, that's a follow-up brief.

---

## 7. Contact

Same as prior briefs. If a new tone slug is added on the frontend palette, coordinate the whitelist here — otherwise it'll 400 on save.
