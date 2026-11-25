import { describe, expect, it } from 'vitest'

import { createSecretBox } from './secret-box.js'

const box = createSecretBox('a passphrase long enough to be a key')

describe('createSecretBox', () => {
  it('round-trips a secret', () => {
    expect(box.open(box.seal('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP')
  })

  it('seals the same secret differently each time, because the iv is random', () => {
    expect(box.seal('same')).not.toBe(box.seal('same'))
  })

  it('refuses a value sealed with another key', () => {
    const other = createSecretBox('a different passphrase for another install')

    expect(() => box.open(other.seal('JBSWY3DPEHPK3PXP'))).toThrow()
  })

  it('refuses a rewritten ciphertext instead of reading it as absent', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP')
    const [version, iv, tag, body] = sealed.split('.')

    expect(() => box.open([version, iv, tag, `${String(body)}x`].join('.'))).toThrow()
    expect(() => box.open('garbage')).toThrow(/not a sealed value/)
  })
})
