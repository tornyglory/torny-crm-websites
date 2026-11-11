# Brief 99 — Custom domain enablement

**Scope:**
- API (this repo): three new endpoints on `clubs/{club_id}/custom-domain`
  plus one cron-lite reconciler. Reuses the existing Cloudflare Pages
  integration (`src/handlers/utils/cloudflare-pages.js`) and KV write path.
- FE (`tornyglory/torny-crm-websites`): Settings → Website → Domain page
  already ships the "enter your apex, see the records, run a client-side
  DNS check" flow (brief 99 FE placeholder landed in `WebsiteSettingsPanel
  .vue`). The disabled "Enable custom domain" button becomes live once
  this brief ships.

**Prereq:** brief 97 (tenant-router Worker) is live. The Worker already
reads `x-torny-tenant-host` and resolves clubs via KV, so once a custom
host → clubId KV entry exists, the Worker routes the domain automatically.

---

## 1. The ask

Admins need to point their own domain (e.g. `kelburnbowls.co.nz`) at their
Torny-hosted club site. The FE hands them the exact DNS records they need
to add at their registrar + verifies via client-side DoH. The backend
needs to:

1. Accept the admin's apex (`POST /clubs/{id}/custom-domain`).
2. Generate a verification TXT token so we can prove ownership.
3. Register the host + `www.<host>` with Cloudflare Pages (so CF issues
   the SSL cert).
4. Poll until Cloudflare marks both hosts as `active` with `success`
   SSL state.
5. Write `host:<custom_host>` → `<clubId>` into the tenant-router KV so
   the Worker from brief 97 routes requests correctly.
6. Expose current status so the FE can show "pending verification" vs
   "live" + surface the right error if the admin's DNS is wrong.

---

## 2. Why

- **Clubs expect their own domain.** The Torny subdomain
  (`<slug>.torny.club`) is fine as a fallback, but committees want
  branded addresses (`kelburnbowls.co.nz`) for printed materials, member
  mailouts, and search. Pre-launch we've already had three clubs ask.
- **The FE scaffolding is ready.** The Domain page accepts the admin's
  apex, shows the required records, and runs a Cloudflare DoH lookup to
  confirm the records resolve from the client. That gets the admin 90%
  of the way to a working domain without any backend. What's left is
  the one-way door: *actually* registering the host with Cloudflare so
  traffic serves and SSL issues.
- **Infra pieces already exist.** `putHostKv` and the Cloudflare Pages
  API wrapper already live in `utils/cloudflare-pages.js` (same module
  that handles the `.torny.club` subdomain KV writes). The new endpoints
  are orchestration + state tracking.

---

## 3. Data model

Add on `clubs_data` (or spin off a `club_custom_domains` table if we
anticipate multiple hosts per club — the FE today assumes one apex):

| Column | Type | Note |
|---|---|---|
| `custom_host` | `VARCHAR(253) NULL` | The apex the admin registered. Null = no custom domain. |
| `custom_host_status` | `ENUM('pending_dns','pending_ssl','live','error') NULL` | Lifecycle state. |
| `custom_host_verification_token` | `VARCHAR(64) NULL` | Random token; admin adds it as a TXT record at `_torny-verify.<host>`. |
| `custom_host_last_error` | `VARCHAR(255) NULL` | Latest Cloudflare / DNS error surfaced to the FE. |
| `custom_host_updated_at` | `TIMESTAMP NULL` | For UI "last checked …" + poller rate-limiting. |

Index on `custom_host` unique — no two clubs can claim the same domain.

---

## 4. Endpoint spec

### 4.1 `POST /clubs/{club_id}/custom-domain`

**Auth:** owner-only.

**Request:**
```json
{ "host": "kelburnbowls.co.nz" }
```

**Behaviour:**

1. Validate payload. Reject `400 host_required` on missing/empty value.
2. Normalise `host` — lowercase, strip scheme / leading `www.` / trailing
   slash (the FE does this too, but the server is authoritative).
3. Validate the shape — matches
   `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`,
   total length ≤ 253. On fail → `422 host_invalid`.
4. Reject disallowed TLDs / suffixes: the `.torny.club` and `.torny.co`
   apexes, plus `pages.dev`. → `422 host_reserved`.
5. Enforce uniqueness: any other club already has `custom_host = host`
   → `409 host_taken`.
6. Generate a 32-byte base32 token, persist as
   `custom_host_verification_token`.
7. Call Cloudflare Pages API to attach both `host` and `www.host` to the
   `torny-crm-websites` Pages project. Capture any error into
   `custom_host_last_error`.
8. Write row: `custom_host`, `custom_host_status = 'pending_dns'`,
   `custom_host_verification_token`, `custom_host_updated_at = NOW()`.
9. Respond `201`:
   ```json
   {
     "status": "success",
     "data": {
       "club_id": 42,
       "host": "kelburnbowls.co.nz",
       "status": "pending_dns",
       "verification_token": "torny=aBcd1234…",
       "required_records": [
         { "type": "CNAME", "host": "kelburnbowls.co.nz",     "value": "proxy.torny.pages.dev" },
         { "type": "CNAME", "host": "www.kelburnbowls.co.nz", "value": "proxy.torny.pages.dev" },
         { "type": "TXT",   "host": "_torny-verify.kelburnbowls.co.nz", "value": "torny=aBcd1234…" }
       ]
     }
   }
   ```

### 4.2 `GET /clubs/{club_id}/custom-domain`

**Auth:** any member of the club.

Returns the current state so the FE can render the right UI. If no
`custom_host` registered, return `404 not_found` (FE already handles the
"no domain set" state via its own input).

```json
{
  "status": "success",
  "data": {
    "club_id": 42,
    "host": "kelburnbowls.co.nz",
    "status": "live",            // pending_dns | pending_ssl | live | error
    "verification_token": "torny=aBcd1234…",
    "ssl_status": "active",       // null until CF issues; "active" / "pending" / "failed"
    "last_error": null,
    "last_checked_at": "2026-11-11T07:22:00Z",
    "required_records": [ … ]     // same shape as 4.1
  }
}
```

### 4.3 `DELETE /clubs/{club_id}/custom-domain`

**Auth:** owner-only.

1. Detach both `host` and `www.host` from the Cloudflare Pages project.
2. Delete `host:<host>` + `host:www.<host>` KV entries (fire-and-forget
   per the pattern in brief 98).
3. Null out `custom_host*` columns.
4. Respond `200` with `{ cleared: true }`.

The `.torny.club` fallback keeps serving — this just stops the custom
host from routing.

### 4.4 `POST /clubs/{club_id}/custom-domain/check` — on-demand poll

**Auth:** owner-only.

Triggered by the FE's "Check DNS" button. (The FE already does a
client-side DoH check so the admin sees instant feedback; this endpoint
is the authoritative one.)

1. Load the stored `custom_host` + `verification_token`.
2. Do an authoritative DNS lookup from the API (not via the browser):
   - `CNAME host` → must resolve to `proxy.torny.pages.dev`.
   - `CNAME www.host` → must resolve to `proxy.torny.pages.dev`.
   - `TXT _torny-verify.host` → must contain the stored token.
3. If any check fails → `status = 'pending_dns'`,
   `custom_host_last_error = "<which record missed>"`, respond with the
   updated state.
4. If DNS is good but CF Pages hasn't finished SSL provisioning →
   `status = 'pending_ssl'`, don't yet write KV.
5. If DNS is good + CF reports SSL `active` on both hosts →
   `status = 'live'`, write `host:<host>` + `host:www.<host>` → `clubId`
   to KV, nil out `custom_host_last_error`.
6. Respond with the same shape as §4.2.

### 4.5 Periodic reconciler

A lightweight cron (or Lambda scheduled rule) that re-runs the §4.4
check for every club in `pending_dns` or `pending_ssl` once every ~15
minutes. Needed so the "live" transition happens without the admin
having to come back and click. Can defer v1 if §4.4 is enough.

---

## 5. Error-code reference

| Code | HTTP | When |
|---|---|---|
| `host_required` | 400 | Payload missing or empty. |
| `host_invalid` | 422 | Fails format check. |
| `host_reserved` | 422 | Matches a Torny-owned TLD or `pages.dev`. |
| `host_taken` | 409 | Another club has it. |
| `cf_provision_failed` | 502 | Cloudflare Pages API returned an error attaching the host. Surface `last_error`. |
| `dns_mismatch` | 422 | Returned by §4.4 when a required record is missing or wrong. |
| `forbidden` | 403 | Non-owner on POST / DELETE. |
| `not_found` | 404 | §4.2 / §4.4 called before §4.1. |

---

## 6. FE contract already in place

- `apps/crm/src/components/WebsiteSettingsPanel.vue` — "Custom domain"
  card. Admin enters the apex; FE normalises + does a client-side DoH
  check per record. Currently persisted to localStorage; swap to §4.1/§4.2
  once those exist.
- The "Enable custom domain" button is disabled and marked "Available
  once backend brief 99 ships". Once the endpoint exists the FE will
  POST on click, poll via `POST /custom-domain/check`, and render the
  returned state.

No new api-client resource yet — I'll add `clubs.customDomain.*` bindings
in the same PR that wires the Enable button once backend ships.

---

## 7. Verification

```bash
CRM="…"
TOKEN="…"   # owner JWT
CLUB=42

