import { describe, expect, it } from 'vitest'

import { LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_MS, LoginThrottle } from './login-throttle.js'

const clock = () => {
  let now = 1_000_000
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

const fail = (throttle: LoginThrottle, client: string, times: number) => {
  for (let index = 0; index < times; index += 1) throttle.recordFailure(client)
}

describe('LoginThrottle', () => {
  it('lets an address try until it reaches the limit, and only that address', () => {
    const time = clock()
    const throttle = new LoginThrottle(time.now)

    fail(throttle, 'a', LOGIN_FAILURE_LIMIT - 1)
    expect(throttle.retryAfterMs('a')).toBe(0)

    fail(throttle, 'a', 1)
    expect(throttle.retryAfterMs('a')).toBe(LOGIN_WINDOW_MS)
    expect(throttle.retryAfterMs('b')).toBe(0)
  })

  it('counts down and forgets the failures once the window has passed', () => {
    const time = clock()
    const throttle = new LoginThrottle(time.now)
    fail(throttle, 'a', LOGIN_FAILURE_LIMIT)

    time.advance(LOGIN_WINDOW_MS - 1_000)
    expect(throttle.retryAfterMs('a')).toBe(1_000)

    time.advance(1_000)
    expect(throttle.retryAfterMs('a')).toBe(0)
  })

  it('clears an address on a successful sign-in', () => {
    const throttle = new LoginThrottle()
    fail(throttle, 'a', LOGIN_FAILURE_LIMIT)

    throttle.recordSuccess('a')
    expect(throttle.retryAfterMs('a')).toBe(0)
  })
})
