import { describe, expect, it } from 'vitest'

import { clearedSessionCookie, readCookie, sessionCookie } from './cookie.js'

describe('readCookie', () => {
  it('finds a value among others', () => {
    expect(readCookie('a=1; cake_session=abc; b=2', 'cake_session')).toBe('abc')
  })

  it('decodes what was encoded, and copes with spaces either side', () => {
    expect(readCookie('  cake_session = a%3Db  ', 'cake_session')).toBe('a=b')
  })

  it('answers undefined for no header, a missing name, or a pair with no value', () => {
    expect(readCookie(undefined, 'cake_session')).toBeUndefined()
    expect(readCookie('a=1; b=2', 'cake_session')).toBeUndefined()
    expect(readCookie('cake_session', 'cake_session')).toBeUndefined()
  })
})

describe('sessionCookie', () => {
  it('is HttpOnly and Lax, so script cannot read it and another site cannot spend it', () => {
    const value = sessionCookie('token', false, 60)

    expect(value).toContain('cake_session=token')
    expect(value).toContain('HttpOnly')
    expect(value).toContain('SameSite=Lax')
    expect(value).toContain('Max-Age=60')
    expect(value).toContain('Path=/')
  })

  it('adds Secure only over https, because plain http would silently drop it', () => {
    expect(sessionCookie('token', true, 60)).toContain('Secure')
    expect(sessionCookie('token', false, 60)).not.toContain('Secure')
  })

  it('clears with Max-Age=0 rather than an empty value alone', () => {
    expect(clearedSessionCookie(false)).toContain('Max-Age=0')
  })
})
