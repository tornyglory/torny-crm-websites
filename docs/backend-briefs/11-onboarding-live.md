# Club Onboarding Wizard — Frontend Implementation Brief

**Audience:** `apps/crm` (Vue 3 SPA)
**Backend counterpart:** `backend-crm-implementation-plan.md`
**Status:** All four endpoints (GET / PATCH / POST /complete / subdomain-check) live in prod on the CRM CDK stack. Wizard can un-mock today.

---

## TL;DR

- **Four endpoints** — three under `/clubs/{club_id}/onboarding` (GET / PATCH / POST /complete) plus a public `/subdomains/check`. All on the CRM base URL.
- **Autosave is safe.** PATCH accepts partial data, merges over saved state, is idempotent. Rapid-fire from a distracted owner is fine.
- **POST /complete is atomic.** Either every write commits (club fields + 7 `club_hours` + N `membership_types` + 5 `public_site_pages` + `onboarded_at`) or none does. Returns the new membership tier IDs.
- **Subdomain uniqueness is enforced on both PATCH and complete** — no nasty final-step 409.
- **Response envelope is nested.** `body.data.step` is the wizard step, `body.data.data.clubName` is the wizard data. Yes, `data.data`. Blame the shared response helper.
- **Membership types are already wired to member records** — the bulk-import commit now looks up the club's tiers and inserts a `club_memberships` row (with `type_id` + `annual_fee`) per new member. Do onboarding first, then bulk-import for correct type assignment.

---

## Base URL

```ts
export const CRM_BASE = 'https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod';
```

Same base as `/me`, claims, admin queue, bulk import. Same JWT.

---

## 1. `GET /clubs/{club_id}/onboarding`  (🔒 owner)

Returns current state. First call after claim approval returns `step: 'welcome'` with defaults pre-filled from the directory row (name, region, country).

