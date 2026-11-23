# Brief 115 — Footer config owned by the club

**STATUS — SHIPPED 2026-11-23 (commit 2b34da0).**

Public `/site` payload now carries a `footer` object (null when the club has never configured one, so the current hardcoded fallback keeps working). Three admin endpoints GET / PUT / DELETE drive the editor + reset.

**URL deviation from the brief:** admin endpoints land on **VENUE_BASE**, not the CRM/SAM base. Same reason as `/ai-generate` and `/block-images-copy` — `TornyCrmStack` is at CloudFormation's 500-resource cap. The public `/site` field addition is on the usual CRM base (just a response-shape change, no new CFN resource).

**Scope shipped:**

- API (Venue stack): `GET`/`PUT`/`DELETE /clubs/{cid}/footer-config` — admin read / save / reset.
- API (CRM stack): `GET /public/clubs/{subdomain}/site` extended with `footer` field.
- DB: migration 167 adds `club_footer_config` — one row per club, single JSON blob.
- Validation: **22/22 unit tests pass** across the full error-code matrix.
- Cache: `revalidateClubSite` fired on PUT + DELETE with `purge: 'all'` (brief 80 pattern).
- Prereq: brief 25 (nav shape), brief 80 (admin nav PUT pattern), brief 110 (slug/subdomain canonicalisation) — all shipped.

---

## 1. Public `/site` extension

Existing endpoint — URL unchanged, payload gains one top-level field:

```
GET https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/public/clubs/{subdomain}/site
```

Keyed on `clubs_data.subdomain` (brief 110 — the `/site` endpoint is subdomain-keyed, not slug-keyed; pair with `data.subdomain` from `/clubs/resolve`, not `data.slug`).

```jsonc
{
  "status": "success",
  "data": {
    // … existing club / contact / hours / membership_tiers / events_upcoming / pages …

    "footer": {
      "description": "A community bowling club. Everyone welcome — bring a friend, we'll bring the bowls.",
      "columns": [
        {
          "heading": "Explore",
          "links": [
            { "label": "Home", "href": "/" },
            { "label": "About", "href": "/about" }
          ]
        }
      ],
      "socials": [
        { "icon": "instagram", "label": "Instagram", "href": "https://instagram.com/naenaebowls" }
      ],
      "legal_links": [
        { "label": "Privacy", "href": "/privacy" }
      ],
      "contact_override": {
        "email": "hello@naenaebowls.co.nz",
        "phone": "(04) 567 1234",
        "address_lines": ["12 Vogel St", "Naenae, Lower Hutt 5011"],
        "status": null
      }
    }
  }
}
```

`footer: null` means the admin has never saved a config. The FE falls through to its existing hardcoded `FALLBACK_HEADER`-style default — no behaviour change for clubs that haven't opted in.

Any sub-array can be `[]` (admin chose to keep that section empty — still a saved config). `contact_override` is null when the admin didn't override — the FE renders the canonical `data.contact` in that section instead.

**Fallback semantics:** if the DB row or JSON parse fails, the handler logs a `console.warn` and returns the rest of the payload with `footer: null`. One failure doesn't kill the whole `/site` response.

**Cache:** same per-subdomain cache as the rest of `/site`. Invalidated on PUT + DELETE via the brief-80 `revalidateClubSite` hook with `purge: 'all'`.

---

## 2. Admin endpoints

```
GET    https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{club_id}/footer-config
PUT    https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{club_id}/footer-config
DELETE https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/{club_id}/footer-config
```

Authorization: owner / admin JWT (`requireClubRole('admin')`).

### 2.1 GET — admin read

```jsonc
// 200 — saved shape
{
  "status": "success",
  "data": {
    "description": "A community bowling club…",
    "columns": [...],
    "socials": [...],
    "legal_links": [...],
    "contact_override": {...},
    "updated_at": "2026-11-23T04:12:33.000Z",
    "social_icons": ["instagram", "facebook", "twitter", "tiktok", "youtube", "linkedin", "email"]
  }
}

// 404 — never saved, but carries the icon whitelist so the editor can render a fresh form
{
  "status": "error",
  "code": "footer_not_configured",
  "message": "Footer has never been configured for this club",
  "data": { "social_icons": ["instagram", "facebook", "twitter", "tiktok", "youtube", "linkedin", "email"] }
}
```

`social_icons` is returned on both 200 and 404 so the editor renders the picker from a single source of truth. No separate `/icons` round-trip.

### 2.2 PUT — full-replacement save

```jsonc
PUT /clubs/{cid}/footer-config
{
  "description": "…",            // string | null, max 300 chars after trim
  "columns": [...],              // 0–4 entries; each column has 1–8 links
  "socials": [...],              // 0–6 entries; icon must be in the whitelist
  "legal_links": [...],          // 0–5 entries
  "contact_override": {...} | null
}
```

