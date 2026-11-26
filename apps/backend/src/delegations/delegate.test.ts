import { setTimeout as delay } from 'node:timers/promises'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'
import type { FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import type { Storage } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'

import { readDelegationUpdate } from '../agent.js'
import type { AgentProfile, ThinkingLevel } from '../agents/agent-repository.js'
import { createSubagentCakeExtension } from '../agents/cake-extension.js'
import type { ChatThread } from '../threads/thread-repository.js'
import type { CallableSubagent } from '../subagents/subagent-repository.js'
import type { DelegationRecord, StartDelegation } from './delegation-repository.js'
import { createDelegateExtension, delegatePrompt } from './delegate.js'
import type { DelegateExtensionOptions } from './delegate.js'

const CONTEXT = BACKGROUND_CONTEXT
const PARENT_AGENT_ID = '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f'
const SUBAGENT_ID = '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80'
const THREAD_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'
const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'

const callable: CallableSubagent = {
  id: SUBAGENT_ID,
  name: 'Reviewer',
  description: 'Reviews one focused task',
  modelId: 'default',
  thinkingLevel: 'medium',
  allowedModels: ['default', 'other'],
}

const profile: AgentProfile = {
  id: SUBAGENT_ID,
  kind: 'subagent',
  workspaceId: WORKSPACE_ID,
  name: callable.name,
  description: callable.description,
  isDefault: false,
  allowAll: false,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId: callable.modelId,
  thinkingLevel: callable.thinkingLevel,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

/** MemoryStorage is retained across Harness close/open; only the harness's own close is intercepted. */
const persistentMemory = (): { storage: Storage; close: () => Promise<void> } => {
  const memory = new MemoryStorage()
  const storage = new Proxy(memory, {
    get(target, property, receiver) {
      if (property === 'close') return async () => undefined
      const value: unknown = Reflect.get(target, property, receiver)

      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  return { storage, close: async () => memory.close(CONTEXT) }
}

const setup = async () => {
  const faux = fauxProvider({
    provider: 'faux',
    models: [{ id: 'parent' }, { id: 'default' }, { id: 'other' }],
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const registry = createRegistry()
  const subagentPrompt = createSubagentCakeExtension(async () => 'subagent global prompt')
  registry.install(subagentPrompt)
  const records = new Map<string, DelegationRecord>()
  const runSettingsCalls: { modelId: string; thinkingLevel: ThinkingLevel }[] = []
  let parentConversationId = 0
  const thread = (): ChatThread => ({
    id: THREAD_ID,
    title: null,
    titleSource: 'auto',
    autoTitleEntryId: null,
    workspaceId: WORKSPACE_ID,
    agentId: PARENT_AGENT_ID,
    durableConversationId: parentConversationId,
    overrides: { credentialId: null, modelId: null, thinkingLevel: null },
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
  const options: DelegateExtensionOptions = {
    threads: { findByConversation: async (id) => id === parentConversationId ? thread() : undefined },
    agents: { find: async (id) => id === SUBAGENT_ID ? profile : undefined },
    subagents: { callableBy: async (agentId) => agentId === PARENT_AGENT_ID ? [callable] : [] },
    delegations: {
      async start(input: StartDelegation) {
        records.set(input.id, {
          ...input,
          subagentName: callable.name,
          status: 'running',
          resultSummary: null,
          startedAt: records.get(input.id)?.startedAt ?? new Date(0),
          finishedAt: null,
        })
      },
      async finish(id, status, resultSummary) {
        const current = records.get(id)
        if (current === undefined) return
        records.set(id, { ...current, status, resultSummary, finishedAt: new Date(1) })
      },
    },
    toolSelection: async () => ({ extensions: [subagentPrompt], tools: [] }),
    runSettings: async (_profile, modelId, thinkingLevel) => {
      runSettingsCalls.push({ modelId, thinkingLevel })

      return { model: { provider: 'faux', modelId }, thinkingLevel, credentialId: 'credential' }
    },
  }
  const extension = createDelegateExtension(options)
  registry.install(extension)
  const persisted = persistentMemory()
  const open = (): Promise<Harness> => Harness.open(persisted.storage, { models, registry }, CONTEXT)
  const harness = await open()
  const parent = await harness.createConversation({
    ownership: { kind: 'ownerless' },
    agent: {
      model: { provider: 'faux', modelId: 'parent' },
      thinkingLevel: 'low',
      extensions: [extension],
      tools: extension.tools ?? [],
    },
  }, CONTEXT)
  parentConversationId = Number(parent.id)

  return { faux, options, records, runSettingsCalls, open, harness, parent, closeStorage: persisted.close }
}

const parentResponse = (
  context: Parameters<FauxResponseFactory>[0],
  calls: ReturnType<typeof fauxToolCall> | ReturnType<typeof fauxToolCall>[],
) => context.messages.some((message) => message.role === 'toolResult')
  ? fauxAssistantMessage('parent finished')
  : fauxAssistantMessage(calls, { stopReason: 'toolUse' })

const firstRecord = (records: Map<string, DelegationRecord>): DelegationRecord => {
  const record = records.values().next().value
  if (record === undefined) throw new Error('no delegation was registered')

  return record
}

describe('delegatePrompt', () => {
  it('lists names, descriptions, defaults and allowed models and discourages casual overrides', () => {
    const prompt = delegatePrompt([callable])

    expect(prompt).toContain('Reviewer')
    expect(prompt).toContain('Reviews one focused task')
    expect(prompt).toContain('Default model: default')
    expect(prompt).toContain('default thinking level: medium')
    expect(prompt).toContain('allowed models: default, other')
    expect(prompt).toContain('only with good reason')
  })
})

describe('delegate with real in-memory pi-durable storage', () => {
  it('uses the subagent default model and returns the child answer plus stream projection', async () => {
    const fixture = await setup()
    try {
      fixture.faux.setResponses([
        (context) => parentResponse(
          context,
          fauxToolCall('delegate', { subagentId: SUBAGENT_ID, task: 'Review it' }, { id: 'call-1' }),
        ),
        (_context, _options, _state, model) => fauxAssistantMessage(`answer from ${model.id}`),
        () => fauxAssistantMessage('parent finished'),
      ])
      const submission = await fixture.parent.submit({ type: 'input', content: 'start' }, CONTEXT)

      const settled = await submission.wait(CONTEXT)
      if (settled.status !== 'done') throw new Error(JSON.stringify(settled))
      expect(fixture.runSettingsCalls).toEqual([{ modelId: 'default', thinkingLevel: 'medium' }])
      expect(firstRecord(fixture.records)).toMatchObject({ status: 'done', resultSummary: 'answer from default' })
      const update = await readDelegationUpdate(fixture.harness, firstRecord(fixture.records))
      expect(update).toMatchObject({
        subagentName: 'Reviewer',
        status: 'done',
        worktreePath: null,
        worktreeBranch: null,
      })
      expect(update.messages.map((message) => message.text)).toContain('answer from default')
    } finally {
      await fixture.harness.close(CONTEXT)
      await fixture.closeStorage()
    }
  }, 15_000)

  it('accepts an allowed model and thinking-level override', async () => {
    const fixture = await setup()
    try {
      fixture.faux.setResponses([
        (context) => parentResponse(context, fauxToolCall('delegate', {
          subagentId: SUBAGENT_ID,
          task: 'Reason deeply',
          model: 'other',
          thinkingLevel: 'high',
        })),
        (_context, _options, _state, model) => fauxAssistantMessage(`answer from ${model.id}`),
        () => fauxAssistantMessage('parent finished'),
      ])
      const submission = await fixture.parent.submit({ type: 'input', content: 'start' }, CONTEXT)

      await expect(submission.wait(CONTEXT)).resolves.toMatchObject({ status: 'done' })
      expect(fixture.runSettingsCalls).toEqual([{ modelId: 'other', thinkingLevel: 'high' }])
      expect(firstRecord(fixture.records).resultSummary).toBe('answer from other')
    } finally {
      await fixture.harness.close(CONTEXT)
      await fixture.closeStorage()
    }
  }, 15_000)

  it('refuses a non-allowed model with a clear tool error and starts no child', async () => {
    const fixture = await setup()
    try {
      fixture.faux.setResponses([
        (context) => parentResponse(context, fauxToolCall('delegate', {
          subagentId: SUBAGENT_ID,
          task: 'Use a forbidden model',
          model: 'forbidden',
        })),
        () => fauxAssistantMessage('parent finished'),
      ])
      const submission = await fixture.parent.submit({ type: 'input', content: 'start' }, CONTEXT)

      await expect(submission.wait(CONTEXT)).resolves.toMatchObject({ status: 'done' })
      expect(fixture.runSettingsCalls).toEqual([])
      expect(fixture.records.size).toBe(0)
      const entries = await fixture.parent.entries({ order: 'ascending' }, 100, undefined, CONTEXT)
      const toolResult = entries.items.flatMap((entry) => entry.model ?? []).find((message) => message.role === 'toolResult')
      expect(toolResult).toMatchObject({ isError: true })
      expect(JSON.stringify(toolResult)).toContain('Allowed models: default, other')
    } finally {
      await fixture.harness.close(CONTEXT)
      await fixture.closeStorage()
    }
  }, 15_000)

  it('runs two delegations from one parent turn concurrently', async () => {
    const fixture = await setup()
    let active = 0
    let maximum = 0
    try {
      const childAnswer = async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await delay(60)
        active -= 1

        return fauxAssistantMessage('parallel answer')
      }
      fixture.faux.setResponses([
        (context) => parentResponse(context, [
          fauxToolCall('delegate', { subagentId: SUBAGENT_ID, task: 'first' }, { id: 'first' }),
          fauxToolCall('delegate', { subagentId: SUBAGENT_ID, task: 'second' }, { id: 'second' }),
        ]),
        childAnswer,
        childAnswer,
        () => fauxAssistantMessage('parent finished'),
      ])
      const submission = await fixture.parent.submit({ type: 'input', content: 'start both' }, CONTEXT)

      await expect(submission.wait(CONTEXT)).resolves.toMatchObject({ status: 'done' })
      expect(maximum).toBe(2)
      expect(fixture.records.size).toBe(2)
      expect([...fixture.records.values()].every((record) => record.status === 'done')).toBe(true)
    } finally {
      await fixture.harness.close(CONTEXT)
      await fixture.closeStorage()
    }
  }, 15_000)

  it('reattaches the parked parent to the child task after a Harness restart', async () => {
    const fixture = await setup()
    let harness = fixture.harness
    let childCalls = 0
    let announceFirstChild = (): void => {}
    const firstChild = new Promise<void>((resolve) => { announceFirstChild = resolve })
    try {
      const childAnswer = async (_context: Parameters<FauxResponseFactory>[0], options: Parameters<FauxResponseFactory>[1]) => {
        childCalls += 1
        if (childCalls === 1) {
          announceFirstChild()
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted === true) {
              resolve()
              return
            }
            options?.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
        }

        return fauxAssistantMessage('answer after restart')
      }
      fixture.faux.setResponses([
        (context) => parentResponse(
          context,
          fauxToolCall('delegate', { subagentId: SUBAGENT_ID, task: 'survive restart' }),
        ),
        childAnswer,
        childAnswer,
        () => fauxAssistantMessage('parent finished'),
      ])
      const submission = await fixture.parent.submit({ type: 'input', content: 'start' }, CONTEXT)
      await firstChild
      await harness.close(CONTEXT)

      harness = await fixture.open()
      harness.resume()
      const resumed = await harness.submission(submission.id, CONTEXT)
      if (resumed === undefined) throw new Error('the parent submission disappeared on restart')
      await expect(resumed.wait(CONTEXT)).resolves.toMatchObject({ status: 'done' })
      expect(childCalls).toBeGreaterThanOrEqual(2)
      expect(firstRecord(fixture.records)).toMatchObject({ status: 'done', resultSummary: 'answer after restart' })
    } finally {
      await harness.close(CONTEXT)
      await fixture.closeStorage()
    }
  }, 20_000)
})
