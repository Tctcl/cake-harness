import type { Actor } from './actor.js'
import type { Permission } from './permissions.js'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Who this request is. Resolved by the actor plugin before any handler runs, so a route may read it without
     * asking whether it was set — the plugin refuses the request otherwise.
     */
    actor: Actor
  }

  interface FastifyContextConfig {
    /** Reachable without a session. Set on the handful of routes that end signing in, and on nothing else. */
    readonly public?: boolean
    /**
     * The permission this route needs. Declared here rather than checked inside the handler so that the answer to "what
     * does this route require" is on the route, where it can be read next to the path it protects.
     */
    readonly permission?: Permission
  }
}
