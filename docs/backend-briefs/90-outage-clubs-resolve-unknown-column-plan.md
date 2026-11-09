# 🚨 OUTAGE — `/clubs/resolve` 500: Unknown column 'cd.plan'

**Severity:** every public club site on torny.co is dark. Including `nae-nae-bowling-club.torny.co`, every custom-domain tenant, and the `*.torny.co` wildcard.

**Status at time of writing:** active production outage. Started shortly after the brief 86 Lambda deploy.

---

## 1. What's happening

The public club sites (`apps/club-sites`, Nuxt on Cloudflare Pages) resolve the current tenant on every request via `GET /clubs/resolve?host=<slug>.torny.co`. That endpoint currently 500s:

```bash
$ curl "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=nae-nae-bowling-club.torny.co"
{"status":"error","code":"internal_error","message":"Unknown column 'cd.plan' in 'field list'"}
```

The FE middleware (`apps/club-sites/server/middleware/tenant.ts`) catches the 500 and bounces the visitor to a 404 — "Club not found for host." End users see the attached screenshot:

> ![404 — Club not found for host](https://torny.co/screenshots/outage-20261109.png)

**Blast radius:** every public club site. Not just Naenae.

---

## 2. Root cause

Brief 86 (plan tiers + feature gating) extended `/clubs/resolve` to include the plan in the payload. The Lambda query was updated to `SELECT cd.plan, …` but the migration that adds `clubs_data.plan` either:

- hasn't been run in prod yet, or
- was rolled back / skipped in the deploy, or
- the table alias (`cd` → `clubs_data`?) doesn't match a column that exists under a different name.

Either way, the Lambda is now referencing a column that isn't there. Every lookup fails.

---

## 3. Recovery — two paths

Either is fine; pick whichever is fastest in your deploy pipeline.

### Option A — rollback the Lambda (fastest, ~2 min)

Revert `/clubs/resolve` to the version that predates brief 86. The endpoint doesn't need `plan` to serve the public hydrate — the FE only started reading `club.plan` once brief 86 was wired up, and gracefully defaults to `'starter'` when the field is absent. So rolling back only removes a field the FE already has a fallback for.

### Option B — ship the brief 86 migration (correct)

```sql
ALTER TABLE clubs_data
  ADD COLUMN plan ENUM('starter','pro') NOT NULL DEFAULT 'starter';
```

No backfill needed — every existing row defaults to `'starter'`. Once the column exists, the current Lambda query works unchanged.

**Either way**, verify with:

```bash
curl "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=nae-nae-bowling-club.torny.co"
# → 200 with data.club
```

---

## 4. Why this slipped through

Deploy coupling. Brief 86's Lambda deploy and schema migration need to go out together (migration first, Lambda second). This time the Lambda went first. The CI check for "does the query parse against the current schema?" either doesn't exist or didn't run.

**Suggested guardrail** (for later, not now):

- Add a `SELECT 1 FROM clubs_data WHERE 1=0` smoke that touches every column the Lambda references before the deploy marks itself healthy. A missing column would fail the smoke and fail-closed the deploy.
- Or more generally: any Lambda that references a new column should block its own deploy until the migration ledger records the migration as applied.

Neither is urgent; recovery is urgent.

---

## 5. Verification once recovered

```bash
# 1. The headline check — Naenae resolves.
curl "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=nae-nae-bowling-club.torny.co"
# → 200, data.club.name = "Naenae Bowling Club"

# 2. Spot-check a second tenant so we know it's not just one row.
curl "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=the-naenae.torny.co"
# → 200

# 3. Hit a custom domain tenant.
curl "https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod/clubs/resolve?host=naenaebowlingclub.co.nz"
# → 200

# 4. Browser smoke — load https://nae-nae-bowling-club.torny.co in a fresh tab.
#    Should render the club home page, not the 404.
```

If `plan` is in the 200 payload (Option B) it should be `'starter'` for every pre-existing row — this matches brief 86's default.

---

## 6. Post-recovery

When the fix is live, ping Felicity and I'll:

1. Re-run the curls above to confirm.
2. Re-run the Playwright signup wizard E2E suite — they mock the backend so they'll still pass but it's a nice confidence check.
3. Close this brief.

Nothing on the FE needs changing either way. The middleware's catch-500-and-404 behaviour is doing exactly what it's supposed to do — just surfacing a less-than-useful error during an actual outage. I can add a friendlier "site temporarily unavailable" page as a follow-up but it's not urgent.
