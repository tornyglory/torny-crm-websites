# Backend brief — Public club-site endpoints

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/club-sites` (Nuxt 3 → Cloudflare Pages, multi-tenant via Cloudflare for SaaS)
**Related:** brief 10 (onboarding — the wizard writes the data these endpoints read), brief 11 (§What's still coming → the `club.onboarded` webhook flagged here), briefs 12–13 (member CRUD + roster summary)
**Status:** Nuxt tenant scaffold exists (middleware + composables + page shells). Zero endpoints exist yet — nothing to wire against.

---

## TL;DR

- One Nuxt app on Cloudflare Pages serves every club. Tenant is resolved from the `Host` header on every request.
- **Two public endpoints** are needed to make the sites real: `GET /clubs/resolve?host=…` (tenant lookup) and `GET /public/clubs/:slug/site` (everything a page needs).
- **One CRM → Nuxt hook**: after any CRM save that changes public content, POST to `sites.torny.club/api/revalidate` with HMAC to purge that club's cache.
- **One event on onboarding complete**: `club.onboarded` → same revalidate hook, warms the cache for the fresh subdomain.
- Both public endpoints are **unauthenticated** — that's the whole point. Cache them aggressively at the CDN + Workers KV.

---

## Context — the multi-tenant model

Not one Nuxt build per club. One app, N tenants:

```
User hits melbourne.torny.club
  ↓
Cloudflare Pages serves the shared Nuxt bundle
  ↓
server/middleware/tenant.ts reads the Host header
  ↓
GET /clubs/resolve?host=melbourne.torny.club  ← ENDPOINT #1
  ↓
Nuxt has { id, slug, name, brand } — attaches to event.context.club
  ↓
Page (e.g. /events) calls GET /public/clubs/:slug/site  ← ENDPOINT #2
  ↓
Renders. Response cached with SWR (1 min for /events, 1 hour for /honour-board, etc.)
```

DNS is a wildcard `*.torny.club` record on Cloudflare Pages via Cloudflare for SaaS. Custom hostnames (e.g. `mybowlsclub.co.nz`) get added through the Cloudflare Custom Hostnames API when an owner configures one in the CRM.

---

## 1. `GET /clubs/resolve?host=…`  (public, edge-cacheable)

**Purpose:** convert a raw hostname to a club identity. Called on **every** request to a club site, including cache misses on assets, so this needs to be fast.

**Query param:**
- `host` — lowercased hostname. Examples: `melbourne.torny.club`, `mybowlsclub.co.nz`, `www.mybowlsclub.co.nz` (server should treat `www.*` as equivalent to the apex).

**200 Success:**
```json
{
  "status": "success",
  "data": {
    "id":            3,
    "slug":          "melbourne",
    "name":          "Melbourne Bowling Club",
    "primary_host":  "melbourne.torny.club",
    "custom_hosts":  ["mybowlsclub.co.nz", "www.mybowlsclub.co.nz"],
    "brand_primary": "#DC2626",
    "logo_url":      "https://imagedelivery.net/…/logo",
    "onboarded_at":  "2026-08-21T10:14:22.000Z"
  }
}
```

`onboarded_at` is critical — the Nuxt middleware refuses to serve unpublished clubs (renders a "coming soon" page or 404). Older, un-onboarded claims should not be reachable via subdomain.

**404 — host doesn't map to a club:**
```json
{ "status": "error", "code": "unknown_host" }
```

Nuxt renders a "not found" page.

**Caching:**
- Response should include `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.
- Prod: back this with Workers KV keyed on the host. Invalidate the KV entry when the club's `primary_host`/`custom_hosts`/`onboarded_at` change (see §Revalidation).

**Rate limit:** none — this is edge-cached and hit on every request.

---

## 2. `GET /public/clubs/:slug/site`  (public, cacheable)

**Purpose:** one endpoint that returns everything a public site needs to render every page. Simpler than N separate endpoints for MVP.

**Path param:**
- `slug` — the club's slug from resolve (e.g. `melbourne`). Preferred over ID for URL beauty.

