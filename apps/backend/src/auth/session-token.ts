import { createHash, randomBytes } from 'node:crypto'

/**
 * The cookie carries a random token; the database carries its SHA-256. A dump therefore hands out nothing that can be
 * replayed, which a stored plaintext token would. The token is 256 random bits, so a fast hash is enough here — scrypt
 * protects a password because a person chooses it, not because the comparison is slow.
 */
const TOKEN_BYTES = 32

export const newSessionToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url')

export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex')
