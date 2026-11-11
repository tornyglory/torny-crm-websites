# Brief 100 — Analytics & GTM wiring for club public sites

**Scope:**
- API (`general` repo): three columns on `clubs_data`, a dedicated `PATCH
  /clubs/{club_id}/analytics` endpoint, and echoing the values on the
  existing public-site payload.
- CRM FE (`apps/crm`): wire the two inputs + cookie-banner toggle on
  Settings → Website → Analytics to the real endpoints. Inputs are
  already built; they just persist to in-memory state today (brief 99
  shipped the UI, brief 100 wires it up).
- Public site FE (`apps/club-sites` + `packages/content-blocks`): read
  the analytics block from the site payload, inject `gtag.js` + GTM's
  loader with Google Consent Mode v2 defaults, and render a minimal
  consent bar when `cookie_banner = true`.

**Prereq:** none. Builds on brief 99 (Custom domain enablement) only in
that the same Website Settings page is the UI surface.

---

## 1. The ask

Clubs on Torny want the same site-wide analytics they're used to on
Squarespace / WordPress: paste a **GA4 Measurement ID** (`G-XXXXXXXXXX`)
and/or a **GTM Container ID** (`GTM-XXXXXXX`) in the CRM, flip on an
optional cookie banner, and have the public site automatically load the
right scripts behind consent.

Neither ID is persisted today — the CRM shows the fields, but nothing
hits the API and the public site never injects a script. Three sides to
build:

1. **Backend** persists the two IDs + the banner flag, validates
   formats, exposes PATCH + GET.
2. **CRM FE** loads values on mount, PATCHes on change (same pattern as
   `clubSettings`).
3. **Public site FE** reads the values from the site payload, drops the
   scripts into `<head>` early with consent-mode defaults, and renders a
   minimal "Accept / Reject" bar when `cookie_banner = true`.

---

## 2. Why

- **Baseline SEO/marketing hygiene.** Every modern site owner expects
  GA4. Several clubs have asked why we don't support it; today the best
  we can say is "paste it anywhere, we'll ignore it."
- **GTM unlocks the long tail.** Clubs that want Facebook Pixel, LinkedIn
  Insight Tag, conversion pixels, or Google Ads tracking should be able
  to do it without us building a dropdown for every vendor. GTM is the
  escape hatch.
- **NZ law + EU GDPR require consent for non-essential cookies.** We
  should default to Consent Mode v2 denied-state and only flip on
  tracking after an explicit opt-in. Google's consent-mode protocol
  means GA4 still gets *modelled* impressions pre-consent — good enough
  for most clubs' reporting without legal exposure.

---

## 3. Data model

Add on `clubs_data`:

| Column | Type | Note |
|---|---|---|
| `ga4_measurement_id` | `VARCHAR(20) NULL` | `G-` prefix + 8-10 uppercase alphanumerics. Null = tracking off. |
| `gtm_container_id` | `VARCHAR(20) NULL` | `GTM-` prefix + 7-8 uppercase alphanumerics. Null = GTM off. |
| `analytics_cookie_banner` | `BOOLEAN NOT NULL DEFAULT false` | When true, public site renders consent bar + defers tracking until opt-in. |

No index needed — these are small nullable settings columns.

---

## 4. Endpoint spec

### 4.1 `GET /clubs/{club_id}/analytics`

**Auth:** any member of the club.

```json
200 {
    "status": "success",
    "data": {
        "club_id": 42,
        "ga4_measurement_id": "G-ABC123XYZ4",
        "gtm_container_id": null,
        "cookie_banner": true
    }
}
```

If the club has never configured analytics, return all three as their
defaults (`null`, `null`, `false`).

### 4.2 `PATCH /clubs/{club_id}/analytics`

**Auth:** owner or admin (anyone with `settings:write` permission).

**Request** — all fields optional; omit a field to leave it unchanged,
send `null` to clear:

```json
{
    "ga4_measurement_id": "G-ABC123XYZ4",
    "gtm_container_id": "GTM-ABC1234",
    "cookie_banner": true
}
```

**Validation:**

1. `ga4_measurement_id`:
   - Null allowed (clears the setting).
   - Must match `^G-[A-Z0-9]{8,10}$` (case-sensitive — Google uses all-caps).
   - On fail → `422 ga4_invalid`.
2. `gtm_container_id`:
   - Null allowed (clears).
   - Must match `^GTM-[A-Z0-9]{7,8}$`.
   - On fail → `422 gtm_invalid`.