# 1. Create — fresh register
curl -s -X POST "$CRM/clubs/$CLUB/custom-domain" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"host":"kelburnbowls.co.nz"}' | jq
# → 201 { status: pending_dns, verification_token: "torny=…", required_records: […] }

# 2. Get before DNS is set
curl -s "$CRM/clubs/$CLUB/custom-domain" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { status: pending_dns, last_error: null }

# 3. Trigger auth DNS check before records are published
curl -s -X POST "$CRM/clubs/$CLUB/custom-domain/check" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { status: pending_dns, last_error: "CNAME kelburnbowls.co.nz missing" }

# 4. After the admin adds the two CNAMEs + TXT, re-check
curl -s -X POST "$CRM/clubs/$CLUB/custom-domain/check" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { status: pending_ssl }   (DNS passed, waiting on Cloudflare)
# → after CF issues: { status: live, ssl_status: active }

# 5. End-to-end — the Worker routes the custom host
curl -I https://kelburnbowls.co.nz/
# → 200 (Worker hits KV, resolves clubId, proxies to pages.dev)

# 6. Taken — second club tries the same host
curl -s -X POST "$CRM/clubs/99/custom-domain" -H "Authorization: Bearer $TOKEN_B" \
    -H "Content-Type: application/json" -d '{"host":"kelburnbowls.co.nz"}'
