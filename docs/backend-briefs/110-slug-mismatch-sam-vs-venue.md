# Brief 110 — Club slug mismatch between the SAM / CRM stack and the Venue stack

**Scope:**
- API (both stacks): make the slug the FE receives from `/clubs/resolve` (SAM / CRM stack) usable on every public Venue-stack endpoint. Pick one of the three options in §4 and ship it.
- FE (`tornyglory/torny-crm-websites`): no changes needed for options A or C. Option B needs one trivial shape change (consume a new field on the resolve response).

**Prereq:** none. Hit on live data today (2026-11-20) — easy to repro with Naenae.

> **Backend status (2026-11-20):** suspected single-source-of-truth bug across `clubs` (SAM) and `clubs_data` (Venue). Flagging for Nev to pick the fix rather than the FE hacking around it per-call site. Brief 109's §2.1 even calls the gotcha out ("Slug note: the club's slug lives on `clubs_data.slug` (e.g. `nae-nae-bowling-club`), not `subdomain` (`naenae-bowling-club`). Easy mistake.") — same symptom, this brief is the structural fix.

---

## 1. The bug

Same club, two different slug values on two different backend stacks:

| Stack | Column / endpoint | Value for Naenae |
|---|---|---|
| **SAM / CRM** | `clubs.slug` (via `GET /clubs/resolve`) | `naenae-bowling-club` |
| **Venue** | `clubs_data.slug` (used by `/public/clubs/:slug/venue-*`) | `nae-nae-bowling-club` |

Reproduced today via `localhost:3001`:

```js
// Resolved tenant on the Nuxt dev server
fetch('/api/site/naenae-bowling-club').then(r => r.json()).then(j => j.club.slug)
// → "naenae-bowling-club"

// Same slug against the Venue stack
fetch('https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/naenae-bowling-club/venue-packages')
// → 404 not_found

// With the Venue-stack slug instead
fetch('https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/nae-nae-bowling-club/venue-packages')
// → 200 { packages: [...] }
```

The FE has no way to know the slug it got from resolve isn't the slug the Venue stack will accept — same key name, same shape, different value.

---

## 2. Blast radius

Every Venue-stack endpoint called by the public club site, keyed by slug:

- `GET /public/clubs/:slug/variant` (brief 105) — CRM sidebar + public join form
- `GET /public/clubs/:slug/custom-facets` (brief 105) — custom join-form fields
- `GET /public/clubs/:slug/venue-packages` (brief 109) — venue booking page
- `GET /public/clubs/:slug/venue-availability` (brief 109) — venue calendar
- Anything else Venue-stack that lands `/public/clubs/:slug/*` in future.

Today the symptom is:

- Public venue-booking page falls back to the hardcoded demo data in `pages/venue-hire/book.vue` (hence the "Bowls on the green $180 / session · Coach + all equipment" row rendering on `?space=green-bbq` with Clubhouse prices — see screenshot in Slack thread).
- Variant + facets happen to resolve for Naenae because they fall back to their own CLUB defaults on a 404 silently, so the sidebar + join form render on `naenae-bowling-club`-style slugs by coincidence. Any club whose two slug columns drift gets the same hollow fallback without the admin ever seeing an error.

How many clubs have drift today? Unknown without a diff of the two tables. For Naenae the drift is visible; the brief-109 author flagged the gotcha preemptively, which suggests it's wider than one club.

---

## 3. Why it exists

