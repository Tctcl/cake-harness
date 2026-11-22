import type { FastifyPluginAsync } from 'fastify'

import type { Agent, StopWatch, ThreadUpdate } from '../agent.js'
import { AppError } from '../errors.js'
import type { ChatThread } from '../threads/thread-repository.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

// Thread ids are uuid columns; validating the shape here keeps a malformed id a 400 instead of a driver cast error.
const threadIdParams = {
  type: 'object',
  properties: { threadId: { type: 'string', pattern: uuid } },
  required: ['threadId'],
  additionalProperties: false,
} as const

const threadListQuery = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    archived: { type: 'string', enum: ['true', 'false'] },
  },
  additionalProperties: false,
} as const

const threadProperties = {
  id: { type: 'string' },
  title: { type: ['string', 'null'] },
  workspaceId: { type: 'string' },
  agentId: { type: 'string' },
  archivedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const threadSchema = {
  type: 'object',
  properties: threadProperties,
  required: ['id', 'title', 'workspaceId', 'agentId', 'archivedAt', 'createdAt', 'updatedAt'],
} as const

const threadListSchema = {
  type: 'object',
  properties: { threads: { type: 'array', items: threadSchema } },
  required: ['threads'],
} as const

const createThreadBody = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'], minLength: 1 },
    workspaceId: { type: 'string', pattern: uuid },
    agentId: { type: 'string', pattern: uuid },
  },
  additionalProperties: false,
} as const

const renameThreadBody = {
  type: 'object',
  properties: { title: { type: ['string', 'null'], minLength: 1 } },
  required: ['title'],
  additionalProperties: false,
} as const

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    role: { type: 'string', enum: ['user', 'assistant'] },
    text: { type: 'string' },
  },
  required: ['id', 'role', 'text'],
} as const

const messageListSchema = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: messageSchema },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['messages', 'nextCursor'],
} as const

const submissionSchema = {
  type: 'object',
  properties: { submissionId: { type: 'string' } },
  required: ['submissionId'],
} as const

// A page is the newest lines by default; `cursor` is the `nextCursor` a caller got back for the page above it.
const messageQuery = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const

const DEFAULT_MESSAGE_LIMIT = 40

/** How often an idle stream sends a comment, so a proxy keeps the connection and a dead client is noticed. */
const HEARTBEAT_MS = 15_000

const sendMessageBody = {
  type: 'object',
  properties: { message: { type: 'string', minLength: 1 } },
  required: ['message'],
  additionalProperties: false,
} as const

interface ThreadIdParams {
  threadId: string
}

interface ThreadListQuery {
  workspaceId?: string
  archived?: 'true' | 'false'
}

interface CreateThreadBody {
  title?: string | null
  workspaceId?: string
  agentId?: string
}

interface MessageListQuery {
  limit?: number
  cursor?: string
}

interface SendMessageBody {
  message: string
}

interface RenameThreadBody {
  title: string | null
}

const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const

const frame = (event: string, data: ThreadUpdate): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

// `Date` would serialize through `String()`, which is not the ISO form the schema promises, so the mapping is explicit.
const toThread = (thread: ChatThread) => ({
  id: thread.id,
  title: thread.title,
  workspaceId: thread.workspaceId,
  agentId: thread.agentId,
  archivedAt: thread.archivedAt === null ? null : thread.archivedAt.toISOString(),
  createdAt: thread.createdAt.toISOString(),
  updatedAt: thread.updatedAt.toISOString(),
})

const notFound = (): AppError =>
  new AppError('the thread does not exist', { statusCode: 404, code: 'THREAD_NOT_FOUND' })

export const threadRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  server.get<{ Querystring: ThreadListQuery }>(
    '/threads',
    { schema: { querystring: threadListQuery, response: { 200: threadListSchema } } },
    async (request) => ({
      threads: (
        await options.agent.threads({
          workspaceId: request.query.workspaceId,
          archived: request.query.archived === 'true',
        })
      ).map(toThread),
    }),
  )

  server.post<{ Body: CreateThreadBody }>(
    '/threads',
    { schema: { body: createThreadBody, response: { 201: threadSchema } } },
    async (request, reply) => {
      const created = await options.agent.createThread({
        title: request.body.title ?? null,
        workspaceId: request.body.workspaceId,
        agentId: request.body.agentId,
      })

      return reply.code(201).send(toThread(created))
    },
  )

  server.post<{ Params: ThreadIdParams }>(
    '/threads/:threadId/archive',
    { schema: { params: threadIdParams, response: { 200: threadSchema } } },
    async (request) => {
      const thread = await options.agent.archiveThread(request.params.threadId)
      if (thread === undefined) throw notFound()

      return toThread(thread)
    },
  )

  server.post<{ Params: ThreadIdParams }>(
    '/threads/:threadId/restore',
    { schema: { params: threadIdParams, response: { 200: threadSchema } } },
    async (request) => {
      const thread = await options.agent.restoreThread(request.params.threadId)
      if (thread === undefined) throw notFound()

      return toThread(thread)
    },
  )

  server.patch<{ Params: ThreadIdParams; Body: RenameThreadBody }>(
    '/threads/:threadId',
    { schema: { params: threadIdParams, body: renameThreadBody, response: { 200: threadSchema } } },
    async (request) => {
      const thread = await options.agent.renameThread(request.params.threadId, request.body.title)
      if (thread === undefined) throw notFound()

      return toThread(thread)
    },
  )

  server.get<{ Params: ThreadIdParams; Querystring: MessageListQuery }>(
    '/threads/:threadId/messages',
    { schema: { params: threadIdParams, querystring: messageQuery, response: { 200: messageListSchema } } },
    async (request) =>
      options.agent.messages(request.params.threadId, {
        limit: request.query.limit ?? DEFAULT_MESSAGE_LIMIT,
        cursor: request.query.cursor,
      }),
  )

  // The stream is the transcript: it opens with the current window and then follows every commit, including the answer
  // arriving in parts. Sending returns before the answer exists, so this is where a run becomes visible.
  server.get<{ Params: ThreadIdParams }>('/threads/:threadId/stream', async (request, reply) => {
    const queued: string[] = []
    // Frames are held until the headers are out, so a thread that does not exist is still a JSON 404.
    let write: (frame: string) => void = (bytes) => queued.push(bytes)
    let detach: StopWatch | undefined

    try {
      detach = await options.agent.watch(request.params.threadId, (update) => {
        write(frame('update', update))
      })
    } catch (error) {
      detach?.().catch(() => undefined)

      throw error
    }

    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, STREAM_HEADERS)
    for (const bytes of queued) raw.write(bytes)
    write = (bytes) => raw.write(bytes)

    const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS)
    let closing = false

    const close = async () => {
      if (closing) return
      closing = true
      clearInterval(heartbeat)
      write = () => {
        // The socket is gone; a late frame has nowhere to go.
      }
      await detach?.()
      raw.end()
    }

    raw.on('close', () => {
      void close()
    })
    request.raw.on('close', () => {
      void close()
    })
  })

  server.post<{ Params: ThreadIdParams; Body: SendMessageBody }>(
    '/threads/:threadId/messages',
    {
      schema: { params: threadIdParams, body: sendMessageBody, response: { 202: submissionSchema } },
    },
    async (request, reply) => {
      const submissionId = await options.agent.submit(request.params.threadId, request.body.message)

      return reply.code(202).send({ submissionId })
    },
  )
}
