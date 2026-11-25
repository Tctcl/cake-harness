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
    expect(screen.getAllByText('Needs a workspace container')).toHaveLength(2)

    fireEvent.click(web)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const saved = calls.find((call) => call.method === 'PUT' && call.url === '/agents/agent-1/grants')
      expect(saved?.body).toEqual({ tools: ['read-id'], skills: ['skill-1'], mcpServers: ['server-1'] })
    })
  })
})
