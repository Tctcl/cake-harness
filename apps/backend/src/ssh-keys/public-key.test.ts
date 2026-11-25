import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { validatePublicKey } from './public-key.js'

const KNOWN_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHJPOdiu8Ol2WKBKTzIV+JvRpeQbODlBw8uQpa+7VXVs cake-test-fixture'

const uint32 = (value: number): Buffer => {
  const result = Buffer.alloc(4)
  result.writeUInt32BE(value)

  return result
}

const field = (value: string | Buffer): Buffer => {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'ascii') : value

  return Buffer.concat([uint32(bytes.length), bytes])
}

const mpint = (unsigned: Buffer): Buffer =>
  unsigned[0] !== undefined && (unsigned[0] & 0x80) !== 0 ? Buffer.concat([Buffer.alloc(1), unsigned]) : unsigned

const rsaKey = (modulusLength: 384 | 256): string => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: modulusLength * 8 })
  const jwk = publicKey.export({ format: 'jwk' })
  if (jwk.n === undefined || jwk.e === undefined) throw new Error('RSA JWK is incomplete')
  const blob = Buffer.concat([
    field('ssh-rsa'),
    field(mpint(Buffer.from(jwk.e, 'base64url'))),
    field(mpint(Buffer.from(jwk.n, 'base64url'))),
  ])

  return `ssh-rsa ${blob.toString('base64')}`
}

const ecdsaKey = (): string => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  const jwk = publicKey.export({ format: 'jwk' })
  if (jwk.x === undefined || jwk.y === undefined) throw new Error('EC JWK is incomplete')
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ])
  const blob = Buffer.concat([
    field('ecdsa-sha2-nistp384'),
    field('nistp384'),
    field(point),
  ])

  return `ecdsa-sha2-nistp384 ${blob.toString('base64')}`
}

describe('validatePublicKey', () => {
  it('accepts and normalizes ed25519, RSA 3072, and ECDSA keys', () => {
    for (const key of [KNOWN_KEY, rsaKey(384), ecdsaKey()]) {
      const validated = validatePublicKey(key)
      expect(validated.publicKey.split(' ')).toHaveLength(2)
      expect(validated.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    }
  })

  it('matches ssh-keygen’s SHA256 fingerprint for a known Ed25519 key', () => {
    // `ssh-keygen -lf` reports SHA256:ar3YW4bLwBEcMYka4Ez0cKhWtCFcEbNbSljSQWCbIKk for this fixture.
    expect(validatePublicKey(KNOWN_KEY)).toEqual({
      publicKey: KNOWN_KEY.replace(' cake-test-fixture', ''),
      fingerprint: 'SHA256:ar3YW4bLwBEcMYka4Ez0cKhWtCFcEbNbSljSQWCbIKk',
    })
  })

  it('rejects bad base64, a short RSA modulus, garbage, and a mismatched wire type', () => {
    expect(() => validatePublicKey('ssh-ed25519 !!!not-base64!!!')).toThrow(/not valid/)
    expect(() => validatePublicKey(rsaKey(256))).toThrow(/at least 3072 bits/)
    expect(() => validatePublicKey('garbage')).toThrow(/not valid/)
    expect(() => validatePublicKey('not-a-key AAAA')).toThrow(/not valid/)

    const rsa = rsaKey(384)
    expect(() => validatePublicKey(rsa.replace(/^ssh-rsa/, 'ssh-ed25519'))).toThrow(/not valid/)
  })

  it('rejects a second line rather than writing it into authorized_keys', () => {
    expect(() => validatePublicKey(`${KNOWN_KEY}\n${KNOWN_KEY}`)).toThrow(/not valid/)
  })
})