3. `cookie_banner`:
   - Must be boolean. On fail → `422 cookie_banner_invalid`.

**Why the strict regexes:** these IDs get dropped verbatim into
`<script src="...gtag/js?id={ID}"></script>` and `GTM-{ID}` script
blocks on the public site. A value like `foo"></script><script>alert(1)`
would XSS every visitor. Reject at the API boundary so the public-site
FE can trust what it serves.

**Response:** same shape as 4.1 with the updated values. 200 OK.

**Error codes:**

| Code | HTTP | When |
|---|---|---|
| `ga4_invalid` | 422 | Fails the regex. |
| `gtm_invalid` | 422 | Fails the regex. |
| `cookie_banner_invalid` | 422 | Not a boolean. |
| `forbidden` | 403 | Caller lacks `settings:write`. |
| `not_found` | 404 | Club doesn't exist. |

---

## 5. Public site payload

Extend `GET /public/clubs/{slug}/site` (the one the Nuxt app calls on
every render) to include an `analytics` block:

```json
{
    "club": { ... },
    "analytics": {
        "ga4_measurement_id": "G-ABC123XYZ4",
        "gtm_container_id": null,
        "cookie_banner": true
    }
}
```

When analytics is entirely unconfigured (`ga4_measurement_id` null AND
`gtm_container_id` null), return `"analytics": null` so the FE can skip
the whole block without checking individual fields. Saves one branch.

---

## 6. CRM FE wiring (`apps/crm`)

Already drafted in `WebsiteSettingsPanel.vue` — two inputs + a conditional
cookie-banner toggle, in-memory today. Wiring up:

1. Add `clubs.getAnalytics(clubId)` + `clubs.patchAnalytics(clubId,
   patch)` to `packages/api-client/src/resources/clubs.ts` with typed
   `AnalyticsErrorCode` export covering the §4.2 codes.
2. In `WebsiteSettingsPanel.vue`:
   - On mount (and on club switch), fetch the current analytics and
     replace the local `analytics` ref.
   - On input blur (or debounced 500ms), PATCH the changed field.
   - On validation error, surface inline under the input.
3. No new UI — the fields and toggle already exist.

---

## 7. Public site FE (`apps/club-sites` + `packages/content-blocks`)

### 7.1 Where to inject

A new `<AnalyticsHead>` component (or just inline in the Nuxt `app.vue`
`<Head>`) that reads `useAnalytics()` composable and renders:

- When `analytics` is null → render nothing.
- When `cookie_banner = false` → load the scripts immediately, no consent
  handling.
- When `cookie_banner = true` → load the scripts with Consent Mode v2
  denied-state defaults and render `<ConsentBar>` at the bottom of the
  page. Accept updates consent → scripts start firing. Reject keeps the
  denied state → GA4 still ships modelled pings (per Consent Mode v2)
  but no cookies set.

### 7.2 Script template

For every configured ID, inject at the top of `<head>`:

```html
<!-- Consent Mode v2 defaults — only when cookie_banner = true -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  });
</script>

<!-- GTM (only when gtm_container_id set) -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-ABC1234');</script>

<!-- GA4 (only when ga4_measurement_id set) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ4"></script>
<script>
  gtag('js', new Date());
  gtag('config', 'G-ABC123XYZ4');
</script>
```

Also inject GTM's `<noscript>` iframe into `<body>` (GTM standard).

### 7.3 Consent bar

Minimal — not a full preferences centre. Single bar at the bottom with:

- Short copy: "We use cookies to measure site traffic. Accept to help us
  improve, or reject to opt out."
- **Accept** → `gtag('consent', 'update', { ad_storage: 'granted',
  ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage:
  'granted' })`, persist choice in `localStorage.torny_consent = 'granted'`.
- **Reject** → `gtag('consent', 'update', { /* all denied */ })`,
  persist `torny_consent = 'denied'`.
- Both buttons dismiss the bar. On future page loads, read
  `localStorage.torny_consent` and skip the bar if a choice is stored.
- Lives in `packages/content-blocks` so the club-sites app + any future
  preview iframe both use the same component.

### 7.4 Previews

When the public site is rendered inside the CRM preview (brief 98's
`VITE_SITES_ORIGIN` flow), analytics should **not** fire — otherwise the
owner's editing session floods their own stats. Simplest: suppress the
whole `<AnalyticsHead>` block when the URL carries a known preview
query param (e.g. `?preview=1`) or the tenant middleware marks
`event.context.preview = true`.

---

## 8. Verification

