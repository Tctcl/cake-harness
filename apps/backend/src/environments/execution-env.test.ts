import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { EnvTarget } from '@earendil-works/pi-durable'
import { describe, expect, it, vi } from 'vitest'

import { createExecutionEnvironment } from './execution-env.js'
import type { ExecutionEnvironmentOptions } from './execution-env.js'
import type { DevEnvironment } from './environment-repository.js'
import type { ChatThread } from '../threads/thread-repository.js'
import type { Workspace } from '../workspaces/workspace-repository.js'

const thread: ChatThread = {
  id: 'thread-1',
  title: null,
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  durableConversationId: 42,
  overrides: { credentialId: null, modelId: null, thinkingLevel: null },
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const workspace = (isDefault: boolean): Workspace => ({
  id: 'workspace-1',
  name: 'Workspace',
  description: '',
  isDefault,
  allowAll: true,
  archivedAt: null,
  position: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
})

const target = { conversationId: 42 } as EnvTarget

const options = (current: Workspace, attached: readonly DevEnvironment[]) => {
  const start = vi.fn()
  const ensure = vi.fn()
  const value: ExecutionEnvironmentOptions = {
    threads: { findByConversation: async (id) => id === 42 ? thread : undefined },
    workspaces: { find: async () => current },
    environments: {
      ofWorkspace: async () => [...attached],
      start,
    },
    installer: { ensure },
  }

  return { value, start, ensure }
}

const attachedEnvironment: DevEnvironment = {
  id: 'environment-1',
  name: 'General',
  image: 'cake-harness/dev-env:dev',
  containerId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

describe('createExecutionEnvironment', () => {
  it('returns undefined for General even with an environment, without starting its container', async () => {
    const { value, start, ensure } = options(workspace(true), [attachedEnvironment])
    const provider = createExecutionEnvironment(value)

    await expect(provider.open(target, BACKGROUND_CONTEXT)).resolves.toBeUndefined()
    expect(start).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
    await provider.close()
  })

  it('returns undefined for a workspace without an environment', async () => {
    const { value, start, ensure } = options(workspace(false), [])
    const provider = createExecutionEnvironment(value)

    await expect(provider.open(target, BACKGROUND_CONTEXT)).resolves.toBeUndefined()
    expect(start).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
    await provider.close()
  })

  it('returns undefined when the durable conversation is not filed as a thread', async () => {
    const { value } = options(workspace(false), [])
    const provider = createExecutionEnvironment(value)

    await expect(provider.open({ conversationId: 999 } as EnvTarget, BACKGROUND_CONTEXT)).resolves.toBeUndefined()
    await provider.close()
  })
})
