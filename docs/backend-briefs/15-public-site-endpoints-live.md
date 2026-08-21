# Public Club-Sites Endpoints — Frontend Implementation Brief

**Feature:** the two public endpoints that power every `*.torny.club` (and eventually custom-hostname) site — hostname → club identity, plus the one-shot page payload. Response of `backend-public-club-sites-brief.md` — same endpoints, this time from the shipping side with real payloads.

**Related:** `backend-public-club-sites-brief.md` (the original ask), `frontend-onboarding-brief.md` (the wizard whose data these expose), `frontend-club-crm-brief.md` (admin side).

**Status:** ✅ shipped 2026-08-21. Both endpoints are live in prod on the CRM API. Migration 087 applied. Onboarding-complete fires the revalidate hook (no-op until Nuxt hands over the shared secret).

---

## TL;DR

- **`GET /clubs/resolve?host=…`** — hostname → club identity. Call from the Nuxt tenant middleware on every request. `www.` stripping is server-side. 5-min cache header.
- **`GET /public/clubs/{slug}/site`** — one-shot payload with club/contact/hours/tiers/events/honour-board/pages_enabled. Ready to feed every page shell. 1-min cache header.
- **`slug === subdomain`** — resolved brief open Q1 in that direction. Onboarding writes `clubs_data.subdomain`; that value is the slug the frontend uses in URLs.
- **Both are unauthenticated.** No JWT. No CORS restrictions.
- **`POST /clubs/{id}/onboarding/complete` fires the Nuxt revalidate webhook.** HMAC-signed with `sha256=<hex>` header `X-Torny-Signature`. Silent no-op until you give us `NUXT_REVALIDATE_SECRET`.

---

## Base URL

```ts
export const CLUB_SITES_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

Same base as `/me`, `/claims`, admin queue, onboarding, bulk import, roster, member CRUD — the CRM stack.

---

## 1. `GET /clubs/resolve?host=…`  (public, no auth)

Convert a hostname to a club identity. Called by the Nuxt tenant middleware on every incoming request.

**Query param:** `host` — lowercased hostname. `www.` prefix is stripped server-side.

**200 Success:**
```json
{
  "status": "success",
  "data": {
    "id": 3,
    "slug": "melbourne-bowling-club",
    "name": "Melbourne Bowling Club",
    "primary_host": "melbourne-bowling-club.torny.club",
    "custom_hosts": [],
    "brand_primary": "#DC2626",
    "logo_url": null,
    "onboarded_at": "2026-08-20T22:50:05.000Z"
  }
}
```

**404 Not found:**
```json
{ "status": "error", "code": "unknown_host" }
```

Cache-Control: `public, max-age=300, stale-while-revalidate=3600` on 200s. Not set on 404s.

---

## 2. `GET /public/clubs/{slug}/site`  (public, no auth)

One-shot payload for the Nuxt club-sites app.

Returns `{ club, contact, hours[], membership_tiers[], cadence, first_year_discount, events_upcoming[], honour_board_recent[], pages_enabled }`. See original brief for full field-by-field notes.

Cache-Control: `public, max-age=60, stale-while-revalidate=300`.

---

## 3. Revalidate webhook — CRM → Nuxt

**Request:**
```
POST https://sites.torny.club/api/revalidate
Content-Type: application/json
X-Torny-Signature: sha256=<hex>

{ "clubId": 3, "slug": "melbourne-bowling-club", "paths": ["/"], "reason": "club.onboarded" }
```

HMAC-SHA256 over the raw body with `NUXT_REVALIDATE_SECRET`.

**Wired today:** `POST /clubs/{id}/onboarding/complete` fires with `paths: ["/"]`, `reason: "club.onboarded"`. Rest land as edit endpoints ship.

**Blocking on frontend:** generate `NUXT_REVALIDATE_SECRET` (32+ random bytes) + share via secure channel.

---

## 4. What backend has verified in prod

- Two clubs onboarded (`melbourne-bowling-club`, `richmond-union-test-30596`) — both resolve correctly.
- Un-onboarded clubs → 404.
- `www.` prefix stripping tested.
- Cache-Control headers set correctly.

---

## 5. What backend still needs from us

1. Generate `NUXT_REVALIDATE_SECRET` + share.
2. Implement `sites.torny.club/api/revalidate` receiver — verify HMAC, purge Cloudflare cache + KV.
3. Confirm wildcard DNS + Cloudflare for SaaS ready.
4. Confirm `CLUB_SITES_BASE` is the right base.

---

## 6. Known payload gaps

- `events_upcoming[].format` / `capacity` / `rsvp_open` return `null` — `club_events` schema doesn't have those columns yet.
- `contact.google_maps_url` returns `null` — no column; build from `address` client-side.
- Honour-board category slugs are kebab-cased from name at query time — no dedicated slug column.

---

## 7. Contact

`#torny-eng` on Slack.
