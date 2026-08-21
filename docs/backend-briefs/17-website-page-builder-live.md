# Website Page Builder — Frontend Implementation Brief

**Feature:** the three CRM endpoints that back the `/crm/website` editor plus the payload extension that lets Nuxt render the published layouts. Response of `backend-website-page-builder-brief.md` from the shipping side — same shape, verified in prod.

**Related:** `backend-website-page-builder-brief.md` (the original ask), `frontend-club-sites-brief.md` (the `/site` payload this extends), `frontend-onboarding-brief.md` (wizard toggles `pages_enabled`).

**Status:** ✅ shipped 2026-08-21. All three endpoints live on the CRM API + `/public/clubs/{slug}/site` now returns `pages`. Migration 088 applied. Full owner-authed lifecycle exercised end-to-end in prod (see §5).

---

## TL;DR

- **`GET /clubs/{club_id}/pages/{page_slug}`** — read draft + published + timestamps. Returns a seeded default layout when no row exists yet — the owner never sees a blank canvas.
- **`PATCH /clubs/{club_id}/pages/{page_slug}`** — autosave the draft. Full replacement of `blocks[]`. Validates block shape, block count (≤ 50), payload size (≤ 200 KB).
- **`POST /clubs/{club_id}/pages/{page_slug}/publish`** — atomic copy `layout_draft → layout_published`. Fires the Nuxt revalidate webhook. Returns the `public_url` for the "View live site" button.
- **`GET /public/clubs/{slug}/site`** now returns `pages: { [slug]: { blocks: [...] } }`. Only published layouts appear; empty map when nothing's been published.
- **Auth:** owner or admin. 401 without token, 403 on wrong club.
- **8 block types** allowed: `hero`, `richText`, `eventList`, `honourBoard`, `gallery`, `contactForm`, `membershipCta`, `ctaBanner`. Backend treats `props` as opaque JSON — TypeScript on your side is the source of truth.

---

## Base URL

```ts
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

Same base as `/me`, claims, onboarding, member CRUD, `/clubs/resolve`, `/public/clubs/{slug}/site` — the CRM stack. Uses the standard `Authorization: Bearer <jwt>` header.

---

## 1. `GET /clubs/{club_id}/pages/{page_slug}`  (🔒 owner or admin)

Read the editor state. Both the current draft and the published version so you can render "you have unpublished changes" hints.

**Path params:**
- `page_slug` — one of `home | about | membership | events | honour-board | contact`.

**200 Success** (verified — user hits a page with no data yet, gets a seed):

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "is_published": false,
    "layout_draft": {
      "blocks": [
        { "id": "seed-hero",   "type": "hero",          "props": { "heading": "Melbourne Bowling Club", "subheading": "Proud, Feared, United", "primaryCta": { "label": "Join us", "href": "/membership" }, "secondaryCta": { "label": "See what's on", "href": "/events" } } },
        { "id": "seed-events", "type": "eventList",     "props": { "heading": "What's on", "limit": 4, "upcomingOnly": true } },
        { "id": "seed-cta",    "type": "membershipCta", "props": { "heading": "Play with us this season", "body": "…", "ctaLabel": "See tiers", "ctaHref": "/membership" } }
      ]
    },
    "layout_published": null,
    "draft_updated_at": null,
    "published_at": null,
    "has_unpublished_changes": true
  }
}
```

**Seed layouts** (returned when no row/draft exists — brief §5):

| Slug          | Seed contents                                     |
|---------------|---------------------------------------------------|
| home          | hero + eventList + membershipCta                  |
| about         | hero + richText (empty `html`)                    |
| membership    | hero + membershipCta                              |
| events        | hero + eventList (limit: 20)                      |
| honour-board  | hero + honourBoard                                |
| contact       | hero + contactForm                                |

Hero seeds interpolate `club.name` and `club.tagline` server-side — no `{{templating}}` reaches the client.

**Reading the flag:**
- `has_unpublished_changes = true` when there's no published layout yet OR `draft_updated_at > published_at`.
- Use it to gate the "Publish" button styling ("Publish" vs "Publish changes") and the unsaved-changes hint.

**Errors:**
- `401 unauthorized` — no/bad JWT
- `403 forbidden` — not owner/admin on this club
- `404 not_found` — unknown `club_id` OR unknown page slug (`code: "unknown_page_slug"`)

**Sample:**
```bash
curl -H "Authorization: Bearer $JWT" \
  "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/3/pages/home"
```

