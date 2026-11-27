import { randomUUID } from 'node:crypto'

import type { Context } from '@earendil-works/chord/context'
import type { JsonValue } from '@earendil-works/chord/json'
import {
  SubmissionSettled,
  configure,
  defineExtension,
  defineTask,
  defineTool,
} from '@earendil-works/pi-durable'
import type {
  AgentChange,
  ConversationId,
  EntryRecord,
  RunningTask,
  TaskRuntime,
  ToolExecutionApi,
  ToolExecutionResult,
  ToolPark,
} from '@earendil-works/pi-durable'

import type { AgentRepository, ThinkingLevel } from '../agents/agent-repository.js'
import type { RunSettings } from '../agents/run-settings.js'
import type { ToolSelection } from '../agents/tool-selection.js'
import { composeSystemAppend } from '../agents/base-prompt.js'
import { renderReminder, turnSubmission } from '../agents/turn-reminder.js'
import type { ThreadRepository } from '../threads/thread-repository.js'
import { idFromNumber } from '../storage/postgres/ids.js'
import type { SubagentRepository } from '../subagents/subagent-repository.js'
import { DelegationRepository } from './delegation-repository.js'
import { createWorktree, worktreePlan } from './worktree.js'

export const DELEGATION_TIMEOUT_MS = 30 * 60 * 1000

export interface DelegateInput {
  readonly subagentId: string
  readonly task: string
  readonly model?: string | undefined
  readonly thinkingLevel?: ThinkingLevel | undefined
  readonly worktree?: boolean | undefined
  readonly repoPath?: string | undefined
}

interface DelegationTaskInput {
  readonly id: string
  readonly parentThreadId: string
  readonly parentConversationId: number
  readonly parentTaskId: number
  readonly parentCallId: string
  readonly subagentId: string
  readonly task: string
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly worktree: boolean
  readonly repoPath?: string
  readonly deadlineAt: number
}

interface ChildCheckpoint {
  readonly childConversationId: number
  readonly worktreePath: string | null
  readonly worktreeBranch: string | null
}

type DelegationCheckpoint =
  | { readonly phase: 'create' }
  | ({ readonly phase: 'submit' } & ChildCheckpoint)
  | ({ readonly phase: 'wait' } & ChildCheckpoint)

export interface DelegationResult {
  readonly [key: string]: JsonValue
  readonly text: string
  readonly worktreePath: string | null
  readonly worktreeBranch: string | null
}

export interface DelegateExtensionOptions {
  readonly threads: Pick<ThreadRepository, 'findByConversation'>
  readonly agents: Pick<AgentRepository, 'find'>
  readonly subagents: Pick<SubagentRepository, 'callableBy'>
  readonly delegations: Pick<DelegationRepository, 'start' | 'finish'>
  readonly toolSelection: (profile: NonNullable<Awaited<ReturnType<AgentRepository['find']>>>) => Promise<ToolSelection>
  readonly runSettings: (
    profile: NonNullable<Awaited<ReturnType<AgentRepository['find']>>>,
    modelId: string,
    thinkingLevel: ThinkingLevel,
  ) => Promise<RunSettings>
}

const parameters = {
  type: 'object',
  properties: {
    subagentId: {
      type: 'string',
      minLength: 1,
      description: 'The id of a sub agent listed in the reminder after the user message.',
    },
    task: { type: 'string', minLength: 1, description: 'A complete, self-contained task for the sub agent.' },
    model: {
      type: 'string',
      minLength: 1,
      description: 'Optional allowed model override. Omit to use the sub agent default; override only for good reason.',
    },
    thinkingLevel: {
      type: 'string',
      enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      description: 'Optional thinking-level override. Omit to use the sub agent default.',
    },
    worktree: { type: 'boolean', default: false, description: 'Run in a new git worktree; requires a container.' },
    repoPath: { type: 'string', minLength: 1, description: 'Repository path relative to /home/dev/workspace.' },
  },
  required: ['subagentId', 'task'],
  additionalProperties: false,
} as const

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

