import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import { AuthService } from '../auth/service.js'
import type { UserRecord } from '../auth/user-repository.js'
import type { Agent } from '../agent.js'

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    username: { type: ['string', 'null'] },
    name: { type: 'string' },
    roleId: { type: ['string', 'null'] },
    disabled: { type: 'boolean' },
    totp: { type: 'boolean' },
    passwordChange: { type: 'boolean' },
  },
  required: ['id', 'username', 'name', 'roleId', 'disabled', 'totp', 'passwordChange'],
} as const

const createSchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    name: { type: 'string' },
    roleId: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'roleId'],
} as const

const createdSchema = {
  type: 'object',
  properties: { user: userSchema, password: { type: 'string' } },
  required: ['user', 'password'],
} as const

/** The account as the settings screen draws it. The sealed second factor never leaves the server. */
const toPayload = (user: UserRecord) => ({
  id: user.id,
  username: user.username,
  name: user.displayName,
  roleId: user.roleId,
  disabled: user.disabled,
  totp: AuthService.totpEnabled(user),
  passwordChange: user.mustChangePassword,
})

export const userRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const auth = (): AuthService => options.agent.auth
  const manage = (request: FastifyRequest): void => {
    AuthService.assertSignedIn(request.actor)
    AuthService.assertCan(request.actor, 'users.manage')
  }

  server.get('/users', { schema: { response: { 200: { type: 'array', items: userSchema } } } }, async (request) => {
    manage(request)

    return (await auth().userList()).map(toPayload)
  })

  server.post('/users', { schema: { body: createSchema, response: { 201: createdSchema } } }, async (request, reply) => {
    manage(request)
    const body = request.body as { username: string; name?: string; roleId: string; password?: string }

    const created = await auth().createUser({
      username: body.username,
      displayName: body.name ?? '',
      roleId: body.roleId,
      password: body.password,
    })

    reply.status(201)

    return { user: toPayload(created.user), password: created.password }
  })

  server.post('/users/:id/reset', { schema: { response: { 200: createdSchema } } }, async (request) => {
    manage(request)
    const { id } = request.params as { id: string }

    const created = await auth().resetUser(request.actor, id)

    return { user: toPayload(created.user), password: created.password }
  })

  server.put('/users/:id/role', async (request, reply) => {
    manage(request)
    const { id } = request.params as { id: string }
    const { roleId } = request.body as { roleId: string }

    await auth().setRole(request.actor, id, roleId)
    reply.status(204)

    return reply.send()
  })

  server.put('/users/:id/disabled', async (request, reply) => {
    manage(request)
    const { id } = request.params as { id: string }
    const { disabled } = request.body as { disabled: boolean }

    await auth().setDisabled(request.actor, id, disabled)
    reply.status(204)

    return reply.send()
  })
}
