# Custom Domains + Fallback Subdomains

**Feature:** every club gets a Torny-hosted address that always works (`<slug>.torny.co`), and can optionally point their own custom domain (`kelburnbowls.co.nz`) at the platform. The CRM's Website → Settings → Domain tab already renders every piece of the flow — this brief is the backend contract that makes it real.

**Status:** front-end mock lives in `apps/crm/src/components/WebsiteSettingsPanel.vue` (Domain section). Every string it shows — custom hostname, live/SSL badges, fallback address, three DNS records — is currently hardcoded. Await backend to ship this brief, then swap the mock for real API calls.

**Related briefs:**
- brief 15/16 (public site payload + tenant resolution) — the resolver at `GET /clubs/resolve?host=` needs to accept both the fallback subdomain and the custom domain and return the same club.
- brief 22 / 23 / 37 (font-pair, style-preset, colour-scheme) — same "PATCH + revalidate" webhook pattern.
- brief 39 (scoped CRM roles) — only `owner` or `admin` (`settings:brand` permission) can change the custom domain.

---

## Base URL — CRM API

```
https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Owner or admin JWT for the mutations. `GET` is admin+ (not public — the DNS record targets are club-specific and shouldn't leak).

---

## The endpoints

| Method | Path | Auth |
|---|---|---|
| `GET`    | `/clubs/{club_id}/domain` | admin+ |
| `PATCH`  | `/clubs/{club_id}/domain` | admin+ |
| `POST`   | `/clubs/{club_id}/domain/verify` | admin+ |
| `DELETE` | `/clubs/{club_id}/domain` | admin+ |
| `GET`    | `/clubs/{club_id}/domain/dev-preview` | admin+ · dev-only (see §7) |

The public site resolver `/clubs/resolve?host=` (already live) picks up custom domains automatically once they're linked — no new public endpoint needed.

---

## 1. Fallback subdomain

Every club gets `<slug>.torny.co` at onboarding. It's minted from `clubs.slug` and stored on `clubs_data.fallback_subdomain`. Can never be edited (would break existing links). Free SSL via the platform wildcard cert (`*.torny.co`).

Rules:
- Slug is lowercased and stripped to `[a-z0-9-]`. First-come-first-served on collision — onboarding rejects a taken slug with `409 slug_taken` (already wired via brief 22 onboarding path).
- Reserved slugs (`www`, `api`, `crm`, `sites`, `admin`, `docs`, `blog`, `mail`, `staging`, `dev`, `preview`) — validator rejects with `400 reserved_slug`.
- Renaming a slug at any point mints a new subdomain and 301-redirects the old one for 90 days, then drops it. Out of scope for v1; document but don't build.

---

## 2. `GET /clubs/{club_id}/domain`

Returns the full domain state — everything the Domain settings card needs to render.

**200 response:**
```jsonc
{
  "status": "success",
  "data": {
    "fallback_subdomain": "kelburn.torny.co",
    "custom_domain": "kelburnbowls.co.nz",         // null when not set
    "state": "live",                                // 'unset' | 'pending' | 'live' | 'error'
    "ssl": {
      "state": "issued",                            // 'none' | 'issuing' | 'issued' | 'error'
      "issued_at": "2026-08-14T22:14:03.000Z",     // nullable
      "expires_at": "2026-11-12T22:14:03.000Z",    // nullable
      "renewal_at": "2026-10-13T22:14:03.000Z",    // nullable
      "provider": "letsencrypt",                    // 'letsencrypt' | 'cloudflare' | null
      "error_message": null                         // populated when state='error'
    },
    "redirect_www_to_apex": true,
    "records": [
      {
        "type": "CNAME",
        "host": "kelburnbowls.co.nz",
        "value": "proxy.torny.co",
        "status": "ok",                             // 'ok' | 'missing' | 'wrong'
        "actual_value": "proxy.torny.co",           // what the DNS actually reports, null when missing
        "last_checked_at": "2026-08-26T22:00:00.000Z"
      },
      {
        "type": "TXT",
        "host": "_torny-verify.kelburnbowls.co.nz",
        "value": "torny-verify=abc123def456",       // opaque token, unique per club
        "status": "ok",
        "actual_value": "torny-verify=abc123def456",
        "last_checked_at": "2026-08-26T22:00:00.000Z"
      },
      {
        "type": "CNAME",
        "host": "www.kelburnbowls.co.nz",
        "value": "proxy.torny.co",
        "status": "ok",
        "actual_value": "proxy.torny.co",
        "last_checked_at": "2026-08-26T22:00:00.000Z"
      }
    ],
    "next_check_at": "2026-08-26T22:15:00.000Z"     // when the worker will re-check
  }
}
```

**State machine:**
- `unset` — no custom domain set. Only fallback works. `records: []`.
- `pending` — custom domain set, one or more records not yet green. SSL sits `issuing` or `none`.
- `live` — every record green + SSL issued. Traffic flowing.
- `error` — a previously-live domain lost a DNS record OR SSL renewal failed. Fallback continues to serve — the custom domain 502s until fixed.

---

## 3. `PATCH /clubs/{club_id}/domain`

Set or change the custom domain. Server generates a new verify token, invalidates any SSL cert for the old domain, and kicks off a first DNS check.

**Body:**
```jsonc
{
  "custom_domain": "kelburnbowls.co.nz",
  "redirect_www_to_apex": true                     // optional, default true
}
```

**200 response:** same shape as `GET`. Comes back with `state: 'pending'` and every record `status: 'missing'` (the owner hasn't added them yet).

**Errors:**

| HTTP | code | Cause |
|---|---|---|
| 400 | `bad_domain` | Doesn't parse as a valid hostname (contains spaces, no TLD, etc.) |
| 400 | `domain_too_long` | > 253 chars |
| 400 | `reserved_domain` | Trying to set a `torny.co` subdomain as the custom domain (would collide with the fallback pool) |
| 409 | `domain_taken` | Another club already owns this hostname |
| 429 | `too_many_changes` | 4th domain change in 24h — rate-limited to defeat DNS-record thrashing |
| 401 / 403 | | Missing JWT / wrong role |

**Side effects on success:**
1. Store `clubs_data.custom_domain = 'kelburnbowls.co.nz'` + `clubs_data.custom_domain_verify_token` (fresh 128-bit hex).
2. Persist the three record specs to `club_domain_records`.
3. Reset SSL state to `none`, delete any prior cert.
4. Fire a first async DNS check (`SetTimeout(0)` — respond fast, worker takes over).
5. Fire the Nuxt revalidate webhook so the tenant resolver picks up the new host binding.

---

## 4. `POST /clubs/{club_id}/domain/verify`

Force a re-check now. Owner-triggered from the Domain tab's "Re-check DNS" button — useful when they've just added the records and don't want to wait for the next scheduled sweep.

**Body:** none.

**200 response:** the same GET shape, with fresh `records[*].status` + `last_checked_at`.

**Rate-limit:** 1 request per 30 seconds per club. 429 `verify_cooldown` with `retry_after_ms` in the body.

**Side effects:**
- Each record hit via a `dns.resolve()` call server-side (DoH provider, 5-second timeout per record).
- If all three flip to `ok` and SSL is still `none`, immediately trigger SSL issuance.
- If any record was `ok` before and is now `missing`/`wrong`, flip the row to `state: 'error'` and note it in an internal audit log (used by the domain-drift email nudge).

---

## 5. `DELETE /clubs/{club_id}/domain`

Remove the custom domain. Fallback stays. Cert (if any) gets revoked. Records rows deleted.

**200 response:**
```json
{ "status": "success", "data": { "fallback_subdomain": "kelburn.torny.co" } }
```

Idempotent: deleting when there's no custom domain returns 200 with the same shape. No error.

---

## 6. DNS record spec

The three records shown in `records[]` are computed server-side per club. Not a template — the values are opaque so the frontend just displays what the API sends.

- **Apex CNAME** — `host = <custom_domain>`, `value = proxy.torny.co`. Providers that don't allow CNAMEs at the apex should use `ALIAS` / `ANAME` / flattening — we don't care as long as `dns.resolve()` returns the right target.
- **Verify TXT** — `host = _torny-verify.<custom_domain>`, `value = torny-verify=<128-bit token>`. Token is a per-club secret, regenerated on every `PATCH /domain`. Prevents someone else from claiming a domain they don't control.
- **www CNAME** — `host = www.<custom_domain>`, `value = proxy.torny.co`. Only rendered when `redirect_www_to_apex` is true (default). The edge proxy handles the 301 from www → apex.

`actual_value` on each row is what the DNS resolver actually returned last check — useful for the CRM to render "you set X, we need Y" hints.

---

## 7. Local development hooks

**Env flag: `TORNY_DEV_SKIP_DNS_CHECK`**
- When `true`, the DNS-check worker treats every record as `status: 'ok'` and every SSL issuance as `state: 'issued'`. Lets the CRM Domain tab render its "live" state without an actual cert or DNS.
- Off in staging/prod.

**`GET /clubs/{club_id}/domain/dev-preview`** (dev-only, gated by the same flag)
Query params:
- `state` — override the top-level state: `unset | pending | live | error`.
- `ssl` — override SSL state: `none | issuing | issued | error`.
- `records` — comma-separated per-record status overrides: `ok,missing,wrong`.

Returns the same shape as `GET /domain` but with the overrides applied in-memory. Doesn't persist. Used to sanity-check every UI branch without waiting for real DNS.

Return `404 not_found` when `TORNY_DEV_SKIP_DNS_CHECK` is false or unset.

**Fallback subdomain resolver in dev**
- The Nuxt tenant resolver already accepts `?host=<slug>.torny.co` via the query param (with a session cookie sticky). Nothing new to build there.
- For end-to-end testing with real hostnames, `/etc/hosts` + Nuxt on port 80 (or Caddy in front) is documented in `apps/club-sites/README.md`. Out of scope for the backend brief.

---

## 8. DNS-check worker

Cron every 15 minutes, plus on-demand via the `verify` endpoint. Walks every club with `custom_domain != NULL`, re-resolves the three record hosts via DoH, and updates `club_domain_records.status` + `actual_value` + `last_checked_at`.

Transitions:
- All three `ok` + SSL `none` → kick off SSL issuance (Let's Encrypt via ACME, or Cloudflare-for-SaaS API depending on infra choice).
- All three `ok` + SSL `issued` → set `state = 'live'`.
- Any record flips from `ok` → not-`ok` → set `state = 'error'`, keep the row's `actual_value` for the CRM hint.
- SSL cert < 30 days from expiry → trigger renewal.

Errors during the resolve don't flip the row's state — a transient DNS failure shouldn't take down the CRM's Domain tab. Log and retry next tick.

---

## 9. `/clubs/resolve?host=` — extend for custom domains

Currently the tenant resolver only knows about `<slug>.torny.co`. Extend it to also match `clubs_data.custom_domain` (LOWER-cased, no `www.` prefix).

Resolution priority:
1. Exact match on `custom_domain`.
2. Exact match on `www.<custom_domain>` → resolve to the club + set a response header `X-Torny-Redirect: /` so the edge proxy 301s to the apex (only when `redirect_www_to_apex = true`).
3. Exact match on `<slug>.torny.co`.
4. 404.

The Nuxt middleware already caches resolver responses for 60s per host — that stays.

---

## 10. Frontend integration plan

- **`packages/api-client/src/resources/domains.ts`** — new resource:
  - `get(clubId)` → `DomainStatus`
  - `update(clubId, { custom_domain, redirect_www_to_apex? })` → `DomainStatus`
  - `verify(clubId)` → `DomainStatus`
  - `remove(clubId)` → `{ fallback_subdomain: string }`
- **`useDomainStore` (Pinia)** — reads the current club's domain state, refreshes on club change + after mutations. Optional: poll every 60s while the Domain tab is open and `state = 'pending'` so the "Live" pill flips without a manual refresh.
- **`WebsiteSettingsPanel.vue` — Domain section**:
  - Replace the hardcoded `kelburnbowls.co.nz`, `kelburn.sites.torny.club`, `proxy.torny.pages.dev`, etc. with real store values.
  - "Edit" opens an inline form to PATCH the domain.
  - "Copy" for the fallback address — already works.
  - Per-record status pill reads `records[i].status` and (when `wrong`) shows "expected X, got Y" copy from `expected_value` vs `actual_value`.
  - Add "Re-check DNS" button that calls `verify()` + shows a spinner.
  - Add "Remove custom domain" as a danger action inside the Edit modal.

---

## 11. TS types

```ts
type DomainState = 'unset' | 'pending' | 'live' | 'error'
type SslState = 'none' | 'issuing' | 'issued' | 'error'
type DnsRecordType = 'CNAME' | 'TXT' | 'A' | 'ALIAS'
type DnsRecordStatus = 'ok' | 'missing' | 'wrong'

