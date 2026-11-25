import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import type { Agent } from '../agent.js'

const roleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    builtin: { type: 'boolean' },
    grantsAll: { type: 'boolean' },
    permissions: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name', 'description', 'builtin', 'grantsAll', 'permissions'],
} as const

/**
 * Roles are read-only here: an admin assigns one, and the screen that edits what a role holds arrives with the role
 * editor. Reading them needs no permission of its own — a user screen that cannot name the roles cannot assign one.
 */
export const roleRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  server.get('/roles', { schema: { response: { 200: { type: 'array', items: roleSchema } } } }, async (request) => {
    AuthService.assertSignedIn(request.actor)
    AuthService.assertCan(request.actor, 'users.manage')

    const roles = await options.agent.auth.roles()

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      builtin: role.isBuiltin,
      grantsAll: role.grantsAll,
      permissions: [...role.permissions],
    }))
  })
}
