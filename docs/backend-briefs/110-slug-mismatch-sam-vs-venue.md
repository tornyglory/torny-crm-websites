# Brief 110 — Club slug mismatch between the SAM / CRM stack and the Venue stack

> **STATUS — SHIPPED 2026-11-21** (commit `8f6b5a5`). `GET /clubs/resolve`
> now returns the real `clubs_data.slug` under `data.slug`, with
> `data.subdomain` added as a sibling field. The original brief's
> "two drifted columns across two stacks" premise was wrong — see §3.
> FE action required: audit any place that uses `data.slug` from resolve
> as a subdomain substitute (URL construction, email link-back, etc.) and
> switch to `data.subdomain` or `data.primary_host`. Downstream Venue-stack
> calls keep working unchanged.

**Scope:**
- API (SAM / CRM stack): `/clubs/resolve` response-shape change. Venue stack untouched.
- FE (`tornyglory/torny-crm-websites`): one-site audit — swap `data.slug` → `data.subdomain` anywhere the field was being used to construct `<sub>.torny.pro` URLs.

**Prereq:** none. Live in prod.

---

## 1. The bug

Same club, two different slug values on two different backend stacks (as observed from the FE):

| Stack | Column / endpoint | Value for Naenae |
|---|---|---|
| **SAM / CRM** | `/clubs/resolve` → `data.slug` | `naenae-bowling-club` |
| **Venue** | `/public/clubs/:slug/venue-*` match on `clubs_data.slug` | `nae-nae-bowling-club` |

Reproduced on 2026-11-20 against prod:

```js
fetch('.../clubs/resolve?host=naenae-bowling-club.torny.pro')
    .then(r => r.json()).then(j => j.data.slug)
// → "naenae-bowling-club"

fetch('.../public/clubs/naenae-bowling-club/venue-packages')
// → 404 not_found

fetch('.../public/clubs/nae-nae-bowling-club/venue-packages')
// → 200 { packages: [...] }
```

The FE had no way to know the slug it got from resolve wasn't the slug the Venue stack would accept — same key name, same shape, different value.

---

## 2. Blast radius

Every Venue-stack endpoint called by the public club site, keyed by slug:

- `GET /public/clubs/:slug/variant` (brief 105)
- `GET /public/clubs/:slug/custom-facets` (brief 105)
- `GET /public/clubs/:slug/venue-packages` (brief 109)
- `GET /public/clubs/:slug/venue-availability` (brief 109)
- Any future Venue-stack `/public/clubs/:slug/*` endpoints.

Pre-fix symptoms:
- Public venue-booking page fell back to the hardcoded demo data in `pages/venue-hire/book.vue` (hence the "Bowls on the green $180 / session · Coach + all equipment" row rendering with Clubhouse prices).
- Variant + facets happened to resolve for Naenae because they fall back to CLUB defaults on a 404 silently — hollow fallback without the admin seeing an error.

**Actual blast radius (confirmed 2026-11-20):** 2 clubs with drift out of 1,461 total rows (Naenae + a Richmond Union test row). 1,457 clubs have `clubs_data.slug IS NULL`. The symptoms were visible for Naenae because it's the only onboarded club with venue packages whose subdomain and slug differ.

---

## 3. Why it exists (the actual root cause)

**There is no `clubs` table.** The bug was never a two-stack drift. Both the SAM stack and the Venue stack read from the same `clubs_data` table on the shared Azure MySQL. What the FE saw was one handler mislabelling a single field.

`src/handlers/resolve-club/index.js` was SELECT-ing `cd.subdomain` and returning it under the field name `slug`:

```js
// pre-fix
slug: club.subdomain,
```

So for Naenae, the FE's `data.slug` always contained the subdomain value (`naenae-bowling-club`), while the Venue stack's `/public/clubs/:slug/...` endpoints match on the actual `clubs_data.slug` column (`nae-nae-bowling-club`). One row, two different fields — the resolve handler just sent the wrong one.

The brief-105 FE filter helpers (`filterLegacyJoinFormSections`, the client-side `your_bowls` strip) and brief 109's "slug note" callout were all workarounds for this single mislabel.

---

## 4. What shipped (2026-11-21, commit `8f6b5a5`)

