# Brief 119 — HttpOnly session cookies (close XSS → account takeover)

**Status — proposed. Not yet scoped on the backend roadmap.**

> **FE-side ask on day one:** move the browser session off `localStorage` and onto a cookie the browser hands around invisibly, so an XSS payload (if one ever slips the sanitisers) can't `fetch('/')` the token out of storage and send it to attacker.example.
>
> See `docs/production-readiness/audit-2026-11-11.md` → Security §1 for the audit that flagged this. We've since shipped XSS sanitisers (01 / 01b), a Content-Security-Policy (06), and sign-in rate limiting (09) — all of which make the XSS entry harder. This brief closes the exploit path *even if* one of those defences misses.

---

## 1. Current state

- CRM FE stores a bearer token under `localStorage.getItem('torny.token')`.
  - Read site: `packages/api-client/src/http.ts:8`.
- Every CRM request sends it as `Authorization: Bearer <token>` (see `authedFetch` in the same file).
- Logout is client-only — `apps/crm/src/stores/auth.ts:82` removes the key from storage; the token stays valid on the server side until it naturally expires.
- There is no server-side session store today. The backend treats the JWT as the only session artefact.

**Problem:** `localStorage` is readable by any JavaScript running on the origin. A successful XSS on `app.torny.pro` — via a missed sanitiser bug, a compromised dep, or a future bug we haven't thought of — reads the token and exfiltrates it. The attacker then has an account-takeover-level session that works from anywhere until the JWT naturally expires.

## 2. Desired state

- The session identifier moves into an **HttpOnly cookie**. Browser JavaScript can't read HttpOnly cookies, so XSS can't exfiltrate them.
- The cookie carries `Secure` (HTTPS only), `SameSite=Lax` (sent on top-level GETs + same-site XHR, blocks cross-site POSTs), and a `Path=/`.
- Logout is server-side — a `/logout` endpoint clears the cookie and invalidates the session on the server.
- CRM makes requests with `credentials: 'include'` (fetch) or `withCredentials: true` (axios, if we ever revive it). No `Authorization` header needed on the browser side.

## 3. The subdomain architecture problem (please solve first)

Today:
- CRM is at `app.torny.pro`
- APIs are at `*.execute-api.ap-southeast-2.amazonaws.com`

Cross-origin cookies require `SameSite=None; Secure`, which:
- Loses the CSRF mitigation `SameSite=Lax` gives for free.
- Several browsers increasingly restrict `SameSite=None` cookies (Safari ITP, Firefox ETP).

**Recommended:** stand up `api.torny.pro` as a CNAME → API Gateway custom domain, so the cookie can be scoped to `.torny.pro` with `SameSite=Lax`. Everything the CRM calls lives on the same registrable domain and the cookie flows naturally. Also makes the CSP `connect-src` allowlist tighter — can drop `https://*.execute-api.ap-southeast-2.amazonaws.com` in favour of `https://api.torny.pro`.

If the subdomain move isn't feasible this quarter, fall back to `SameSite=None; Secure` with explicit CSRF defences (see §6 below). But this is strictly worse, so please try the subdomain path first.

## 4. New endpoints

### 4.1 `POST /auth/login`

Same request shape as today. On success:

