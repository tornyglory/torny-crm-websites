# Public signup flow — self-serve onboarding for any organisation

**Feature:** turn the 4-step signup wizard from the marketing site into a real onboarding flow. One public endpoint creates the user, the organisation, and a Stripe Checkout Session (subscription mode with 30-day trial) atomically. Slug availability check feeds the wizard's auto-slug field. Replaces the old "claim your club from a pre-populated bowls directory" flow entirely.

**Status:** this brief is phase 3 of the Torny OS subscription model (phases 1 + 2 are briefs 86 + 87). FE wiring on `torny-web` lands as a separate commit; backend owes the endpoint + the org `type` column + slug check. Phase 4 (in-app upgrade / downgrade UX) is a follow-up — this brief doesn't touch it.

**Related briefs:**
- Brief 86 — plan tiers + feature gating. This brief creates clubs that default to Starter, upgraded to Pro via the checkout flow.
- Brief 87 — Stripe subscriptions. The `POST /public/signup` endpoint is a wrapper around brief 87's `/billing/checkout` + user/org creation; same Stripe wiring.

**Supersedes:** the "claim your club" flow — the existing pre-populated bowls directory + claim/approve path (`/claim` on the CRM, `claims` api-client resource, `POST /claims/submit` / `POST /claims/{id}/approve` on the backend). See §7 for the retirement plan.

---

## TL;DR

- **Schema:** `clubs.type ENUM(...)` (10 values, nullable for existing rows), `clubs.timezone VARCHAR(64) NOT NULL DEFAULT 'Pacific/Auckland'`, `clubs.country VARCHAR(2) NOT NULL DEFAULT 'NZ'`.
- **New GET** `/public/slugs/{slug}/availability` — returns `{ available, reason? }` so the wizard's slug input can show live validation.
- **New POST** `/public/signup` — atomic create of user + organisation + Stripe Checkout Session (trial = 30 days). Returns a short-lived login token + the Stripe Checkout URL. FE uses the token to sign the admin in, then redirects to Stripe.
- **No new webhooks.** Brief 87's existing subscription webhooks handle the trial → active lifecycle.
- **No changes to `clubs.plan`** — new clubs start on Starter (brief 86 default); Stripe webhook flips them to Pro once trial starts.
- **Retires the old claim-your-club flow** (`/claim` in the CRM, the `claims` resource, the `/claims/*` endpoints). See §6 for the sunset plan. Existing claimed clubs are unaffected.

---

## 1. Schema — migration 150

```sql
ALTER TABLE clubs
  ADD COLUMN type ENUM(
    'sports_and_recreation',
    'fitness_and_wellness',
    'arts_and_culture',
    'community_and_civic',
    'youth_groups',
    'hospitality',
    'holiday_accommodation',
    'events_venue',
    'non_profit',
    'other'
  ) NULL,
  ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Pacific/Auckland',
  ADD COLUMN country  VARCHAR(2)  NOT NULL DEFAULT 'NZ';
```

### Notes

- `type` is nullable so every existing club lands with `NULL` — no migration grief. The CRM's Settings → Organisation can prompt existing admins to pick one later.
- `country` + `timezone` default to NZ because today's clubs are all NZ-based. Signups from the public form always pass an explicit value.
- The ten enum values are the ones the wizard displays. Keep them stable — once published they're a contract with the FE.

---

## 2. `GET /public/slugs/{slug}/availability`

Public, no auth, cheap. The wizard calls this after each keystroke (debounced ~200ms) to flip the little "✓ Available / ✗ Taken" badge next to the slug field.

### 200 — available

```jsonc
{
  "status": "success",
  "data": { "available": true, "slug": "thorndon-bowling-club" }
}
```

### 200 — not available

```jsonc
{
  "status": "success",
  "data": {
    "available": false,
    "slug": "thorndon-bowling-club",
    "reason": "taken"   // 'taken' | 'reserved' | 'too_short' | 'bad_chars'
  }
}
```

Returning 200 either way (not 404) — the FE displays the reason without needing to branch on HTTP status.

### Validation