A single handler change in `src/handlers/resolve-club/index.js`. No schema change, no migration, no backfill.

The SELECT now pulls `cd.slug` as well, and the response exposes both fields:

```diff
  return respond(200, {
      status: 'success',
      data: {
          id: club.club_id,
-         slug: club.subdomain,
+         slug: club.slug_col || club.subdomain,   // real clubs_data.slug (falls back to subdomain when null)
+         subdomain: club.subdomain,               // NEW: the tenant-routing key
          name: club.name,
          primary_host: club.primary_host,
          custom_hosts: customRows.map(r => r.hostname),
          brand_primary: club.accent_colour,
          brand_accent:  club.brand_accent || null,
          logo_url: club.logo_url,
          plan: club.plan || 'starter',
          onboarded_at: club.onboarded_at,
      },
  }, CACHE_HEADERS);
```

### What this means

- `data.slug` is now "the key you pass to every `/public/clubs/:slug/*` call" — the canonical venue/content lookup key. For the 2 clubs whose subdomain and slug differ, this value is **different from before**.
- `data.subdomain` is new. It's the tenant-routing key (`<sub>.torny.pro`). FE code that was using `slug` for URL construction should move here.
- For the 1,457 clubs where `clubs_data.slug IS NULL`, the fallback returns the subdomain under `slug`, so behaviour is unchanged.
- For the 2 drift clubs (Naenae + Richmond Union), `slug` now returns the real slug. Downstream calls that were failing now succeed.

### Why not Options A / B / C from the original brief

- **A (one canonical slug synced across two tables):** there are no two tables to sync. One mislabelled field, not drifted columns.
- **B (resolve returns both slugs):** almost what we did, but the brief framed it as "venue_slug alongside slug forever." The real shape is `slug` (canonical) + `subdomain` (routing key) — different semantics, not two names for the same concept.
- **C (Venue stack tolerant lookup):** would hide the real bug behind a fallback and add a DB hit per request.

---

## 4.1 Addendum (2026-11-21, discovered while wiring the FE)

The resolve handler fix is right, but five `/public/clubs/:slug/*` endpoints across both stacks turn out to key on **different** slug shapes. Observed against prod:

| Stack | Endpoint | Accepts `clubs_data.slug` (`nae-nae-bowling-club`) | Accepts subdomain (`naenae-bowling-club`) |
|---|---|---|---|
| SAM | `site` | 404 | ✅ 200 |
| SAM | `events` | 404 | ✅ 200 |
| Venue | `variant` | 404 | ✅ 200 |
| Venue | `custom-facets` | 404 | ✅ 200 |
| Venue | `venue-packages` | ✅ 200 | 404 |
| Venue | `venue-availability` | ✅ 200 | 404 |

So the brief's §6 claim "`GET /clubs/resolve` → `data.slug` and `GET /public/clubs/:slug/*` on the Venue stack accept the same value for every club" holds **only for the two venue endpoints**. The other four public endpoints across both stacks still key on subdomain. Post-fix, every FE call that was blindly passing `data.slug` through to `site`, `events`, `variant`, or `custom-facets` 404s for the ~2 drift clubs — reproducing today as "Naenae's entire website is blank" because `useSite()` now returns null and PageRenderer falls back to chrome-only.

**FE workaround shipped today (2026-11-21):**
- `useSite()` → prefers `club.subdomain ?? club.slug`.
- `useVariant()` + `usePublicFacets()` → prefer `club.subdomain ?? club.slug`.
- `BlockContext` gets a sibling `clubSubdomain` alongside `clubSlug`.
- `EventsCalendarBlock` → reads `clubSubdomain` for its public endpoint call.
- `VenueBookingBlock` + venue-availability fetch → stay on `clubSlug` (canonical venue-lookup key).
- Each call site has a brief-110 comment pointing at which key the endpoint expects.

**Backend ask (primary):** align the four subdomain-keyed endpoints (`site`, `events`, `variant`, `custom-facets`) to look up by `clubs_data.slug` as well — either by changing the handler lookup column or by accepting both shapes. Once that ships, every `/public/clubs/:slug/*` endpoint accepts `data.slug` and the FE can drop the per-call `subdomain` fallback + the dual `BlockContext` field.