interface DnsRecord {
  type: DnsRecordType
  host: string
  value: string
  status: DnsRecordStatus
  actual_value: string | null
  last_checked_at: string | null
}

interface SslStatus {
  state: SslState
  issued_at: string | null
  expires_at: string | null
  renewal_at: string | null
  provider: 'letsencrypt' | 'cloudflare' | null
  error_message: string | null
}

interface DomainStatus {
  fallback_subdomain: string
  custom_domain: string | null
  state: DomainState
  ssl: SslStatus
  redirect_www_to_apex: boolean
  records: DnsRecord[]
  next_check_at: string | null
}

interface UpdateDomainInput {
  custom_domain: string | null
  redirect_www_to_apex?: boolean
}

type DomainErrorCode =
  | 'bad_domain'
  | 'domain_too_long'
  | 'reserved_domain'
  | 'domain_taken'
  | 'too_many_changes'
  | 'verify_cooldown'
```

---

## 12. Verification cases

- ✓ `GET` when no custom domain set → `state: 'unset'`, `records: []`, `custom_domain: null`.
- ✓ `PATCH` with a valid hostname → state pending, three record rows with `status: 'missing'`.
- ✓ Once records set correctly (mock DNS), `verify` flips them to `ok` + kicks SSL.
- ✓ SSL issued → `state: 'live'`, `ssl.state: 'issued'`, populated `issued_at` / `expires_at`.
- ✓ Manually break the CNAME (change target to something wrong) + `verify` → row flips to `wrong`, `actual_value` reflects what the resolver got, top-level `state: 'error'`.
- ✓ `PATCH` with `custom_domain: null` → clears the domain, records deleted, cert revoked (or scheduled for revocation).
- ✓ `POST /verify` twice in 10s → second is 429 `verify_cooldown`.
- ✓ `PATCH` four times in 24h → fourth returns 429 `too_many_changes`.
- ✓ `PATCH` with `bad_domain: "not a domain"` → 400.
- ✓ Another club owning `example.com` + `PATCH { custom_domain: 'example.com' }` from a second club → 409 `domain_taken`.
- ✓ `PATCH { custom_domain: 'kelburn.torny.co' }` → 400 `reserved_domain`.
- ✓ Non-admin → 403.
- ✓ `TORNY_DEV_SKIP_DNS_CHECK=true` + `PATCH` a domain → immediately `state: 'live'`, `ssl.state: 'issued'`.
- ✓ `GET /domain/dev-preview?state=error&ssl=error&records=ok,missing,wrong` in dev mode → returns exactly that mix.
- ✓ Custom domain set + hit `/clubs/resolve?host=kelburnbowls.co.nz` → returns the Kelburn club (same as `?host=kelburn.torny.co`).

---

## 13. Non-goals (v1)

- Multi-domain support (a club with 3+ custom domains all pointing to Torny). One custom domain per club.
- Wildcard custom domains (`*.kelburnbowls.co.nz`). Just apex + www.
- Auto-purchase / registration through the platform. Owners bring their own domain.
- Slug renaming with the 90-day redirect window. Slugs are permanent for v1.
- CAA record enforcement notes in the UI. If the owner's registrar has a CAA policy that blocks Let's Encrypt, the SSL state will flip to `error` with the resolver message — that's the surface.

---

## 14. Contact

Same as prior briefs. If we move to Cloudflare-for-SaaS for cert issuance, the `ssl.provider` value flips to `cloudflare` and the `renewal_at` may become irrelevant (they auto-renew silently). Frontend just displays whatever comes back — no coordination needed there.
