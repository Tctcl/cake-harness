import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentEnvironment } from './agent-environment.tsx'

const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const AGENT_ID = '7f6e5d4c-3b2a-4f1e-8d9c-0a1b2c3d4e5f'
const NODE_ID = '11111111-2222-4333-8444-555555555555'
const GO_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa'

const environment = (id: string, name: string, running: boolean) => ({
  id,
  name,
  image: 'ghcr.io/tctcl/cake-harness/workspace:0.1.0',
  containerId: running ? 'abc123' : null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const node = environment(NODE_ID, 'Node', true)
const go = environment(GO_ID, 'Go', false)

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

function stubBackend(options: {
  attached?: readonly unknown[]
  current?: unknown
  onWrite?: (path: string, init?: RequestInit) => void
}) {
  return vi.fn((path: string, init?: RequestInit) => {
    options.onWrite?.(path, init)
    if (path === `/workspaces/${WORKSPACE_ID}/environments`) {
      return reply({ environments: options.attached ?? [node, go] })
    }

    return reply({ environment: options.current ?? null })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AgentEnvironment', () => {
  it('selects the environment the agent already works in', async () => {
    vi.stubGlobal(
      'fetch',
      stubBackend({ current: go }),
    )

    render(<AgentEnvironment workspaceId={WORKSPACE_ID} agentId={AGENT_ID} />)

    const select = screen.getByRole('combobox', { name: 'Agent environment' })
    await waitFor(() => expect(select).toHaveValue(GO_ID))
    expect(screen.getByRole('option', { name: 'Go (stopped)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Node' })).toBeInTheDocument()
  })

  it('puts an agent into an environment with a PUT', async () => {
    const onWrite = vi.fn()
    vi.stubGlobal('fetch', stubBackend({ onWrite }))

    render(<AgentEnvironment workspaceId={WORKSPACE_ID} agentId={AGENT_ID} />)

    const select = screen.getByRole('combobox', { name: 'Agent environment' })
    await screen.findByRole('option', { name: 'Node' })
    fireEvent.change(select, { target: { value: NODE_ID } })

    await waitFor(() => expect(select).toHaveValue(NODE_ID))
    expect(onWrite).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/agents/${AGENT_ID}/environment`,
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('takes an agent out of every environment with a DELETE', async () => {
    const onWrite = vi.fn()
    vi.stubGlobal('fetch', stubBackend({ current: node, onWrite }))

    render(<AgentEnvironment workspaceId={WORKSPACE_ID} agentId={AGENT_ID} />)

    const select = screen.getByRole('combobox', { name: 'Agent environment' })
    await waitFor(() => expect(select).toHaveValue(NODE_ID))
    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(select).toHaveValue(''))
    expect(onWrite).toHaveBeenCalledWith(
      `/workspaces/${WORKSPACE_ID}/agents/${AGENT_ID}/environment`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('restores the confirmed choice when the save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        if (path === `/workspaces/${WORKSPACE_ID}/environments`) {
          return reply({ environments: [node, go] })
        }
        if (init?.method === 'PUT') {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: { message: 'no' } }) })
        }

        return reply({ environment: null })
      }),
    )

    render(<AgentEnvironment workspaceId={WORKSPACE_ID} agentId={AGENT_ID} />)

    const select = screen.getByRole('combobox', { name: 'Agent environment' })
    await screen.findByRole('option', { name: 'Go (stopped)' })
    fireEvent.change(select, { target: { value: GO_ID } })

    expect(await screen.findByRole('alert')).toHaveTextContent('no')
    expect(select).toHaveValue('')
  })
})
