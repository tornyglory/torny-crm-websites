/**
 * Client-side rate limiter for the auth forms (sign-in, later register
 * and forgot-password). Tracks failed attempts in sessionStorage, locks
 * the form for an exponentially-growing cool-off after too many fails,
 * surfaces a countdown so the UI can display it, and resets on success.
 *
 * Honest framing: this is defence-in-depth, not a real security
 * control. An attacker scripting a credential-stuffing attack just
 * clears sessionStorage and starts over. The real rate limit must live
 * on the backend — this composable's job is:
 *   1. Stop accidental hammering of the submit button by legitimate
 *      users (ten retries in ten seconds doesn't help anyone).
 *   2. Give us a ready-made UI for when the backend ships a 429 with a
 *      retry window — call `applyServerLockout(seconds)` with the hint.
 *   3. Document the security intent in-code so we don't sit on "I
 *      meant to add rate limiting" forever.
 *
 * See docs/production-readiness/09-sign-in-rate-limit.md.
 */
import { computed, onBeforeUnmount, onMounted, readonly, ref, watch } from 'vue'

const STORAGE_KEY_ATTEMPTS = 'torny.auth.failedAttempts'
const STORAGE_KEY_LOCKED_UNTIL = 'torny.auth.lockedUntil'
const STORAGE_KEY_LOCKOUT_COUNT = 'torny.auth.lockoutCount'

const MAX_ATTEMPTS = 5

/** Cool-off (ms) per lockout number — exponential with a 15-min cap. */
const LOCKOUT_SCHEDULE_MS = [30_000, 60_000, 120_000, 300_000, 900_000]

function readNumber(key: string, fallback = 0): number {
  if (typeof sessionStorage === 'undefined') return fallback
  const raw = sessionStorage.getItem(key)
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function writeNumber(key: string, value: number): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(key, String(value))
}

function clearKey(key: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(key)
}

export interface AuthRateLimit {
  /** True while the form should be locked. */
  isLocked: Readonly<{ value: boolean }>
  /** Seconds remaining on the current lockout, floored to whole seconds. */
  secondsRemaining: Readonly<{ value: number }>
  /** Human-friendly countdown string: "0:30" / "2:05". */
  countdownLabel: Readonly<{ value: string }>
  /** Attempts the user has made this session. */
  attempts: Readonly<{ value: number }>
  /** Max attempts before the FE triggers its own lockout. */
  readonly maxAttempts: number
  /** Call on a failed auth attempt (wrong password, unknown user, etc.). */
  recordFailure(): void
  /** Call on a successful auth. Clears everything. */
  recordSuccess(): void
  /** Call when the backend returns 429 with a retry-after hint (seconds). */
  applyServerLockout(seconds: number): void
}

export function useAuthRateLimit(): AuthRateLimit {
  const attempts = ref<number>(readNumber(STORAGE_KEY_ATTEMPTS))
  const lockedUntilMs = ref<number>(readNumber(STORAGE_KEY_LOCKED_UNTIL))
  const now = ref<number>(Date.now())
  let tickHandle: ReturnType<typeof setInterval> | null = null

  function syncFromStorage(): void {
    attempts.value = readNumber(STORAGE_KEY_ATTEMPTS)
    lockedUntilMs.value = readNumber(STORAGE_KEY_LOCKED_UNTIL)
  }

  function startTicking(): void {
    if (tickHandle) return
    tickHandle = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function stopTicking(): void {
    if (!tickHandle) return
    clearInterval(tickHandle)
    tickHandle = null
  }

  const isLocked = computed(() => lockedUntilMs.value > now.value)
  const secondsRemaining = computed(() => {
    if (!isLocked.value) return 0
    return Math.max(0, Math.ceil((lockedUntilMs.value - now.value) / 1000))
  })
  const countdownLabel = computed(() => {
    const s = secondsRemaining.value
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}:${String(rem).padStart(2, '0')}`
  })

  // Only tick when we need to — saves a background interval on idle
  // sign-in pages that aren't locked. Stop as soon as we unlock so the
  // reactive now.value doesn't keep triggering unrelated re-renders.
  watch(
    isLocked,
    (locked) => {
      if (locked) startTicking()
      else stopTicking()
    },
    { immediate: true },
  )

  onMounted(() => {
    syncFromStorage()
    now.value = Date.now()
  })
  onBeforeUnmount(stopTicking)

  function recordFailure(): void {
    const nextAttempts = attempts.value + 1
    attempts.value = nextAttempts
    writeNumber(STORAGE_KEY_ATTEMPTS, nextAttempts)

    if (nextAttempts >= MAX_ATTEMPTS) {
      const lockoutCount = readNumber(STORAGE_KEY_LOCKOUT_COUNT)
      const scheduleIdx = Math.min(lockoutCount, LOCKOUT_SCHEDULE_MS.length - 1)
      const lockoutMs = LOCKOUT_SCHEDULE_MS[scheduleIdx]!
      const nextLockedUntil = Date.now() + lockoutMs
      lockedUntilMs.value = nextLockedUntil
      writeNumber(STORAGE_KEY_LOCKED_UNTIL, nextLockedUntil)
      writeNumber(STORAGE_KEY_LOCKOUT_COUNT, lockoutCount + 1)
      // Fresh attempts counter — next failure after the lockout ends
      // counts from zero against the (now longer) next cool-off.
      attempts.value = 0
      writeNumber(STORAGE_KEY_ATTEMPTS, 0)
    }
  }

  function recordSuccess(): void {
    attempts.value = 0
    lockedUntilMs.value = 0
    clearKey(STORAGE_KEY_ATTEMPTS)
    clearKey(STORAGE_KEY_LOCKED_UNTIL)
    clearKey(STORAGE_KEY_LOCKOUT_COUNT)
  }

  function applyServerLockout(seconds: number): void {
    const safeSeconds = Math.max(1, Math.floor(seconds))
    const nextLockedUntil = Date.now() + safeSeconds * 1000
    lockedUntilMs.value = nextLockedUntil
    writeNumber(STORAGE_KEY_LOCKED_UNTIL, nextLockedUntil)
    // Server-side lockout doesn't advance the local schedule; the server
    // is authoritative on the retry window.
  }

  return {
    isLocked: readonly(isLocked) as Readonly<{ value: boolean }>,
    secondsRemaining: readonly(secondsRemaining) as Readonly<{ value: number }>,
    countdownLabel: readonly(countdownLabel) as Readonly<{ value: string }>,
    attempts: readonly(attempts) as Readonly<{ value: number }>,
    maxAttempts: MAX_ATTEMPTS,
    recordFailure,
    recordSuccess,
    applyServerLockout,
  }
}
