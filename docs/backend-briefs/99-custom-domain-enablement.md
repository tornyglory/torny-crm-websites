# Brief 99 — Custom domain for club public sites

**Scope:**
- FE (`tornyglory/torny-crm-websites`, `apps/crm`): fix the misleading CNAME target shown on the Custom Domain card + wire the Save/Verify/Remove flows to real API endpoints.
- API (this repo): new handlers for `POST / GET / DELETE /clubs/{club_id}/custom-hostnames` + `POST /clubs/{club_id}/custom-hostnames/{id}/verify`. Each one calls the Cloudflare Pages Custom-Hostname API so that adding a row in the CRM actually makes the domain serve.

**Prereq:** Brief 95 shipped (Worker-fronted multi-tenant `.torny.club` stack is live + Pages project `torny-crm-websites` is the single project serving all clubs).

---

## 1. The bug on the current page

The CRM currently shows this for a club setting up `naenaebowls.nz`:

> **naenaebowls.nz · CNAME → proxy.torny.pages.dev**
> **www.naenaebowls.nz · CNAME → proxy.torny.pages.dev**

Both lines are wrong:

1. **`proxy.torny.pages.dev` doesn't exist.** There is no such hostname in our Cloudflare account. Nothing resolves. Pointing a customer's DNS at it would 404 permanently.
2. **`naenaebowls.nz` at the apex can't CNAME at most registrars.** A CNAME at the zone apex is forbidden by RFC 1912 and rejected by GoDaddy, Namecheap, most hosts. Only Cloudflare's own DNS supports apex CNAME via CNAME flattening.
3. **Nothing happens when they click Check DNS or Enable custom domain.** No backend handler exists to register the hostname with Cloudflare Pages. Even a correctly-pointed CNAME would 404 at the edge.

In short: the UI is shipped ahead of the plumbing. We need (a) the backend wired up, then (b) the FE instructions corrected to match what actually works.

---

## 2. The correct architecture

Custom domains follow a different path than Torny-hosted subdomains:

```
<slug>.torny.club          → wildcard DNS → tenant-router Worker → Pages (via fetch)
<customer-domain>.anything → customer's DNS → Pages (direct, as a registered custom hostname)
```

The Worker only intercepts traffic inside the `torny.club` zone. Custom domains live in the customer's own zone — the Worker never sees them. For Pages to serve the customer's domain:

1. The customer sets a **CNAME record** at their DNS provider pointing their chosen hostname at the Pages project's canonical URL.
2. We **register that hostname as a Pages Custom Domain** via the Cloudflare API.
3. Cloudflare validates the DNS record + provisions a Universal SSL cert automatically.
4. Pages routes incoming traffic for that hostname to the Nuxt app.
5. Nuxt's existing tenant middleware reads the `Host` header, calls `/clubs/resolve?host=<customer-domain>`, and resolves the clubId via the existing `club_custom_hostnames` join.

**The CNAME target the FE should display:**

```
torny-crm-websites.pages.dev
```

That's the real Pages project's canonical URL (not `proxy.anything.pages.dev`). It's the same target Cloudflare's own custom-domain setup docs would give you.

### 2.1 The apex problem

`naenaebowls.nz` (bare apex) cannot CNAME at most registrars. Three paths for customers:

| Customer's DNS provider | Apex strategy |
|---|---|
| Cloudflare DNS | CNAME flattening handles it. Set CNAME on apex as normal. |
| GoDaddy / Namecheap / Google Domains / most others | Use an `ALIAS` / `ANAME` record if the provider supports it. |
| Everyone else | Only set up `www.<domain>` as the custom domain. Configure the registrar's "forwarding" feature to redirect `<domain>` → `www.<domain>`. |

**Default FE recommendation:** tell the user to add `www.naenaebowls.nz` as the custom domain and set up a registrar-level redirect from apex → www. That's the least-surprising path and works everywhere. Advanced users on Cloudflare DNS can add the apex directly as a second custom hostname — we support both.

---

