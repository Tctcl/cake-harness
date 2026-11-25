import { Secret, TOTP } from 'otpauth'

/** The issuer half of the label an authenticator app shows; the account name is the other half. */
const ISSUER = 'Cake'

/**
 * 160 bits, which is what RFC 4226 recommends for a shared secret. `otpauth` handles base32 and the RFC 6238 counter, so
 * what this module adds is the issuer, the parameters, and one place to change them.
 */
export const newTotpSecret = (): string => new Secret({ size: 20 }).base32

const build = (base32: string, account: string): TOTP =>
  new TOTP({ issuer: ISSUER, label: account, secret: Secret.fromBase32(base32), digits: 6, period: 30, algorithm: 'SHA1' })

/**
 * What gets put in the QR code or pasted into a password manager. The secret is in the URI, so this is only ever shown
 * to the person enrolling and never logged.
 */
export const totpProvisioningUri = (base32: string, account: string): string => build(base32, account).toString()

/**
 * One step either side of now, so a phone twenty seconds off still signs in. `validate` answers with the matched step,
 * and step `0` is a valid match — comparing against `null` rather than testing truthiness is the whole subtlety here.
 */
export const verifyTotp = (base32: string, account: string, token: string): boolean =>
  build(base32, account).validate({ token, window: 1 }) !== null
