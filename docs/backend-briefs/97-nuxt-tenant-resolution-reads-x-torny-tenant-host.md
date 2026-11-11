# Brief 97 — Nuxt tenant resolution reads `x-torny-tenant-host`

**Scope:** Vue/Nuxt FE (`tornyglory/torny-crm-websites`) — one-line middleware change in whichever server-side code resolves the current club from the request host.

**Prereq:** Cloudflare Worker tenant-router already deployed on `*.torny.club/*` (see `cloudflare-workers/tenant-router/` in the API repo).

---

## 1. The ask

On every incoming request, the Nuxt server reads the `Host` header to figure out which club's site to render — the resolved clubId drives every subsequent API call. Right now it does something like:

```ts
const host = event.node.req.headers.host;
// or: getRequestHost(event)
// or: event.headers.get('host')
const club = await resolveClub(host);   // calls /clubs/resolve?host=<host>
```

Change it to prefer `x-torny-tenant-host` and fall back to `Host`:

```ts
const host = event.node.req.headers['x-torny-tenant-host']
          ?? event.node.req.headers.host;
const club = await resolveClub(host);
```

That's it. Backwards-compatible — existing `.torny.co` traffic and anything else that doesn't go through the Worker keeps working unchanged.

---

## 2. Why

We built a Cloudflare Worker that fronts `*.torny.club/*`. For each request:

1. Reads the incoming Host header.
2. Looks up `host:<host>` → `clubId` in KV (the same namespace the API already writes to).
3. Proxies the request to `torny-crm-websites.pages.dev` with these headers injected:
   - `x-torny-club-id` — the resolved clubId
   - `x-torny-tenant-host` — the original request host

**The problem:** when the Worker proxies to `pages.dev`, the `fetch()` call rewrites the `Host` header to `torny-crm-websites.pages.dev` (Cloudflare Workers takes Host from the URL — we can't override it). So Nuxt sees `Host: torny-crm-websites.pages.dev` and 404s with "Club not found for host".

The Worker injects the original host as `x-torny-tenant-host` specifically so the FE can resolve the tenant from that header instead. Nuxt just needs to read it.

**Why we need the Worker at all:** we're moving club public sites from `.torny.co` → `.torny.club` so the whole platform lives under one apex. Cloudflare Pages has a 100-custom-domain cap per project — fine for today's ~3 clubs, but we want to scale to thousands without that limit. The Worker+KV model is standard multi-tenant SaaS on Cloudflare: one wildcard DNS, one wildcard Worker route, KV lookup per request, no per-tenant Pages registration. Infinite scale.

---

## 3. Where to make the change

Search the FE repo for one of:
- `/clubs/resolve` — the API endpoint called with the host
- `headers.host` — the header being read
- `resolveTenant` / `resolveClub` / `currentClub` / `useClub`

Likely locations in a Nuxt 3 app:
- `server/middleware/*.ts` — a middleware file like `tenant.ts` or `resolve-club.ts`
- `server/plugins/*.ts` — an early-boot plugin
- A composable called from a page's `asyncData` / `useAsyncData`

Whichever place currently gets the Host, add the header fallback. One line, one file.

---

## 4. Verify

After the FE change is deployed to the Pages project:

```bash
# 1. Direct pages.dev now accepts the override header.
curl -I https://torny-crm-websites.pages.dev/ -H "x-torny-tenant-host: nae-nae-bowling-club.torny.co"
# → HTTP 200   (today: 404 "Club not found for host")

# 2. End-to-end through the Worker on the new .torny.club apex.
curl -I https://nae-nae-bowling-club.torny.club/
# → HTTP 200   (today: 404)

# 3. Pre-existing path — unchanged behaviour.
curl -I https://nae-nae-bowling-club.torny.co/
# → HTTP 200   (as today, no regression)
```

If all three pass, the Worker model is live and we can cut all traffic over to `.torny.club`.

---

## 5. Pass criteria

- ✓ Any request carrying `x-torny-tenant-host` uses that header for tenant resolution.
- ✓ Any request without `x-torny-tenant-host` continues to use `Host` — zero behaviour change for existing `.torny.co` callers.
- ✓ `<slug>.torny.club` renders the club's site end-to-end through the Worker.

---

## 6. Non-goals

- Changing how tenants are resolved. The `/clubs/resolve?host=` API call pattern stays identical — only the *source* of the host string changes (header preference).
- Changing any public URLs rendered by the FE (canonical links, OG tags, sitemap) — those should still reflect the request's actual host, which the FE reads from the same place it does today. This brief is only about the lookup.
- Handling raw `.pages.dev` access without tenant headers. Those should keep 404ing — the Worker is the entry point for production traffic, and direct `.pages.dev` serving production content would be bad for SEO.

---

## 7. Why this is safe

- Adding a header fallback is purely additive. If `x-torny-tenant-host` is absent (today's state for 100% of traffic), nothing changes.
- Only our tenant-router Worker sets this header. Direct `.pages.dev` access from a browser or a scraper can't spoof it — well, they *can*, but the worst they can do is resolve a different tenant than their request host, which is harmless (it's the same read-only resolution the FE already does).
- The Worker is already running on `*.torny.club/*` — this change just unblocks the in-flight requests. Backend handlers, DB, API Gateway — none of that changes.

---

## 8. Related context (backend)

- **Cloudflare Worker:** `cloudflare-workers/tenant-router/` in the API repo (`general`). Deployed to the Cloudflare account that owns `torny.club`, on route `*.torny.club/*`.
- **KV namespace:** `worker-TORNY_KV` (id `630c2c36dafc4947bb07dd053e06e744`) — holds `host:<full-host>` → `<clubId>` entries. Writes come from the existing `provisionClubDomain` flow in `src/handlers/utils/cloudflare-pages.js`.
- **CRM bypass:** `app.torny.club` routes through the same Worker but bypasses tenant resolution — the Worker proxies directly to the Azure Static Web App that backs the CRM. No tenant headers are injected on that path.
- **Pending backend work:** migration 153 flips `clubs_data.primary_host` from `.torny.co` → `.torny.club` for every onboarded club, which triggers the retry Lambda to write fresh KV entries. We'll run that only after this FE change ships — otherwise clubs will 404 on the new apex.

---

## 9. FE status — shipped

Landed in `apps/club-sites/server/middleware/tenant.ts`. The middleware now
reads `x-torny-tenant-host` first and falls back to `Host`; everything
downstream (`resolveClubForHost`, `event.context.club`, the dev `?host=`
override, the localhost-only cookie) is unchanged.

```ts
const rawRequestHost = (
  getRequestHeader(event, 'x-torny-tenant-host')
  ?? getRequestHeader(event, 'host')
  ?? ''
).toLowerCase()
```

Backend is clear to run migration 153 and let the retry Lambda write the
new KV entries. Flag anything that looks off end-to-end — happy to take a
second pass.

---

## 10. Contact

Nev on Slack (`#torny-eng`). Tiny change — one line in one file. Flag anything unclear and I'll clarify.
