import { DEFAULT_LOG_TAIL } from '../environments/container-logs.js'
import { bearerToken } from '../environments/bootstrap-token.js'
import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { EnvironmentApi } from '../environments/api.js'
import { containerStatuses } from '../environments/container-runtime.js'
import type { DevEnvironment, EnvironmentPatch } from '../environments/environment-repository.js'
import { workspaceSshAlias } from '../environments/ssh-access.js'
import { AppError } from '../errors.js'
import type { TerminalSessions } from '../terminal/sessions.js'
import type { Workspace } from '../workspaces/workspace-repository.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const LOG_STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

/** Proxies drop an idle stream; a comment line now and then keeps a quiet container's log open. */
const LOG_HEARTBEAT_MS = 15_000

const environmentIdParams = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

const workspaceIdParams = {
  type: 'object',
  properties: { workspaceId: { type: 'string', pattern: uuid } },
  required: ['workspaceId'],
  additionalProperties: false,
} as const

const workspaceEnvironmentParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    environmentId: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'environmentId'],
  additionalProperties: false,
} as const

const workspaceAgentParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    agentId: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'agentId'],
  additionalProperties: false,
} as const

const environmentProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  image: { type: 'string' },
  containerId: { type: ['string', 'null'] },
  sshPort: { type: 'integer' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const environmentSchema = {
  type: 'object',
  properties: environmentProperties,
  required: ['id', 'name', 'image', 'containerId', 'sshPort', 'createdAt', 'updatedAt'],
} as const

const environmentListSchema = {
  type: 'object',
  properties: { environments: { type: 'array', items: environmentSchema } },
  required: ['environments'],
} as const

// The detail read answers what Docker says now, which the row alone cannot: `containerId` records a name, not a state.
const environmentDetailSchema = {
  type: 'object',
  properties: { ...environmentProperties, status: { type: 'string', enum: [...containerStatuses] } },
  required: ['id', 'name', 'image', 'containerId', 'sshPort', 'createdAt', 'updatedAt', 'status'],
} as const

// Bytes and a percentage, so a client formats them and the wire stays free of units.
const metricsSchema = {
  type: 'object',
  properties: {
    cpuPercent: { type: 'number' },
    memoryUsedBytes: { type: 'integer' },
    memoryLimitBytes: { type: 'integer' },
    networkReceiveBytes: { type: 'integer' },
    networkTransmitBytes: { type: 'integer' },
    blockReadBytes: { type: 'integer' },
    blockWriteBytes: { type: 'integer' },
  },
  required: [
    'cpuPercent',
    'memoryUsedBytes',
    'memoryLimitBytes',
    'networkReceiveBytes',
    'networkTransmitBytes',
    'blockReadBytes',
    'blockWriteBytes',
  ],
} as const

// `null` is an answer, not a missing one: a container with no published port has no SSH endpoint, and saying so is
// what lets the panel show "no access yet" instead of an error.
const sshAccessSchema = {
  type: ['object', 'null'],
  properties: {
    command: { type: 'string' },
    host: { type: 'string' },
    port: { type: 'integer' },
    user: { type: 'string' },
    running: { type: 'boolean' },
  },
  required: ['command', 'host', 'port', 'user', 'running'],
} as const

const listeningPortSchema = {
  type: 'object',
  properties: { port: { type: 'integer' }, command: { type: 'string' } },
  required: ['port', 'command'],
} as const

const listeningPortListSchema = {
  type: 'object',
  properties: { ports: { type: 'array', items: listeningPortSchema } },
  required: ['ports'],
} as const

// The link tables answer ids, so the wrapper says which table it came from rather than posing as the rows.
const workspaceIdsSchema = {
  type: 'object',
  properties: { workspaceIds: { type: 'array', items: { type: 'string' } } },
  required: ['workspaceIds'],
} as const

// An agent works in at most one environment: `null` is the state, not a missing answer.
const agentEnvironmentSchema = {
  type: 'object',
  properties: { environment: { ...environmentSchema, type: ['object', 'null'] } },
  required: ['environment'],
} as const

const createEnvironmentBody = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 } },
  required: ['name'],
  additionalProperties: false,
} as const

// `image` is a tag Cake publishes; a patch either names one or leaves it alone, and `null` is refused because
// an environment without an image has nothing to start.
const updateEnvironmentBody = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 }, image: { type: 'string', minLength: 1 } },
  additionalProperties: false,
} as const

const attachBody = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

const connectBody = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

interface EnvironmentIdParams {
  environmentId: string
}

interface WorkspaceIdParams {
  workspaceId: string
}

interface WorkspaceEnvironmentParams {
  workspaceId: string
  environmentId: string
}

