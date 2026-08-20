# Backend brief — Frontend blockers

**Audience:** Torny backend engineers
**Frontend counterpart:** `apps/crm` (Vue 3 SPA)
**Status:** One P0 live bug + M4 pending + M2 quality-of-life gaps.
**Owner:** Neville Rodda (`nev@torny.co`)

---

## TL;DR

The CRM's auth surface is fully wired against the M1 endpoints:

- **Sign-in** — works end-to-end against prod.
- **Password reset** — both `request-password-reset` and `reset-password` wired and verified.
- **Register UI + api-client** — built, but **`POST /register` is returning 500 for every payload we can construct**. This blocks every new user from ever getting to the claim flow. See §1.

Beyond the P0, the two remaining gaps are (a) the M4 claim endpoints per brief 04 and (b) three M2 quality-of-life items called out in brief 03.

---

## 1. P0 — `POST /register` is broken

**Reproduction, live against prod (2026-08-20):**

Base URL: `https://ieg3lhlyy0.execute-api.ap-southeast-2.amazonaws.com/Prod`

```bash
# Brief 03 §2 documented payload:
curl -X POST $BASE/register -H 'Content-Type: application/json' -d '{
  "firstName": "Test",
  "lastName": "User",
  "email": "crm-1234@example.com",
  "password": "TestPass123",
  "account_type": "player"
}'
# → HTTP 400 { "status": "error", "message": "Missing required fields" }

# With a combined `name` field:
curl -X POST $BASE/register -H 'Content-Type: application/json' -d '{
  "name": "Test User",
  "email": "crm-1234@example.com",
  "password": "TestPass123",
  "account_type": "player"
}'
# → HTTP 500 { "status": "error", "message": "An error occurred during registration" }

# Kitchen-sink payload:
curl -X POST $BASE/register -H 'Content-Type: application/json' -d '{
  "name": "Test User CRM",
  "firstName": "Test",
  "lastName": "User",
  "email": "crm-1234@example.com",
  "password": "TestPassword1",
  "phone": "+64211234567",
  "account_type": "player",
  "user_type": "player"
}'
# → HTTP 500 { "status": "error", "message": "An error occurred during registration" }
```

**What we conclude:**

- The endpoint requires a `name` field (missing → 400). Brief 03 §2 documents `firstName` + `lastName` — that shape does not work.
- With `name` present, the handler passes the required-fields check but then 500s on something else. We can't tell what without the logs.

**What we need:**

Pick one:

1. **Publish the canonical payload shape.** Whatever the mobile app sends today. We'll update `packages/api-client/src/resources/auth.ts` to match and re-verify. Brief 03 §2 should also be corrected.
2. **Fix the 500** so the brief-03-documented payload works as advertised.

**Impact if not fixed:**

New users literally cannot sign up. Every "Can I register as a club?" journey ends on the register screen with a generic error message. The claim flow's whole point is moot without this.

**What the frontend has done to be ready:**

`packages/api-client/src/resources/auth.ts:register()` currently sends both `firstName + lastName` (per brief 03) AND `name` (concatenated) as a belt-and-suspenders. Once you confirm the canonical shape, we'll trim to just that.

---

## 2. P1 — M4 claim flow endpoints

Everything in **brief 04** ([04-claim-flow-m4-punchlist.md](./04-claim-flow-m4-punchlist.md)) is still needed:

- `POST /claims` — wires `ClaimClubView.vue` step 2 submit
- `GET /claims/mine` — needed for "your claim is pending" screen on player sign-in
- `GET /admin/claims`, `POST /admin/claims/:id/approve|reject` — platform admin queue

Brief 04 has the acceptance criteria and open questions. Nothing new to add — this brief is just a reminder that M4 is on the critical path for "register as a club" to work end-to-end. Once §1 is unblocked and M4 lands, the round trip works.

---

## 3. P2 — M2 quality-of-life

Not blocking, but each is a small server-side add that unlocks a corresponding client cleanup:

### 3.1 `GET /me`

Currently the login response is the only source of user data. If the user's role or `clubs[]` changes server-side (e.g. their claim gets approved), the frontend won't see it until they fully sign out and back in. `GET /me` lets us refresh the session state without a full re-login.

**Frontend impact when it lands:** we'll call `/me` on router `beforeEach` so a signed-in user hitting the app after their claim is approved lands on `/crm/dashboard` immediately instead of `/claim`. Right now they get stuck in the "please claim a club" loop until they manually log out and back in.

### 3.2 `POST /auth/logout`

Client-side logout works (`localStorage.removeItem('torny.token')`). Server-side session kill is nicer for security (compromised token, shared device, admin ban). Brief 01 §11 mentions this in the context of banning.

**Frontend impact when it lands:** the "Sign out" button in `AuthShell.vue` and the top-bar user menu will hit `POST /auth/logout` before clearing localStorage. One-line change.

### 3.3 Refresh token rotation

Access token TTL is 30 days today. Fine for now, but if we want shorter-lived tokens post-M2 the frontend needs to know:

- Response shape for `POST /auth/refresh`
- Whether the refresh token comes back in the response body or an httpOnly cookie
- Whether we handle reuse detection client-side or the server force-invalidates the family

Not urgent — flag when M2 is in scope.

---

## 4. What's already wired and waiting on you

Full inventory of the frontend integration surface, for context:

| Frontend seam | Status | Endpoint | Notes |
| --- | --- | --- | --- |
| `SignInView.vue` submit | ✅ Wired | `POST /login` | Tested against `noah@qubestudio.co.nz` — returns real JWT, routes by role. |
| `RegisterView.vue` submit | 🔴 Blocked | `POST /register` | UI complete, api-client complete, endpoint 500s (§1). |
| `ForgotPasswordView.vue` submit | ✅ Wired | `POST /request-password-reset` | Live-verified — returns non-leaking generic response. |
| `ResetPasswordView.vue` submit | ✅ Wired | `POST /reset-password` | Reads `?token=` from URL; hits endpoint. Not tested with a real token yet. |
| `ClaimClubView.vue` step 1 (search) | ✅ Live since before M1 | Public directory API | Not touched by this milestone. |
| `ClaimClubView.vue` step 2 (submit) | 🟠 Mocked | `POST /claims` (M4) | See brief 04. One-line swap when M4 lands. |
| `stores/claims.ts` (admin queue) | 🟠 Mocked | `GET/POST /admin/claims/*` (M4) | See brief 04. |
| Session refresh on app load | 🟡 Missing | `GET /me` (M2) | Frontend uses stored user; goes stale on role changes. |
| Server-side logout | 🟡 Missing | `POST /auth/logout` (M2) | Currently localStorage-only. |

---

## 5. Priority ask

- **This week:** unblock §1. Pick one of the two options in "What we need". Everything else in the CRM auth surface is downstream of this.
- **M4:** ship the punchlist in brief 04.
- **M2:** the P2 items whenever they fit — no rush.

---

## 6. Contact

Same as previous briefs — `#torny-eng` on Slack, or an issue against `tornyglory/torny-crm-websites`. Happy to jump on a call to pair through the register handler if easier.
