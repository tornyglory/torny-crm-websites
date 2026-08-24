# Post-onboarding fixes — CORS on `/clubs/:id` + seed system pages on complete

**Feature:** two small backend bugs surfaced when a new club (id=5) completed onboarding on prod. Both are blockers for the second-club-per-owner flow.

**Status:** reported by Nigel Upper on 2026-08-24 — the second club he claimed and onboarded couldn't publish because the CRM's page endpoints 404 for that club, and the sidebar/dashboard couldn't hydrate club-level details because a CORS preflight fails.

**Repro:** sign in as an owner of two clubs (e.g. Kelburn + Nae Nae), complete onboarding for the second club, land on Website editor → Publish button → 404. Console also shows CORS errors for `/clubs/:id`.

---

## TL;DR

1. **`GET /clubs/:id` on CRM_BASE (`byi59x19m4…`) is missing `Access-Control-Allow-Origin`.** Every other route on that stack returns CORS headers fine; just this one is broken. Blocks the CRM's `hydrateFull()` and any code path that reads the club record.
2. **`POST /clubs/:id/onboarding/complete` isn't seeding the six system pages** (`home`, `about`, `membership`, `events`, `honour-board`, `contact`). The Website editor's `GET /clubs/:id/pages/home` returns 404, so `POST /clubs/:id/pages/home/publish` also 404s. Owners can't publish anything until every page row is manually created.
3. **`POST /clubs/:id/onboarding/complete` isn't writing `subdomain` / `primary_host` to the `clubs` table.** New club (id=5) hits `/clubs/resolve?host=<slug>.torny.club` and gets 404 — the Preview button and the live site both land on the tenant-not-found page.

All three are the same finalize-transaction gap — frontend is correct and can't paper over them.

---

## 1. CORS on `GET /clubs/:id`

### Symptom

From the browser console when `hydrateFull()` fires after switching clubs:

```
Access to fetch at 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/5'
from origin 'http://localhost:5174' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Same error for `/clubs/3`. Every other CRM_BASE endpoint (auth, `/me`, `/onboarding`, `/pages`, `/style-presets`, `/font-pairs`, etc) works cleanly from the same origin, so the deployment / gateway config for **this route only** is missing the CORS response headers.

### Frontend context

CRM `useClubStore.hydrateFull()` (`apps/crm/src/stores/club.ts:83`) fetches:

```ts
const res = await authedFetch<Envelope<Club>>(`${CRM_BASE}/clubs/${c.id}`)
```

The response shape (working locally against a mock) is:

```json
{
  "status": "success",
  "data": {
    "id": 5,
    "slug": "nae-nae-bowling-club",
    "name": "Nae Nae Bowling Club",
    "domain": null,
    "brandPrimary": "#2563EB",
    "logoUrl": "https://…",
    "faviconUrl": null,
    "fonts": { … },
    "style": { … },
    "navigation": { … }
  }
}
```

The frontend catches the transport failure and leaves `slug`/`brand`/`logo` unset, so the CRM sidebar shows initials instead of the logo and the "View live site" button links to the wrong URL. Silent degradation, not a hard error — but a fix is needed for the sidebar to render correctly.

### What needs to change

Add the standard CORS headers to `GET /clubs/:id` responses (and the corresponding `OPTIONS` preflight). Match whatever pattern is used on `GET /me` or `GET /clubs/:id/onboarding` on the same stack — those work.

Headers needed on both the 200 response *and* the OPTIONS preflight:

```
Access-Control-Allow-Origin: *          (or the configured origin whitelist)
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

### Verification

```bash
curl -i -X OPTIONS 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/5' \
  -H 'Origin: http://localhost:5174' \
  -H 'Access-Control-Request-Method: GET'
```

Expect `Access-Control-Allow-Origin` on the response headers.

```bash
curl -i 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/5' \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Origin: http://localhost:5174'
```

Expect `Access-Control-Allow-Origin` on the 200 response headers.

---

## 2. Seed system pages on `POST /clubs/:id/onboarding/complete`

### Symptom

After onboarding club 5 (Nae Nae), the CRM's Website editor tries to load the home page:

```
GET  https://byi59x19m4…/Prod/clubs/5/pages/home           → 404 not_found
POST https://byi59x19m4…/Prod/clubs/5/pages/home/publish   → 404 not_found
```

Payload of the 404 body:

```json
{ "status": "error", "code": "not_found", "message": "Page not found" }
```

The same requests for club 3 (Kelburn — onboarded before this bug) return normally, so the regression is specifically that new clubs don't get their default `pages` rows created.

### What needs to change

`POST /clubs/:clubId/onboarding/complete` should, as part of the finalize transaction, insert (or upsert) a default row for each of the six system-page slugs:

- `home`
- `about`
- `membership`
- `events`
- `honour-board`
- `contact`

For each row:

```
pages
  club_id           = :clubId
  slug              = <slug>
  title             = <default title, e.g. 'Home', 'About', …>
  is_system         = TRUE
  is_published      = FALSE       (owner publishes explicitly)
  position          = index in the six-slug list
  layout_draft      = seeded default template (see below)
  layout_published  = NULL
```