const answerText = (entry: EntryRecord | undefined): string => {
  const message = entry?.model?.find((candidate) => candidate.role === 'assistant')
  if (message?.role !== 'assistant') return ''
  if (typeof message.content === 'string') return message.content

  return message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
}

const childId = (checkpoint: DelegationCheckpoint): ConversationId | undefined =>
  checkpoint.phase === 'create' ? undefined : idFromNumber<ConversationId>(checkpoint.childConversationId)

type Runtime = TaskRuntime<DelegationTaskInput, DelegationCheckpoint, DelegationResult, object>
type Task = RunningTask<DelegationTaskInput, DelegationCheckpoint, DelegationResult>

const fail = async (
  options: DelegateExtensionOptions,
  task: Task,
  runtime: Runtime,
  error: unknown,
  context: Context,
): Promise<void> => {
  const message = errorText(error)
  await options.delegations.finish(task.input.id, 'failed', message)
  await runtime.commit(() => ({
    status: 'terminal',
    outcome: { status: 'failed', error: { message } },
  }), context)
}

const registration = (input: DelegationTaskInput, checkpoint: ChildCheckpoint) => ({
  id: input.id,
  parentThreadId: input.parentThreadId,
  parentConversationId: input.parentConversationId,
  parentTaskId: input.parentTaskId,
  parentCallId: input.parentCallId,
  subagentId: input.subagentId,
  childConversationId: checkpoint.childConversationId,
  worktreePath: checkpoint.worktreePath,
  worktreeBranch: checkpoint.worktreeBranch,
})

