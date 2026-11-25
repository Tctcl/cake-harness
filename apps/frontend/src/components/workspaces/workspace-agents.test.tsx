import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceAgents } from './workspace-agents.tsx'

const workspace = {
  id: 'workspace-1',
  name: 'General',
  description: '',
  isDefault: true,
  allowAll: true,
  position: 0,
}

const agent = {
  id: 'agent-1',
  workspaceId: workspace.id,
  name: 'General',
  description: 'Default profile',
  isDefault: true,
  allowAll: false,
  systemPromptAppend: 'Help.',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low' as const,
}

const tools = [
  { id: 'read-id', name: 'read', description: 'Read a file' },
  { id: 'write-id', name: 'write', description: 'Write a file' },
  { id: 'web-id', name: 'web_fetch', description: 'Fetch a page' },
]

afterEach(() => vi.unstubAllGlobals())

describe('WorkspaceAgents tools', () => {
  it('greys environment tools in General and saves agent grants', async () => {
    const calls: { url: string; method: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
      calls.push({ url, method, ...(body === undefined ? {} : { body }) })

      let result: unknown = {}
      if (url === '/workspaces/workspace-1/agents?archived=true') result = { agents: [] }
      else if (url === '/workspaces/workspace-1/agents') result = method === 'GET' ? { agents: [agent] } : agent
      else if (url === '/workspaces/workspace-1/agents/agent-1') result = agent
      else if (url === '/providers/logins') result = { logins: [{ id: 'key', label: 'Work' }] }
      else if (url === '/providers/models') result = { models: [] }
      else if (url === '/workspaces/workspace-1/providers') {
        result = { loginIds: ['key'], allowedModels: [], allowAllModels: true }
      } else if (url === '/tools') result = { tools }
      else if (url === '/agents/agent-1/grants') {
        result = method === 'GET'
          ? { tools: ['read-id', 'web-id'], skills: ['skill-1'], mcpServers: ['server-1'] }
          : body
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(result) })
    }))

    render(<WorkspaceAgents workspace={workspace} onOpenProviders={() => {}} />)

    const read = await screen.findByRole('checkbox', { name: 'read' })
    const write = screen.getByRole('checkbox', { name: 'write' })
    const web = screen.getByRole('checkbox', { name: 'web_fetch' })
    expect(read).toBeDisabled()
    expect(write).toBeDisabled()
    expect(web).toBeEnabled()
    expect(screen.getAllByText('Unavailable to General’s agent')).toHaveLength(2)

    fireEvent.click(web)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const saved = calls.find((call) => call.method === 'PUT' && call.url === '/agents/agent-1/grants')
      expect(saved?.body).toEqual({ tools: ['read-id'], skills: ['skill-1'], mcpServers: ['server-1'] })
    })
  })

  it('keeps showing the saved values after a save instead of the ones before it', async () => {
    let stored = { ...agent }
    let saved = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      let result: unknown = {}
      if (url === '/workspaces/workspace-1/agents?archived=true') result = { agents: [] }
      else if (url === '/workspaces/workspace-1/agents') {
        // The reload after a save takes a network round trip in the app; without it the stale list never shows.
        if (saved) await new Promise((resolve) => setTimeout(resolve, 100))
        result = { agents: [stored] }
      } else if (url === '/workspaces/workspace-1/agents/agent-1' && method === 'PATCH') {
        stored = { ...stored, ...(JSON.parse(String(init?.body)) as Partial<typeof agent>) }
        saved = true
        result = stored
      } else if (url === '/providers/logins') result = { logins: [{ id: 'key', label: 'Work' }] }
      else if (url === '/providers/models') result = { models: [] }
      else if (url === '/workspaces/workspace-1/providers') {
        result = { loginIds: ['key'], allowedModels: [], allowAllModels: true }
      } else if (url === '/tools') result = { tools }
      else if (url === '/agents/agent-1/grants') result = { tools: [], skills: [], mcpServers: [] }

      return { ok: true, status: 200, json: () => Promise.resolve(result) }
    }))

    render(<WorkspaceAgents workspace={workspace} onOpenProviders={() => {}} />)

    // Save refuses until the agent's tool grants have loaded, so wait for the tool list first.
    await screen.findByRole('checkbox', { name: 'web_fetch' })
    const description = screen.getByLabelText('Description')
    fireEvent.change(description, { target: { value: 'Answers anything' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(stored.description).toBe('Answers anything'))
    // Past the delayed reload: the editor must show what was saved, not what it held before.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await waitFor(() => expect(screen.getByLabelText('Description')).toHaveValue('Answers anything'))
  })
})