**200:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "step": "welcome" | "1" | "2" | "3" | "4" | "5" | "6" | "complete",
    "completed": false,
    "completedAt": null,
    "data": {
      "clubName": "Melbourne Bowling Club",
      "yearFounded": "",
      "clubType": "community",
      "shortDescription": "",
      "address": "",
      "suburb": "",
      "region": "Victoria",
      "country": "Australia",
      "greens": 1,
      "rinks": 8,
      "greenSurface": "cotula",
      "email": "",
      "phone": "",
      "hours": {
        "mon": { "open": false, "from": "", "to": "" },
        "tue": { "open": false, "from": "", "to": "" },
        "wed": { "open": false, "from": "", "to": "" },
        "thu": { "open": false, "from": "", "to": "" },
        "fri": { "open": false, "from": "", "to": "" },
        "sat": { "open": false, "from": "", "to": "" },
        "sun": { "open": false, "from": "", "to": "" }
      },
      "cadence": "annual",
      "firstYearDiscount": false,
      "tiers": [],
      "logoName": null,
      "logoUrl": null,
      "accentColour": "#2563EB",
      "tagline": "",
      "subdomain": "",
      "pages": { "home": true, "about": false, "membership": false, "events": false, "shop": false }
    }
  }
}
```

Errors: `403` (not owner), `404` (club doesn't exist), `500`.

---

## 2. `PATCH /clubs/{club_id}/onboarding`  (🔒 owner)

Autosave — call on every step advance and (debounced) on field blur.

**Request:**
```json
{
  "step": 2,
  "data": {
    "address": "12 Bowling Green Rd",
    "suburb": "Windsor",
    "greens": 3,
    "rinks": 24
  }
}
```

- Both `step` and `data` optional. `step` is a bookmark for resume-on-refresh — server does not enforce ordering.
- `data` is a partial. Server merges over saved state; nested `hours` and `pages` are shallow-merged so you can send a single day without wiping the others.
- Idempotent.

**200:**
```json
{ "status": "success", "data": { "clubId": 3, "step": 2, "updatedAt": "2026-08-21T10:14:22.000Z" } }
```

**Errors — machine-readable `code`:**

| Status | `code` | When |
|---|---|---|
| `400` | `bad_json` | body isn't valid JSON |
| `400` | `subdomain_invalid` | `data.subdomain` not 3–30 chars / bad chars |
| `400` | `subdomain_reserved` | `data.subdomain` is in the reserved list |
| `401` | `unauthorized` | no bearer token |
| `403` | (empty body) | not an owner on this club |
| `404` | | club not found / caller not a member |
| `422` | `subdomain_taken` | another club owns this subdomain |
| `500` | `internal` |

---

## 3. `POST /clubs/{club_id}/onboarding/complete`  (🔒 owner)

Empty body. Atomically:
1. Validate all required fields → `422` with `errors[]` if anything fails (nothing writes).
2. Update `clubs_data` flat fields.
3. Upsert 7 `club_hours` rows (one per day).
4. Insert `membership_types` rows for each tier — returns the integer type IDs.
5. Upsert 5 `public_site_pages` rows (published flags).
6. Set `clubs_data.onboarded_at = NOW()`.

**200:**
```json
{
  "status": "success",
  "data": {
    "clubId": 3,
    "onboardedAt": "2026-08-21T10:14:22.000Z",
    "publicUrl": "https://melbourne.torny.club",
    "membershipTierIds": [4, 5, 6]
  }
}
```

`membershipTierIds` are ordered to match `data.tiers[]` — element `i` is the DB id for `tiers[i]`. Store these client-side so subsequent edits (or member imports) can reference them.

**Errors:**

| Status | `code` | When |
|---|---|---|
| `403` | | not owner |
| `404` | | club not found |
| `409` | `already_onboarded` | complete called on a club that's already onboarded — route the user to the settings surface instead |
| `422` | `validation_failed` | `errors: [{ field, code, message }]` — map each entry to the step that owns the field |
| `500` | `internal` |

### Validation error codes (`errors[].code`)

Mirrors §5 of the brief:

| `field` | `code` | Rule |
|---|---|---|
| `clubName` | `club_name_required` / `club_name_too_long` | 1–120 chars |
| `shortDescription` | `description_too_long` | ≤ 500 chars |
| `address` | `address_required` | ≥ 3 chars |
| `region` | `region_required` | non-empty |
| `country` | `country_required` | non-empty |
| `greens` | `greens_out_of_range` | 1–20 |
| `rinks` | `rinks_out_of_range` | 1–100 |
| `email` | `email_invalid` | RFC-ish |
| `phone` | `phone_invalid` | ≥ 7 digits after strip |
| `hours` | `no_open_days` | ≥ 1 day with `open: true` |
| `hours.{day}` | `hours_time_invalid` | open days must have HH:MM 24h `from`/`to` |
| `tiers` | `tiers_required` / `default_tier_required` | ≥ 1 tier; exactly one with `isDefault: true` |
| `tiers[i].name` | `tier_name_required` | non-empty |
| `tiers[i].price` | `tier_price_out_of_range` | 0 ≤ n ≤ 10000 (integer dollars) |
| `accentColour` | `accent_invalid` | `#RRGGBB` |
| `subdomain` | `subdomain_invalid` / `subdomain_reserved` / `subdomain_taken` | see §7 |
| `pages.home` | `home_page_required` | must be true |

---

## 4. `GET /subdomains/check?value=melbourne`  (public)

For the live-availability hint in the wizard's brand step. No auth — deliberately, so the field can validate before the caller's session warms up on other tabs. Does not leak which club owns a taken subdomain.

**200:**
```json
{ "status": "success", "data": { "available": true, "value": "melbourne" } }
```
Or:
```json
{ "status": "success", "data": { "available": false, "reason": "taken" | "reserved" | "invalid" } }
```

Debounce ~300ms. Only fire when the field has ≥3 chars.

---

## Rules of the road

**Subdomain (§7 of the design brief):**
- 3–30 chars, lowercase `a-z0-9-`, cannot start/end with `-`.
- Reserved server-side: `www`, `api`, `admin`, `app`, `crm`, `sites`, `mail`, `dashboard`, `docs`, `blog`, `ftp`, `smtp`, `pop`, `imap`, `auth`, `oauth`, `staging`, `dev`, `test`, `stage`, `prod`.
- Uniqueness checked on every PATCH (not just complete), so the owner sees the conflict immediately.