- Response body returns the user payload as today — token field is omitted.
- Response headers include:
  ```
  Set-Cookie: torny_sid=<opaque-session-id>; Domain=.torny.pro; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
  ```
  (30-day session; adjust if there's a policy call to make it shorter.)
- The server maps `torny_sid` → user in a server-side session store (DynamoDB, Redis, Postgres — backend's call on which).

### 4.2 `POST /auth/logout` (new)

- Reads the session cookie.
- Deletes the server-side session row.
- Returns a `Set-Cookie` that overwrites the session cookie with `Max-Age=0` to tell the browser to drop it.
- Responds `204`.

### 4.3 `POST /auth/register`

Same flow as login — set the cookie, return the user, no token.

### 4.4 `GET /me` and everything else

Change: read the session ID from the cookie instead of the `Authorization` header. If the cookie is present and valid, hydrate the user. If not, respond 401.

### 4.5 (Optional) `POST /auth/refresh`

If we want sliding sessions, add a refresh endpoint the FE calls periodically. For a first implementation, let the Max-Age handle it — cookie's absolute expiry is 30 days from issue.

## 5. Session store

Minimum shape:

```
sessions (
  session_id     text primary key,     -- opaque, cryptographic random, ≥128 bits
  user_id        int not null,
  issued_at      timestamptz not null,
  expires_at     timestamptz not null,
  revoked_at     timestamptz null,     -- set by logout
  last_seen_at   timestamptz not null,
  ip             inet,                  -- useful for anomaly detection later
  user_agent     text                   -- same
)
```

- `session_id` in the cookie is opaque — not a JWT. All session facts live server-side.
- Lookup on every authenticated request. Cache if latency matters.
- On lookup: verify `revoked_at is null` and `expires_at > now()`. Otherwise reject with 401.
- On every successful lookup: bump `last_seen_at`.
- Sweeper job: periodically delete sessions where `expires_at < now() - interval '7 days'`.

## 6. CSRF defences

With `SameSite=Lax` + the subdomain move, you get most of the protection for free — a cross-site POST from attacker.example can't attach the cookie. That's sufficient for 95% of real-world CSRF.

Belt-and-braces for the remaining 5% (same-site but attacker-controlled subdomain, which we don't have today but shouldn't rule out):

- **Origin header check.** On every `POST/PATCH/PUT/DELETE`, assert the `Origin` header equals `https://app.torny.pro`. Reject with 403 otherwise. Trivial, zero FE change.
- **Double-submit token** if we want full OWASP CSRF coverage: a separate cookie carrying a token, which the FE reads and echoes in a header. Slightly more work; defer unless the Origin check doesn't satisfy the compliance call.

If we fall back to `SameSite=None` (because the subdomain move slips), the Origin check becomes mandatory, not optional.

## 7. FE migration path

Dual-support window on the backend so the FE can roll gradually:

1. **Phase A (backend ships cookies, keeps Bearer).** New `/auth/login` returns a cookie **and** the token in the body. CRM FE change: `authedFetch` adds `credentials: 'include'` to every call. `localStorage.torny.token` keeps working until Phase C.
2. **Phase B (FE stops reading localStorage).** `useAuthStore` + `http.ts` drop their localStorage reads. The session is cookie-only in the browser. Bearer token still accepted server-side for safety.
3. **Phase C (backend stops accepting Bearer).** Drop `Authorization` header support. Any lingering non-cookie callers get 401.

Suggest a 2-week overlap between each phase so a user with a stale open tab doesn't get booted mid-session.

## 8. Logout UX change

Today: client clears localStorage and bounces to `/sign-in`.
Future: client calls `POST /auth/logout`, awaits the 204, then bounces. The cookie is cleared by the Set-Cookie response.

If the logout endpoint 500s (rare), fall back to the client-only clear + bounce — the user shouldn't be stuck on a page with a half-dead session.

## 9. FE code changes (summary — for the record, not for the backend to do)

- `packages/api-client/src/http.ts` — drop `readToken()`, drop `Authorization` header injection, add `credentials: 'include'` to every fetch.
- `apps/crm/src/stores/auth.ts` — drop localStorage persistence, drop `setSession(token, user)`, call `/auth/logout` on `clear()`.
- `apps/crm/src/views/auth/SignInView.vue` — don't try to read the token from `authApi.login()` response; the cookie is already set by the time the promise resolves.
- CSP `connect-src` — tighten if we move to `api.torny.pro`.

Noted here so the backend brief carries context, but these changes land in a separate FE commit during Phase A.

## 10. Verification checklist

Backend (per phase):

- [ ] Phase A: login + register set a cookie AND return a token
- [ ] `POST /auth/logout` returns 204 + clears the cookie
- [ ] Session store round-trip: issue → lookup → revoke works
- [ ] 401 on expired / revoked session
- [ ] `Last-Seen-At` bumps on each authenticated request
- [ ] Origin header check on mutating requests (403 for wrong origin)
- [ ] Sweeper removes expired sessions (test on a tight clock)

FE (handled in a follow-up ticket once Phase A is live):

- [ ] `credentials: 'include'` on every CRM fetch
- [ ] Sign-in → navigate → refresh page → still authenticated via cookie
- [ ] Logout → next request returns 401
- [ ] Multiple tabs share the session (cookie is domain-scoped)

## 11. Out of scope (for this brief)

- **OAuth / SSO.** Google / Apple / Microsoft buttons currently hint "not wired up yet" — they stay that way for now.
- **Passkey.** Same — separate brief when it moves to real.
- **Multi-session visibility** (list of active sessions, "revoke all other sessions"). Nice-to-have, worth a small follow-up.
- **Suspicious-login email** (new country / new device). Separate anomaly-detection brief.

## 12. Why this matters

Audit originally scored Security 3/10. We've shipped sanitisers (01 / 01b), CSP (06), and rate limiting (09) — Security is now ~9/10. The last structural gap is this one — the browser-side storage of the session artefact.

Even with every XSS defence in place, a JWT in `localStorage` means a single defence miss hands the attacker a 30-day authenticated session. Moving to `HttpOnly` cookies means the same XSS miss is contained to whatever the attacker can do *within the page*, not account-takeover-from-anywhere.

Defence-in-depth is the whole game here. This brief is the last big piece.