**200 Success:**
```jsonc
{
  "status": "success",
  "data": {
    "club": {
      "id":            3,
      "slug":          "melbourne",
      "name":          "Melbourne Bowling Club",
      "short_description": "Bowls in Windsor since 1885.",
      "tagline":       "Bowls in Windsor since 1885.",
      "founded_year":  1885,
      "sport":         "bowls",
      "region":        "Victoria",
      "country":       "Australia",
      "brand_primary": "#DC2626",
      "logo_url":      "https://imagedelivery.net/…/logo",
      "onboarded_at":  "2026-08-21T10:14:22.000Z"
    },

    "contact": {
      "email":   "secretary@melbournebowls.au",
      "phone":   "+61 3 9428 5555",
      "address": "12 Bowling Green Rd, Windsor, Victoria",
      "google_maps_url": "https://maps.google.com/?q=..."
    },

    "hours": [
      { "day": "mon", "is_open": true,  "open": "15:00", "close": "20:00" },
      { "day": "tue", "is_open": false, "open": null,    "close": null },
      // …7 rows
    ],

    "membership_tiers": [
      {
        "id":          4,
        "type_name":   "Playing member",
        "description": "Full playing rights, all comps.",
        "cadence":     "annual",
        "fee":         240,
        "is_default":  true
      }
      // ordered by sort_order or is_default first
    ],

    "cadence":               "annual",
    "first_year_discount":   true,

    "events_upcoming": [
      {
        "id":          17,
        "slug":        "twilight-triples-2026-09-04",
        "title":       "Twilight Triples",
        "starts_at":   "2026-09-04T17:30:00+11:00",
        "ends_at":     "2026-09-04T20:30:00+11:00",
        "location":    "Green 2 & 3",
        "cover_url":   null,
        "format":      "triples",
        "capacity":    24,
        "rsvp_open":   true,
        "excerpt":     "Casual mid-week triples. BBQ from 5pm."
      }
      // capped at ~10 upcoming; full list on /events
    ],

    "honour_board_recent": [
      {
        "category_slug": "club-champion-singles",
        "category_name": "Club Champion — Singles",
        "year":          2025,
        "member_name":   "Marcus Tuilagi",
        "notes":         null
      }
      // capped at ~10 most recent
    ],

    "pages_enabled": {
      "home":       true,
      "about":      true,
      "membership": true,
      "events":     true,
      "honour_board": true,
      "shop":       false
    }
  }
}
```

**Field notes:**
- `pages_enabled` drives which routes render vs 404. Nuxt middleware checks this per URL.
- `hours[]` is always 7 rows even for closed days — simpler client-side rendering.
- `events_upcoming` is the top ~10 for the home + upcoming-events preview. A separate `/public/clubs/:slug/events` (paginated) will land later for the full list.
- `honour_board_recent` same shape — ~10 most recent decisions. Full list at `/public/clubs/:slug/honour-board` later.
- All timestamps are ISO 8601 with timezone. Client formats.

**404 — slug not found or club not onboarded:**
```json
{ "status": "error", "code": "not_found" }
```

**Caching:**
- Response headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
- Nuxt layer adds its own SWR windows on top (5 min home, 1 min events, 1 hour honour-board — see the club-sites README).
- Purged via §Revalidation on any CRM save that touches these fields.

**Rate limit:** none at the API layer. Cloudflare rate-limit rules handle abuse at the edge.

---

## 3. Individual page endpoints — **P2, not blocking**

The site endpoint above covers the MVP surface. When the events list grows past ~10 or the honour board needs pagination, add:

- `GET /public/clubs/:slug/events?limit=20&cursor=…` — full events list, cursor-paginated
- `GET /public/clubs/:slug/events/:eventSlug` — single event detail (registration, description, cover image)
- `GET /public/clubs/:slug/honour-board` — full board grouped by category

Same shape rules — public, cacheable, no auth. Not needed for MVP launch.

---

## 4. Revalidation — CRM → club-sites hook

