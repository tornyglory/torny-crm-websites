# Tournaments — Cover + Gallery

**Feature:** every tournament gets a hero `cover_image_url` (already shipped in brief 47 Phase 1) and up to 8 ordered `gallery_urls`. Organisers upload from the CRM Create/Edit Tournament form; images render on the public tournament page and on the org-side entries view. Same Cloudflare upload dance as club logos + page images — no new media plumbing.

**Status:** Frontend is fully built and behind a feature check. The CRM Create Tournament form already renders a cover slot + an 8-tile gallery grid with add/reorder/remove; uploads succeed and confirm through the existing `/media/images/*` endpoints. Right now the CRM sends `gallery_urls: string[]` in `POST /clubs/{id}/tournaments` and it's dropped server-side because the column doesn't exist. Once this brief ships, the same UI un-mocks with zero frontend changes beyond the api-client type export.

**Related briefs:**
- brief 47 (tournaments Phase 1) — parent. `tournaments` table already exists with `cover_image_url VARCHAR NULL`. This brief adds the gallery column + widens create/update to accept both.
- brief 43 (peopleGrid + gallery whitelist), brief 44 (venue-hire blocks) — same JSONB-array-of-URLs pattern used for site gallery blocks. Reuse the pattern.
- Media stack (`/media/images/upload-url` + `/media/images/confirm`) — no changes. CRM uploads under `entity_type: 'club'`, `content_type: 'cover' | 'gallery'`, `content_id: <random 31-bit int>`. Backend just stores the returned public URLs on the tournament row.

---

## Base URL

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Admin+ writes, committee+ reads (unchanged from brief 47).

---

## 1. Storage

One column on the existing `tournaments` table:

```
gallery_urls  JSON   NOT NULL DEFAULT (JSON_ARRAY())
```

- Ordered array. Position 0 = first tile on the public page.
- Max length **8** — enforce server-side (see §5).
- Each entry is a Cloudflare public URL (`https://imagedelivery.net/...` or the CDN alias). Strings, no per-item metadata.
- No separate `tournament_images` join table — the array is tiny and mutated as a whole.

Migration:

```sql
ALTER TABLE tournaments
  ADD COLUMN gallery_urls JSON NOT NULL DEFAULT (JSON_ARRAY())
  AFTER cover_image_url;
```

Backfill: not needed. Default is `[]`.

---

## 2. Endpoints affected

No new endpoints. Three existing brief-47 endpoints widen:

| Method | Path | Change |
|---|---|---|
| `POST`  | `/clubs/{club_id}/tournaments` | accept optional `cover_image_url` + `gallery_urls[]` on create |
| `PATCH` | `/clubs/{club_id}/tournaments/{tournament_id}` | accept optional `cover_image_url` + `gallery_urls[]` on update |
| `GET`   | `/clubs/{club_id}/tournaments/{tournament_id}` | include `gallery_urls` in the response |
| `GET`   | `/clubs/{club_id}/tournaments` | include `gallery_urls` on list rows so the CRM list card can show a thumbnail count |
| `GET`   | `/public/tournaments` | include `gallery_urls` on `PublicTournamentCard` |
| `GET`   | `/public/tournaments/{club_slug}/{tournament_slug}` | include `gallery_urls` on public detail |

Cover is unchanged in shape — it's already `cover_image_url: string \| null` from Phase 1. This brief just makes sure it's writable in both create and update (verify — frontend was previously blocked from writing it, one report of it landing as null after upload).

---

## 3. Request shape — create + update

Both endpoints accept the same optional fields:

```jsonc
{
  // ... existing brief 47 fields ...
  "cover_image_url": "https://imagedelivery.net/abc/def/public",
  "gallery_urls": [
    "https://imagedelivery.net/abc/img-1/public",
    "https://imagedelivery.net/abc/img-2/public",
    "https://imagedelivery.net/abc/img-3/public"
  ]
}
```

Rules:
- Both are optional. Omit → no change (PATCH) / default `null` + `[]` (POST).
- `gallery_urls: []` explicitly clears the gallery.
- `cover_image_url: null` explicitly clears the cover.
- Order in the array is respected + persisted verbatim. Reorder = client sends the array in the new order.

---

## 4. Response shape

Add to every response that already includes tournament rows:

```jsonc
{
  "cover_image_url": "https://imagedelivery.net/abc/def/public",
  "gallery_urls": [
    "https://imagedelivery.net/abc/img-1/public",
    "https://imagedelivery.net/abc/img-2/public"
  ]
}
```

Always an array (never null) — makes frontend rendering unconditional. Empty gallery = `[]`.

---

## 5. Validation

