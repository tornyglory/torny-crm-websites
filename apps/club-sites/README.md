# @torny/club-sites

Public-facing club websites. Nuxt 3 on **Cloudflare Pages**, multi-tenant via **Cloudflare for SaaS** (Custom Hostnames).

## Dev

```bash
pnpm --filter @torny/club-sites dev
# → http://localhost:3000

# Preview a production build in the wrangler local runtime:
pnpm --filter @torny/club-sites build
pnpm --filter @torny/club-sites preview
```

Env vars (`.env.local` or `.dev.vars`):

```
NUXT_TORNY_API_BASE_URL=https://api.torny.club
NUXT_REVALIDATE_SECRET=change-me
NUXT_PUBLIC_SITE_URL=https://sites.torny.club
```

## Multi-tenant architecture

- **Host resolution**: `server/middleware/tenant.ts` reads the `Host` header on every request and looks up the club via `/clubs/resolve?host=…`. For production, hot-path this to Workers KV.
- **Custom domains**: owner enters `mybowlsclub.co.nz` in the CRM → CRM calls the Cloudflare API (`POST /zones/:id/custom_hostnames`) → CF issues SSL via SNI → same Nuxt project handles the request.
- **Fallback subdomain**: every club also gets `<slug>.sites.torny.club` (or your chosen root domain), routed via a single wildcard record.

## Publish + revalidate flow

1. Owner clicks *Publish* in the CRM.
2. CRM backend POSTs `/api/revalidate` with `{ clubId, paths: ['/', '/events/…'] }` + HMAC signature.
3. `server/api/revalidate.post.ts` verifies the HMAC then calls the Cloudflare cache purge API for each URL (or for Enterprise, uses `Cache-Tag` purge).
4. Next visitor triggers a re-render; cache repopulates for the SWR window.

## Route rules

Every page uses SWR (stale-while-revalidate) so cold hits are still fast:

| Path              | SWR window |
| ----------------- | ---------- |
| `/`               | 5 min      |
| `/events/**`      | 1 min      |
| `/honour-board/**`| 1 hour     |
| `/membership`     | 5 min      |
| `/contact`        | 1 hour     |

## Deploy

```bash
pnpm --filter @torny/club-sites deploy
```

Requires `wrangler login` first. Bind the `TORNY_KV` namespace and env secrets in the Pages project dashboard (or via `wrangler.toml`).
