import { Secret, TOTP } from 'otpauth'
import { describe, expect, it } from 'vitest'

import { newTotpSecret, totpProvisioningUri, verifyTotp } from './totp.js'

/** A code from the same secret, generated the way an authenticator app would. */
const codeFor = (base32: string): string =>
  new TOTP({ secret: Secret.fromBase32(base32), digits: 6, period: 30, algorithm: 'SHA1' }).generate()

describe('newTotpSecret', () => {
  it('is 160 bits of base32, which is what RFC 4226 asks for', () => {
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })
})

describe('totpProvisioningUri', () => {
  it('names the app and the account, so it is unambiguous in a password manager', () => {
    const uri = totpProvisioningUri(newTotpSecret(), 'luke')

    expect(uri).toMatch(/^otpauth:\/\/totp\/tctcl:luke\?/)
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })
})

describe('verifyTotp', () => {
  const secret = newTotpSecret()

  it('accepts the code the enrolled secret produces', () => {
    expect(verifyTotp(secret, 'luke', codeFor(secret))).toBe(true)
  })

  it('rejects a code from another secret', () => {
    expect(verifyTotp(secret, 'luke', codeFor(newTotpSecret()))).toBe(false)
  })

  it('rejects text that is not a code at all', () => {
    expect(verifyTotp(secret, 'luke', '')).toBe(false)
    expect(verifyTotp(secret, 'luke', 'abcdef')).toBe(false)
  })

  it('agrees with the parameters the URI advertises', () => {
    // A code generated with different digits would never match the validator; this pins the two to one another.
    const uri = totpProvisioningUri(secret, 'luke')
    expect(new URL(uri).searchParams.get('secret')).toBe(secret)
    expect(verifyTotp(secret, 'luke', codeFor(secret))).toBe(true)
  })
})