Return `400` with the existing error envelope. New codes:

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_gallery` | `gallery_urls` isn't an array of strings, OR contains > 8 items, OR contains a duplicate, OR any item > 2048 chars |
| 400 | `bad_image_url` | `cover_image_url` or any `gallery_urls` entry isn't a valid `https://` URL |

Do **not** validate the URL hostnames against a Cloudflare whitelist — clubs may proxy through their own CDN. Just enforce `https://` prefix + length. Frontend only ever sends what the media confirm endpoint returned, so bad values in practice mean tampering.

Empty strings inside the array → strip silently before persisting (a common CRM edge case).

---

## 6. Public detail — image ordering

On `GET /public/tournaments/{club_slug}/{tournament_slug}`, return:

```jsonc
{
  "cover_image_url": "…",
  "gallery_urls": ["…", "…"]
}
```

The public page renders the cover as the hero and the gallery as a horizontally scrollable strip below. No server-side thumbnail generation needed — Cloudflare Images serves resized variants at delivery time (`/public`, `/thumbnail`, etc.).

---

## 7. Delete tournament — image cleanup

Phase 1 keeps `DELETE /clubs/{id}/tournaments/{tid}` restricted to `status='draft'`. Uploaded images live in Cloudflare under `entity_type='club'`, `content_type='cover'|'gallery'`, `content_id=<random>` — they don't get orphan-cleaned when the tournament row is deleted.

**Phase 1 punt:** don't try to reap the Cloudflare assets on tournament delete. Cost is trivial (Cloudflare Images is cheap) and the URLs become unreachable anyway once the row is gone.

**Phase 2 optional:** add a per-image `deleted_at` sweeper (weekly cron) that lists images with `content_type IN ('cover','gallery')` where no tournament row references the URL, and deletes them from Cloudflare + the `images` table. Not blocking.

---

## 8. TS types (deltas for `packages/api-client/src/resources/tournaments.ts`)

Already merged on the frontend. Confirming the shape for reference:

```ts
export interface Tournament {
  // ... existing brief 47 fields ...
  cover_image_url: string | null
  gallery_urls: string[]
}

export type CreateTournamentInput = Pick<Tournament, ...> & Partial<Pick<Tournament,
  | 'subtitle'
  | 'description'
  | 'gender_scope'
  | 'waitlist_enabled'
  | 'waitlist_cap'
  | 'prize_pool_cents'
  | 'prize_notes'
  | 'open_to_visitors'
  | 'requires_bcnz'
  | 'min_age'
  | 'max_age'
  | 'cover_image_url'
  | 'gallery_urls'
  | 'sanctioned_by'
  | 'sanction_url'
>>
```

The `Partial` makes both optional on create/update, matching §3.

---

## 9. Verification

Cover cases:
- ✓ POST with `cover_image_url` → persisted, returned on GET
- ✓ POST without `cover_image_url` → stored as `NULL`
- ✓ PATCH with `cover_image_url: null` → clears
- ✓ PATCH with malformed URL → `400 bad_image_url`

Gallery cases:
- ✓ POST with `gallery_urls: ["a","b","c"]` → persisted in order
- ✓ POST without `gallery_urls` → stored as `[]`
- ✓ PATCH with `gallery_urls: []` → clears
- ✓ PATCH with reordered array `["b","a","c"]` → persisted in new order
- ✓ PATCH with 9 URLs → `400 bad_gallery`
- ✓ PATCH with duplicate URLs → `400 bad_gallery`
- ✓ PATCH with `["", "https://…"]` → strips the empty string, persists 1 item
- ✓ GET detail → `gallery_urls` present + is an array (never null)
- ✓ Public detail includes both fields
- ✓ Public list card includes `cover_image_url` + `gallery_urls`

---

## 10. Non-goals

- No image reordering endpoint — the whole array PATCH is the reorder.
- No caption / alt text per image — Phase 3 if requested. Alt text falls back to tournament title on the public page.
- No per-image click-through analytics.
- No slideshow / lightbox spec on the public page — that's frontend styling, not backend shape.
- No orphan cleanup (see §7).
- No cross-tournament image reuse — each upload is a fresh Cloudflare asset. Cheap enough.

---

## 11. Frontend integration plan

Zero-change on merge if the response shape matches §4:
- `packages/api-client/src/resources/tournaments.ts` already exports `cover_image_url` and `gallery_urls`.
- CRM Create Tournament form (`apps/crm/src/views/tournaments/TournamentCreateView.vue`) already uploads via `/media/images/*` and submits both fields on save.
- CRM Detail view will render the cover as a header thumbnail once the backend returns it (already reserved on the design).
- torny-web public tournament page will render cover + gallery once the endpoint exists (blocked on brief 47 public discovery being un-mocked in the CRM stack — see §16 in brief 47).

---

## 12. Contact

Same as brief 47.
