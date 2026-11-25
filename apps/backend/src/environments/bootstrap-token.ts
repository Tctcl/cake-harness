import { timingSafeEqual } from 'node:crypto'

import type { SecretBox } from '../auth/secret-box.js'

/**
 * The credential a workspace container proves itself with when it fetches its manifest and reports its state. Those
 * two calls come from inside the container, which has no browser session; the manifest carries the credentials the
 * container materialises, so it cannot simply be public.
 *
 * Derived rather than stored: the backend can recompute it for any environment, it is bound to one environment id (a
 * container cannot read another's manifest with its own token), and rotating SECRET_KEY rotates every token.
 */
export const environmentBootstrapToken = (secrets: Pick<SecretBox, 'derive'>, environmentId: string): string =>
  secrets.derive(`environment-bootstrap:${environmentId}`)

/** The token from an `Authorization: Bearer <token>` header, or undefined when the header is absent or malformed. */
export const bearerToken = (header: string | undefined): string | undefined => {
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header?.trim() ?? '')

  return match?.[1]
}

/** Constant-time comparison, so the answer time says nothing about how much of a guessed token was right. */
export const bootstrapTokenMatches = (expected: string, presented: string | undefined): boolean => {
  if (presented === undefined) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(presented)

  return left.length === right.length && timingSafeEqual(left, right)
}