## 3. Backend — endpoints to build

Four new endpoints (all owner-only, same auth gate as the subdomain endpoint):

### 3.1 `GET /clubs/{club_id}/custom-hostnames`

Returns the current list — reuses what `get-club-settings` already does for the Domain card.

```json
200 {
    "status": "success",
    "data": {
        "custom_hostnames": [
            {
                "id": 7,
                "hostname": "www.naenaebowls.nz",
                "ssl_status": "active",
                "added_at": "2026-11-12T00:00:00Z",
                "verified_at": "2026-11-12T00:15:00Z"
            }
        ]
    }
}
```

### 3.2 `POST /clubs/{club_id}/custom-hostnames`

```http
POST /clubs/42/custom-hostnames
Authorization: Bearer <JWT>
Content-Type: application/json

{ "hostname": "www.naenaebowls.nz" }
```

Steps:

1. Validate hostname: lowercase, valid FQDN, 253 chars max, no `*`, doesn't belong to `torny.club` or `torny.co` (those are our own zones).
2. Reject if already registered to any club (`UNIQUE` check against `club_custom_hostnames.hostname`).
3. Call Cloudflare Pages **Add Custom Domain** API — `POST /accounts/{acct}/pages/projects/torny-crm-websites/domains` with `{ name: hostname }`.
4. If Cloudflare returns success → insert `club_custom_hostnames` row with `ssl_status = 'pending'`.
5. If Cloudflare returns 409 (already attached) → treat as success (idempotent) and insert the row.
6. Return the row + next-step instructions for the FE to render.

```json
201 {
    "status": "success",
    "data": {
        "id": 7,
        "hostname": "www.naenaebowls.nz",
        "ssl_status": "pending",
        "dns_instructions": {
            "type": "CNAME",
            "name": "www.naenaebowls.nz",
            "target": "torny-crm-websites.pages.dev",
            "proxied": false
        }
    }
}
```

Error codes:
- `hostname_required` (400), `hostname_invalid` (422), `hostname_reserved` (422 — points at a torny.* zone), `hostname_taken` (409 — another club has it), `provision_failed` (502 — Cloudflare API returned something other than 200/409), `forbidden` (403), `not_found` (404).

### 3.3 `POST /clubs/{club_id}/custom-hostnames/{id}/verify`

Re-polls Cloudflare for the current verification + SSL status. Called when the FE's "Check DNS" button is clicked.

Steps:

1. Load the row; 404 if missing or not in this club.
2. Call Cloudflare Pages **Get Domain** API — `GET /accounts/{acct}/pages/projects/torny-crm-websites/domains/{hostname}`.
3. Extract: `status` (pending/active) and `certificate_authority` / `verification_data`.
4. Update local row: `ssl_status = <status>`, `verified_at = NOW()` if active.
5. Return the fresh state.

```json
200 {
    "status": "success",
    "data": {
        "id": 7,
        "hostname": "www.naenaebowls.nz",
        "ssl_status": "active",       // or "pending" or "failed"
        "verified_at": "2026-11-12T00:15:00Z"
    }
}
```

### 3.4 `DELETE /clubs/{club_id}/custom-hostnames/{id}`

Removes the hostname from the Pages project and deletes the row. Idempotent (404 from Cloudflare is treated as success — the mapping is already gone).

```
200 { "status": "success", "data": { "removed": true } }
```

---

## 4. FE — the user-facing flow (fixed)

### 4.1 Empty state (no custom domains yet)

Show the "CUSTOM DOMAIN" card with:
- A single input "your-domain.com or www.your-domain.com"
- Save button
- Helper text: "We'll show you the DNS record to add once you save."

On Save → `POST /clubs/{id}/custom-hostnames` → render the DNS instructions block (step 4.2 below).

### 4.2 DNS instructions block (after a hostname is added, before it verifies)

Use the API response's `dns_instructions` block — don't hardcode anything.