- `slug` — 2..64 chars, lowercase `a-z`, digits, hyphens. No leading/trailing hyphens, no consecutive hyphens. Invalid format → `available: false, reason: 'bad_chars'`.
- **Reserved list** — maintain a small deny-list of slugs we can't give out: `www`, `api`, `app`, `admin`, `dashboard`, `help`, `status`, `blog`, `login`, `signup`, `signin`, `register`, `support`, `docs`, `about`, `pricing`, `torny`, `torny-os`. Return `reason: 'reserved'`.

### Caching

```
Cache-Control: no-store
```

Availability is volatile (someone else might claim the slug a second later) — don't let any proxy cache it.

---

## 3. `POST /public/signup`

The wizard's final "Save card · Start trial" button hits this endpoint. One call → user created, org created, Stripe Checkout Session minted. Public, no auth. All-or-nothing: if any step fails, the whole thing rolls back.

### Request

```jsonc
{
  "user": {
    "name":     "Sarah Whittaker",
    "email":    "sarah@thorndonclub.co.nz",
    "password": "goodlongpassword"
  },
  "organisation": {
    "name":     "Thorndon Bowling Club",
    "slug":     "thorndon-bowling-club",
    "type":     "sports_and_recreation",
    "country":  "NZ",
    "timezone": "Pacific/Auckland"
  },
  "plan":        "pro",                                               // 'starter' | 'pro'
  "success_url": "https://torny.co/signup/welcome?org=thorndon-bowling-club",
  "cancel_url":  "https://torny.co/signup?step=4"
}
```

### Server behaviour (wrapped in a single DB transaction)

1. **Validate everything up front** before touching Stripe or the DB:
   - `user.email` — standard email format, not already registered → 400 `email_in_use`.
   - `user.password` — ≥ 12 chars → 400 `bad_password`.
   - `organisation.slug` — passes the §2 availability check → 400 `slug_unavailable`.
   - `organisation.type` — one of the 10 enum values → 400 `bad_type`.
   - `plan` — `'starter'` or `'pro'` → 400 `bad_plan`.
   - `success_url` / `cancel_url` — HTTPS, ≤ 2048 chars → 400 `bad_url`.
2. **Reserve the slug** (SELECT FOR UPDATE on the slug row, or an advisory lock) to prevent a race with another concurrent signup.
3. **Create the user** (`users` row + password hash). Owner role, email unverified.
4. **Create the organisation** (`clubs` row with `type`, `timezone`, `country`, `plan = 'starter'` default from brief 86, `subscription_status = 'none'` from brief 87). Attach the user as owner on `club_members`.
5. **Create a Stripe Customer** (same shape as brief 87 §3) and persist `clubs.stripe_customer_id`.
6. **Mint a Stripe Checkout Session** (same shape as brief 87 §3, subscription mode, `trial_period_days: 30`, `success_url` + `cancel_url` from the request).
7. **Issue a short-lived JWT** scoped to the new user — the FE uses it to sign them in before the Stripe redirect so when Stripe bounces them back they're already authenticated.
8. **Fire a "welcome / verify your email" email** (async). The user can keep going without verifying; verification matters once they want to send bulk comms.
9. **Commit the transaction**. If any Stripe call failed after inserts, rollback and return 502.

### 200

```jsonc
{
  "status": "success",
  "data": {
    "user":          { "id": 4821, "name": "Sarah Whittaker", "email": "sarah@thorndonclub.co.nz" },
    "organisation":  { "id": 319, "slug": "thorndon-bowling-club", "name": "Thorndon Bowling Club" },
    "auth_token":    "eyJhbGciOi…",                                                      // JWT, 15-min expiry
    "checkout_url":  "https://checkout.stripe.com/c/pay/cs_test_…",
    "public_site":   "https://thorndon-bowling-club.torny.co"
  }
}
```

The FE's sequence after a 200:
1. Store `auth_token` the same way `/auth/login` does.
2. `window.location.href = checkout_url`.

### Errors

| HTTP | code | meaning |
|---|---|---|
| 400 | `bad_email` / `bad_password` / `bad_plan` / `bad_type` / `bad_url` | obvious validation failures |
| 400 | `slug_unavailable` | slug lost the race / taken / reserved. Response body echoes §2's shape |
| 409 | `email_in_use` | there's already a user with that email. FE should offer "sign in instead" |
| 502 | `stripe_create_failed` | Stripe rejected (subpath in `message`); rollback happened |
| 500 | generic | retry with the same payload is safe (idempotency key — see below) |

### Idempotency

