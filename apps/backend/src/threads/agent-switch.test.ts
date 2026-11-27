import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import type { FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'

import { chatMessages } from '../agent.js'
import type { AgentProfile } from '../agents/agent-repository.js'
import type { KeyCatalog, RunSettingsPatch, WorkspaceReach } from '../agents/run-settings.js'
import type { AgentSwitchStores } from './agent-switch.js'
import { AgentSwitchEntry, switchThreadAgent } from './agent-switch.js'
import type { ChatThread } from './thread-repository.js'

const CONTEXT = BACKGROUND_CONTEXT

const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const OTHER_WORKSPACE_ID = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c'
const BUILD_ID = '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f'
const REVIEWER_ID = '6e5f4071-8c9d-4e2f-8a3b-4c5d6e7f8091'
const KEY_ID = '7f6f5182-9dae-4f30-9b4c-5d6e7f809102'

const profile = (overrides: Partial<AgentProfile>): AgentProfile => ({
  id: BUILD_ID,
  kind: 'agent',
  workspaceId: WORKSPACE_ID,
  name: 'Build',
  description: '',
  isDefault: true,
  allowAll: true,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low',
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const threadOf = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f',
  title: null,
  titleSource: 'auto',
  autoTitleEntryId: null,
  workspaceId: WORKSPACE_ID,
  agentId: BUILD_ID,
  durableConversationId: 9,
  overrides: { credentialId: null, modelId: null, thinkingLevel: null },
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const reach: WorkspaceReach = { allowAll: false, loginIds: [KEY_ID], allowAllModels: false, allowedModels: ['kimi-k3'] }
const keys: KeyCatalog = { loginIds: [KEY_ID], modelIds: new Set(['kimi-k3', 'deepseek-v4.1-flash']) }

const setup = (options: {
  readonly thread?: ChatThread
  readonly agents?: readonly AgentProfile[]
  readonly reach?: WorkspaceReach
  readonly keys?: KeyCatalog
} = {}) => {
  let thread = options.thread ?? threadOf()
  const agents = options.agents ?? [
    profile({}),
    profile({ id: REVIEWER_ID, name: 'Reviewer', isDefault: false, systemPromptAppend: 'Review.' }),
  ]
  const recorded: { thread: ChatThread; agentName: string }[] = []
  const stores: AgentSwitchStores = {
    threads: {
      find: async (id) => (id === thread.id ? thread : undefined),
      async setAgent(id, agentId) {
        if (id !== thread.id) return undefined
        thread = { ...thread, agentId }

        return thread
      },
      async updateRunSettings(id, patch: RunSettingsPatch) {
        if (id !== thread.id) return undefined
        thread = { ...thread, overrides: { ...thread.overrides, ...patch } }

        return thread
      },
    },
    agents: { find: async (id) => agents.find((candidate) => candidate.id === id) },
    reachOf: async () => options.reach ?? reach,
    keyCatalog: async () => options.keys ?? keys,
    record: async (switched, agent) => {
      recorded.push({ thread: switched, agentName: agent.name })
    },
  }

  return { stores, recorded, thread: () => thread }
}

describe('switchThreadAgent', () => {
  it('points the conversation at the new agent and records one divider', async () => {
    const fixture = setup()

    const switched = await switchThreadAgent(fixture.stores, fixture.thread().id, REVIEWER_ID)

    expect(switched?.thread.agentId).toBe(REVIEWER_ID)
    expect(switched?.clearedOverrides).toEqual([])
    expect(fixture.recorded.map(({ agentName }) => agentName)).toEqual(['Reviewer'])
    // The row names the new agent before its divider is written, so the entry can never claim a switch that did not happen.
    expect(fixture.recorded[0]?.thread.agentId).toBe(REVIEWER_ID)
  })

  it('writes nothing when the conversation already runs that agent', async () => {
    const fixture = setup()

    const switched = await switchThreadAgent(fixture.stores, fixture.thread().id, BUILD_ID)

    expect(switched?.thread.agentId).toBe(BUILD_ID)
    expect(switched?.clearedOverrides).toEqual([])
    expect(fixture.recorded).toEqual([])
  })

  it('refuses an agent of another workspace, a sub agent, an archived agent and a malformed id', async () => {
    const fixture = setup({
      agents: [
        profile({}),
        profile({ id: REVIEWER_ID, name: 'Elsewhere', workspaceId: OTHER_WORKSPACE_ID }),
        profile({ id: '8a7b6c5d-4e3f-2a1b-9c8d-7e6f5a4b3c2d', name: 'Child', kind: 'subagent' }),
        profile({ id: '9b8c7d6e-5f4a-3b2c-8d9e-0f1a2b3c4d5e', name: 'Gone', archivedAt: new Date(1) }),
      ],
    })
    const threadId = fixture.thread().id

    await expect(switchThreadAgent(fixture.stores, threadId, REVIEWER_ID)).rejects.toMatchObject({
      code: 'AGENT_WORKSPACE_MISMATCH',
      statusCode: 400,
    })
    await expect(
      switchThreadAgent(fixture.stores, threadId, '8a7b6c5d-4e3f-2a1b-9c8d-7e6f5a4b3c2d'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND', statusCode: 404 })
    await expect(
      switchThreadAgent(fixture.stores, threadId, '9b8c7d6e-5f4a-3b2c-8d9e-0f1a2b3c4d5e'),
    ).rejects.toMatchObject({ code: 'AGENT_ARCHIVED', statusCode: 409 })
    await expect(
      switchThreadAgent(fixture.stores, threadId, 'not-an-agent-id'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' })
    expect(fixture.thread().agentId).toBe(BUILD_ID)
    expect(fixture.recorded).toEqual([])
  })

  it('refuses to switch a conversation the caller has not loaded', async () => {
    const fixture = setup()

    await expect(
      switchThreadAgent(fixture.stores, '00000000-0000-4000-8000-000000000000', REVIEWER_ID),
    ).resolves.toBeUndefined()
  })

  it('keeps the overrides that still hold and drops the ones the workspace no longer honours', async () => {
    const fixture = setup({
      thread: threadOf({
        overrides: { credentialId: 'a-key-that-left', modelId: 'kimi-k3', thinkingLevel: null },
      }),
    })

    const switched = await switchThreadAgent(fixture.stores, fixture.thread().id, REVIEWER_ID)

    expect(switched?.clearedOverrides).toEqual(['credentialId'])
    expect(switched?.thread.overrides).toEqual({ credentialId: null, modelId: 'kimi-k3', thinkingLevel: null })
    expect(fixture.recorded).toHaveLength(1)
  })

  it('reports a model the workspace stopped allowing and a level the run cannot use', async () => {
    const fixture = setup({
      thread: threadOf({
        // A row edited by hand: the column's check constraint is what normally keeps the level in its list.
        overrides: { credentialId: KEY_ID, modelId: 'retired-model', thinkingLevel: 'enormous' as never },
      }),
      keys: { loginIds: [KEY_ID], modelIds: new Set(['kimi-k3']) },
    })

    const switched = await switchThreadAgent(fixture.stores, fixture.thread().id, REVIEWER_ID)

    expect(switched?.clearedOverrides).toEqual(['modelId', 'thinkingLevel'])
    expect(switched?.thread.overrides).toEqual({ credentialId: KEY_ID, modelId: null, thinkingLevel: null })
  })

  it('reports a divider that could not be written instead of hiding it', async () => {
    const stores: AgentSwitchStores = {
      ...setup().stores,
      record: async () => {
        throw new Error('the harness is gone')
      },
    }

    await expect(switchThreadAgent(stores, threadOf().id, REVIEWER_ID)).rejects.toThrow('the harness is gone')
  })
})

describe('the switch divider in a conversation', () => {
  it('shows in the transcript and never reaches the model as a message', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'parent' }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const memory = new MemoryStorage()
    const harness = await Harness.open(memory, { models, registry: createRegistry() }, CONTEXT)
    try {
      const conversation = await harness.createConversation(
        {
          ownership: { kind: 'ownerless' },
          agent: { model: { provider: 'faux', modelId: 'parent' }, thinkingLevel: 'low', tools: [] },
        },
        CONTEXT,
      )
      await harness.commit(
        (tx) => tx.appendEntry(AgentSwitchEntry, conversation.id, {
          data: { agentId: REVIEWER_ID, agentName: 'Reviewer' },
        }),
        CONTEXT,
      )

      const asked: string[] = []
      const capture = (context: Parameters<FauxResponseFactory>[0]) => {
        for (const message of context.messages) {
          if (message.role !== 'user') continue
          asked.push(typeof message.content === 'string'
            ? message.content
            : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'))
        }

        return fauxAssistantMessage('done')
      }
      faux.setResponses([capture])
      await (await conversation.submit({ type: 'input', content: 'hello' }, CONTEXT)).wait(CONTEXT)

      // Display-only: the entry carries no `model`, so the request has no message the person did not write.
      expect(asked).toEqual(['hello'])
      const page = await conversation.entries({ order: 'ascending' }, 50, undefined, CONTEXT)
      const switchLines = chatMessages(page.items).filter((message) => message.role === 'switch')
      expect(switchLines).toEqual([
        {
          id: expect.any(Number) as number,
          role: 'switch',
          text: 'Reviewer',
          blocks: [],
          stopReason: null,
          errorMessage: null,
          reason: null,
        },
      ])
    } finally {
      await harness.close(CONTEXT)
      await memory.close(CONTEXT)
    }
  }, 20_000)
})