interface WorkspaceAgentParams {
  workspaceId: string
  agentId: string
}

/**
 * The report a container sends after reconciling: the shapes `apps/agent` produces, restated here because the wire format
 * is the contract between the two processes and this is where it is validated.
 */
interface ToolingStateBody {
  schemaVersion: 1
  reportedAt: string
  tools: { id: string; version: string; path: string | null; source: 'image' | 'installed' }[]
}

const toolingStateBody = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    reportedAt: { type: 'string', format: 'date-time' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          version: { type: 'string', minLength: 1 },
          path: { type: ['string', 'null'] },
          source: { type: 'string', enum: ['image', 'installed'] },
        },
        required: ['id', 'version', 'path', 'source'],
        additionalProperties: false,
      },
    },
  },
  required: ['schemaVersion', 'reportedAt', 'tools'],
  additionalProperties: false,
} as const

// `null` on both fields is "never reported", which is a state of the environment rather than a missing resource.
const reportedStateSchema = {
  type: 'object',
  properties: {
    reportedAt: { type: ['string', 'null'] },
    state: { type: ['object', 'null'], additionalProperties: true },
  },
  required: ['reportedAt', 'state'],
} as const

const notFound = (message: string, code: string): AppError =>
  new AppError(message, { statusCode: 404, code })

const missing = (): AppError =>
  notFound('the environment does not exist', 'ENVIRONMENT_NOT_FOUND')

const notRunning = (): AppError =>
  new AppError('the environment is not running', { statusCode: 409, code: 'ENVIRONMENT_STOPPED' })

const alreadyAttached = (): AppError =>
  new AppError('the workspace already runs in an environment', {
    statusCode: 409,
    code: 'ENVIRONMENT_ALREADY_ATTACHED',
  })

const environmentRequired = (): AppError =>
  new AppError('a workspace runs in exactly one environment; detach nothing', {
    statusCode: 409,
    code: 'ENVIRONMENT_REQUIRED',
  })

const environmentInUse = (): AppError =>
  new AppError('a workspace runs in this environment; delete the workspace instead', {
    statusCode: 409,
    code: 'ENVIRONMENT_IN_USE',
  })

const toEnvironment = (environment: DevEnvironment) => ({
  ...environment,
  // `Date` serializes through `String()`, which is not the ISO form the response schema promises.
  createdAt: environment.createdAt.toISOString(),
  updatedAt: environment.updatedAt.toISOString(),
})