**Membership tiers → member records:**
- The bulk-import commit already resolves each row's `membership_type` CSV cell against the club's active `membership_types` (`type_code` → `slug` → `type_name`, case-insensitive; falls back to `is_default`). Match hits → new `club_memberships` row with the resolved `type_id` + `annual_fee` = tier's `price`. No match, no default configured → club_members row still lands, `club_memberships` skipped (logged).
- **Order matters:** run onboarding *first*, then bulk import. Importing before tiers exist means members get no membership record and won't show a tier in the roster.

**Payload shape gotcha:** the top-level response wraps everything in `data`, and this endpoint's payload is itself in a `data` key — so on the frontend, the wizard fields are at `response.data.data.clubName`, not `response.data.clubName`.

---

## Wire-up

```ts
// packages/api-client/src/resources/clubOnboarding.ts
import { CRM_BASE } from '../config'
import { authedFetch, publicFetch } from '../http'

export const clubOnboarding = {
  async get(clubId: number) {
    const res = await authedFetch(`${CRM_BASE}/clubs/${clubId}/onboarding`)
    return res.data   // { clubId, step, completed, completedAt, data: {...} }
  },
  async patch(clubId: number, payload: { step?: number|string, data?: Record<string, any> }) {
    return authedFetch(`${CRM_BASE}/clubs/${clubId}/onboarding`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },
  async complete(clubId: number) {
    return authedFetch(`${CRM_BASE}/clubs/${clubId}/onboarding/complete`, {
      method: 'POST',
      body: '{}',
    })
  },
  async checkSubdomain(value: string) {
    const url = `${CRM_BASE}/subdomains/check?value=${encodeURIComponent(value)}`
    return publicFetch(url)   // { available, value?, reason? }
  },
}
```

### `stores/onboarding.ts` swap

```ts
// Replace localStorage.setItem(...) with a debounced PATCH.
const persist = debounce(async (step: number, data: Partial<WizardData>) => {
  try {
    await clubOnboarding.patch(clubId, { step, data })
  } catch (err) {
    // Keep localStorage as an offline fallback — server merge is authoritative.
    localStorage.setItem(`torny.crm.onboarding.${clubId}`, JSON.stringify({ step, data }))
  }
}, 300)

// markComplete() becomes:
async markComplete() {
  const res = await clubOnboarding.complete(clubId)
  if (res.status === 'success') {
    completed.value = true
    publicUrl.value = res.data.publicUrl
    membershipTierIds.value = res.data.membershipTierIds
    // Refresh session so /me picks up the new state.
    await session.refresh()
  } else if (res.code === 'validation_failed') {
    validationErrors.value = res.errors
    // Jump to the earliest step that owns a failing field
    const firstError = res.errors[0]
    step.value = stepForField(firstError.field)
  } else {
    throw new Error(res.message)
  }
}
```

### Router guard

Extend `UserClub` in `/me` to carry `onboardedAt` (already present via `data.data.completedAt` — expose it on `/me.clubs[i]` if you want a cheaper check):

```ts
const requireOwnerAndOnboarded = async (to) => {
  const session = useSession()
  const club = session.user?.clubs?.find(c => c.id === Number(to.params.clubId))
  if (!club || club.role !== 'owner') return '/'
  // Fresh onboarding state — cheapest to hit /clubs/:id/onboarding and check completed
  const state = await clubOnboarding.get(club.id)
  if (!state.completed) return `/crm/onboarding/${club.id}`
}
```

---

## Test accounts + seed data

- **Owner test flow:** grant a user `role='owner'` on a club (approving a claim does this automatically). We don't seed a fresh onboardable club by default — after a claim approval on staging, the resulting club is ready to onboard.
- **Subdomain check:** hit `/subdomains/check?value=<anything>` unauthenticated to smoke it.

---

## What's still coming

- **Logo upload flow.** `logoUrl` is a plain string field today; there's no upload endpoint yet. Store the filename on `logoName`, leave `logoUrl` null until we ship one of: (a) presigned R2 PUT, or (b) POST /clubs/{id}/logo. Not blocking for onboarding completion.
- **`club.onboarded` webhook / SNS event** for the Nuxt build. Not wired yet — the public-site pages *rows* land immediately, but the SSG/ISR revalidate is manual until we add the fanout. If you need public-site freshness sooner, ping.
- **Post-onboarding "edit club settings" surface.** POST /complete is one-shot (409 on re-run). Individual field edits should live under a separate `/clubs/:id/settings` API surface — not built yet; flag when the design needs it.

---

## Contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`.
