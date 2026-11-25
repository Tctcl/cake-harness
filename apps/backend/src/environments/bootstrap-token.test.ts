import { describe, expect, it } from 'vitest'

import { createSecretBox } from '../auth/secret-box.js'
import { bearerToken, bootstrapTokenMatches, environmentBootstrapToken } from './bootstrap-token.js'

const secrets = createSecretBox('a passphrase long enough to be a key')

describe('environment bootstrap token', () => {
  it('is stable for one environment and different for another', () => {
    const first = environmentBootstrapToken(secrets, 'env-1')

    expect(environmentBootstrapToken(secrets, 'env-1')).toBe(first)
    expect(environmentBootstrapToken(secrets, 'env-2')).not.toBe(first)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('depends on the install secret', () => {
    const other = createSecretBox('another install with its own secret key')

    expect(environmentBootstrapToken(other, 'env-1')).not.toBe(environmentBootstrapToken(secrets, 'env-1'))
  })

  it('reads only a well-formed bearer header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123')
    expect(bearerToken('bearer abc123')).toBeUndefined()
    expect(bearerToken('Basic abc123')).toBeUndefined()
    expect(bearerToken('Bearer ')).toBeUndefined()
    expect(bearerToken(undefined)).toBeUndefined()
  })

  it('matches only the exact token', () => {
    const token = environmentBootstrapToken(secrets, 'env-1')

    expect(bootstrapTokenMatches(token, token)).toBe(true)
    expect(bootstrapTokenMatches(token, `${token}0`)).toBe(false)
    expect(bootstrapTokenMatches(token, token.slice(1))).toBe(false)
    expect(bootstrapTokenMatches(token, environmentBootstrapToken(secrets, 'env-2'))).toBe(false)
    expect(bootstrapTokenMatches(token, undefined)).toBe(false)
  })
})