The handler accepts an optional `Idempotency-Key` header. If the same key arrives twice within 24h, return the cached response (success or 4xx) instead of re-executing. Covers the "user double-clicks Save card" case. Store the key + response in a small table (reuse brief 72's `stripe_events` if its shape fits, or a dedicated `signup_idempotency` table).

---

## 4. Trip around the loop — how it all fits together

```
Wizard Step 4 click
      │
      │ POST /public/signup (brief 88)
      ▼
┌─────────────────────────────────────────────┐
│ Backend: validate, lock slug, insert user + │
│ org, create Stripe Customer, mint Checkout  │
│ Session with 30-day trial, issue JWT.       │
└─────────────────────────────────────────────┘
      │
      │ 200 { auth_token, checkout_url }
      ▼
FE stores token (user is now signed in)
FE does window.location.href = checkout_url
      │
      ▼
Stripe-hosted Checkout — card captured, $0 charged
      │
      ├── Save card ──► Stripe redirects to success_url
      │                        │
      │                        │ Stripe fires customer.subscription.created
      │                        ▼
      │                 brief 87 webhook:
      │                 - clubs.subscription_status = 'trialing'
      │                 - clubs.plan = 'pro' (from the price metadata)
      │                 - clubs.trial_ends_at = +30 days
      │                 - Welcome-to-Pro email fires
      │
      └── Cancel ──► Stripe redirects to cancel_url
                                │
                                ▼
                        User is still signed in, org still exists,
                        plan = starter, subscription_status = 'none'.
                        FE shows "You can finish signing up later in Settings → Billing."
```

Key invariant: **the signup endpoint and the Stripe webhook are the only writers to `clubs.subscription_status` + `clubs.plan`**. The webhook is idempotent via brief 87's ledger — replays are safe.

---

## 5. Verification

```bash
API="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Slug availability — fresh slug.
curl "$API/public/slugs/thorndon-bowling-club/availability"
# → 200 { data: { available: true, slug: 'thorndon-bowling-club' } }

# 2. Slug availability — reserved.
curl "$API/public/slugs/admin/availability"
# → 200 { data: { available: false, slug: 'admin', reason: 'reserved' } }

# 3. Slug availability — bad chars.
curl "$API/public/slugs/Thorndon-Club!/availability"
# → 200 { data: { available: false, reason: 'bad_chars' } }

# 4. Full signup — success.
curl -X POST -H "Content-Type: application/json" "$API/public/signup" \
  -d '{"user":{"name":"Sarah","email":"sarah+test@thorndonclub.co.nz","password":"goodlongpassword"},"organisation":{"name":"Thorndon Test Club","slug":"thorndon-test-club","type":"sports_and_recreation","country":"NZ","timezone":"Pacific/Auckland"},"plan":"pro","success_url":"https://torny.co/signup/welcome","cancel_url":"https://torny.co/signup?step=4"}'
# → 200 { data: { user, organisation, auth_token, checkout_url, public_site } }

# 5. Pay at the returned checkout_url with Stripe test card 4242 4242 4242 4242.
#    Webhook fires customer.subscription.created → club flipped to trialing + pro.

# 6. Already-registered email.
curl -X POST "$API/public/signup" -d '{"user":{"email":"sarah+test@thorndonclub.co.nz", ...}}'
# → 409 { code: 'email_in_use' }

# 7. Taken slug mid-race.
# (Signup A reserves, signup B hits the slug check after A commits.)
# → 400 { code: 'slug_unavailable', data: { available: false, reason: 'taken' } }

# 8. Idempotency — same key within 24h returns the cached response.
curl -X POST -H "Idempotency-Key: abc-123" "$API/public/signup" -d '{...}'
curl -X POST -H "Idempotency-Key: abc-123" "$API/public/signup" -d '{...}'
# → Same 200 body both times, same checkout_url, no second user created.
```

### Pass criteria

- ✓ Schema columns added; existing rows unaffected (type NULL, timezone + country defaulted).
- ✓ Slug availability endpoint validates format, enforces the reserved list, cache-no-store header set.
- ✓ Signup endpoint creates user + org + Stripe Customer + Checkout Session in one transaction.
- ✓ Failures mid-transaction roll back cleanly — no orphan users or orgs.
- ✓ `auth_token` signs the admin into the CRM; `checkout_url` resolves to Stripe.
- ✓ Email collision 409s cleanly; the FE can switch to the sign-in path.
- ✓ Idempotency key dedupes double-clicks over a 24h window.
- ✓ Welcome email fires on successful signup.

---

## 6. Retire the claim-your-club flow

The pre-OS Torny onboarding (clubs pre-populated from bowls directory → admin finds their club → submits a claim → support approves) is replaced in full by this brief. Admins sign up and create their org directly — no pre-populated anything.

### What's being retired

| Surface | Action |
|---|---|
| CRM route `/claim` (`ClaimClubView.vue`) | Delete. Replaced by the new signup wizard on `torny-web`. |
| `apps/crm/src/views/auth/ClaimClubView.vue` | Delete. |
| api-client `claims` resource (`resources/claims.ts`) | Deprecate — keep the file for one release so existing deployed admins reading from stale builds don't crash. Delete in a follow-up. |
| Backend `POST /claims/submit`, `POST /claims/{id}/approve`, `POST /claims/{id}/reject`, `GET /claims/mine`, `GET /admin/claims` | Keep responding for one release so in-flight claims can be resolved. Return a deprecation header (`Deprecation: true`, `Sunset: <date>`) and log a count of inbound traffic so we know when it's safe to delete. |
| `directory` resource / `GET /public/directory/clubs` search | **Keep.** Still useful as a club finder on the marketing site ("find your local club") — just not the entry point for admin signup. |
| Pre-populated `clubs` rows in the DB (bowls directory import) | **Keep.** The directory search + public profiles still reference them. New signups from this brief create fresh `clubs` rows; the two co-exist. |

### Pending claims

At the point of cutover there'll be a small number of in-flight claims (submitted but not approved). Three options:

1. **Auto-approve everything pending** before deleting the endpoint. Fastest; low risk given the small volume.
2. **Email each pending claimant** with a signup link instead, and reject the claim. Slower, but matches the new mental model.
3. **Let the backend endpoint keep working until all pending resolve.** Safest, but requires keeping the old flow alive indefinitely.

Recommend **option 1** — the only humans who submitted claims recently are the ones we're trying to serve anyway. Grandfathered access.

### What's NOT being retired

- Claimed clubs that have already been approved stay exactly as they are. No data migration, no plan change, no re-signup. Their ownership + member list carries forward unchanged.
- The existing bowls-directory `clubs` rows (unclaimed, pre-populated) stay in the DB. They surface on the public directory + are searchable. Nothing new creates them; the old scripts that populated them should also be retired.
- Admins who've already registered + claimed get free Starter forever (grandfathered). They can upgrade to Pro via brief 87's billing flow any time.

### Order of operations

1. Ship this brief (backend + the new signup endpoint goes live).
2. Ship the FE for the new wizard on `torny-web` (brief 88 FE commit).
3. Auto-approve any pending claims (one-shot SQL or script).
4. Delete the CRM's `/claim` route + `ClaimClubView.vue` (FE commit).
5. Add `Deprecation` + `Sunset` headers to the old `/claims/*` endpoints with a 30-day sunset date.
6. 30 days later: delete the old endpoints + the api-client `claims` resource.

---

## 7. Non-goals

- **No email verification requirement.** The user can access the CRM before verifying. Verification matters for bulk-email sending (existing Postmark domain check) but not for signup itself.
- **No social SSO yet.** The wizard mocks up Google / Apple / Microsoft chips but phase 3's scope is email + password only. Social sign-in is a follow-up — slot it in once the core flow is live.
- **No invite-flow.** Only the first admin signs up through this endpoint. Inviting more admins is the existing `/clubs/{cid}/invitations` path.
- **No domain-is-your-org nicety.** Users with a `@thorndonbowlingclub.co.nz` email don't get auto-matched to an existing org — this is first-admin-wins. Multi-admin / domain-based grouping is a later feature.
- **No phone capture.** We've done phone-free signups elsewhere; keeping this one short.
- **No plan picker on the backend.** `plan` is just metadata that gets passed through to brief 87's checkout session builder. The real source of truth is what Stripe's subscription says once the webhook fires.
- **No auto-club-sites provisioning step.** The club site goes live immediately with the default template because of the way the Nuxt tenant-resolve works today — no dedicated "provision site" step needed on signup.
