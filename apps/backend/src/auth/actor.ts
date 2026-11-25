import type { Permission } from './permissions.js'

/**
 * What is left to finish signing in, or `null` once the person is themselves. Three states rather than a boolean because
 * they lead to different screens: choose a password, enrol a second factor, or type the six digits from it.
 */
export type PendingStep = 'password' | 'totp' | 'totp-setup'

/**
 * The caller, resolved once per request. Everything a route needs to decide on is here, so no handler reads a cookie or
 * asks the database who is knocking.
 */
export interface Actor {
  readonly id: string
  readonly displayName: string
  readonly username: string | null
  readonly permissions: ReadonlySet<Permission>
  readonly pending: PendingStep | null
  /** The session this request arrived on, or `null` in single-user mode where there is no session at all. */
  readonly sessionId: string | null
  /** True when nobody signed in and the install is treating every request as its owner. */
  readonly singleUser: boolean
}

export const can = (actor: Actor, permission: Permission): boolean => actor.permissions.has(permission)

/** A half-signed-in session may read nothing but its own state: the pending step is a wall, not a warning. */
export const isSignedIn = (actor: Actor): boolean => actor.pending === null
