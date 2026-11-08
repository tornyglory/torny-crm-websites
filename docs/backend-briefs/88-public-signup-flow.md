# Public signup — FE contract

Self-serve onboarding for any organisation. Replaces the claim-your-club flow.
Supersedes the original brief-88 draft — a couple of wire shapes diverged from
the draft during implementation. Product behaviour is unchanged.

## Base URLs

```
VENUE = https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod
CRM   = https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod
```

Venue hosts the new signup + billing endpoints. The slug-availability check
lives on the CRM stack because it was already shipped there (the brief-88
draft asked for a new one — we reused instead of duplicated).

## Divergences from the brief-88 draft

| Draft said | Reality |
|---|---|
| `GET /public/slugs/{slug}/availability` | Reuse `GET /subdomains/check?value=…` on the CRM stack — same shape. |
| Request body: `organisation.type` | Request body: `organisation.org_type` — avoids collision with the legacy `club_type` column. |
| 2–64 char slug | 3–30 chars (matches the existing subdomain validation). |
| 15-min JWT returned from signup | 30-day JWT matching `/auth/login` — treat `auth_token` as a normal session token. |

Everything else lines up with what you drafted.

---

## 1. `GET /subdomains/check?value=<slug>` — live slug check

Public. No auth. Used by the wizard's slug input for the green-tick / red-cross.

### Request
```http
GET /subdomains/check?value=carterton-community-hall
```

### 200 — available
```json
{ "status": "success", "data": { "available": true, "value": "carterton-community-hall" } }
```

### 200 — not available
```json
{
  "status": "success",
  "data": {
    "available": false,
    "reason":    "taken",
    "value":     "carterton-community-hall"
  }
}
```

`reason` is one of:

| reason     | meaning |
|------------|---------|
| `invalid`  | Wrong format (bad chars / wrong length). |
| `reserved` | Blocked slug (`www`, `admin`, `login`, `signup`, `torny`, etc). |
| `taken`    | Another org already has it. |

### Validation (useful for the FE to mirror client-side)

- 3–30 chars
- Lowercase `a-z`, digits, hyphens
- No leading / trailing hyphens
- No consecutive hyphens

Format violations return `invalid`, not `bad_chars`. Response is `200` either way — no need to branch on HTTP status.

Response has `Cache-Control: no-store`. Debounce the input ~200ms.

---

## 2. `POST /public/signup` — create account

Public. No auth. One call → user + organisation + Stripe Customer + Checkout
Session, all-or-nothing. Response includes a session JWT + the Stripe Checkout
URL to redirect to.

### Request
```http
POST /public/signup
Content-Type: application/json
Idempotency-Key: 6f1a3b2c-…      (optional but recommended)

{
  "user": {
    "name":     "Sarah Whittaker",
    "email":    "sarah@carterton-hall.co.nz",
    "password": "a-long-good-password"
  },
  "organisation": {
    "name":     "Carterton Community Hall",
    "slug":     "carterton-community-hall",
    "org_type": "community_and_civic",
    "country":  "NZ",                     // optional; defaults 'NZ'
    "timezone": "Pacific/Auckland"        // optional; defaults 'Pacific/Auckland'
  },
  "plan":        "pro",                   // 'starter' | 'pro'
  "success_url": "https://torny.co/signup/welcome?org=carterton-community-hall",
  "cancel_url":  "https://torny.co/signup?step=4"
}
```

### `org_type` — the 10 wizard categories

Exact string values, must match one of these:

- `sports_and_recreation`
- `fitness_and_wellness`
- `arts_and_culture`
- `community_and_civic`
- `youth_groups`
- `hospitality`
- `holiday_accommodation`
- `events_venue`
- `non_profit`
- `other`

### Password

Minimum 12 characters. No other complexity rules server-side.

### Idempotency-Key

Optional header. If present, a repeat call within 24h returns the cached response
byte-for-byte — same `auth_token`, same `checkout_url`, no duplicate Stripe
objects created. Generate a UUIDv4 per wizard session (not per click).

Only successful (2xx) and 4xx responses are cached. 5xx stays retryable.

### 200 response
```json
{
  "status": "success",
  "data": {
    "user": {
      "id":    4821,
      "name":  "Sarah Whittaker",
      "email": "sarah@carterton-hall.co.nz"
    },
    "organisation": {
      "id":   319,
      "slug": "carterton-community-hall",
      "name": "Carterton Community Hall"
    },
    "auth_token":   "eyJhbGciOi…",                               // JWT, 30-day
    "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_…",
    "public_site":  "https://carterton-community-hall.torny.co"
  }
}
```