export const environmentRoutes: FastifyPluginAsync<{ agent: Agent; terminals: TerminalSessions }> = async (server, options) => {
  const environments: EnvironmentApi = options.agent.environments

  const requireBootstrapToken = (environmentId: string, authorization: string | undefined): void => {
    if (!environments.acceptsBootstrapToken(environmentId, bearerToken(authorization))) {
      throw new AppError('this environment token is not valid', { statusCode: 401, code: 'ENVIRONMENT_TOKEN_INVALID' })
    }
  }

  // The workspace is the scope the client is looking through, so an unknown one is a 404 before the link table is
  // consulted — otherwise an empty list would hide a typo in the id.
  const requireWorkspace = async (workspaceId: string): Promise<Workspace> => {
    const workspace = await options.agent.workspace(workspaceId)
    if (workspace === undefined) {
      throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
    }

    return workspace
  }

  // Checked here rather than left to the foreign key: an unknown agent is a 404, not a constraint violation that
  // surfaces as a 500.
  const requireAgent = async (workspaceId: string, agentId: string): Promise<void> => {
    await requireWorkspace(workspaceId)
    const agents = await options.agent.agents(workspaceId)
    if (!agents.some((candidate) => candidate.id === agentId)) {
      throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')
    }
  }

  server.get(
    '/environments',
    { schema: { response: { 200: environmentListSchema } } },
    async () => ({ environments: (await environments.list()).map(toEnvironment) }),
  )

  server.post<{ Body: { name: string } }>(
    '/environments',
    { config: { permission: 'environments.create' }, schema: { body: createEnvironmentBody, response: { 201: environmentSchema } } },
    async (request, reply) =>
      reply.code(201).send(toEnvironment(await environments.create(request.body.name))),
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId',
    { schema: { params: environmentIdParams, response: { 200: environmentDetailSchema } } },
    async (request) => {
      const environment = await environments.find(request.params.environmentId)
      if (environment === undefined) throw missing()

      const status = await environments.status(request.params.environmentId)

      // The row was just found, so a missing status can only mean Docker lost the container under it.
      return { ...toEnvironment(environment), status: status ?? 'missing' }
    },
  )

  // A stopped environment has no reading, and saying so beats zeros that draw as an idle container.
  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/metrics',
    { schema: { params: environmentIdParams, response: { 200: metricsSchema } } },
    async (request) => {
      const metrics = await environments.metrics(request.params.environmentId)
      if (metrics === undefined) throw missing()
      if (metrics === null) throw notRunning()

      return metrics
    },
  )

  // Nothing opens a port for this: it reports the mapping the container was started with, or null when there is none.
  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/ssh',
    { schema: { params: environmentIdParams, response: { 200: sshAccessSchema } } },
    async (request) => {
      const access = await environments.ssh(request.params.environmentId)
      if (access === undefined) throw missing()

      return access
    },
  )

  // Server-Sent Events: `line` for each line of output (the last DEFAULT_LOG_TAIL first, then live), `end` when Docker
  // closes the log because the container stopped. Behind the session like every environment route.
  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/logs',
    { schema: { params: environmentIdParams } },
    async (request, reply) => {
      // Lines that arrive before the headers are written are held, so an unknown id can still answer a JSON 404.
      const queued: string[] = []
      let write = (bytes: string): void => {
        queued.push(bytes)
      }
      let ended = false
      const stop = await environments.followLogs(request.params.environmentId, {
        tail: DEFAULT_LOG_TAIL,
        onLine: (line) => write(`event: line\ndata: ${JSON.stringify(line)}\n\n`),
        onEnd: () => {
          ended = true
          write('event: end\ndata: {}\n\n')
        },
      })
      if (stop === undefined) throw missing()
      if (stop === null) throw notRunning()

      reply.hijack()
      const raw = reply.raw
      raw.writeHead(200, LOG_STREAM_HEADERS)
      for (const bytes of queued) raw.write(bytes)
      write = (bytes) => {
        raw.write(bytes)
      }
      const heartbeat = setInterval(() => raw.write(': ping\n\n'), LOG_HEARTBEAT_MS)

      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        write = () => {
          // The socket is gone; a late line has nowhere to go.
        }
        stop()
        raw.end()
      }
      // A stopped container's log ends right after its tail: the client gets the `end` event, then the response ends.
      if (ended) close()
      raw.on('close', close)
      request.raw.on('close', close)
    },
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/ports',
    { schema: { params: environmentIdParams, response: { 200: listeningPortListSchema } } },
    async (request) => {
      const environment = await environments.find(request.params.environmentId)
      if (environment === undefined) throw missing()
      const ports = await environments.ports(request.params.environmentId)
      if (ports === undefined) throw missing()
      if (ports === null) throw notRunning()

      const [workspaceId] = await environments.workspacesOf(environment.id)
      const workspace = workspaceId === undefined ? undefined : await options.agent.workspace(workspaceId)
      const alias = workspaceSshAlias(workspace?.name ?? environment.name)

      return { ports: ports.map((port) => ({ port, command: `ssh -N -L ${port}:localhost:${port} ${alias}` })) }
    },
  )

  server.patch<{ Params: EnvironmentIdParams; Body: EnvironmentPatch }>(
    '/environments/:environmentId',
    {
      schema: {
        params: environmentIdParams,
        body: updateEnvironmentBody,
        response: { 200: environmentSchema },
      },
    },
    async (request) => {
      const updated = await environments.update(request.params.environmentId, request.body)
      if (updated === undefined) throw missing()

      return toEnvironment(updated)
    },
  )

  server.delete<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId',
    { schema: { params: environmentIdParams } },
    async (request, reply) => {
      // The row is what makes a workspace runnable, so an environment a workspace runs in is not the client's to
      // delete: the workspace keeps its container until the workspace itself goes.
      for (const workspaceId of await environments.workspacesOf(request.params.environmentId)) {
        const workspace = await options.agent.workspace(workspaceId)
        if (workspace !== undefined) throw environmentInUse()
      }

      // The container is removed before the row, so a failure here leaves a state the next attempt can see.
      const removed = await environments.remove(request.params.environmentId)
      if (!removed) throw missing()

      return reply.code(204).send()
    },
  )

  server.post<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/start',
    { schema: { params: environmentIdParams, response: { 200: environmentSchema } } },
    async (request) => {
      const started = await environments.start(request.params.environmentId)
      if (started === undefined) throw missing()

      return toEnvironment(started)
    },
  )

  server.post<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/stop',
    { schema: { params: environmentIdParams, response: { 200: environmentSchema } } },
    async (request) => {
      // Sessions die with the container, so they are closed before it: a shell left in the registry would answer for a
      // container that no longer exists and would hold its own `docker exec` open.
      await options.terminals.closeEnvironment(request.params.environmentId)

      const stopped = await environments.stop(request.params.environmentId)
      if (stopped === undefined) throw missing()

      return toEnvironment(stopped)
    },
  )

  // No response schema on purpose: Fastify drops what a schema does not name, and the manifest belongs to the
  // container's parser — a field this file forgot to list would disappear from the document a workspace boots from.
  // The container calls these two itself while it boots, with no browser session: it proves which environment it is
  // with the bootstrap token Cake started it with, so they skip the session check and check that token instead.
  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/manifest',
    { config: { public: true }, schema: { params: environmentIdParams } },
    async (request) => {
      requireBootstrapToken(request.params.environmentId, request.headers.authorization)
      const manifest = await environments.manifest(request.params.environmentId)
      if (manifest === undefined) throw missing()

      return manifest
    },
  )

  server.put<{ Params: EnvironmentIdParams; Body: ToolingStateBody }>(
    '/environments/:environmentId/state',
    { config: { public: true }, schema: { params: environmentIdParams, body: toolingStateBody } },
    async (request, reply) => {
      requireBootstrapToken(request.params.environmentId, request.headers.authorization)
      const recorded = await environments.recordState(request.params.environmentId, request.body)
      if (!recorded) throw missing()

      return reply.code(204).send()
    },
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/state',
    { schema: { params: environmentIdParams, response: { 200: reportedStateSchema } } },
    async (request) => {
      const reported = await environments.state(request.params.environmentId)
      // An unknown environment and one that never reported answer differently: the first is a 404, the second a null.
      if (reported === undefined) {
        if ((await environments.find(request.params.environmentId)) === undefined) throw missing()

        return { reportedAt: null, state: null }
      }

      return { reportedAt: reported.reportedAt.toISOString(), state: reported.state }
    },
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/workspaces',
    { schema: { params: environmentIdParams, response: { 200: workspaceIdsSchema } } },
    async (request) => ({
      workspaceIds: await environments.workspacesOf(request.params.environmentId),
    }),
  )

  server.get<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId/environments',
    { schema: { params: workspaceIdParams, response: { 200: environmentListSchema } } },
    async (request) => {
      await requireWorkspace(request.params.workspaceId)

      return {
        environments: (await environments.ofWorkspace(request.params.workspaceId)).map(toEnvironment),
      }
    },
  )

  server.post<{ Params: WorkspaceIdParams; Body: { environmentId: string } }>(
    '/workspaces/:workspaceId/environments',
    { schema: { params: workspaceIdParams, body: attachBody } },
    async (request, reply) => {
      await requireWorkspace(request.params.workspaceId)
      if ((await environments.find(request.body.environmentId)) === undefined) throw missing()

      // Attaching what is already attached is the state the caller asked for, so it is not an error. A second,
      // different environment is: the workspace has one and no picker to choose between them.
      const [current] = await environments.ofWorkspace(request.params.workspaceId)
      if (current !== undefined && current.id !== request.body.environmentId) throw alreadyAttached()

      await environments.attach(request.params.workspaceId, request.body.environmentId)

      return reply.code(204).send()
    },
  )

  server.delete<{ Params: WorkspaceEnvironmentParams }>(
    '/workspaces/:workspaceId/environments/:environmentId',
    { schema: { params: workspaceEnvironmentParams } },
    async (request) => {
      // Every workspace owns exactly one environment, General included, so the link is not the client's to drop.
      await requireWorkspace(request.params.workspaceId)
      throw environmentRequired()
    },
  )

  server.get<{ Params: WorkspaceAgentParams }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    { schema: { params: workspaceAgentParams, response: { 200: agentEnvironmentSchema } } },
    async (request) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const environment = await environments.ofAgent(request.params.agentId)

      return { environment: environment === undefined ? null : toEnvironment(environment) }
    },
  )

  server.put<{ Params: WorkspaceAgentParams; Body: { environmentId: string } }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    {
      schema: {
        params: workspaceAgentParams,
        body: connectBody,
        response: { 200: agentEnvironmentSchema },
      },
    },
    async (request) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const environment = await environments.find(request.body.environmentId)
      if (environment === undefined) throw missing()

      await environments.connectAgent(request.params.agentId, request.body.environmentId)

      return { environment: toEnvironment(environment) }
    },
  )

  server.delete<{ Params: WorkspaceAgentParams }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    { schema: { params: workspaceAgentParams } },
    async (request, reply) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const disconnected = await environments.disconnectAgent(request.params.agentId)
      if (!disconnected) throw notFound('the agent has no environment', 'ENVIRONMENT_NOT_ATTACHED')

      return reply.code(204).send()
    },
  )
}
