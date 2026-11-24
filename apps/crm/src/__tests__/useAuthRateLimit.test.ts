/**
 * Tests the sign-in rate limiter's lockout math + storage persistence.
 * Uses vi.useFakeTimers so the exponential backoff schedule can be
 * walked through without actually waiting 30+ seconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useAuthRateLimit, type AuthFormKey, type AuthRateLimit } from '@/composables/useAuthRateLimit'

const testFormKey: AuthFormKey = 'signIn'

// Mount the composable in a fake component so onMounted / onBeforeUnmount
// / reactive refs all behave the way they would in SignInView.
function mountRateLimit(): { rl: AuthRateLimit; unmount: () => void } {
  let captured!: AuthRateLimit
  const Host = defineComponent({
    setup() {
      captured = useAuthRateLimit(testFormKey)
      return () => null
    },
  })
  const wrapper = mount(Host)
  return { rl: captured, unmount: () => wrapper.unmount() }
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAuthRateLimit', () => {
  it('starts unlocked with zero attempts', () => {
    const { rl, unmount } = mountRateLimit()
    expect(rl.isLocked.value).toBe(false)
    expect(rl.attempts.value).toBe(0)
    expect(rl.secondsRemaining.value).toBe(0)
    expect(rl.maxAttempts).toBe(5)
    unmount()
  })

  it('increments attempts on each failure without locking below max', () => {
    const { rl, unmount } = mountRateLimit()
    for (let i = 1; i < rl.maxAttempts; i++) {
      rl.recordFailure()
      expect(rl.attempts.value).toBe(i)
      expect(rl.isLocked.value).toBe(false)
    }
    unmount()
  })

  it('locks the form at maxAttempts and starts a 30-second countdown', async () => {
    const { rl, unmount } = mountRateLimit()
    for (let i = 0; i < rl.maxAttempts; i++) rl.recordFailure()
    await nextTick()
    expect(rl.isLocked.value).toBe(true)
    expect(rl.secondsRemaining.value).toBe(30)
    expect(rl.countdownLabel.value).toBe('0:30')
    unmount()
  })

  it('counts down each second while locked', async () => {
    const { rl, unmount } = mountRateLimit()
    for (let i = 0; i < rl.maxAttempts; i++) rl.recordFailure()
    await nextTick()
    expect(rl.secondsRemaining.value).toBe(30)

    vi.advanceTimersByTime(10_000)
    await nextTick()
    expect(rl.secondsRemaining.value).toBe(20)
    expect(rl.countdownLabel.value).toBe('0:20')
    unmount()
  })

  it('unlocks once the cool-off elapses', async () => {
    const { rl, unmount } = mountRateLimit()
    for (let i = 0; i < rl.maxAttempts; i++) rl.recordFailure()
    await nextTick()
    expect(rl.isLocked.value).toBe(true)

    vi.advanceTimersByTime(30_000)
    await nextTick()
    expect(rl.isLocked.value).toBe(false)
    expect(rl.secondsRemaining.value).toBe(0)
    unmount()
  })

  it('escalates the cool-off on repeat lockouts (30s → 60s → 2m → 5m → 15m)', async () => {
    const { rl, unmount } = mountRateLimit()
    const expectedWindows = [30, 60, 120, 300, 900, 900]
    for (const expectedSeconds of expectedWindows) {
      for (let i = 0; i < rl.maxAttempts; i++) rl.recordFailure()
      await nextTick()
      expect(rl.secondsRemaining.value).toBe(expectedSeconds)
      // Advance past the current lockout so the next iteration starts fresh.
      vi.advanceTimersByTime(expectedSeconds * 1000)
      await nextTick()
      expect(rl.isLocked.value).toBe(false)
    }
    unmount()
  })

  it('recordSuccess clears attempts, lockout, and lockout-count', async () => {
    const { rl, unmount } = mountRateLimit()
    for (let i = 0; i < rl.maxAttempts; i++) rl.recordFailure()
    await nextTick()
    expect(rl.isLocked.value).toBe(true)

    rl.recordSuccess()
    await nextTick()
    expect(rl.isLocked.value).toBe(false)
    expect(rl.attempts.value).toBe(0)
    expect(sessionStorage.getItem('torny.auth.signIn.failedAttempts')).toBeNull()
    expect(sessionStorage.getItem('torny.auth.signIn.lockedUntil')).toBeNull()
    expect(sessionStorage.getItem('torny.auth.signIn.lockoutCount')).toBeNull()
    unmount()
  })

  it('applyServerLockout uses the provided seconds regardless of local count', async () => {
    const { rl, unmount } = mountRateLimit()
    rl.applyServerLockout(45)
    await nextTick()
    expect(rl.isLocked.value).toBe(true)
    expect(rl.secondsRemaining.value).toBe(45)
    expect(rl.countdownLabel.value).toBe('0:45')
    unmount()
  })

  it('applyServerLockout clamps non-positive values to at-least 1 second', async () => {
    const { rl, unmount } = mountRateLimit()
    rl.applyServerLockout(0)
    await nextTick()
    expect(rl.secondsRemaining.value).toBe(1)
    unmount()
  })

  it('persists lockout state across a remount within the same session', async () => {
    const first = mountRateLimit()
    for (let i = 0; i < first.rl.maxAttempts; i++) first.rl.recordFailure()
    await nextTick()
    expect(first.rl.isLocked.value).toBe(true)
    first.unmount()

    // Simulate a fresh page load in the same session — a new mount
    // should see the lockout via sessionStorage.
    const second = mountRateLimit()
    await nextTick()
    expect(second.rl.isLocked.value).toBe(true)
    expect(second.rl.secondsRemaining.value).toBeGreaterThan(0)
    second.unmount()
  })

  it('formats countdownLabel into minutes:seconds for long lockouts', async () => {
    const { rl, unmount } = mountRateLimit()
    rl.applyServerLockout(125)
    await nextTick()
    expect(rl.countdownLabel.value).toBe('2:05')
    unmount()
  })

  it('different formKeys are isolated — locking register does not lock signIn', async () => {
    // Mount the sign-in form's limiter and drive it to lockout.
    let signInRl!: AuthRateLimit
    let registerRl!: AuthRateLimit
    const SignInHost = defineComponent({
      setup() { signInRl = useAuthRateLimit('signIn'); return () => null },
    })
    const RegisterHost = defineComponent({
      setup() { registerRl = useAuthRateLimit('register'); return () => null },
    })
    const w1 = mount(SignInHost)
    const w2 = mount(RegisterHost)

    for (let i = 0; i < registerRl.maxAttempts; i++) registerRl.recordFailure()
    await nextTick()

    expect(registerRl.isLocked.value).toBe(true)
    expect(signInRl.isLocked.value).toBe(false)
    expect(signInRl.attempts.value).toBe(0)

    // And the opposite — locking signIn doesn't touch register.
    registerRl.recordSuccess()
    for (let i = 0; i < signInRl.maxAttempts; i++) signInRl.recordFailure()
    await nextTick()

    expect(signInRl.isLocked.value).toBe(true)
    expect(registerRl.isLocked.value).toBe(false)

    w1.unmount()
    w2.unmount()
  })
})
