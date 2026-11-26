import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatSubagent } from '../../lib/subagent-api.ts'
import { WorkspaceSubagents } from './workspace-subagents.tsx'

const workspace = {
  id: 'workspace-1',
  name: 'Platform',
  description: '',
  isDefault: false,
  allowAll: true,
  position: 0,
}

const agents = [
  {
    id: 'agent-1',
    workspaceId: workspace.id,
    name: 'Builder',
    description: '',
    isDefault: true,
    allowAll: true,
    systemPromptAppend: '',
    instructions: '',
    credentialId: null,
    modelId: null,
    thinkingLevel: 'low' as const,
  },
  {
    id: 'agent-2',
    workspaceId: workspace.id,
    name: 'Reviewer parent',
    description: '',
    isDefault: false,
    allowAll: true,
    systemPromptAppend: '',
    instructions: '',
    credentialId: null,
    modelId: null,
    thinkingLevel: 'low' as const,
  },
]

const models = ['model-1', 'model-2', 'model-3'].map((id, index) => ({
  id,
  provider: 'opencode-go',
  name: `Model ${index + 1}`,
  contextWindow: 1000,
  maxOutput: 100,
  inputUsdPerMillion: null,
  outputUsdPerMillion: null,
  supportsReasoning: true,
  supportsTools: true,
}))

const tools = [
  { id: 'read-id', name: 'read', description: 'Read a file' },
  { id: 'ask-id', name: 'ask_user', description: 'Ask a person' },
  { id: 'delegate-id', name: 'delegate', description: 'Delegate again' },
]

const profile = (overrides: Partial<ChatSubagent> = {}): ChatSubagent => ({
  id: 'subagent-1',
  workspaceId: workspace.id,
  name: 'Reviewer',
  description: 'Review a change',
  allowAll: false,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId: 'model-1',
  thinkingLevel: 'high',
  allowedModels: ['model-1'],
  callableBy: ['agent-1'],
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const commonResponse = (url: string, stored: readonly ChatSubagent[]): unknown => {
  if (url === '/workspaces/workspace-1/agents?archived=true') return { agents: [] }
  if (url === '/workspaces/workspace-1/agents') return { agents }
  if (url === '/workspaces/workspace-1/subagents?archived=true') return { subagents: [] }
  if (url === '/workspaces/workspace-1/subagents') return { subagents: stored }
  if (url === '/providers/logins') return { logins: [{ id: 'key', label: 'Work' }] }
  if (url === '/providers/models') return { models }
  if (url === '/workspaces/workspace-1/providers') {
    return { loginIds: ['key'], allowedModels: models.map((model) => model.id), allowAllModels: false }
  }
  if (url === '/tools') return { tools }

  return undefined
}

afterEach(() => vi.unstubAllGlobals())

describe('WorkspaceSubagents', () => {
  it('creates with default and allowed models, callable agents, and no ask_user or delegate tools', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    let stored: ChatSubagent[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
      calls.push({ url, method, ...(body === undefined ? {} : { body }) })

      let result = commonResponse(url, stored)
      if (url === '/workspaces/workspace-1/subagents' && method === 'POST') {
        const created = profile(body as Partial<ChatSubagent>)
        stored = [created]
        result = created
      } else if (url === '/agents/subagent-1/grants') {
        result = method === 'GET' ? { tools: [], skills: [], mcpServers: [] } : body
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(result ?? {}) })
    }))

    render(<WorkspaceSubagents workspace={workspace} onOpenProviders={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New sub agent' }))

    const defaultModel = screen.getByRole('combobox', { name: 'Default model' })
    expect(defaultModel).toHaveValue('model-1')
    const firstAllowed = screen.getByRole('checkbox', { name: 'Allowed model Model 1' })
    expect(firstAllowed).toBeChecked()
    expect(firstAllowed).toBeDisabled()
    fireEvent.click(firstAllowed)
    expect(firstAllowed).toBeChecked()

    fireEvent.change(defaultModel, { target: { value: 'model-2' } })
    const secondAllowed = screen.getByRole('checkbox', { name: 'Allowed model Model 2' })
    expect(secondAllowed).toBeChecked()
    expect(secondAllowed).toBeDisabled()
    fireEvent.click(firstAllowed)
    expect(firstAllowed).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allowed model Model 3' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reviewer parent' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'All tools available here' }))
    expect(await screen.findByRole('checkbox', { name: 'read' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'ask_user' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'delegate' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'read' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Implementer' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Implement a scoped task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sub agent' }))

    await waitFor(() => {
      const created = calls.find((call) => call.url === '/workspaces/workspace-1/subagents' && call.method === 'POST')
      expect(created?.body).toEqual(expect.objectContaining({
        name: 'Implementer',
        description: 'Implement a scoped task',
        modelId: 'model-2',
        thinkingLevel: 'low',
        allowedModels: ['model-2', 'model-3'],
        callableBy: ['agent-2'],
      }))
    })
    await waitFor(() => {
      const grants = calls.find((call) => call.url === '/agents/subagent-1/grants' && call.method === 'PUT')
      expect(grants?.body).toEqual({ tools: ['read-id'], skills: [], mcpServers: [] })
    })
  })

  it('keeps the saved model, allowed models, callers and fields visible after reload', async () => {
    let stored = profile({ allowedModels: ['model-1', 'model-2'] })
    let saved = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = init?.method ?? 'GET'
      let result = commonResponse(url, [stored])
      if (url === '/workspaces/workspace-1/subagents' && saved) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        result = { subagents: [stored] }
      } else if (url === '/workspaces/workspace-1/subagents/subagent-1' && method === 'PATCH') {
        stored = { ...stored, ...(JSON.parse(String(init?.body)) as Partial<ChatSubagent>) }
        saved = true
        result = stored
      } else if (url === '/agents/subagent-1/grants') {
        result = { tools: ['read-id', 'ask-id', 'delegate-id'], skills: [], mcpServers: [] }
      }

      return { ok: true, status: 200, json: () => Promise.resolve(result ?? {}) }
    }))

    render(<WorkspaceSubagents workspace={workspace} onOpenProviders={() => {}} />)
    await screen.findByRole('checkbox', { name: 'read' })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Review the final diff' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Default model' }), { target: { value: 'model-2' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allowed model Model 3' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reviewer parent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(stored.description).toBe('Review the final diff'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('Review the final diff'))
    expect(screen.getByRole('combobox', { name: 'Default model' })).toHaveValue('model-2')
    expect(screen.getByRole('checkbox', { name: 'Allowed model Model 2' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Allowed model Model 2' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Allowed model Model 3' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Builder' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Reviewer parent' })).toBeChecked()
    expect(stored.callableBy).toEqual(['agent-1', 'agent-2'])
    expect(stored.allowedModels).toEqual(['model-2', 'model-1', 'model-3'])
  })
})