---

## 2. `PATCH /clubs/{club_id}/pages/{page_slug}`  (🔒 owner or admin)

Autosave. Call on every meaningful edit; frontend should debounce ~500 ms.

**Request:**

```json
{
  "layout_draft": {
    "blocks": [
      { "id": "blk-hero",  "type": "hero",      "props": { "heading": "Melbourne Bowling Club", "subheading": "Since 1864" } },
      { "id": "blk-cta",   "type": "ctaBanner", "props": { "heading": "Join us", "ctaLabel": "Membership", "ctaHref": "/membership" } }
    ]
  }
}
```

**Full replace** — send the whole `blocks[]`. Server doesn't diff.

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "draft_updated_at": "2026-08-21T20:38:08.000Z"
  }
}
```

Use the returned `draft_updated_at` for the "Saved just now" indicator (compare to `Date.now()`).

**Validation** (all verified in prod):

| Error case                | HTTP | `code`                | Body extra          |
|---------------------------|------|-----------------------|---------------------|
| Body isn't valid JSON     | 400  | `bad_json`            | —                   |
| `layout_draft` missing or not an object | 400 | `bad_json` | — |
| `blocks` isn't an array   | 400  | `bad_json`            | —                   |
| `blocks.length > 50`      | 400  | `too_many_blocks`     | —                   |
| Request body > 200 KB     | 400  | `payload_too_large`   | —                   |
| A block missing `id`/`type`/`props` | 400 | `invalid_block_shape` | — |
| A block's `type` isn't one of the 8 known | 400 | `unknown_block_type` | `"type": "<offending>"` |
| Not owner/admin on this club | 403 | `forbidden` | — |
| Unknown club/page slug    | 404  | `not_found` / `unknown_page_slug` | — |

**Full-replace semantics + block IDs.** `id` values are yours — we don't mint or validate them, they exist for React/Vue key stability. If a block from a previous save doesn't appear in the new `blocks[]`, it's gone.

---

## 3. `POST /clubs/{club_id}/pages/{page_slug}/publish`  (🔒 owner or admin)

Empty body. Atomically copies `layout_draft → layout_published`, sets `published_at`, fires the Nuxt revalidate webhook.

**200 Success:**

```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "pageSlug": "home",
    "published_at": "2026-08-21T20:38:08.000Z",
    "public_url": "https://melbourne-bowling-club.torny.club/"
  }
}
```

`public_url` maps `home` → `/`, everything else → `/{page_slug}`. Use it as the `href` on the "View live site" button.

**Revalidate:** on success we fire `POST sites.torny.club/api/revalidate` with `paths: ["/" | "/{page_slug}"]`, `reason: "page.published"`. Fire-and-forget — publish returns 200 whether or not the webhook lands. The webhook is a no-op until `NUXT_REVALIDATE_SECRET` is exchanged (see `frontend-club-sites-brief.md` §3).

**Errors:**
- `400 empty_draft` — first publish with no draft blocks. Republishing an existing publish with an empty draft is allowed (treat as "reaffirm the current live layout").
- `401 unauthorized`
- `403 forbidden`
- `404 not_found` / `unknown_page_slug`
- `500 internal`

---

## 4. `/public/clubs/{slug}/site` — `pages` map

The existing site payload (see `frontend-club-sites-brief.md` §2) gained a **`pages`** key alongside `pages_enabled`:

```json
{
  "status": "success",
  "data": {
    "club":              { /* … */ },
    "contact":           { /* … */ },
    "hours":             [ /* … */ ],
    "membership_tiers":  [ /* … */ ],
    "events_upcoming":   [ /* … */ ],
    "honour_board_recent": [ /* … */ ],
    "pages_enabled":     { "home": true, "about": true, "membership": true, "events": true, "honour_board": false, "shop": false },
    "pages": {
      "home":  { "blocks": [ { "id": "blk-hero", "type": "hero", "props": { /* … */ } } ] }
    }
  }
}
```

- **Only published pages appear.** A slug that's toggled `pages_enabled: true` but never published won't be in `pages`. Frontend falls back to a hardcoded template for those, exactly as `frontend-club-sites-brief.md` §2 already flagged.
- Same caching rules — `Cache-Control: public, max-age=60, stale-while-revalidate=300` on the whole response. When the CRM hits publish, the revalidate webhook fires so your `/api/revalidate` receiver can purge Cloudflare + KV. Until the secret is exchanged, the SWR windows heal the cache within a few minutes.

---

## 5. What we verified in prod (end-to-end, authed)

Ran through with a real owner JWT on `melbourne-bowling-club` (state restored on exit):

1. **GET on a page with no data** → returns seeded layout (`hero`, `eventList`, `membershipCta`), `has_unpublished_changes: true`.
2. **PATCH v1** (2 blocks: hero + ctaBanner) → 200, `draft_updated_at` set.
3. **GET after v1** → draft has the 2 blocks, `published: null`, still unsaved.
4. **PATCH v2** (add an eventList block) → 200, full replacement worked.
5. **PATCH `type: "nope"`** → 400 `unknown_block_type` with `"type": "nope"` in payload.
6. **PATCH block missing `props`** → 400 `invalid_block_shape`.
7. **PATCH 51 blocks** → 400 `too_many_blocks`.
8. **POST publish** → 200 with `public_url`.
9. **GET after publish** → draft + published match, `has_unpublished_changes: false`.
10. **`/site` payload** → `pages.home.blocks` shows `[hero, ctaBanner, eventList]` in order.
11. **GET on a club we don't belong to** → 403 forbidden.

---

## 6. Block schema — 8 types accepted

Exactly the discriminated union in `packages/content-blocks/src/types.ts`:

```
hero | richText | eventList | honourBoard | gallery | contactForm | membershipCta | ctaBanner
```

**Backend rules:**
- Enforces the outer envelope (`{ blocks: [...] }`), block count (≤ 50), size (≤ 200 KB), block presence of `{ id, type, props }`, and that `type` is one of the 8 above.
- **Doesn't validate `props` per type.** Your TypeScript is the source of truth. If you send `{ type: "hero", props: { greeting: "hi" } }`, we store it verbatim — the renderer downstream is responsible for handling shape drift.
- Adding a new block type requires a backend change (`utils/page-blocks.js`) — coordinate before shipping to production so old clients can't inject a value that hasn't been whitelisted.

**HTML sanitisation on `richText`:** not implemented yet. Once you start emitting HTML from TipTap, flag it — we'll add DOMPurify-equivalent server-side sanitisation before real user content lands. Trusted-admin-only for now.

---

## 7. Frontend wire-up notes

- **Editor autosave** — debounce PATCH ~500 ms after the last edit. On network error, keep the local draft in memory and retry with backoff — don't lose the owner's work.
- **`has_unpublished_changes`** — treat as the source of truth for the "Publish" vs "Publish changes" button state. Cheaper than diffing locally.
- **"View live site"** — after publish, use `data.public_url` from the POST response directly. Don't reconstruct it from subdomain client-side; that logic lives on the backend now (path prefix handling for `home` vs everything else).
- **Preview mode** — not shipped. When you build the "preview draft" surface, tell us and we'll add a `?draft=true` variant to the public site endpoint (returns `layout_draft` if the caller is an admin with a valid JWT).
- **Race between two owners editing** — no locks yet. Last write wins on PATCH. If you need pessimistic locks or optimistic ETag headers, flag it.

---

## 8. What we still need from you

1. **`NUXT_REVALIDATE_SECRET`** — same blocker as `frontend-club-sites-brief.md` §5. Once shared and dropped into `cdk/config/secrets.json` + CRM redeploy, publishes will actually purge the Nuxt cache.
2. **Confirm 8 block types are enough for MVP.** If you're planning `videoEmbed`, `sponsorGrid`, `testimonials`, etc. flag them so we allowlist together instead of a series of one-offs.
3. **`richText` HTML shape.** Confirm the emitted HTML is TipTap standard (no custom tags/attrs) so our future sanitiser doesn't strip things you rely on.

---

## 9. Known gaps vs the brief

- **`unpublish` endpoint (brief §2.4)** not shipped. Owners can flip `pages_enabled` off from the onboarding wizard's page list, but there's no dedicated "unpublish this page" surface yet. Flag when you need it.
- **Version history (brief §9 Q2)** not shipped — no `public_site_page_versions` table. Every publish overwrites `layout_published` in place.
- **Media uploads for `hero.imageUrl` / `gallery.images[].url`** — reuse the existing media upload flow (backend brief §9 Q4). Backend doesn't validate the URL strings.

---

## 10. Contact

Same as previous briefs — `#torny-eng` on Slack. Happy to pair through the editor's autosave/publish UX or extend the block allowlist if you spot something missing.