The CRM knows when public content changed. It should tell the club-sites Nuxt app to purge its cache for that club.

**Endpoint (lives on Nuxt, not CRM):** `POST https://sites.torny.club/api/revalidate`

**Request from CRM:**
```json
{
  "clubId": 3,
  "slug":   "melbourne",
  "paths":  ["/", "/events", "/events/twilight-triples-2026-09-04"],
  "reason": "event.published"
}
```

Or, if you'd rather not enumerate paths:
```json
{ "clubId": 3, "slug": "melbourne", "purge": "all", "reason": "brand.updated" }
```

**HMAC signature:** required. Header `X-Torny-Signature: sha256=<hex>` computed over the raw request body using a shared secret (`NUXT_REVALIDATE_SECRET`, currently a placeholder in the club-sites README). Nuxt verifies before purging. Reject unsigned or bad-signature requests with 401.

**When CRM should fire it:**

| Event | `paths` (recommended) |
| --- | --- |
| Onboarding complete | `["/"]` — first render |
| Any onboarding PATCH (before complete) | skip (draft state) |
| Brand / logo / tagline updated (post-onboarding, once a "settings" endpoint exists) | `["/"]` |
| Membership tier added / edited / removed | `["/", "/membership"]` |
| Hours updated | `["/", "/contact"]` |
| Event created / edited / published | `["/", "/events", "/events/:slug"]` |
| Event deleted | `["/", "/events"]` |
| Honour board entry added | `["/", "/honour-board"]` |
| Member add / edit / remove | skip — not public |
| Payment recorded | skip — not public |
| Application decisions | skip — not public |

**On Nuxt side (already scaffolded per the club-sites README):**
- Verify HMAC.
- Call Cloudflare's cache purge API for `https://{club.primary_host}{path}` for each path, plus every custom host.
- Also purge the `/clubs/resolve?host=…` KV entry for every host on the club.
- Return 200 with `{ purged: N }`.

**Retry policy:** fire-and-forget from CRM's perspective. If the POST fails, log it — the SWR windows are short enough (1-5 min) that the cache heals itself within a few minutes anyway.

---

## 5. Onboarding-complete webhook — the first fire

Brief 10 §8 and brief 11 §What's still coming both flagged this. When `POST /clubs/:id/onboarding/complete` succeeds:

1. The atomic transaction commits (club row + hours + tiers + pages).
2. Backend fires the same `/api/revalidate` POST above with `{ clubId, slug, paths: ['/'], reason: 'club.onboarded' }`.
3. Nuxt purges any negative cache (a probe on `/` earlier would have returned 404 for a non-onboarded club) and warms the fresh home page.
4. Owner clicks the `publicUrl` returned from `/complete` → sees their real site.

**Latency budget:** POST → purge → warm should complete inside ~5 seconds. If it's slower, the "View live site" button on the CompleteView needs to warn "your site is publishing — this can take a minute" (that copy already exists per the wizard's celebration screen).

---

## 6. Custom hostnames — **P2, not blocking**

When an owner enters `mybowlsclub.co.nz` in the CRM (future settings surface):

1. CRM validates the domain format.
2. CRM POSTs to Cloudflare's `/zones/:id/custom_hostnames` endpoint with `{ hostname: 'mybowlsclub.co.nz', ssl: { method: 'http', type: 'dv' } }`.
3. Cloudflare issues an SSL cert via SNI and returns a validation record.
4. CRM shows the owner: "Add this CNAME at your registrar: `mybowlsclub.co.nz` → `sites.torny.club`."
5. Once DNS propagates + cert is issued (usually < 5 min), the same Nuxt project handles requests to that hostname (via `/clubs/resolve`).
6. `clubs.custom_hosts[]` in the resolve response gets updated to include the new hostname.

Not blocking for MVP — every club has a `.torny.club` fallback subdomain already.

---

## 7. Data model additions

Extends brief 10 §4:

