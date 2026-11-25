import type { FastifyPluginAsync } from 'fastify'

import { AppError } from '../errors.js'
import type { EnvironmentApi } from '../environments/api.js'
import {
  clampSize,
  CLOSE_UNAVAILABLE,
  CLOSE_UNKNOWN_TERMINAL,
  DEFAULT_TERMINAL_SIZE,
  MAX_TERMINAL_SIZE,
  MIN_TERMINAL_SIZE,
  toPayload,
  type ClientFrame,
  type ServerFrame,
  type TerminalPayload,
} from '../terminal/contract.js'
import type { TerminalAttachment, TerminalSessions } from '../terminal/sessions.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const terminalParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    environmentId: { type: 'string', pattern: uuid },
    terminalId: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'environmentId', 'terminalId'],
  additionalProperties: false,
} as const

const createTerminalBody = {
  type: 'object',
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 60 },
    size: {
      type: 'object',
      properties: {
        cols: { type: 'integer', minimum: MIN_TERMINAL_SIZE.cols, maximum: MAX_TERMINAL_SIZE.cols },
        rows: { type: 'integer', minimum: MIN_TERMINAL_SIZE.rows, maximum: MAX_TERMINAL_SIZE.rows },
      },
      required: ['cols', 'rows'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const

const terminalSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    size: {
      type: 'object',
      properties: { cols: { type: 'integer' }, rows: { type: 'integer' } },
      required: ['cols', 'rows'],
    },
    attached: { type: 'boolean' },
  },
  required: ['id', 'label', 'createdAt', 'size', 'attached'],
} as const

const terminalListSchema = {
  type: 'object',
  properties: { terminals: { type: 'array', items: terminalSchema } },
  required: ['terminals'],
} as const

/** `environmentId` travels in the session payload as well: the panel is mounted per environment and must not guess. */
const sessionSchema = {
  type: 'object',
  properties: { ...terminalSchema.properties, environmentId: { type: 'string' } },
  required: [...terminalSchema.required, 'environmentId'],
} as const

const withEnvironment = (terminal: TerminalPayload, environmentId: string): TerminalPayload & { environmentId: string } => ({
  environmentId,
  ...terminal,
})

interface WorkspaceParams {
  workspaceId: string
  environmentId: string
}

interface TerminalParams extends WorkspaceParams {
  terminalId: string
}

interface CreateTerminalRequestBody {
  label?: string
  size?: { cols: number; rows: number }
}

export interface TerminalRoutesOptions {
  readonly environments: EnvironmentApi
  readonly terminals: TerminalSessions
}

/**
 * Terminal sessions inside an environment's container.
 *
 * Mounted under `/workspaces/:workspaceId/environments/:environmentId` because a terminal is a use of an environment,
 * not a thing of its own: it dies with the environment and inherits its identity. The container id never leaves this
 * file — a client names an environment and a session, nothing else.
 */