**Backend ask (alternative, less invasive):** leave the handlers as they are, but also update `/clubs/resolve` to return a `venue_slug` field alongside the existing `slug` + `subdomain`, so the FE has an explicit name for "the key you pass to venue-packages." Keeps the 404 mapping explicit instead of encoding it in the FE as which-endpoint-picks-which.

Secondary observation while verifying: the variant endpoint still returns `your_bowls` in the `club` vertical's `join_form_sections`. Brief 107 asked for it to be dropped; that's independent of this brief but worth flagging. Until it ships, the FE keeps `filterLegacyJoinFormSections` + `LEGACY_JOIN_FORM_SECTION_KEYS` as defensive scaffolding (brief-105 wiring).

---

## 5. Verification

```bash
SAM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Resolve now returns both fields
curl -s "$SAM/clubs/resolve?host=naenae-bowling-club.torny.pro" | jq '.data | {slug, subdomain, primary_host}'
# → { "slug": "nae-nae-bowling-club", "subdomain": "naenae-bowling-club", "primary_host": "naenae-bowling-club.torny.pro" }

# 2. The resolved slug works end-to-end on the Venue stack
curl -s "$VENUE/public/clubs/nae-nae-bowling-club/venue-packages" | jq '.status, (.data.packages | length)'
# → "success", 3

# 3. Audit — how many clubs have drift today?
#    (Only 2 of 1 461 rows; 1 457 have null slug and use the fallback.)
SELECT COUNT(*) AS total,
       SUM(slug <> subdomain) AS drift,
       SUM(slug IS NULL) AS null_slug
  FROM clubs_data;
```

---

## 6. Pass criteria

- ✓ `GET /clubs/resolve` → `data.slug` and `GET /public/clubs/:slug/*` on the Venue stack accept the same value for every club.
- ✓ Naenae specifically: `localhost:3001/venue-hire/book?space=the-clubhouse` renders live data (3 packages × their slot cards) instead of the hardcoded demo fallback.
- ✓ The brief-109 slug-note caveat in §2.1 is now historical; it can be removed on the next edit of that doc.
- ✓ The brief-105 FE helper `filterLegacyJoinFormSections` / `LEGACY_JOIN_FORM_SECTION_KEYS` can be deleted in a follow-up PR — the backend will serve a clean list.
- ✓ No regression for the 1,457 null-slug clubs — the fallback returns subdomain under `slug`.

---

## 7. Non-goals

- Backfilling `clubs_data.slug` where null. Not needed; the fallback handles it and no onboarded club with venue features has a null slug today. Open a follow-up brief if we want the slug to be authoritative.
- Changing `clubs_data.subdomain`. Separate concern (tenant routing).
- Admin UI for renaming a slug. Brief 98 handles subdomain changes; an equivalent for slug can come later if needed.
- Cross-stack sync or triggers. There's only one table.

---

## 8. FE follow-up checklist

1. **Downstream API calls** (`/public/clubs/:slug/venue-packages`, `/variant`, `/custom-facets`, `/venue-availability`, future Venue-stack endpoints): continue passing `data.slug`. Nothing to change — this is why we did the fix.
2. **URL construction** (building `<sub>.torny.pro` links back to the tenant, link-back emails, etc.): switch from `data.slug` to `data.subdomain` or `data.primary_host`. For 2 clubs (Naenae + Richmond Union) this is a behaviour fix; for everyone else it's a no-op.
3. **Display copy**: audit any place that renders `data.slug` as human-visible text. If it should be the tenant identity, use `name` or `subdomain`; if it's the venue-lookup key, keep `slug`.
4. Remove `filterLegacyJoinFormSections` + `LEGACY_JOIN_FORM_SECTION_KEYS` from the brief-105 wiring.
5. Remove the brief-109 §2.1 slug-note from the committed brief doc.
6. `grep -r "slug" packages/content-blocks apps/club-sites` to confirm no other call site has baked in a hyphenated-variant workaround.

---

## 9. Contact

Nev on Slack (`#torny-eng`). Related briefs: 15 (public site endpoints), 93 (plan on session hydrate), 98 (change subdomain), 99 (custom domain), 105 (variant + custom facets), 106 (join-form config), 109 (public venue booking).