```
clubs_data
  ...brief 10...
  primary_host VARCHAR(255) NOT NULL              -- e.g. 'melbourne.torny.club'
  -- (custom hosts join out to a separate table so a club can have many)

club_custom_hostnames
  id, club_id FK, hostname VARCHAR(255) UNIQUE,
  ssl_status ENUM('pending','issued','failed'),
  added_at, verified_at NULLABLE
```

On onboarding complete, compute `primary_host` as `${subdomain}.torny.club` and write it to `clubs_data.primary_host`. The resolve endpoint queries `WHERE primary_host = ? OR EXISTS(SELECT 1 FROM club_custom_hostnames WHERE club_id = clubs_data.id AND hostname = ?)`.

---

## 8. Acceptance criteria

Frontend can un-mock the club sites when **all** of these are true:

- [ ] `GET /clubs/resolve?host=melbourne.torny.club` returns the shape in §1 with correct `onboarded_at`.
- [ ] `GET /clubs/resolve?host=unknown.torny.club` returns 404 `unknown_host`.
- [ ] `GET /clubs/resolve` is cacheable (Cache-Control header) and served in < 100ms cold.
- [ ] `GET /public/clubs/melbourne/site` returns the shape in §2 with real data (hours, tiers, events, honour board).
- [ ] `GET /public/clubs/{slug}/site` returns 404 for un-onboarded clubs.
- [ ] `POST /clubs/:id/onboarding/complete` fires `/api/revalidate` with the club's slug + paths.
- [ ] Every CRM mutation that changes public content per §4's table fires `/api/revalidate` with the right paths.
- [ ] Revalidate requests are HMAC-signed with `NUXT_REVALIDATE_SECRET`.

---

## 9. What's already ready on the frontend

Concrete scaffolding in `apps/club-sites` (see the folder's README + `server/middleware/tenant.ts`):

- Tenant middleware calls `resolveClubForHost(host)` — plugs into §1 directly.
- `useClub()` composable reads from `event.context.club` — no change needed.
- Page shells at `pages/index.vue`, `pages/events/`, `pages/honour-board/`, `pages/membership.vue`, `pages/contact.vue`, `pages/[...slug].vue` — need their `useAsyncData` calls pointed at `/public/clubs/:slug/site`.
- `wrangler.toml` + Cloudflare Pages build configured.
- README documents the SWR windows.
- `server/api/revalidate.post.ts` is called out in the README (may or may not be written yet — verify before assuming).

Estimated frontend wire-up once §§1 + 2 land: **~half a day** for the home page + events + honour-board + membership + contact all reading from the one site endpoint.

---

## 10. Open questions

- **Slug source of truth.** Currently the wizard writes `subdomain` in step 6. Are `subdomain` and `slug` the same field, or two separate things? Recommend: same. Confirm.
- **Onboarding-in-progress previews.** Should partially-onboarded clubs get a preview URL (e.g. `melbourne-preview.torny.club`) so they can see what their site looks like before publishing? Not blocking — flag as a follow-up.
- **Multi-language.** Not currently in scope. If any club is bilingual (Māori/English is likely for some NZ clubs) we'll want a `locale` field on the club + a fallback strategy.
- **Analytics.** Do we want first-party analytics on the public sites (e.g. Plausible embedded in the Nuxt app) or leave it to owners? Not blocking.
- **CDN vs origin caching split.** For MVP, edge-cache everything with 1-5 min SWR is fine. Post-MVP consider Cloudflare Cache-Tags per club so we can purge with one call.

---

## 11. Suggested build order

1. **`clubs_data.primary_host` migration** — every existing + future club needs one. Compute from `subdomain + '.torny.club'`.
2. **`GET /clubs/resolve`** — smallest endpoint, unblocks the tenant middleware.
3. **`GET /public/clubs/:slug/site`** — bulk data, unblocks every page.
4. **Onboarding complete fires the revalidate webhook** — smallest CRM mutation event.
5. **Wire the rest of the CRM's public-affecting mutations** (per §4 table).
6. Custom hostnames + Nuxt page wire-up follow in parallel once §§1-3 are green.

---

## 12. Contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`. Happy to pair through the resolve caching strategy or the HMAC contract if useful.