/** The durable child task is the restart anchor: Harness.open resumes it and wakes the parent's parked tool wait. */
export const createDelegationTask = (options: DelegateExtensionOptions) =>
  defineTask<DelegationTaskInput, DelegationCheckpoint, DelegationResult, object>({
    name: 'cake-delegation',
    version: 1,
    initial: () => ({ phase: 'create' }),
    phases: {
      async create(task, runtime, context) {
        try {
          await runtime.commit(async (tx) => {
            const child = await tx.createConversation({ ownership: { kind: 'task', taskId: runtime.taskId } })

            return {
              status: 'running' as const,
              checkpoint: {
                phase: 'submit',
                childConversationId: Number(child.id),
                worktreePath: null,
                worktreeBranch: null,
              } satisfies DelegationCheckpoint,
            }
          }, context)
        } catch (error) {
          await fail(options, task, runtime, error, context)
        }
      },

      async submit(task, runtime, context) {
        const checkpoint = task.state.checkpoint
        const conversationId = idFromNumber<ConversationId>(checkpoint.childConversationId)
        try {
          // Register before setup so a bad repo, archived profile or missing key still leaves a visible failed row.
          await options.delegations.start(registration(task.input, checkpoint))
          const [profile, parent, child] = await Promise.all([
            options.agents.find(task.input.subagentId),
            runtime.agent(context),
            runtime.conversation(conversationId, context),
          ])
          if (profile?.kind !== 'subagent' || profile.archivedAt !== null) {
            throw new Error('the sub agent is no longer available')
          }
          if (child === undefined) throw new Error('the child conversation is missing')

          let worktreePath: string | null = null
          let worktreeBranch: string | null = null
          if (task.input.worktree) {
            const env = await runtime.env(context)
            if (env === undefined) throw new Error('worktree delegation requires a workspace container')
            const plan = worktreePlan(task.input.id, parent.cwd, task.input.repoPath)
            await createWorktree(env, plan, context)
            worktreePath = plan.path
            worktreeBranch = plan.branch
            await options.delegations.start(registration(task.input, {
              ...checkpoint,
              worktreePath,
              worktreeBranch,
            }))
          }

          const [selection, settings] = await Promise.all([
            options.toolSelection(profile),
            options.runSettings(profile, task.input.modelId, task.input.thinkingLevel),
          ])
          const append = composeSystemAppend(profile.systemPromptAppend)
          const change: AgentChange = {
            model: settings.model,
            thinkingLevel: settings.thinkingLevel,
            ...selection,
            // `null` clears an instructions section a delegation started under the old prompt may have left behind.
            instructions: append ?? null,
            cwd: worktreePath ?? parent.cwd ?? null,
          }
          // The child is a sub agent, so its reminder carries its instructions and its own tools: never ask_user or
          // delegate, which tool selection has already dropped for it.
          const reminder = renderReminder({
            instructions: profile.instructions,
            tools: selection.tools,
            subagents: [],
            skills: [],
          })

          await runtime.commit(async (tx) => {
            await configure(tx, conversationId, change)
            await child.submit(tx, {
              ...turnSubmission(task.input.task, reminder),
              notify: { taskId: runtime.taskId, key: task.input.id },
            })

            return {
              status: 'sleeping',
              until: task.input.deadlineAt,
              signals: [SubmissionSettled.key(task.input.id)],
              checkpoint: { ...checkpoint, phase: 'wait', worktreePath, worktreeBranch } satisfies DelegationCheckpoint,
            }
          }, context)
        } catch (error) {
          await fail(options, task, runtime, error, context)
        }
      },

      async wait(task, runtime, context) {
        const checkpoint = task.state.checkpoint
        try {
          const settled = await runtime.readSignal(SubmissionSettled, task.input.id, context)
          if (settled === undefined || !('value' in settled)) {
            if (runtime.now() < task.input.deadlineAt) {
              await runtime.sleepUntil(task.input.deadlineAt, checkpoint, context)
              return
            }
            const child = await runtime.conversation(idFromNumber<ConversationId>(checkpoint.childConversationId), context)
            await child?.abort(context)
            throw new Error('the delegation timed out after 30 minutes')
          }

          const submission = settled.value
          if (submission.status !== 'done') {
            throw new Error(`the sub agent run ended without an answer: ${submission.reason}`)
          }
          if (submission.answer === undefined) throw new Error('the sub agent run settled without a final answer')
          const childContext = await runtime.context(
            idFromNumber<ConversationId>(checkpoint.childConversationId),
            context,
          )
          const result: DelegationResult = {
            text: answerText(childContext.entries.find((entry) => entry.id === submission.answer)),
            worktreePath: checkpoint.worktreePath,
            worktreeBranch: checkpoint.worktreeBranch,
          }
          await options.delegations.finish(task.input.id, 'done', result.text)
          await runtime.commit(() => ({
            status: 'terminal',
            outcome: { status: 'completed', result },
          }), context)
        } catch (error) {
          await fail(options, task, runtime, error, context)
        }
      },
    },

    async abort(task, runtime, context) {
      const conversationId = childId(task.state.checkpoint)
      if (conversationId !== undefined) {
        const child = await runtime.conversation(conversationId, context)
        await child?.abort(context)
      }
      await options.delegations.finish(task.input.id, 'failed', 'the delegation was aborted')
      await runtime.commit(() => ({
        status: 'terminal',
        outcome: { status: 'aborted', reason: 'the delegation was aborted' },
      }), context)
    },
  })

const checkpointOf = (
  checkpoint: JsonValue | undefined,
): { id: string; taskId: number; deadlineAt: number } | undefined => {
  if (typeof checkpoint !== 'object' || checkpoint === null || Array.isArray(checkpoint)) return undefined
  const id = checkpoint['id']
  const taskId = checkpoint['taskId']
  const deadlineAt = checkpoint['deadlineAt']

  return typeof id === 'string' && typeof taskId === 'number' && typeof deadlineAt === 'number'
    ? { id, taskId, deadlineAt }
    : undefined
}

const withWorktree = (result: DelegationResult): string => {
  if (result.worktreePath === null || result.worktreeBranch === null) return result.text

  return `${result.text}\n\nWorktree: ${result.worktreePath}\nBranch: ${result.worktreeBranch}`
}

const failedResult = (message: string, details?: { readonly [key: string]: JsonValue }): ToolExecutionResult => ({
  output: [{ type: 'text', text: message }],
  isError: true,
  ...(details === undefined ? {} : { details }),
})