Backend already stores custom pages this way (brief 27) — this is just seeding the six system slugs at onboarding time so `GET /clubs/:id/pages/:slug` doesn't 404.

### Default `layout_draft` per system page

The CRM's Website editor has hardcoded default templates in `apps/crm/src/views/website/WebsiteEditorView.vue` (`seed()` helper, line ~440). It renders those templates client-side if `layout_draft` is `null`. So the backend could either:

- **A.** Seed each row with `layout_draft = null` and let the frontend fall back to the client template on first open (simplest).
- **B.** Seed each row with a canonical default `layout_draft` payload the backend keeps in sync (more work).

Recommend **A** — matches how the frontend already behaves for pre-existing clubs whose system pages were seeded before layouts were stored, and avoids duplicating the seed templates on both sides. If we want richer server-authored defaults later, we can flip to B without breaking the CRM.

### Idempotency

The complete endpoint is documented as idempotent (returns `already_onboarded` on second call). The page-seeding should be as well:

- Use `INSERT … ON CONFLICT (club_id, slug) DO NOTHING` (or equivalent).
- Do not overwrite existing rows for clubs that already have system pages.

### Backfill for existing clubs

Club 3 (Kelburn, onboarded pre-fix) already has its rows. Club 5 (Nae Nae, onboarded post-regression) doesn't. Once the fix ships, either:

1. **Backfill migration** — one-off UPDATE that scans every onboarded club, inserts missing system-slug rows. Preferred so we don't leave the fleet in a bimodal state.
2. **Call `complete()` again for affected clubs** — simpler but requires knowing which ones are affected. If the count is low (right now: 1), a manual SQL fix is fine.

Recommend the backfill migration. Cheap and it prevents future what-if.

### Verification

After hitting `POST /clubs/5/onboarding/complete` (or after the backfill migration runs):

```sql
SELECT slug, is_system, is_published FROM pages WHERE club_id = 5 ORDER BY position;
```

Should return exactly 6 rows: `home`, `about`, `membership`, `events`, `honour-board`, `contact`, all `is_system = TRUE`, all `is_published = FALSE`.

Then from the CRM:

```
GET  /clubs/5/pages/home  → 200 with the seeded row
POST /clubs/5/pages/home/publish  → 200 with public_url
```

---

## 3. Also missing on complete — `clubs.subdomain` / `clubs.primary_host`

### Symptom

Clicking **Preview site** in the CRM's Website editor for club 5 opens the Nuxt club-sites dev server:

```
http://localhost:3001/?host=nae-nae-bowling-club.torny.club
```

The Nuxt tenant middleware calls the backend:

```
GET /clubs/resolve?host=nae-nae-bowling-club.torny.club  →  404 unknown_host
```

Landing on the fallback page: **"Club not found for host"**.

Melbourne (id=3) resolves fine at `melbourne-bowling-club.torny.club` — proving the `/clubs/resolve` endpoint itself works. The regression is that club 5 doesn't have `primary_host` (or `subdomain`) populated in the `clubs` table.

### What needs to change

Same finalize transaction as Issue 2 — when a club onboards, `POST /clubs/:id/onboarding/complete` should copy the wizard's `subdomain` field into the `clubs` table:

```
clubs
  subdomain     ← onboarding_data.subdomain   (e.g. 'nae-nae-bowling-club')
  primary_host  ← <subdomain>.torny.club       (or leave computed at read time)
```

`GET /clubs/resolve?host=<slug>.torny.club` should match either an exact `primary_host` row or the derived `<subdomain>.torny.club` value — however Melbourne's row is set up, replicate that for new completions.

### Idempotency

- Complete endpoint already returns `already_onboarded` on second call — safe to re-run in a backfill.
- Subdomain uniqueness constraint (already enforced by `GET /subdomains/check` during Step 6) means the finalize can trust the wizard's value.

### Backfill

Same story as Issue 2 — club 5 needs `subdomain` set retroactively. If the wizard's `onboarding_data.subdomain` is still stored on the row, the migration is trivial (`UPDATE clubs SET subdomain = onboarding_data->>'subdomain' WHERE onboarded_at IS NOT NULL AND subdomain IS NULL`).

### Verification

```bash
curl -i 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=nae-nae-bowling-club.torny.club'
```

Expect 200 with `data.id = 5` after the fix / backfill.

---

## 4. Priority

- **Issue 2 (missing pages)** — hard block on publishing.
- **Issue 3 (missing subdomain)** — hard block on Preview / live site — the new club is unreachable via its subdomain.
- **Issue 1 (CORS)** — cosmetic (sidebar shows initials, "View live site" links to `undefined.torny.club`).

All three are the same "onboarding complete isn't fully finalising the club record" pattern — ideally fixed in one pass with a shared backfill migration for any clubs onboarded post-regression.

---

## 4. Contact

`#torny-eng`. Both fixes are localised — the CORS one is a config drift on a single route, and the page-seeding one is a missing block in the onboarding-complete transaction. Ping if the seed default (option A vs B) needs a call.
