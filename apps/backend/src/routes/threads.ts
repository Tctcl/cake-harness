import type { FastifyPluginAsync } from 'fastify'

import type { Agent, StopWatch, ThreadUpdate } from '../agent.js'
import { THINKING_LEVELS } from '../agents/agent-repository.js'
import type { RunSettingsPatch } from '../agents/run-settings.js'
import { AppError } from '../errors.js'
import type { ChatThread } from '../threads/thread-repository.js'
import type { DelegationRecord } from '../delegations/delegation-repository.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

// Thread ids are uuid columns; validating the shape here keeps a malformed id a 400 instead of a driver cast error.
const threadIdParams = {
  type: 'object',
  properties: { threadId: { type: 'string', pattern: uuid } },
  required: ['threadId'],
  additionalProperties: false,
} as const

const toolCallParams = {
  type: 'object',
  properties: { threadId: { type: 'string', pattern: uuid }, callId: { type: 'string', minLength: 1 } },
  required: ['threadId', 'callId'],
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

const overrideProperties = {
  credentialId: { anyOf: [{ type: 'string', pattern: uuid }, { type: 'null' }] },
  modelId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] },
  thinkingLevel: { anyOf: [{ type: 'string', enum: [...THINKING_LEVELS] }, { type: 'null' }] },
} as const

const overridesSchema = {
  type: 'object',
  properties: overrideProperties,
  required: ['credentialId', 'modelId', 'thinkingLevel'],
  additionalProperties: false,
} as const

const threadProperties = {
  id: { type: 'string' },
  title: { type: ['string', 'null'] },
  titleSource: { type: 'string', enum: ['user', 'auto'] },
  workspaceId: { type: 'string' },
  agentId: { type: 'string' },
  overrides: overridesSchema,
  archivedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const threadSchema = {
  type: 'object',
  properties: threadProperties,
  required: ['id', 'title', 'titleSource', 'workspaceId', 'agentId', 'overrides', 'archivedAt', 'createdAt', 'updatedAt'],
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

const runSettingsBody = {
  type: 'object',
  properties: overrideProperties,
  additionalProperties: false,
} as const

const textBlockSchema = {
  type: 'object',
  properties: { type: { type: 'string', const: 'text' }, text: { type: 'string' } },
  required: ['type', 'text'],
  additionalProperties: false,
} as const

const thinkingBlockSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'thinking' },
    text: { type: 'string' },
    redacted: { type: 'boolean' },
  },
  required: ['type', 'text', 'redacted'],
  additionalProperties: false,
} as const

const toolCallBlockSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', const: 'toolCall' },
    callId: { type: 'string' },
    name: { type: 'string' },
    arguments: { type: 'string' },
  },
  required: ['type', 'callId', 'name', 'arguments'],
  additionalProperties: false,
} as const

const contextSectionSchema = {
  type: 'object',
  properties: { key: { type: 'string' }, text: { type: ['string', 'null'] } },
  required: ['key', 'text'],
  additionalProperties: false,
} as const

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    role: { type: 'string', enum: ['user', 'assistant', 'compaction', 'reset', 'context'] },
    text: { type: 'string' },
    blocks: {
      type: 'array',
      items: { oneOf: [textBlockSchema, thinkingBlockSchema, toolCallBlockSchema] },
    },
    stopReason: { type: ['string', 'null'] },
    errorMessage: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    sections: { type: 'array', items: contextSectionSchema },
    toolsAdded: { type: 'array', items: { type: 'string' } },
    toolsRemoved: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'role', 'text', 'blocks', 'stopReason', 'errorMessage', 'reason'],
} as const

const messageListSchema = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: messageSchema },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['messages', 'nextCursor'],
} as const

const toolCallDetailsSchema = {
  type: 'object',
  properties: {
    arguments: { type: ['string', 'null'] },
    result: { type: ['string', 'null'] },
  },
  required: ['arguments', 'result'],
} as const

const contextCategorySchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['messages', 'systemPrompt', 'systemTools'] },
    tokens: { type: 'integer' },
  },
  required: ['kind', 'tokens'],
} as const

const contextUsageSchema = {
  type: 'object',
  properties: {
    provider: { type: ['string', 'null'] },
    modelId: { type: ['string', 'null'] },
    contextWindow: { type: ['integer', 'null'] },
    used: { type: 'integer' },
    remaining: { type: ['integer', 'null'] },
    categories: { type: 'array', items: contextCategorySchema },
  },
  required: ['provider', 'modelId', 'contextWindow', 'used', 'remaining', 'categories'],
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

const answerQuestionBody = {
  type: 'object',
  properties: { answer: { type: 'string', minLength: 1, maxLength: 4000 } },
  required: ['answer'],
  additionalProperties: false,
} as const

interface ThreadIdParams {
  threadId: string
}

interface ToolCallParams extends ThreadIdParams {
  callId: string
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

interface AnswerQuestionBody {
  answer: string
}

interface RenameThreadBody {
  title: string | null
}

type RunSettingsBody = RunSettingsPatch

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
  titleSource: thread.titleSource,
  workspaceId: thread.workspaceId,
  agentId: thread.agentId,
  overrides: thread.overrides,
  archivedAt: thread.archivedAt === null ? null : thread.archivedAt.toISOString(),
  createdAt: thread.createdAt.toISOString(),
  updatedAt: thread.updatedAt.toISOString(),
})

const delegationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    parentThreadId: { type: 'string' },
    parentConversationId: { type: 'number' },
    parentTaskId: { type: 'number' },
    parentCallId: { type: 'string' },
    subagentId: { type: 'string' },
    subagentName: { type: 'string' },
    childConversationId: { type: 'number' },
    status: { type: 'string', enum: ['running', 'done', 'failed'] },
    worktreePath: { type: ['string', 'null'] },
    worktreeBranch: { type: ['string', 'null'] },
    resultSummary: { type: ['string', 'null'] },
    startedAt: { type: 'string' },
    finishedAt: { type: ['string', 'null'] },
  },
  required: [
    'id',
    'parentThreadId',
    'parentConversationId',
    'parentTaskId',
    'parentCallId',
    'subagentId',
    'subagentName',
    'childConversationId',
    'status',
    'worktreePath',
    'worktreeBranch',
    'resultSummary',
    'startedAt',
    'finishedAt',
  ],
} as const

const delegationListSchema = {
  type: 'object',
  properties: { delegations: { type: 'array', items: delegationSchema } },
  required: ['delegations'],
} as const

const toDelegation = (delegation: DelegationRecord) => ({
  ...delegation,
  startedAt: delegation.startedAt.toISOString(),
  finishedAt: delegation.finishedAt === null ? null : delegation.finishedAt.toISOString(),
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

  server.get<{ Params: ThreadIdParams }>(
    '/threads/:threadId',
    { schema: { params: threadIdParams, response: { 200: threadSchema } } },
    async (request) => {
      const thread = await options.agent.thread(request.params.threadId)
      if (thread === undefined) throw notFound()

      return toThread(thread)
    },
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

  server.patch<{ Params: ThreadIdParams; Body: RunSettingsBody }>(
    '/threads/:threadId/run-settings',
    { schema: { params: threadIdParams, body: runSettingsBody, response: { 200: threadSchema } } },
    async (request) => {
      const thread = await options.agent.updateThreadRunSettings(request.params.threadId, request.body)
      if (thread === undefined) throw notFound()

      return toThread(thread)
    },
  )

  server.get<{ Params: ThreadIdParams }>(
    '/threads/:threadId/delegations',
    { schema: { params: threadIdParams, response: { 200: delegationListSchema } } },
    async (request) => {
      if ((await options.agent.thread(request.params.threadId)) === undefined) throw notFound()

      return { delegations: (await options.agent.delegations(request.params.threadId)).map(toDelegation) }
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

  server.get<{ Params: ToolCallParams }>(
    '/threads/:threadId/tool-calls/:callId',
    { schema: { params: toolCallParams, response: { 200: toolCallDetailsSchema } } },
    async (request) => {
      const details = await options.agent.toolCallDetails(request.params.threadId, request.params.callId)
      if (details === undefined) throw notFound()

      return details
    },
  )

  // Estimated, not measured: the panel draws a share of the window, and a thread has to have one before the provider
  // has answered once.
  server.get<{ Params: ThreadIdParams }>(
    '/threads/:threadId/context',
    { schema: { params: threadIdParams, response: { 200: contextUsageSchema } } },
    async (request) => options.agent.contextUsage(request.params.threadId),
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

  server.post<{ Params: ToolCallParams; Body: AnswerQuestionBody }>(
    '/threads/:threadId/questions/:callId/answer',
    {
      schema: {
        params: toolCallParams,
        body: answerQuestionBody,
        response: { 200: { type: 'object', properties: { answered: { type: 'boolean' } }, required: ['answered'] } },
      },
    },
    async (request, reply) => {
      const result = await options.agent.answerQuestion(
        request.params.threadId,
        request.params.callId,
        request.body.answer,
      )
      if (result === 'not-found') {
        throw new AppError('no waiting ask_user call was found', {
          statusCode: 404,
          code: 'QUESTION_NOT_FOUND',
        })
      }
      if (result === 'already-answered') {
        throw new AppError('this question has already been answered', {
          statusCode: 409,
          code: 'QUESTION_ALREADY_ANSWERED',
        })
      }

      return reply.code(200).send({ answered: true })
    },
  )
}