### FE sequence after 200

1. Store `auth_token` the same way you handle `/auth/login`'s response.
2. `window.location.href = checkout_url`.
3. Stripe's own `success_url` / `cancel_url` lands the user back on your routes.
4. Both the success and cancel paths work — if the user cancels Stripe,
   they're still signed in and the org exists on Starter. You can surface
   "finish your billing" in Settings → Billing.

### Errors

| HTTP | code                           | meaning |
|------|--------------------------------|---------|
| 400  | `bad_body`                     | Not valid JSON. |
| 400  | `bad_name`                     | `user.name` missing / too short. |
| 400  | `bad_email`                    | `user.email` not a valid email. |
| 400  | `bad_password`                 | <12 chars. |
| 400  | `bad_org_name`                 | Missing / too short. |
| 400  | `bad_org_type`                 | Not one of the 10 values. |
| 400  | `bad_plan`                     | Not `'starter'` or `'pro'`. |
| 400  | `bad_url`                      | `success_url` / `cancel_url` not https / too long. |
| 400  | `slug_unavailable`             | Format bad / reserved / taken. Body echoes `data.reason`. |
| 409  | `email_in_use`                 | Email already registered. Route to `/auth/login` instead. |
| 502  | `stripe_price_unconfigured`    | Deploy misconfig (prod should never see this). |
| 502  | `stripe_customer_create_failed`| Stripe rejected. Body has `message`. |
| 502  | `stripe_checkout_create_failed`| Stripe rejected. Body has `message`. |
| 500  | `signup_tx_failed`             | DB error after Stripe created. Safe to retry with the same idempotency key. |

`slug_unavailable` body:
```json
{
  "status":  "error",
  "code":    "slug_unavailable",
  "message": "organisation.slug is not available",
  "data":    { "available": false, "reason": "taken", "slug": "…" }
}
```

---

## 3. Settings → Billing

Three endpoints on the Venue stack. Admin+ required (JWT with `role` `admin` or `owner` on the club).

### 3a. `GET /clubs/{club_id}/plan` — read

Returns current plan + subscription state. Extended from the existing
`/plan` endpoint — new fields below the fold are additive, old shape is
preserved.

```json
{
  "status": "success",
  "data": {
    "plan":                "pro",
    "display_name":        "Pro",
    "monthly_price_cents": 7900,
    "features":            ["dashboard","members", … ,"venue_bookings"],
    "is_pro":              true,
    "upgradeable_to":      [],

    "plan_source":         "derived",            // 'derived' | 'manual'
    "subscription_status": "trialing",           // see enum below
    "trial_ends_at":       "2027-01-08T00:00:00.000Z",
    "current_period_end":  "2027-01-08T00:00:00.000Z",
    "has_stripe_customer": true
  }
}
```

`subscription_status` mirrors Stripe exactly:
`none | trialing | active | past_due | canceled | unpaid | paused | incomplete | incomplete_expired`.

`plan_source = 'manual'` means a superadmin flipped the plan manually (via
`PATCH /clubs/{cid}/plan`) — Stripe webhooks will no longer auto-change it.
Rare; shows up on grandfathered clubs or comped ones.

