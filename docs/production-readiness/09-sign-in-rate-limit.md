# 09 · Sign-in rate limit (FE defence-in-depth)

**Status:** FE shipped. Backend brief required for the real control.
**Date:** 2026-11-25
**Priority:** Defence-in-depth after the auth-form a11y pass and the compliance scaffold.

## What this is

Client-side lockout on the CRM sign-in form after too many failed attempts. Tracks failures in `sessionStorage`, locks the form for a cool-off window with exponential backoff, surfaces a countdown so the user sees when they can try again, and resets on success.

Ready to honour a backend `429 Too Many Requests` with a `data.retry_after_seconds` hint whenever the server ships one — the composable has an `applyServerLockout(seconds)` entrypoint that the catch block already uses.

## What this is NOT

**Not a real security control.** A script attacking Torny with credential stuffing just:
1. Clears `sessionStorage` between attempts, OR
2. Opens a fresh tab per attempt, OR
3. Doesn't use a browser at all.

The real protection has to live on the backend — tracked by IP, by account, or both. The FE lockout exists to:

- Stop accidental hammering from legitimate users (five retries in five seconds doesn't help anyone).
- Give us a ready-made UI for when the backend ships its 429 — plug the `retry_after_seconds` straight into `rateLimit.applyServerLockout(…)` and the countdown is already visible.
- Document the security intent in-code so we don't sit on "I meant to add rate limiting" forever.

## Backend brief needed

Separate from this FE work, the backend should:

- Rate-limit `/login` and `/register` per source IP **and** per email address, whichever hits first.
- Suggested thresholds (match or tighten what the FE schedule does):
  - 5 failed attempts per email in 15 minutes → 429 with `retry_after_seconds: 900`.
  - 20 failed attempts per IP in 15 minutes → 429, same window.
- Response body shape: `{ status: "error", code: "rate_limited", message: "Too many attempts.", data: { retry_after_seconds: 900 } }`
- Also apply to `/forgot-password` and `/reset-password` once those endpoints exist.

Note: this needs to be its own brief in `docs/backend-briefs/` — small scope but requires cache/counter storage that the auth stack doesn't have today.

## Lockout schedule

Exponential backoff per lockout. Each lockout counts against the next window — the cool-off grows if the user keeps failing after their session unlocks.

| Lockout # | Cool-off |
|---|---|
| 1 | 30 seconds |
| 2 | 1 minute |
| 3 | 2 minutes |
| 4 | 5 minutes |
| 5+ | 15 minutes (cap) |

Threshold per lockout: 5 failed attempts.

`recordSuccess()` clears everything — attempts, lockout window, lockout count. A successful sign-in resets the user back to zero.

A server-triggered lockout (`applyServerLockout`) doesn't advance the local schedule — the server is authoritative on the window, and we shouldn't double-count our own counter against theirs.

## Files

- `apps/crm/src/composables/useAuthRateLimit.ts` — the composable. Pure logic, reactive, session-scoped.
- `apps/crm/src/__tests__/useAuthRateLimit.test.ts` — 11 tests covering the lockout math, persistence, countdown, and server-lockout path. Uses `vi.useFakeTimers` so the exponential schedule runs through in milliseconds.
- `apps/crm/src/views/auth/SignInView.vue` — wired to the composable. Form inputs disabled during submit AND during lockout; the error slot carries the countdown text; the `Forgot?` link stays active (a locked-out user may need it).

## Follow-ups

- Wire to `RegisterView.vue` once the backend register endpoint is rate-limited.
- Wire to `ForgotPasswordView.vue` for the same reason — forgot-password is a well-known enumeration vector.
- Backend brief as described above.
- Decide whether `recordFailure()` on a 500 (vs 401) is appropriate. Right now only 401 counts, which is the right call for the common case — a server error shouldn't lock the user out — but a flapping server might deserve a token effort.
