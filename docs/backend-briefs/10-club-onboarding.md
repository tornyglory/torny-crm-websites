# Backend brief — Club onboarding wizard

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` — `/crm/onboarding/*` (6-step wizard)
**Related:** [01-auth-and-club-claim.md](./01-auth-and-club-claim.md) (claim approval provisions the club row this brief extends), [08-backend-response-m1-m3-m4-live.md](./08-backend-response-m1-m3-m4-live.md) (`/me` returns `clubs[]` — this brief flips those clubs from "provisioned" to "onboarded")
**Status:** Frontend wizard is fully built, persisting to `localStorage` under `torny.crm.onboarding.{clubId}`. Every field is validated client-side and every step animates cleanly. **Zero of it hits the server today** — every seam is ready to swap when these endpoints land.
**Owner:** Neville Rodda (`nev@torny.co`)

---

## 1. Why this matters now

A claim gets approved → owner lands on `/crm/onboarding/welcome`. They walk through 6 steps of "tell us about your club". Right now:

- Fields save to localStorage. Great for resume-on-refresh, terrible for anything else (new device, different browser, admin sees stale data).
- `markComplete()` just flips a local flag. The `clubs_data` row stays as the sparse directory-imported version.
- The public site (Nuxt) has nothing to render — no hours, no membership tiers, no tagline.

Point of onboarding is to **turn the sparse `clubs_data` row (name, region, sport, provisioned_at) into a full, publishable club record.** Until this lands, every club looks half-abandoned.

---

## 2. What the wizard collects

Per `apps/crm/src/stores/onboarding.ts` — mirror this exactly:

### Step 1 — Club basics
```ts
{
  clubName: string           // required, ≤ 120 chars
  yearFounded: string        // 4-digit year, or empty
  clubType: 'community' | 'private' | 'district'
  shortDescription: string   // ≤ 500 chars, plain text
}
```

### Step 2 — Where you play
```ts
{
  address: string            // freeform street + number
  suburb: string
  region: string
  country: string            // ISO name; defaults to 'New Zealand'
  greens: number             // 1–20
  rinks: number              // 1–100
  greenSurface: 'tifdwarf' | 'cotula' | 'synthetic' | 'mixed'
}
```

### Step 3 — Contact & hours
```ts
{
  email: string              // public contact email
  phone: string              // public contact phone
  hours: Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', {
    open: boolean
    from: string             // "HH:MM" 24h, empty if closed
    to: string
  }>
}
```

### Step 4 — Membership
```ts
{
  cadence: 'annual' | 'monthly' | 'season'
  firstYearDiscount: boolean
  tiers: Array<{
    id: string               // client slug — 'playing' | 'social' | 'junior' | custom
    name: string
    description: string
    price: number             // dollars, integer
    tone: 'accent' | 'mint' | 'tangerine' | 'violet'   // UI colour hint — pass through
    isDefault?: boolean
  }>
}
```

### Step 5 — Brand
```ts
{
  logoName: string | null    // filename (upload flow TBD — see §6)
  accentColour: string       // hex — "#2563EB"
  tagline: string            // ≤ 140 chars
}
```

### Step 6 — Website
```ts
{
  subdomain: string          // lowercase-hyphens, 3–30 chars, must be unique across Torny
  pages: Record<'home'|'about'|'membership'|'events'|'shop', boolean>
}
```

---

## 3. Endpoints

Recommended shape — 3 endpoints. All at CRM_BASE. All require the caller to be `owner` on the target club (`admin` may fill it in on behalf of the owner — brief-worthy discussion, but for MVP: owner only).

### 3.1 `GET /clubs/:clubId/onboarding`

Returns the current onboarding state so the frontend can hydrate on any device.

**Response:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "step": "welcome" | 1 | 2 | 3 | 4 | 5 | 6 | "complete",
    "completed": false,
    "completedAt": null,
    "data": {
      "clubName": "Melbourne Bowling Club",
      "yearFounded": "1864",
      "clubType": "private",
      "shortDescription": "...",
      "address": "12 Bowling Green Rd",
      "suburb": "Windsor",
      "region": "Victoria",
      "country": "Australia",
      "greens": 3,
      "rinks": 24,
      "greenSurface": "cotula",
      "email": "hello@melbournebowls.au",
      "phone": "+61 3 5555 0000",
      "hours": { "mon": { "open": true, "from": "15:00", "to": "20:00" }, ... },
      "cadence": "annual",
      "firstYearDiscount": true,
      "tiers": [ { "id": "playing", "name": "Playing member", ... }, ... ],
      "logoUrl": "https://…" | null,
      "accentColour": "#2563EB",
      "tagline": "Roll up in Windsor since 1864.",
      "subdomain": "melbourne",
      "pages": { "home": true, "about": true, "membership": true, "events": true, "shop": false }
    }
  }
}
```

If the club has never touched onboarding, return `step: "welcome"`, `completed: false`, `data` populated with whatever's already on the `clubs_data` row (clubName pre-filled from the directory record — everything else empty/default). Frontend will re-derive defaults for anything missing.

### 3.2 `PATCH /clubs/:clubId/onboarding`

Autosave. Frontend calls this on advance from each step. Accepts a partial `data` object plus an optional `step` marker so we can resume where the owner left off.

**Request:**
```json
{
  "step": 2,
  "data": {
    "address": "12 Bowling Green Rd",
    "suburb": "Windsor",
    "region": "Victoria",
    "country": "Australia",
    "greens": 3,
    "rinks": 24,
    "greenSurface": "cotula"
  }
}
```

**Response:**
```json
{ "status": "success", "data": { "clubId": 3, "step": 2, "updatedAt": "..." } }
```

Rules:
- Partial patch — only send what changed. Server merges over stored values.
- `step` is just a bookmark — server does not enforce step order. Frontend can PATCH out of order.
- Idempotent. Rapid-fire PATCHes from a distracted owner are fine.
- Validate individual fields but do NOT reject the whole payload if one field's wrong — return `warnings[]` so autosave doesn't feel punitive. Only reject on obvious garbage (SQL injection attempts, malformed JSON).

**Errors:**
- `400 bad_json` — malformed body
- `401` — no auth
- `403 forbidden` — caller isn't `owner`
- `404` — club doesn't exist / caller isn't a member
- `422 subdomain_taken` — `data.subdomain` conflicts with an existing club (checked on every PATCH since it's the one field with cross-club uniqueness)

### 3.3 `POST /clubs/:clubId/onboarding/complete`

Finalize. This is the "flip the club to publishable" call. Runs validation across every field, provisions the public site, marks the club `onboarded_at`.

**Request:** empty body — the server uses whatever's been PATCHed in.

**Response:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "onboardedAt": "2026-08-21T10:14:22.000Z",
    "publicUrl": "https://melbourne.torny.club",
    "membershipTierIds": [ 101, 102, 103 ]
  }
}
```

**Atomic transaction:**
1. Validate all required fields (see §5). If anything fails, return `422` with a full `errors: [{ field, code, message }]` array — nothing is written.
2. Update the `clubs_data` row with the flat fields.
3. Insert `club_hours` rows (7 per club — one per day).
4. Insert `membership_tiers` rows — return their integer IDs so the frontend can key off them later.
5. Insert `public_site_pages` rows for the pages toggled on.
6. Set `clubs_data.onboarded_at = NOW()`.
7. Fire the `club.onboarded` webhook so the public site build kicks off.

**Errors:**
- `422 validation_failed` with `errors: [ ... ]` — see §5 for the code table
- `409 subdomain_taken` — someone else grabbed the subdomain between PATCH and complete
- `403 forbidden` — not `owner`
- Others as above

---

## 4. Data model sketch

Not prescriptive — implement in whatever store the team's standardising on.

```
clubs_data                    -- extended, mostly nullable until onboarding
  ...existing columns...
  year_founded INT NULL
  club_type ENUM('community','private','district') NULL
  short_description TEXT NULL
  address_line VARCHAR(200) NULL
  suburb VARCHAR(100) NULL
  -- region, country already on the row from directory
  greens INT NULL
  rinks INT NULL
  green_surface ENUM('tifdwarf','cotula','synthetic','mixed') NULL
  contact_email VARCHAR(200) NULL
  contact_phone VARCHAR(50) NULL
  cadence ENUM('annual','monthly','season') NULL
  first_year_discount BOOL DEFAULT false
  logo_url VARCHAR(500) NULL
  accent_colour VARCHAR(7) NULL           -- '#RRGGBB'
  tagline VARCHAR(280) NULL
  subdomain VARCHAR(30) UNIQUE NULL       -- unique across the whole platform
  onboarded_at TIMESTAMP NULL
  onboarding_step VARCHAR(20) DEFAULT 'welcome'
  onboarding_data JSONB NULL              -- raw payload from PATCH — audit + partial saves

club_hours
  id, club_id FK, day ENUM('mon',...'sun'),
  is_open BOOL, open_time TIME NULL, close_time TIME NULL,
  UNIQUE(club_id, day)

membership_tiers
  id, club_id FK, slug VARCHAR(50),        -- client-supplied slug + integer PK
  name VARCHAR(100), description TEXT,
  price INT,                                -- cents or dollars — pick one, document
  cadence VARCHAR(20),                      -- copied off clubs_data for tier-level future flexibility
  tone VARCHAR(20),                         -- opaque UI hint
  is_default BOOL DEFAULT false,
  sort_order INT DEFAULT 0,
  active BOOL DEFAULT true

public_site_pages
  id, club_id FK, slug VARCHAR(30),
  is_published BOOL,
  UNIQUE(club_id, slug)
```

Why `onboarding_data JSONB`? PATCH accepts partial data — persisting it as JSON lets us reconstruct the exact wizard state (including tone hints, custom tier ids, etc.) without a table-per-field expansion. On complete, we split it out into the structured tables. The JSONB stays for audit.

---

## 5. Validation — what "complete" checks

Fields required for `POST /complete` to succeed:

| Field | Rule | Error code |
|---|---|---|
| `clubName` | 1–120 chars, trim | `club_name_required` / `club_name_too_long` |
| `shortDescription` | ≤ 500 chars (may be empty) | `description_too_long` |
| `address` | ≥ 3 chars | `address_required` |
| `region` | non-empty | `region_required` |
| `country` | non-empty | `country_required` |
| `greens` | 1 ≤ n ≤ 20 | `greens_out_of_range` |
| `rinks` | 1 ≤ n ≤ 100 | `rinks_out_of_range` |
| `email` | RFC email | `email_invalid` |
| `phone` | ≥ 7 digits after strip | `phone_invalid` |
| `hours` | at least 1 day with `open: true` | `no_open_days` |
| `tiers` | ≥ 1 tier, exactly 1 with `isDefault` | `tiers_required` / `default_tier_required` |
| `tiers[].price` | 0 ≤ n ≤ 10000 | `tier_price_out_of_range` |
| `accentColour` | `#RRGGBB` | `accent_invalid` |
| `subdomain` | 3–30 chars, `[a-z0-9-]`, cannot start/end with `-`, not in reserved list (`www`, `api`, `admin`, `app`) | `subdomain_invalid` / `subdomain_reserved` / `subdomain_taken` |
| `pages` | at least `home` = true | `home_page_required` |

The response's `errors[]` is an array of `{ field, code, message }` — frontend maps each entry back to the step that owns the field and jumps the user there.

`yearFounded`, `clubType`, `logoName`, `tagline`, `firstYearDiscount`, `greenSurface`, `cadence`, individual `pages` toggles — all optional. Server accepts and stores whatever the client sends.

---

## 6. Logo upload — deferred to a follow-up

Logos in the wizard are a filename string only right now. Real image upload needs either:
- A pre-signed S3 (or Cloudflare R2) URL flow — `POST /clubs/:clubId/logo/upload-url` returns a signed PUT + a final CDN URL to write back to `clubs_data.logo_url`
- Or direct multipart to a `POST /clubs/:clubId/logo` endpoint

Either is fine. Not blocking for MVP — owners can complete onboarding without a logo (default to their initials on the public site). Flag once the rest of onboarding is live.

---

## 7. Subdomain — the sharp edge

`subdomain` is the only field with cross-club uniqueness. Design implications:

- **Check on PATCH**, not just complete — otherwise the owner sees "melbourne is available" all the way through step 6 and gets a nasty 409 on submit.
- The frontend already has a debounced availability check pattern (see the directory search in the claim wizard). We'd wire it against a new `GET /subdomains/check?value=melbourne` → `{ available: true|false, reason?: 'taken'|'reserved'|'invalid' }`. Small endpoint, big UX win. Include it if you can.
- The reserved list should live server-side, not client. At minimum: `www`, `api`, `admin`, `app`, `crm`, `sites`, `mail`, `dashboard`, `docs`, `blog`, plus anything you use for infra.

---

## 8. Public site kick-off

When `POST /complete` succeeds, the public site needs to build. Recommend firing a `club.onboarded` webhook or emitting an SNS event with `{ clubId, subdomain, publicUrl }`. The Nuxt build for `apps/club-sites` picks up the DNS-mapped tenant, revalidates, and the URL goes live.

For MVP, if you'd rather skip the build automation and just insert the `public_site_pages` rows so the Nuxt app can start serving them on next request — that's fine too. Just be explicit about what "publicUrl" means at that moment (live NOW vs "eventually consistent, wait 2 min").

---

## 9. Acceptance criteria

Frontend can un-mock the whole wizard when:

- [ ] `GET /clubs/:clubId/onboarding` returns the current state (defaults on first call, whatever's PATCHed otherwise).
- [ ] `PATCH /clubs/:clubId/onboarding` accepts partial data + step marker, merges, returns 200.
- [ ] `POST /clubs/:clubId/onboarding/complete` validates the full record, atomically writes `clubs_data` + `club_hours` + `membership_tiers` + `public_site_pages`, sets `onboarded_at`, returns `publicUrl` + tier IDs.
- [ ] Validation errors return `422 { errors: [{ field, code, message }] }` with codes matching §5.
- [ ] Subdomain uniqueness is enforced on both PATCH and complete.
- [ ] Only `owner` can call any of these (403 for anyone else).
- [ ] After complete, the caller's next `GET /me` still shows the club in `clubs[]` (unchanged) but hitting the public site URL renders the pages that were toggled on.

When all seven are green — this is a ~half-day frontend swap. The wizard steps stay identical; only the `persist()` call in `stores/onboarding.ts` swaps from `localStorage.setItem` to `PATCH`, and `markComplete()` becomes `POST /complete`.

---

## 10. Frontend integration plan

Where the swap happens:

1. `packages/api-client/src/resources/clubOnboarding.ts` — new module with `getState`, `patch`, `complete` functions using `authedFetch`.
2. `apps/crm/src/stores/onboarding.ts` — replace localStorage `persist()` with a debounced PATCH (300ms), replace `markComplete()` with `complete()`. Keep the localStorage fallback for offline resilience.
3. `apps/crm/src/router/guards.ts` — `requireOwnerAndOnboarded` currently checks a local flag. Post-wireup: check `auth.user.clubs[0].onboardedAt != null` (extend `UserClub` in `/me`).
4. `apps/crm/src/views/onboarding/*` — no changes. Every field already binds to the store.

Nothing on the public site (`apps/club-sites`) needs to know about this — it just needs the data to be there. Once `club.onboarded` fires, its normal ISR flow picks up the new content.

---

## 11. Priority within the milestone

- **P0** — `GET`, `PATCH`, `POST /complete`. The three above.
- **P0** — subdomain uniqueness enforcement (see §7).
- **P1** — `GET /subdomains/check` for live-availability feedback.
- **P1** — `club.onboarded` webhook / SNS event for public site build.
- **P2** — logo upload flow.

---

## 12. Open questions

- **Can `admin` complete onboarding, or only `owner`?** Brief 01 §3 says only `owner` in each club. Onboarding is meaningful club-shaping — recommend owner-only for MVP. Confirm.
- **Membership tier price unit — cents or dollars?** Frontend passes integer dollars (`140` = NZ$140). Backend: pick one, document, don't ambiguate.
- **What if the owner re-opens onboarding after `completed: true`?** Recommend: they can re-edit any field via a separate "Club settings" surface (already partially built at `/crm/settings`). Onboarding is a one-shot. Confirm.
- **`onboarding_data JSONB` audit retention** — how long do we keep the raw PATCH history? 12 months seems reasonable.

---

## 13. Contact

Same as previous briefs — `#torny-eng` on Slack. Happy to pair through the atomic transaction shape or the subdomain-check UX before you build.
