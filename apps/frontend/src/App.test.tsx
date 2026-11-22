import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'

const GENERAL_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const OTHER_ID = '5d4e3f6a-7b8c-4d0e-9f1a-2b3c4d5e6f70'

const workspace = (id: string, name: string, description: string, isDefault: boolean) => ({
  id,
  name,
  description,
  isDefault,
  container: null,
  allowedTools: [],
  allowedMcpServers: [],
  allowedSkills: [],
})

const workspaces = [
  workspace(GENERAL_ID, 'General', '', true),
  workspace(OTHER_ID, 'Platform', 'This repository', false),
]

const agents = [
  {
    id: 'ag1',
    workspaceId: GENERAL_ID,
    name: 'Generalist',
    description: 'The default profile',
    isDefault: true,
    allowAll: true,
    systemPrompt: '',
    instructions: '',
  },
]

const threads = {
  [GENERAL_ID]: [{ id: 'a1', title: 'General chat', workspaceId: GENERAL_ID, agentId: 'ag1' }],
  [OTHER_ID]: [{ id: 'b1', title: 'Platform chat', workspaceId: OTHER_ID, agentId: 'ag2' }],
}

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

function stubBackend() {
  return vi.fn((path: string, init?: RequestInit) => {
    if (path === '/workspaces') return reply({ workspaces })
    // Grants before the agent list: both live under /agents, and the panel reads them separately.
    if (path.endsWith('/grants')) {
      return reply({ tools: ['t1', 't2'], prompts: [], skills: [], mcpServers: [] })
    }
    if (path.includes('/agents')) return reply({ agents })
    if (path.includes('/messages')) return reply({ messages: [], nextCursor: null })
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { title: string | null }

      return reply({ id: 'a1', title: body.title, workspaceId: GENERAL_ID, agentId: 'ag1' })
    }

    const workspaceId = new URL(path, 'http://localhost').searchParams.get('workspaceId')
    const listed = threads[workspaceId as keyof typeof threads] ?? []

    return reply({ threads: listed })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('puts conversations on the left and the conversation info on the right, with no top nav', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)

    expect(screen.getByRole('complementary', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Conversation' })).toBeInTheDocument()
    expect(screen.queryByText('topnav')).not.toBeInTheDocument()

    expect(await screen.findByText('General chat')).toBeInTheDocument()
    // The workspace lives in the picker at the foot of the left sidebar, not in a sidebar of its own.
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveTextContent('General')
  })

  it('lists only the selected workspace conversations', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    expect(await screen.findByText('General chat')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    const search = await screen.findByRole('textbox', { name: 'Find a workspace' })
    fireEvent.change(search, { target: { value: 'plat' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(await screen.findByText('Platform chat')).toBeInTheDocument()
    expect(screen.queryByText('General chat')).not.toBeInTheDocument()
  })

  it('shows the search field as soon as the picker opens', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    await screen.findByText('General chat')

    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Find a workspace' })).toHaveFocus(),
    )
  })

  it('opens a conversation in the main area', async () => {
    vi.stubGlobal('fetch', stubBackend())
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    )

    render(<App />)
    fireEvent.click(await screen.findByText('General chat'))

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Transcript' })).toBeInTheDocument(),
    )
  })

  it('names the agent of the open conversation in the right sidebar', async () => {
    vi.stubGlobal('fetch', stubBackend())
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    )

    render(<App />)
    fireEvent.click(await screen.findByText('General chat'))

    const sidebar = screen.getByRole('complementary', { name: 'Conversation' })
    expect(await within(sidebar).findByText('Generalist')).toBeInTheDocument()
    expect(await within(sidebar).findByText('2 tools')).toBeInTheDocument()
  })

  it('renames the open conversation from the right sidebar', async () => {
    vi.stubGlobal('fetch', stubBackend())
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    )

    render(<App />)
    fireEvent.click(await screen.findByText('General chat'))

    const sidebar = screen.getByRole('complementary', { name: 'Conversation' })
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'Rename conversation' }))

    const input = within(sidebar).getByRole('textbox', { name: 'Conversation title' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.submit(input)

    await waitFor(() => expect(within(sidebar).getByText('Renamed')).toBeInTheDocument())
  })

  it('collapses a sidebar to a rail and restores it', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    await screen.findByText('General chat')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Conversations' }))
    expect(screen.queryByRole('complementary', { name: 'Conversations' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Conversations' }))
    expect(screen.getByRole('complementary', { name: 'Conversations' })).toBeInTheDocument()
  })
})