Response is the normalised persisted shape plus `updated_at` and `social_icons` (same as GET 200).

**Empty save** (`description: null`, `columns: []`, `socials: []`, `legal_links: []`, `contact_override: null`) is valid — a row is written, `/site` returns a non-null `footer` with empty arrays. The FE renders a minimal footer (brand + copyright only).

### 2.3 DELETE — reset to fallback

```jsonc
DELETE /clubs/{cid}/footer-config
// 200
{ "status": "success", "data": { "reset": true } }
```

Idempotent — DELETE on a club that never saved still returns 200. Public `/site` returns `footer: null` again; FE falls back to its hardcoded default.

---

## 3. Error codes (full matrix)

Every 400 comes with `{ status: "error", code, message }`.

| HTTP | code | When |
|---|---|---|
| 400 | `bad_json` | Body isn't valid JSON, or top-level shape is wrong. |
| 400 | `footer_description_too_long` | `description` > 300 chars after trim. |
| 400 | `footer_columns_too_many` | > 4 columns. |
| 400 | `footer_column_heading_too_long` | column heading missing or > 40 chars. |
| 400 | `footer_column_empty` | column has 0 links. |
| 400 | `footer_column_too_many_links` | column has > 8 links. |
| 400 | `footer_link_label_too_long` | link label missing or > 40 chars. |
| 400 | `footer_link_href_invalid` | href fails validation (see §4 for the rules). |
| 400 | `footer_social_icon_unknown` | icon outside the whitelist. |
| 400 | `footer_social_href_invalid` | social href is not absolute `https:` / `mailto:` / `tel:`. |
| 400 | `footer_socials_too_many` | > 6 socials. |
| 400 | `footer_legal_links_too_many` | > 5 legal links. |
| 400 | `footer_contact_email_invalid` | `contact_override.email` fails email regex, or > 120 chars. |
| 400 | `footer_contact_address_too_many` | > 4 address lines. |
| 400 | `footer_contact_line_too_long` | any single address line > 80 chars, or status > 40 chars. |
| 401 | `unauthenticated` | Bearer missing / malformed. |
| 403 | role gate | Caller lacks CRM admin role on the club. |
| 404 | `footer_not_configured` | GET only — admin reads a club that never saved. |
| 405 | `method_not_allowed` | Something other than GET/PUT/DELETE/OPTIONS hit the route. Shouldn't fire. |

---

## 4. Href rules

Same as nav links (brief 25 / 80). String is trim-then-validate:

| Allowed | Example |
|---|---|
| Relative path | `/about`, `/venue-hire?space=green` |
| Absolute HTTPS | `https://example.com/x` |
| Mailto | `mailto:info@club.co.nz` |
| Tel | `tel:+6445671234` |

| Rejected | Why |
|---|---|
| `javascript:…` | XSS vector. |
| `data:…` | XSS vector. |
| Bare `www.example.com` | Missing scheme — surfaces the admin's typo. |
| `http://…` | Non-TLS; coerce to `https` or ask the admin to fix. |

**Socials are stricter** — relative paths are rejected (socials always point off-site). Everything else above applies.

---

## 5. FE wiring

### 5.1 `packages/api-client/src/resources/footer.ts` (new)

```ts
import { VENUE_BASE } from '../config'
import { authedFetch, ApiError } from '../http'
import type { FooterConfig, FooterSocialIcon } from '../types'

interface Envelope<T> { status: 'success'; data: T }
export interface FooterConfigRead extends FooterConfig {
  updated_at: string
  social_icons: FooterSocialIcon[]
}

/** GET /clubs/:cid/footer-config — returns the saved shape, or null when never saved. */
export async function get(clubId: number): Promise<FooterConfigRead | null> {
  try {
    const res = await authedFetch<Envelope<FooterConfigRead>>(
      `${VENUE_BASE}/clubs/${clubId}/footer-config`,
    )
    return res.data
  } catch (err) {
    // When the API returns 404 footer_not_configured, surface null so
    // the editor can seed a fresh form. Propagate everything else.
    if (err instanceof ApiError && err.code === 'footer_not_configured') return null
    throw err
  }
}

export async function put(clubId: number, payload: FooterConfig): Promise<FooterConfigRead> {
  const res = await authedFetch<Envelope<FooterConfigRead>>(
    `${VENUE_BASE}/clubs/${clubId}/footer-config`,
    { method: 'PUT', body: JSON.stringify(payload) },
  )
  return res.data
}

export async function remove(clubId: number): Promise<void> {
  await authedFetch(`${VENUE_BASE}/clubs/${clubId}/footer-config`, { method: 'DELETE' })
}
```