/** Exported for focused replay tests; pi-durable invokes the same function through the registered tool. */
export const executeDelegate = async (
  args: DelegateInput,
  api: ToolExecutionApi,
  options: DelegateExtensionOptions,
  taskDefinition: ReturnType<typeof createDelegationTask>,
  context: Context,
): Promise<ToolExecutionResult | ToolPark> => {
  const thread = await options.threads.findByConversation(Number(api.conversationId))
  if (thread === undefined) return failedResult('the parent conversation is not a chat thread')
  const available = await options.subagents.callableBy(thread.agentId)
  const subagent = available.find((candidate) => candidate.id === args.subagentId)
  if (subagent === undefined) return failedResult('this sub agent is not callable by the parent agent')
  if (args.task.trim() === '') return failedResult('task must not be empty')
  const modelId = args.model ?? subagent.modelId
  if (!subagent.allowedModels.includes(modelId)) {
    return failedResult(
      `model ${modelId} is not allowed for sub agent ${subagent.name}. Allowed models: ${subagent.allowedModels.join(', ')}`,
    )
  }

  const previous = checkpointOf(api.checkpoint)
  // A replay before the first park has no checkpoint. The memo makes the external child task idempotent even then.
  const identity = previous ?? await api.memo<{ id: string; deadlineAt: number }>('cake-delegation', {
    id: randomUUID(),
    deadlineAt: api.now() + DELEGATION_TIMEOUT_MS,
  }, context)
  const id = identity.id
  const input: DelegationTaskInput = {
    id,
    parentThreadId: thread.id,
    parentConversationId: Number(api.conversationId),
    parentTaskId: Number(api.taskId),
    parentCallId: api.callId,
    subagentId: args.subagentId,
    task: args.task,
    modelId,
    thinkingLevel: args.thinkingLevel ?? subagent.thinkingLevel,
    worktree: args.worktree ?? false,
    ...(args.repoPath === undefined ? {} : { repoPath: args.repoPath }),
    deadlineAt: identity.deadlineAt,
  }
  const taskId = await api.createTask(taskDefinition, input, {
    ownership: { kind: 'task', taskId: api.taskId },
    key: 'delegation',
  }, context)
  const checkpoint = { id, taskId: Number(taskId), deadlineAt: input.deadlineAt }
  await api.details({
    delegationId: id,
    subagentId: args.subagentId,
    modelId,
    thinkingLevel: input.thinkingLevel,
    status: 'running',
  }, context)

  const settled = api.wake === undefined ? undefined : await api.getTask(taskId, context)
  if (settled?.state.status !== 'terminal') {
    return { wait: { on: [taskId], policy: 'allSettled', checkpoint } }
  }

  const outcome = settled.state.outcome
  if (outcome.status === 'completed') {
    await api.details({
      delegationId: id,
      subagentId: args.subagentId,
      status: 'done',
      worktreePath: outcome.result.worktreePath,
      worktreeBranch: outcome.result.worktreeBranch,
    }, context)

    return {
      output: [{ type: 'text', text: withWorktree(outcome.result) }],
      details: { delegationId: id, status: 'done', ...outcome.result },
    }
  }

  const message = outcome.status === 'failed' || outcome.status === 'faulted'
    ? outcome.error.message
    : outcome.status === 'aborted'
      ? outcome.reason ?? 'the delegation was aborted'
      : `the delegation could not resume: ${outcome.reason}`
  await options.delegations.finish(id, 'failed', message)

  return failedResult(message, { delegationId: id, subagentId: args.subagentId, status: 'failed' })
}

export const createDelegateExtension = (options: DelegateExtensionOptions) => {
  const task = createDelegationTask(options)
  const delegate = defineTool({
    name: 'delegate',
    description: 'Run one listed sub agent on a self-contained task and wait for its final result. Calls in one round run in parallel. The reminder after the user message lists the sub agents, their default and allowed models.',
    parameters,
    replay: 'safe',
    executionMode: 'parallel',
    async execute(args, api, context) {
      return executeDelegate(args as DelegateInput, api, options, task, context)
    },
  })

  // No section: the callable list belongs to the turn's reminder, rebuilt from live rows on every submission. A
  // section would be a second copy of the list in the system message, which is the copy that went stale.
  return defineExtension({
    name: 'delegate',
    tools: [delegate],
    tasks: [task],
  })
}