# → 409 host_taken

# 7. Non-owner is blocked
curl -s -X POST "$CRM/clubs/$CLUB/custom-domain" -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" -d '{"host":"anything.co.nz"}'
# → 403 forbidden

# 8. Delete — clean teardown
curl -s -X DELETE "$CRM/clubs/$CLUB/custom-domain" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { cleared: true }
# → kelburnbowls.co.nz now 404s at the Worker (unknown_host), .torny.club fallback still serves
```

---

## 8. Pass criteria

- ✓ POST creates the row, attaches to CF Pages, returns the records + token.
- ✓ Authoritative DNS check (§4.4) distinguishes the four lifecycle states.
- ✓ On successful `live` transition, KV has `host:<custom>` → clubId and the Worker serves the club at the custom domain.
- ✓ DELETE detaches from CF Pages + clears KV + nulls DB columns in one call.
- ✓ Uniqueness index prevents two clubs claiming the same host.
- ✓ Owner-only on mutations; any member can GET status.
- ✓ FE's existing client-side DoH check keeps working — it's advisory, not authoritative.

---

## 9. Non-goals

- Multiple custom hosts per club. V1 is one apex + its www. If a club wants
  `club.co.nz` *and* `www.oldclub.co.nz` both pointing here, they handle
  that at their registrar with a redirect.
- Automatic WWW redirect. Cloudflare Pages serves both hosts; we don't
  canonicalise. Separate brief if we want to pick a primary + 301 the other.
- Email / MX records for the domain. Out of scope — Torny doesn't provide
  mailboxes.
- Custom certs. CF Pages auto-issues Let's Encrypt; no user-provided cert.
- Admin role for custom-domain management. Owner-only, matches brief 98's
  model. Separate brief if delegation is wanted.
- Deep DNS troubleshooting UI. The FE will show which record missed; the
  admin fixes it at their registrar. No "we'll walk you through GoDaddy"
  guides.

---

## 10. Contact

Nev on Slack (`#torny-eng`). Backend: three endpoints + one reconciler +
one table change. FE already has the scaffolding — wiring the Enable
button is ~30 lines once this ships.