```bash
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # owner JWT
CLUB=42

# 1. Get — defaults
curl -s "$CRM/clubs/$CLUB/analytics" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { data: { ga4_measurement_id: null, gtm_container_id: null, cookie_banner: false } }

# 2. Patch GA4 + cookie banner
curl -s -X PATCH "$CRM/clubs/$CLUB/analytics" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"ga4_measurement_id":"G-ABC123XYZ4","cookie_banner":true}' | jq
# → 200 updated shape

# 3. Patch GTM too
curl -s -X PATCH "$CRM/clubs/$CLUB/analytics" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"gtm_container_id":"GTM-ABC1234"}' | jq
# → 200 { data: { ga4_measurement_id: "G-ABC123XYZ4", gtm_container_id: "GTM-ABC1234", cookie_banner: true } }

# 4. XSS attempt — rejected
curl -s -X PATCH "$CRM/clubs/$CLUB/analytics" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"ga4_measurement_id":"G-abc\"><script>alert(1)</script>"}'
# → 422 { code: "ga4_invalid" }

# 5. Clear by sending null
curl -s -X PATCH "$CRM/clubs/$CLUB/analytics" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"ga4_measurement_id":null,"gtm_container_id":null}' | jq
# → 200 { data: { ga4_measurement_id: null, gtm_container_id: null, cookie_banner: true } }

# 6. Public site payload echoes analytics
curl -s "$CRM/public/clubs/kelburn-bowls/site" | jq '.data.analytics'
# → null  (nothing configured)
# OR
# → { ga4_measurement_id: "G-ABC123XYZ4", gtm_container_id: null, cookie_banner: true }

# 7. End-to-end — public site loads GA4
curl -s https://kelburn-bowls.torny.club/ | grep -o 'googletagmanager.com[^"]*' | head -3
# → googletagmanager.com/gtag/js?id=G-ABC123XYZ4
# → googletagmanager.com/gtm.js?id=GTM-...   (if GTM also set)

# 8. Non-member blocked from writing
curl -s -X PATCH "$CRM/clubs/$CLUB/analytics" -H "Authorization: Bearer $PLAYER_TOKEN" \
    -d '{"cookie_banner":false}'
# → 403 { code: "forbidden" }
```

---

## 9. Pass criteria

- ✓ GET returns the current settings or defaults.
- ✓ PATCH validates both ID formats strictly and rejects anything that
  could lead to injection.
- ✓ Clearing works (null → null on disk).
- ✓ Public site payload includes `analytics` or `null`.
- ✓ When `ga4_measurement_id` is set, public pages ship `gtag/js?id=<ID>`.
- ✓ When `gtm_container_id` is set, public pages ship GTM's loader + the
  `<noscript>` iframe.
- ✓ When `cookie_banner = true`, Consent Mode v2 denied-state defaults
  fire *before* the GA4/GTM loaders, and the consent bar renders until
  the user picks accept/reject.
- ✓ Preview URLs (`?preview=1` or tenant `event.context.preview`) skip
  the whole analytics block.
- ✓ Non-member / unauthenticated callers can't mutate.

---

## 10. Non-goals

- **Granular consent preferences centre.** We ship Accept / Reject only;
  no per-category toggles.
- **Plausible, Matomo, Fathom.** GA4 + GTM covers every long-tail need
  via GTM. Dropping other providers keeps the surface clean.
- **Server-side GTM / Measurement Protocol.** Client-side only; if a
  club wants server-side GTM they can put the container ID here and
  rig up the forwarding themselves.
- **Reporting the club's analytics data inside the CRM dashboard.**
  Separate brief if we want to pull GA4 Data API — this one is only
  about *ingesting* pageviews.
- **Honoring DNT / GPC headers automatically.** NZ law doesn't require
  it yet; revisit if we expand to CA.
- **Multi-ID (multiple GA4 or multiple GTM).** One of each per club.
  The GTM container itself can fan out to multiple GA4 properties if
  needed.

---

## 11. Contact

Nev on Slack (`#torny-eng`). Backend: three columns + one endpoint pair
+ one public-payload tweak. CRM FE: one api-client resource addition +
one `<script setup>` block (inputs already drafted). Public site FE: one
`<AnalyticsHead>` component + one `<ConsentBar>` inside
`packages/content-blocks`.

Suggest shipping in order: backend first (unblocks both FEs), CRM wiring
second (lets a club paste an ID), public-site injection third (makes it
actually fire). Each step is independently useful — a configured ID that
isn't yet injected still persists through the public-site FE catchup.