> **Add this DNS record at your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.):**
>
> **Record 1**
> - Type: `CNAME`
> - Name: `www`  (or `@` if the API gave them the apex — rare)
> - Target: `torny-crm-websites.pages.dev`
> - Proxy: **Off / DNS only** (grey cloud in Cloudflare, or just "DNS" at most registrars)
>
> DNS changes take a few minutes. Once propagated, click **Check DNS**.
>
> *Using the apex (naenaebowls.nz instead of www.naenaebowls.nz)? A CNAME at the apex is only supported by Cloudflare DNS. If you're elsewhere, use your registrar's ALIAS / ANAME record type instead, or set up a redirect from apex → www.*

Three important differences from the current page:

1. **One CNAME, not two.** Guiding users to point both apex + www creates the apex-CNAME trap. Default to www-only.
2. **Correct target:** `torny-crm-websites.pages.dev` (not `proxy.torny.pages.dev`).
3. **Explicit DNS-only note** so the user doesn't orange-cloud it if they're on Cloudflare DNS (orange cloud on a CNAME to pages.dev causes a loop).

### 4.3 Check DNS button

`POST /clubs/{id}/custom-hostnames/{id}/verify` → re-render with the new `ssl_status`:

- `pending` → "DNS not yet detected. Try again in a few minutes."
- `active` → the top card flips to "Live · SSL Issued" and the DNS instructions block collapses.
- `failed` → "We couldn't validate this hostname. Double-check the CNAME value and that proxy is off, then try again."

### 4.4 Remove button

`DELETE /clubs/{id}/custom-hostnames/{id}` → confirm modal → remove the row + unregister from Pages.

### 4.5 Per-field fixes

- Remove the "Point your own domain at this club's Torny site…" copy if you're not already updating it.
- Never show `proxy.torny.pages.dev` anywhere.
- The "Fallback" block (showing `naenae-bowling-club.torny.club`) is correct — leave it alone. Only the Custom Domain card changes.

---

## 5. Verification

**Base URL gotcha:** the custom-hostname endpoints live on the **Venue API**
(not the CRM API) because TornyCrmStack hit the CFN 500-resource cap. The
subdomain PATCH endpoint (Brief 98) is on the CRM API; custom-hostname
endpoints are on the Venue API. Both Lambdas run `crm-router` dispatch;
the split is purely a CloudFormation workaround and has no behavioural
consequence for the FE. Use:

```
CRM_API   = https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod   # subdomain, members, etc.
VENUE_API = https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod   # custom-hostname CRUD, invites, billing, venue packages
```

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
TOKEN="…"   # owner JWT
CLUB=5

# 1. Add a custom hostname
curl -s -X POST "$VENUE/clubs/$CLUB/custom-hostnames" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"hostname":"www.naenaebowls.nz"}' | jq
# → 201 { data: { id, hostname, ssl_status: "pending", dns_instructions: { target: "torny-crm-websites.pages.dev", ... } } }

# 2. List
curl -s "$VENUE/clubs/$CLUB/custom-hostnames" -H "Authorization: Bearer $TOKEN" | jq
# → 200 { data: { custom_hostnames: [...] } }

# 3. Customer adds the CNAME at their registrar.
#    www.naenaebowls.nz CNAME torny-crm-websites.pages.dev

# 4. After DNS propagates (few mins):
curl -s -X POST "$VENUE/clubs/$CLUB/custom-hostnames/$ID/verify" \
    -H "Authorization: Bearer $TOKEN" | jq
# → 200 { data: { ssl_status: "active", verified_at: "..." } }

# 5. The live URL serves the club's site via Pages
curl -I https://www.naenaebowls.nz/
# → 200  (routed by Pages custom-domain binding, not the Worker)

# 6. Resolve endpoint (what the Nuxt FE calls)
curl -s "$CRM/clubs/resolve?host=www.naenaebowls.nz" | jq '.data.club_id'
# → 5

# 7. Taken
curl -s -X POST "$VENUE/clubs/999/custom-hostnames" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"hostname":"www.naenaebowls.nz"}'
# → 409 { code: "hostname_taken" }

