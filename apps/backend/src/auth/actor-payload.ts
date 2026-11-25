import type { Actor } from './actor.js'

/** The identity as the client reads it: what it may show, what it may offer, and which step signing in still needs. */
export interface ActorPayload {
  readonly id: string
  readonly name: string
  readonly username: string | null
  readonly permissions: readonly string[]
  readonly pending: string | null
  readonly singleUser: boolean
}

export const toActorPayload = (actor: Actor): ActorPayload => ({
  id: actor.id,
  name: actor.displayName,
  username: actor.username,
  permissions: [...actor.permissions],
  pending: actor.pending,
  singleUser: actor.singleUser,
})