Legacy. The two stacks sync `clubs.name`, `clubs.subdomain`, `clubs.plan`, etc., but the `slug` column is independent — nothing enforces that `clubs.slug` and `clubs_data.slug` carry the same string. At some point they diverged (presumably when `subdomain` was normalised differently on each side — Naenae's `clubs.subdomain` is `naenae-bowling-club` on both, but the derived slug landed hyphenated differently). No explicit migration ever aligned them.

The brief-105 and brief-106 FE filters (`filterLegacyJoinFormSections`, the client-side `your_bowls` strip) and brief 109's "slug note" callout are all symptoms of this — the FE has been papering over single-stack inconsistencies rather than the root cause.

---

## 4. Fix options (backend picks one)

### Option A — one canonical slug, synced ✅ recommended

- Pick a canonical: whichever stack the admin UI writes to today (my bet: `clubs.slug` on SAM, since that's what onboarding writes and what `/clubs/resolve` returns).
- One-time migration to overwrite `clubs_data.slug` from `clubs.slug` for every club. Run in a transaction, log diff counts, keep a backup table.
- Add an ongoing sync on every slug change — either a trigger, an app-layer dual-write, or a nightly reconciliation job depending on how the two stacks talk today.
- FE: zero changes. The slug it already has works everywhere.

Risks: existing bookings / applications / data rows in Venue-stack tables that reference `clubs_data.slug` need to rehome. Scan first; most reference `club_id`, not slug, so this should be clean.

### Option B — resolve returns both slugs

- `/clubs/resolve` response gains a `venue_slug: string | null` field alongside the current `slug`. FE uses `venue_slug ?? slug` on every Venue-stack call.
- Zero data migration, zero behaviour change on the slug columns.
- FE changes: `Club` interface + `BlockContext.clubSlug` need a sibling `venueClubSlug`. Easy, but introduces two names for the same concept forever.

Risks: perpetuates the drift. Every future Venue-stack contract repeats the "pass the right slug" dance. Doesn't fix the admin UX if they rename a club.

### Option C — Venue stack accepts either slug

- Venue-stack `/public/clubs/:slug/*` handlers lookup by `clubs_data.slug` first, fall back to `clubs_data.subdomain` (or a join with SAM's `clubs.slug` if the stacks share the DB, or a resolve-map if they don't).
- Zero data migration, zero FE changes.
- Risks: hides the drift forever behind a tolerant lookup. Harder to spot related bugs. Slower per-request if the fallback is a second DB hit.

### My recommendation

**Option A.** Cleanest end state, same slug everywhere, the FE's current slug-from-resolve path keeps working. B and C are both forms of living with the drift.

---

## 5. Verification

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
SAM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Current drift — before fix
curl -s "$SAM/clubs/resolve?host=naenae-bowling-club.torny.co" | jq '.data.slug'
# → "naenae-bowling-club"

curl -s "$VENUE/public/clubs/naenae-bowling-club/venue-packages" | jq '.status, .data.packages | length'
# → "error", null

# 2. After Option A ships — both endpoints agree
curl -s "$SAM/clubs/resolve?host=naenae-bowling-club.torny.co" | jq '.data.slug'
# → "naenae-bowling-club"

curl -s "$VENUE/public/clubs/naenae-bowling-club/venue-packages" | jq '.data.packages | length'
# → 3

# 3. Audit — how many clubs still have drift before the migration?
SELECT c.id, c.subdomain, c.slug AS sam_slug, cd.slug AS venue_slug
FROM clubs c
JOIN clubs_data cd ON cd.club_id = c.id
WHERE c.slug <> cd.slug;
# Report the count so we know the blast radius before picking the plan.
```

---

## 6. Pass criteria

- ✓ `GET /clubs/resolve` → `data.slug` and `GET /public/clubs/:slug/*` on the Venue stack accept the same value for every club.
- ✓ Naenae specifically: the public venue-booking page at `localhost:3001/venue-hire/book?space=green-bbq` renders $220 / $220 / $400 from live data (not the hardcoded demo fallback).
- ✓ Legacy data in Venue-stack tables (bookings, applications, custom facets, etc.) continues to map to the right club after the migration — no orphans.
- ✓ Future slug renames don't resurrect the drift (sync mechanism tested on at least one dev club).
- ✓ The brief-105 `filterLegacyJoinFormSections` and brief-109 slug-note become historical — can be ripped out on the FE in a follow-up once the fix ships.

---

## 7. Non-goals

- **Changing the `clubs.subdomain` column.** That's a separate concern (tenant routing). Only the `slug` columns are in scope.
- **Public custom domains.** Already covered by `custom_hosts` on the resolve response and brief 99; they're keyed by host, not slug.
- **Admin UI for renaming a slug.** Brief 98 handles subdomain changes via `/clubs/{id}/change-subdomain`; an equivalent for slug can come later if needed, but this brief only cares about aligning the existing columns.

---

## 8. FE follow-up after this ships

Once Option A (or equivalent) lands and the audit confirms zero drift:

1. Remove the brief-105 FE filter helpers (`filterLegacyJoinFormSections`, `LEGACY_JOIN_FORM_SECTION_KEYS`) — they're defensive only; the backend will serve a clean list.
2. Remove the brief-109 slug-note from the committed brief doc (`docs/backend-briefs/109-public-venue-booking-live-data.md` §2.1) with a note that it's historical.
3. Full roster audit: `grep -r "slug" packages/content-blocks apps/club-sites` to confirm no other call site has baked in a hyphenated-variant workaround.

---

## 9. Contact

Nev on Slack (`#torny-eng`). Reproduces on Naenae today. Related briefs: 15 (public site endpoints), 93 (plan on session hydrate), 98 (change subdomain), 99 (custom domain), 105 (variant + custom facets), 106 (join-form config), 109 (public venue booking).
