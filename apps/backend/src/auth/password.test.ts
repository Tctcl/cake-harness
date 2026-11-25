import { describe, expect, it } from 'vitest'

import { checkPassword, generatePassword, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from './password.js'

describe('password hashing', () => {
  it('verifies the password it hashed and nothing else', async () => {
    const stored = await hashPassword('correct horse battery staple')

    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true)
    expect(await verifyPassword(stored, 'correct horse battery stapl')).toBe(false)
  })

  it('salts, so the same password hashes differently twice', async () => {
    const first = await hashPassword('correct horse battery staple')
    const second = await hashPassword('correct horse battery staple')

    expect(first).not.toBe(second)
  })

  it('reads a malformed stored hash as a failure rather than throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })
})

describe('generated passwords', () => {
  it('is 144 bits of url-safe text, so it survives a shell and a log line', () => {
    const password = generatePassword()

    expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(generatePassword()).not.toBe(password)
  })

  it('passes the policy the screen enforces', () => {
    expect(() => checkPassword(generatePassword())).not.toThrow()
  })
})

describe('checkPassword', () => {
  it('refuses anything shorter than the minimum', () => {
    expect(() => checkPassword('short')).toThrow(/at least/)
    expect(() => checkPassword('x'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow()
  })

  it('refuses a password long enough to make scrypt the attack', () => {
    expect(() => checkPassword('x'.repeat(5000))).toThrow(/at most/)
  })
})
