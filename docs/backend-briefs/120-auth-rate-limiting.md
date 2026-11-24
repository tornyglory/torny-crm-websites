# Brief 120 — Backend rate limiting on auth endpoints

**Status — proposed. Pairs with the FE lockout shipped in docs/production-readiness/09.**

> **Why this matters.** The CRM sign-in form already locks the UI after 5 failures with exponential backoff (see FE commit `9ad01d5`). That's defence-in-depth — it stops a legit user from hammering the button, nothing more. A script clears `sessionStorage` or opens a new tab and continues. The real control lives here.
>
> This brief scopes the server-side rate limit: credential stuffing on `/auth/login`, enumeration on `/auth/register` and the eventual `/auth/forgot-password`, and the response contract the FE is already wired to honour.

---

## 1. Endpoints in scope

| Method | URL | Why it needs rate limiting |
|---|---|---|
| POST | `/auth/login` | Credential stuffing (classic). Primary target. |
| POST | `/auth/register` | Email enumeration ("is this address already registered?" leaks via the error code). |
| POST | `/auth/forgot-password` | Not live today. Will be. Same enumeration risk as register, plus email-bombardment of the target address. |
| POST | `/auth/reset-password` | Rare but worth including — brute-force the reset token from a leaked email. |

Not in scope for this brief: `/me`, resource endpoints. Those don't accept unauthenticated attempts, so they're a different problem.

## 2. The response contract (the FE already consumes this)

When a request is rate-limited, respond:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 900

{
  "status": "error",
  "code": "rate_limited",
  "message": "Too many attempts. Try again in a moment.",
  "data": {
    "retry_after_seconds": 900
  }
}
```

The FE (`apps/crm/src/views/auth/SignInView.vue` catch block) reads `err.data.retry_after_seconds` and plugs it straight into its own lockout composable so the countdown UI appears without the user having to refresh. Falls back to 60s if the field is missing.

- Match the `Retry-After` header and the `data.retry_after_seconds` body field — they should carry the same value. (Browsers honour the header; the FE reads the body.)
- `code: "rate_limited"` is stable — don't rename without a FE ticket.

## 3. Thresholds

Two independent counters per endpoint. Trip whichever hits first.

### 3.1 `/auth/login`

- **Per email address:** 5 failed attempts within 15 minutes → 429 with `retry_after_seconds: 900`.
- **Per source IP:** 20 failed attempts within 15 minutes → 429 with the same window.
- Successful login resets the per-email counter.
- A 429 response does *not* count as a "failure" against either counter (they already lost; don't amplify).

### 3.2 `/auth/register`

- **Per source IP:** 10 attempts within 1 hour → 429 with `retry_after_seconds: 3600`.
- No per-email counter — that *would* leak existence (the attacker could probe which emails lock the counter).
- Any attempt counts — successful or not — because the goal is to cap enumeration velocity.

### 3.3 `/auth/forgot-password` (when it lands)

- **Per source IP:** 10 attempts within 1 hour → 429 with `retry_after_seconds: 3600`.
- **Per target email:** 3 attempts within 1 hour → 429 with the same window. Stops attackers from spamming someone's inbox.
- Always respond with the same body shape regardless of whether the email is registered — "if this address is on file, we've sent a reset link." (Standard enumeration mitigation.)

### 3.4 `/auth/reset-password` (when it lands)

- **Per reset token:** 5 attempts within 15 minutes → 429. Also invalidate the token after N wrong attempts.

### Why these numbers

- Honest users mistype their password occasionally — 5 misses in 15 minutes is forgiving enough that a bad keyboard day doesn't lock a user out.
- Credential-stuffing lists are long. 20 IPs in 15 minutes caps a stuffing script to ~80/hour from one source. The real attack comes from thousands of IPs; that's not solvable here, that needs WAF / bot-management (out of scope for this brief).
- Match or tighten the FE schedule (9), so a user who's hit the FE lockout doesn't also hit the backend 429 with a different window and get confused by conflicting countdowns.

## 4. Counter storage

**Recommendation:** Redis / ElastiCache with TTL on each key. Classic rate-limit pattern, no database schema change, cheap to operate.

Key shape:

```
rl:login:email:{email_hash}       → counter, TTL 15m
rl:login:ip:{ip}                  → counter, TTL 15m
rl:register:ip:{ip}               → counter, TTL 1h
rl:forgot:ip:{ip}                 → counter, TTL 1h
rl:forgot:email:{email_hash}      → counter, TTL 1h
```

- `{email_hash}` = SHA-256 of lowercased, trimmed email. Never store raw emails in the counter keys — PII leak.
- Increment-and-get atomically (`INCR` returns the new value; set `EXPIRE` on first touch).
- If Redis is unavailable, **fail open** (allow the request). The FE lockout is the fallback; a down rate limiter shouldn't break sign-in for everyone.

If Redis isn't practical, DynamoDB with TTL works but is slower per request. Postgres works as a last resort but adds database load on the hot path — avoid.

## 5. Headers to emit on every auth response

Even when NOT rate-limited:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1764100000    # unix timestamp when window resets
```

- Lets the FE preempt a 429 by showing "2 attempts remaining" before the lockout kicks in. Nice-to-have; backend ships it, FE picks it up in a later ticket.
- Pick one of (`X-RateLimit-*` vs `RateLimit-*` per the draft RFC). The dashed-prefix form is the de-facto industry standard; stay with it unless there's a reason to switch.

## 6. IP source

- Read the client IP from the API Gateway `X-Forwarded-For` header, first value.
- Behind Cloudflare, prefer `CF-Connecting-IP` when present (that's the real client; `X-Forwarded-For` has the Cloudflare edge IP in the first position).
- Don't ban IPs — the counter is per-IP-per-window, resets naturally. Permanent bans are a different system (WAF).

## 7. Interplay with brief 119 (HttpOnly session cookies)

- Rate limiting applies the same whether the FE is on Phase A (bearer + cookie) or Phase B (cookie only).
- When 119 lands, add the counter for `/auth/logout` too — 10 per IP per minute is enough; logout isn't a credential endpoint but a flood still wastes session-store writes.

## 8. Monitoring

- Emit a CloudWatch metric (or equivalent) for each 429 response: `auth_rate_limit_hits{endpoint, reason}`.
- A sudden spike in `/auth/login` 429s is a credential-stuffing attempt starting — page or notify so we can shift to tighter thresholds temporarily.
- Alert threshold: `> 50 429s per minute` on login for more than 5 minutes.

## 9. Verification checklist

- [ ] 6th failed login attempt from the same email within 15 minutes returns 429
- [ ] 21st failed login attempt from the same IP within 15 minutes returns 429
- [ ] Successful login resets the per-email counter (6th attempt right after a success is fine)
- [ ] 429 response body matches §2 shape exactly (FE depends on `data.retry_after_seconds`)
- [ ] `Retry-After` header value equals `retry_after_seconds` in the body
- [ ] Redis outage → endpoints still serve (fail-open), monitoring alert fires
- [ ] 11th register attempt from the same IP within 1 hour returns 429
- [ ] `/auth/forgot-password` returns the same body shape whether email exists or not
- [ ] `X-RateLimit-Remaining` decrements as expected

## 10. Out of scope

- Bot management (reCAPTCHA / hCaptcha / Turnstile). Separate brief when there's a reason — a single stuffing attempt from 1000 IPs isn't solvable at the app layer. If we see that pattern in the wild, WAF it.
- Account lockout after N failures (as distinct from rate limit). Trickier — a locked account is a DoS vector against a target email. Punt.
- IP reputation. Not worth the ops burden at current scale.
