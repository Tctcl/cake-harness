import { describe, expect, it } from 'vitest'

import { hashSessionToken, newSessionToken } from './session-token.js'

describe('session tokens', () => {
  it('is 256 bits of url-safe text', () => {
    expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('never repeats', () => {
    expect(newSessionToken()).not.toBe(newSessionToken())
  })

  it('hashes to a value that is nothing like the token, so a dump is not a set of cookies', () => {
    const token = newSessionToken()

    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSessionToken(token)).not.toContain(token)
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })
})