### 5.2 Shared types (`packages/api-client/src/types.ts`)

```ts
export type FooterSocialIcon =
  | 'instagram' | 'facebook' | 'twitter' | 'tiktok'
  | 'youtube'   | 'linkedin' | 'email'

export interface FooterLink   { label: string; href: string }
export interface FooterColumn { heading: string; links: FooterLink[] }
export interface FooterSocial { icon: FooterSocialIcon; label: string; href: string }

export interface FooterContactOverride {
  email: string | null
  phone: string | null
  address_lines: string[] | null
  status: string | null
}

export interface FooterConfig {
  description: string | null
  columns: FooterColumn[]
  socials: FooterSocial[]
  legal_links: FooterLink[]
  contact_override: FooterContactOverride | null
}
```

### 5.3 `apps/club-sites/server/utils/tornyApi.ts`

Extend the `Site` type with `footer: SiteFooter | null`. The existing `SiteNavigation.footer` flat list is unrelated — keep it as-is; deprecation call-out can come in a follow-up.

### 5.4 `apps/club-sites/layouts/default.vue`

Swap the static constants for `site.value?.footer`-derived computeds. Keep the hardcoded fallback as a safety net when `footer` is `null` or absent (older payloads) — same `FALLBACK_HEADER` pattern already in the file.

### 5.5 CRM editor (`apps/crm/src/views/settings/FooterEditorCard.vue`)

- On mount: `footer.get(clubId)`. 200 → hydrate form; null (via caught 404) → start blank with the picker populated from `data.social_icons`.
- Save → `footer.put(clubId, formValues)`. On error, map `error.code` → per-field inline message (lookup table matches §3).
- Reset → `footer.remove(clubId)` + reset form state to empty.
- Icon picker: drive the whitelist from `response.social_icons` so new icons added server-side appear without a FE release.

---

## 6. Verification (live against prod)

```sh
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Admin routes live + authorizer gates (403/401 are expected unauth)
for M in GET PUT DELETE; do
  curl -s -o /dev/null -w "$M → HTTP %{http_code}\n" -X $M "$VENUE/clubs/5/footer-config" -H "Content-Type: application/json" -d '{}'
done
# → GET → HTTP 403
# → PUT → HTTP 401
# → DELETE → HTTP 401

# 2. OPTIONS preflight for the editor
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X OPTIONS "$VENUE/clubs/5/footer-config" \
  -H "Origin: http://localhost:5174"
# → 204 with Access-Control-Allow-Origin: *

# 3. Public /site for Naenae — subdomain key — returns footer: null (no config saved yet)
curl -s "$CRM/public/clubs/naenae-bowling-club/site" | jq '.data.footer'
# → null
```

### 6.1 Validator unit tests (ran during ship)

22/22 pass across the full §3 error-code matrix: length caps on description / columns / headings / links / socials / legal / contact fields; `javascript:` / `data:` / bare `www.` / relative socials all rejected; relative-in-site / https / mailto / tel accepted; icon whitelist enforced; trailing empty address lines stripped; empty-save accepted.

---

## 7. Pass criteria

- ✓ Fresh club, no footer saved → `GET /public/clubs/{subdomain}/site` returns `"footer": null`.
- ✓ Admin `GET /clubs/{cid}/footer-config` on fresh club → 404 `footer_not_configured` with `data.social_icons` present.
- ✓ Admin PUT with a valid full payload → 200. Subsequent `/site` call includes the saved `footer` object.
- ✓ Each 400 code from §3 fires for the expected input shape (22/22 validator tests).
- ✓ Admin PUT then DELETE → 200. `/site` returns `footer: null` again.
- ✓ Non-admin PUT / DELETE → 403.
- ✓ After PUT, the Worker cache for the club's subdomain is invalidated within one revalidate cycle (same as brief-80 nav updates — `revalidateClubSite({ purge: 'all' })`).

---

## 8. Non-goals (per brief + what I didn't ship)

- Per-page footer (every page shows the same footer).
- "Hide footer" toggle. Empty-save covers that intent — the FE renders a minimal footer.
- Server-side column reorder endpoint. The PUT replaces the whole array; order is wherever the FE puts it.
- Social-link verification (no outgoing HEAD to confirm the handle exists).
- Country-specific address formatting. Free-text lines only.
- Plan gating. All clubs get footer config regardless of tier (brief §prereq note).

---

## 9. Contact

Nev on `#torny-eng`. Related briefs: 25 (nav shape), 80 (admin nav PUT pattern + revalidate hook), 110 (subdomain-keyed public `/site`), 113 + 114 (recent CRM-stack-cap moves to Venue stack).
