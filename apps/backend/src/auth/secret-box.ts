import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * The TOTP secret is a second factor, and a database dump that holds it in the clear hands out both factors at once.
 * AES-256-GCM encrypts it with a key that lives in `.env`, so the two are only useful together.
 *
 * The key is derived from the configured secret rather than used raw: an operator pasting a passphrase and an operator
 * pasting 32 random bytes both produce a 32-byte key, and neither can produce a weak one by accident.
 */
const VERSION = 'v1'
const IV_LENGTH = 12
const TAG_LENGTH = 16

export interface SecretBox {
  readonly seal: (plain: string) => string
  /** Throws when the ciphertext or its tag was rewritten: a tampered secret must fail closed, not read as absent. */
  readonly open: (sealed: string) => string
  /**
   * A stable keyed value for `label`, so a credential can be derived from the install's secret instead of stored: the
   * same label always answers the same hex string, and nobody without the secret can produce it.
   */
  readonly derive: (label: string) => string
}

export const createSecretBox = (configured: string): SecretBox => {
  const key = createHash('sha256').update(configured).digest()

  return {
    seal(plain) {
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()

      return [VERSION, iv.toString('base64url'), tag.toString('base64url'), sealed.toString('base64url')].join('.')
    },

    open(value) {
      const [version, iv, tag, sealed] = value.split('.')
      if (version !== VERSION || iv === undefined || tag === undefined || sealed === undefined) {
        throw new Error('Unreadable secret: not a sealed value')
      }

      const tagBytes = Buffer.from(tag, 'base64url')
      if (tagBytes.length !== TAG_LENGTH) throw new Error('Unreadable secret: wrong tag length')

      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAuthTag(tagBytes)

      return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString('utf8')
    },

    derive(label) {
      return createHmac('sha256', key).update(label).digest('hex')
    },
  }
}