Use this endpoint to drive the Settings → Billing panel ("Pro — trial ends
in 7 days", etc) and the sidebar's upgrade nudges.

### 3b. `POST /clubs/{club_id}/billing/checkout` — start Pro upgrade

For existing orgs on Starter that want to move to Pro from Settings → Billing
(not the signup wizard). Same Stripe Checkout Session mechanism, same 30-day
trial.

```http
POST /clubs/{club_id}/billing/checkout
Authorization: Bearer <JWT>

{
  "plan":        "pro",                                  // 'starter' | 'pro'
  "success_url": "https://torny.co/settings/billing?result=success",
  "cancel_url":  "https://torny.co/settings/billing?result=cancel"
}
```

200:
```json
{
  "status": "success",
  "data": {
    "checkout_url": "https://checkout.stripe.com/c/pay/cs_…",
    "session_id":   "cs_test_…"
  }
}
```

FE redirects the admin to `checkout_url`. On return, the Stripe webhook will
have flipped `subscription_status` to `trialing` and `plan` to `pro` (or
whatever they chose).

### 3c. `POST /clubs/{club_id}/billing/portal` — manage card / cancel

Opens a Stripe-hosted Billing Portal session. The admin does everything in
Stripe's UI (change card, upgrade, cancel, see invoices).

```http
POST /clubs/{club_id}/billing/portal
Authorization: Bearer <JWT>

{
  "return_url": "https://torny.co/settings/billing"
}
```

200:
```json
{
  "status": "success",
  "data": { "portal_url": "https://billing.stripe.com/p/session/…" }
}
```

Error `409 no_stripe_customer` — the org never started billing (fresh Starter
with no Stripe Customer). Route to the checkout endpoint instead.

### Errors (shared across the three billing endpoints)

| HTTP | code                           | meaning |
|------|--------------------------------|---------|
| 400  | `bad_body` / `bad_plan` / `bad_url` | obvious validation |
| 401  | `unauthorized`                 | no / expired JWT |
| 403  | `forbidden`                    | not admin/owner on this club |
| 404  | `not_found`                    | club doesn't exist |
| 409  | `no_stripe_customer`           | portal only — no customer to open |
| 502  | `stripe_customer_create_failed` / `stripe_checkout_create_failed` / `stripe_portal_create_failed` | Stripe errored |

---

## 4. Retiring the claim-your-club flow

Delete these from the CRM app:

- `/claim` route + `apps/crm/src/views/auth/ClaimClubView.vue`
- `apps/crm/src/api-client/resources/claims.ts` (keep for one release, then delete)

The backend claim endpoints keep responding for 30 days (**sunset: 2026-12-09**)
with two extra headers so in-flight claims can resolve:

```
Deprecation: true
Sunset:      Wed, 09 Dec 2026 00:00:00 GMT
Link:        <https://torny.co/signup>; rel="successor-version"
```

After 2026-12-09 they return 404. If `claims.ts` is still importable in the
app at that point, callers will blow up — plan the delete ahead of time.

The public directory of pre-populated bowls clubs (`GET /clubs` list etc) is
untouched. It stops being the admin signup funnel, but still powers "find your
local club."

---

## 5. Verification walk-through

```bash
VENUE="https://tbqlfxlc0e.execute-api.ap-southeast-2.amazonaws.com/Prod"
CRM="https://byi59x19m4.execute-api.ap-southeast-2.amazonaws.com/Prod"

# 1. Slug check — green
curl "$CRM/subdomains/check?value=carterton-community-hall"

# 2. Slug check — reserved
curl "$CRM/subdomains/check?value=admin"

# 3. Slug check — bad chars
curl "$CRM/subdomains/check?value=Hello!"

# 4. Signup
curl -X POST -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" "$VENUE/public/signup" \
  -d '{"user":{"name":"Sarah","email":"sarah+test@carterton-hall.co.nz","password":"long-good-password"},"organisation":{"name":"Carterton Test","slug":"carterton-test","org_type":"community_and_civic","country":"NZ","timezone":"Pacific/Auckland"},"plan":"pro","success_url":"https://torny.co/signup/welcome","cancel_url":"https://torny.co/signup?step=4"}'

# 5. Pay at the returned checkout_url with Stripe test card 4242 4242 4242 4242.
#    customer.subscription.created webhook fires → club flipped to trialing + Pro.

# 6. Duplicate signup — should 409 email_in_use
curl -X POST -H "Content-Type: application/json" "$VENUE/public/signup" \
  -d '{"user":{"email":"sarah+test@carterton-hall.co.nz", …}}'

# 7. Taken slug — should 400 slug_unavailable
curl -X POST "$VENUE/public/signup" \
  -d '{"organisation":{"slug":"carterton-test", …}, …}'

# 8. Same Idempotency-Key twice — same body, same checkout_url, no second user
KEY=$(uuidgen)
curl -X POST -H "Idempotency-Key: $KEY" "$VENUE/public/signup" -d '{…}'
curl -X POST -H "Idempotency-Key: $KEY" "$VENUE/public/signup" -d '{…}'
```

### Pass criteria

- Slug check returns `available: true/false` with a `reason` on the false case.
- Signup returns both `auth_token` and `checkout_url` in one response.
- `auth_token` lets you call `GET /me` on the CRM stack right away.
- `checkout_url` resolves to Stripe Checkout in subscription mode with a 30-day trial.
- After Stripe fires the webhook, `GET /clubs/{id}/plan` shows
  `subscription_status: 'trialing'` and `plan: 'pro'`.
- Idempotency key dedupes correctly.
- Welcome email arrives (optional — only if `SENDGRID_WELCOME_TEMPLATE_ID` is set).