export const terminalRoutes: FastifyPluginAsync<TerminalRoutesOptions> = async (server, options) => {
  const { environments, terminals } = options

  /** Every route resolves the environment the same way, so a stopped one answers identically everywhere. */
  const requireEnvironment = async (environmentId: string) => {
    const environment = await environments.find(environmentId)
    if (environment === undefined) throw new AppError('that environment does not exist', { statusCode: 404, code: 'ENVIRONMENT_NOT_FOUND' })

    return environment
  }

  const requireSession = (terminalId: string, environmentId: string) => {
    const view = terminals.view(terminalId)
    // A session belongs to one environment: an id from another one is a miss, not a redirect.
    if (view.environmentId !== environmentId) {
      throw new AppError('that terminal does not exist', { statusCode: 404, code: 'TERMINAL_NOT_FOUND' })
    }

    return view
  }

  server.get<{ Params: WorkspaceParams }>(
    '/workspaces/:workspaceId/environments/:environmentId/terminals',
    { config: { permission: 'environments.create' }, schema: { response: { 200: terminalListSchema } } },
    async (request) => {
      await requireEnvironment(request.params.environmentId)

      return {
        terminals: terminals.list(request.params.environmentId).map((view) => withEnvironment(toPayload(view), view.environmentId)),
      }
    },
  )

  server.post<{ Params: WorkspaceParams; Body: CreateTerminalRequestBody }>(
    '/workspaces/:workspaceId/environments/:environmentId/terminals',
    {
      config: { permission: 'environments.create' },
      schema: { body: createTerminalBody, response: { 201: sessionSchema } },
    },
    async (request, reply) => {
      const environment = await requireEnvironment(request.params.environmentId)
      // Answered here, before anything is spawned: a stopped environment is a state to report, not an error to retry.
      if (environment.containerId === null) {
        throw new AppError('start the environment before opening a terminal', {
          statusCode: 409,
          code: 'ENVIRONMENT_STOPPED',
        })
      }

      const view = await terminals.create({
        environmentId: environment.id,
        containerId: environment.containerId,
        label: request.body.label,
        size: request.body.size === undefined ? undefined : clampSize(request.body.size, DEFAULT_TERMINAL_SIZE),
      })

      return reply.code(201).send(withEnvironment(toPayload(view), view.environmentId))
    },
  )

  server.delete<{ Params: TerminalParams }>(
    '/workspaces/:workspaceId/environments/:environmentId/terminals/:terminalId',
    { config: { permission: 'environments.create' }, schema: { params: terminalParams } },
    async (request, reply) => {
      requireSession(request.params.terminalId, request.params.environmentId)
      // Resolves once the process is gone, so a `204` means the program is dead rather than merely asked to be.
      await terminals.close(request.params.terminalId)

      return reply.code(204).send()
    },
  )

  /**
   * The byte pump. Binary frames are terminal bytes in both directions and are never parsed; text frames are the control
   * messages in `contract.ts`. That split is what keeps a paste of 10 KB of escape sequences intact.
   */
  server.get<{ Params: TerminalParams }>(
    '/workspaces/:workspaceId/environments/:environmentId/terminals/:terminalId/attach',
    { websocket: true, config: { permission: 'environments.create' }, schema: { params: terminalParams } },
    (socket, request) => {
      const send = (frame: ServerFrame): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
      }

      const fail = (code: number, message: string): void => {
        send({ type: 'error', code: message, message })
        socket.close(code, message.slice(0, 120))
      }

      void (async () => {
        const { environmentId, terminalId } = request.params
        const environment = await environments.find(environmentId)
        if (environment === undefined || environment.containerId === null) {
          fail(CLOSE_UNAVAILABLE, environment === undefined ? 'that environment does not exist' : 'the environment is not running')

          return
        }

        let attachment: TerminalAttachment
        try {
          if (terminals.view(terminalId).environmentId !== environmentId) {
            fail(CLOSE_UNKNOWN_TERMINAL, 'that terminal does not exist')

            return
          }
          attachment = terminals.attach(terminalId, {
            emit: (chunk) => {
              if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true })
            },
            ended: () => {
              // Nothing is left to talk to; the client reattaches to a different session or opens a new one.
              socket.close(1000, 'the terminal exited')
            },
          })
        } catch (error) {
          const code = error instanceof AppError && error.code === 'TERMINAL_BUSY' ? CLOSE_UNAVAILABLE : CLOSE_UNKNOWN_TERMINAL
          fail(code, error instanceof Error ? error.message : String(error))

          return
        }

        send({ type: 'ready', terminal: withEnvironment(toPayload(terminals.view(terminalId)), environmentId) })
        // After `ready` and before any live byte, so the client can mount its emulator sized and pre-filled.
        if (attachment.replay.length > 0) socket.send(attachment.replay, { binary: true })

        socket.on('message', (data: unknown, isBinary: boolean) => {
          if (isBinary) {
            terminals.write(terminalId, asBytes(data))
            return
          }

          const frame = parseClientFrame(asBytes(data).toString('utf8'))
          if (frame !== undefined) terminals.resize(terminalId, clampSize(frame, currentSize(terminals, terminalId)))
        })

        socket.on('close', () => attachment.detach())
        socket.on('error', () => attachment.detach())
      })()
    },
  )
}

/** The last size the panel reported, used when a resize frame carries only one of the two numbers. */
const currentSize = (terminals: TerminalSessions, terminalId: string): { cols: number; rows: number } => {
  try {
    return terminals.view(terminalId).size
  } catch {
    return DEFAULT_TERMINAL_SIZE
  }
}

const asBytes = (data: unknown): Buffer => {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (Array.isArray(data)) return Buffer.concat(data.filter((part): part is Buffer => Buffer.isBuffer(part)))

  return Buffer.alloc(0)
}

const parseClientFrame = (text: string): ClientFrame | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const candidate = parsed as { type?: unknown; cols?: unknown; rows?: unknown }
    if (candidate.type !== 'resize' || typeof candidate.cols !== 'number' || typeof candidate.rows !== 'number') return undefined

    return { type: 'resize', cols: candidate.cols, rows: candidate.rows }
  } catch {
    // A client that sends garbage loses the frame, not the session.
    return undefined
  }
}