# 8. Remove
curl -s -X DELETE "$VENUE/clubs/$CLUB/custom-hostnames/$ID" -H "Authorization: Bearer $TOKEN"
# → 200 { data: { removed: true } }
curl -I https://www.naenaebowls.nz/
# → 404 or similar — Pages no longer serves this hostname
```

---

## 6. Pass criteria

- ✓ FE never displays `proxy.torny.pages.dev`. The only target shown is `torny-crm-websites.pages.dev`, pulled from the API response's `dns_instructions.target`.
- ✓ FE recommends a single CNAME (`www.<domain>`) by default, with an "advanced: apex via ANAME / CF flattening" aside.
- ✓ Saving a hostname registers it on Pages via the API. SSL provisions automatically within 10-15 minutes. No manual Cloudflare dashboard step.
- ✓ Check DNS re-polls Cloudflare and updates `ssl_status` in real time.
- ✓ Remove unregisters the hostname from Pages and drops the DB row.
- ✓ `/clubs/resolve?host=<custom-domain>` returns the clubId (already works via existing `club_custom_hostnames` join — no change there).

---

## 7. Non-goals

- Cloudflare SaaS Custom Hostnames. That's the scalable path (unlimited custom hostnames, bypasses the Pages 100-cap) but it's a separate product with more setup. For now, direct Pages custom domains are fine: we have budget for ~85 before hitting the cap (the first 15 are the Torny-hosted subdomains from before the migration, cleanup pending).
- Apex redirect automation. We tell the user to set it up at their registrar. Automating that would require managing DNS on their behalf — out of scope.
- Deep SSL state surfacing (certificate expiry warnings, mixed-content checks). Pages handles cert lifecycle; we just show a 3-state status (pending / active / failed).

---

## 8. Backend state — not built yet

As of writing: the only pieces implemented for custom hostnames are:
- DB table `club_custom_hostnames`.
- Read in `src/handlers/get-club-settings/index.js` (returns the list for the Domain card).
- Join in `src/handlers/resolve-club/index.js` (lets Nuxt find the clubId by custom host).

Missing: the four CRUD + verify endpoints in §3. No calls to the Cloudflare Pages Custom Domain API exist today — the `addPagesDomain` helper was removed when we switched tenant subdomains to the Worker model (Brief 95), but it's the exact same API call shape we need here. We'll reintroduce a small wrapper (`addPagesCustomDomain`, `removePagesCustomDomain`, `getPagesDomainStatus`) in `src/handlers/utils/cloudflare-pages.js`.

---

## 9. Contact

Nev on Slack (`#torny-eng`). Backend will land before FE wires it up — we'll ping once the endpoints respond. Until then please remove the misleading `proxy.torny.pages.dev` copy from the Custom Domain card as a hotfix — it actively leads users astray.

---

## 10. FE hotfix — shipped ahead of backend

Landed in `apps/crm/src/components/WebsiteSettingsPanel.vue`:

- `PROXY_TARGET` constant swapped from `proxy.torny.pages.dev` →
  `torny-crm-websites.pages.dev`. No surface in the CRM still displays
  the old string (grep'd clean).
- `requiredDnsRecords` reduced to a single `www.<apex>` CNAME. The apex
  CNAME is gone; the input strips a leading `www.` so the admin can
  paste either `naenaebowls.nz` or `www.naenaebowls.nz` and we always
  render the www form.
- Added an "Advanced — using the apex?" aside listing the three paths
  (Cloudflare CNAME flattening / ALIAS or ANAME / registrar redirect
  from apex → www).
- Added an explicit "DNS only" note so Cloudflare DNS admins don't
  orange-cloud the record and loop Pages.

The "Check DNS" button still runs the client-side DoH lookup — that's
advisory and remains useful until the backend `/verify` endpoint ships.
Once it lands, the Enable CTA + Check DNS will swap over to the API
calls spec'd in §3.3, and the hardcoded target string will come from
`dns_instructions.target` instead of the FE constant.
