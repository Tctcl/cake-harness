import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'

// xterm needs a real canvas and matchMedia, neither of which jsdom provides; the panel tests only the chrome.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    writeln() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

const GENERAL_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const OTHER_ID = '5d4e3f6a-7b8c-4d0e-9f1a-2b3c4d5e6f70'

const workspace = (id: string, name: string, description: string, isDefault: boolean, position: number) => ({
  id,
  name,
  description,
  isDefault,
  allowAll: true,
  position,
})

const workspaces = [
  workspace(GENERAL_ID, 'General', '', true, 0),
  workspace(OTHER_ID, 'Platform', 'This repository', false, 1),
]

const agents = [
  {
    id: 'ag1',
    workspaceId: GENERAL_ID,
    name: 'Generalist',
    description: 'The default profile',
    isDefault: true,
    allowAll: true,
    systemPromptAppend: '',
    instructions: '',
  },
]

const threads = [
  { id: 'a1', title: 'General chat', workspaceId: GENERAL_ID, agentId: 'ag1' },
  { id: 'b1', title: 'Platform chat', workspaceId: OTHER_ID, agentId: 'ag2' },
]

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

function stubBackend() {
  return vi.fn((path: string, init?: RequestInit) => {
    if (path === '/workspaces') return reply({ workspaces })
    // The whole order at once, and the answer is the list as the server stored it.
    if (path === '/workspaces/order') {
      const body = JSON.parse(String(init?.body)) as { order: string[] }

      return reply({
        workspaces: body.order.map((id, position) => ({
          ...workspaces.find((candidate) => candidate.id === id),
          position,
        })),
      })
    }
    // The sidebar asks which environment the agent works in; this workspace offers none, which is a valid state.
    if (path.endsWith('/environments')) return reply({ environments: [] })
    if (path.endsWith('/environment')) return reply({ environment: null })
    // Grants before the agent list: both live under /agents, and the panel reads them separately.
    if (path.endsWith('/grants')) {
      return reply({ tools: ['t1', 't2'], skills: [], mcpServers: [] })
    }
    if (path.includes('/subagents')) return reply({ subagents: [] })
    if (path.includes('/agents')) return reply({ agents })
    if (path.includes('/messages')) return reply({ messages: [], nextCursor: null })
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { title: string | null }

      return reply({ id: 'a1', title: body.title, workspaceId: GENERAL_ID, agentId: 'ag1' })
    }

    return reply({ threads })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('puts conversations on the left and the conversation info behind the topbar', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)

    expect(screen.getByRole('complementary', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.queryByText('topnav')).not.toBeInTheDocument()
    // Nothing is shown on the right until the topbar asks for something.
    expect(
      screen.queryByRole('complementary', { name: 'Conversation info' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation info' }))
    expect(
      screen.getByRole('complementary', { name: 'Conversation info' }),
    ).toBeInTheDocument()

    expect(await screen.findByText('General chat')).toBeInTheDocument()
    // Both workspaces are headings over their own conversations; there is no separate workspace selector.
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Platform' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('lists the conversations of every workspace under its own heading', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)

    expect(await screen.findByText('General chat')).toBeInTheDocument()
    expect(screen.getByText('Platform chat')).toBeInTheDocument()
  })

  it('folds a workspace shut and leaves the other groups alone', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    await screen.findByText('General chat')

    const general = screen.getByRole('button', { name: 'General' })
    fireEvent.click(general)

    expect(general).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('General chat')).not.toBeInTheDocument()
    expect(screen.getByText('Platform chat')).toBeInTheDocument()

    fireEvent.click(general)
    expect(await screen.findByText('General chat')).toBeInTheDocument()
  })

  it('saves the order a dragged workspace is dropped into', async () => {
    const backend = stubBackend()
    vi.stubGlobal('fetch', backend)

    render(<App />)
    await screen.findByText('General chat')

    const headings = () =>
      Array.from(document.querySelectorAll('[aria-controls^="sessions-of-"]')).map(
        (heading) => heading.textContent ?? '',
      )
    expect(headings()[0]).toMatch(/^General$/)

    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {} }
    // Onto the top half of the first heading: above it, which is where the list opens a gap.
    fireEvent.dragStart(screen.getByRole('button', { name: 'Platform' }).parentElement as Element, {
      dataTransfer,
    })
    fireEvent.dragOver(screen.getByRole('button', { name: 'General' }).parentElement as Element, {
      dataTransfer,
      clientY: 0,
    })
    fireEvent.drop(screen.getByRole('button', { name: 'General' }).parentElement as Element, {
      dataTransfer,
      clientY: 0,
    })

    await waitFor(() => expect(headings()[0]).toMatch(/^Platform$/))

    const put = backend.mock.calls.find((call) => call[1]?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ order: [OTHER_ID, GENERAL_ID] })
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

  it('names the agent of the open conversation in the info panel', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Conversation info' }))

    const panel = screen.getByRole('complementary', { name: 'Conversation info' })
    expect(await within(panel).findByText('Generalist')).toBeInTheDocument()
    expect(await within(panel).findByText('2 tools')).toBeInTheDocument()
  })

  it('renames the open conversation from the topbar', async () => {
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

    const topbar = screen.getByRole('banner')
    fireEvent.click(await within(topbar).findByRole('button', { name: 'Rename conversation' }))

    const input = within(topbar).getByRole('textbox', { name: 'Conversation title' })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.submit(input)

    await waitFor(() => expect(within(topbar).getByText('Renamed')).toBeInTheDocument())
  })

  it('keeps one panel at a time and closes it again from the same toggle', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    await screen.findByText('General chat')

    const info = screen.getByRole('button', { name: 'Conversation info' })
    fireEvent.click(info)
    expect(
      screen.getByRole('complementary', { name: 'Conversation info' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sub agents' }))
    expect(screen.queryByRole('complementary', { name: 'Conversation info' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Sub agents' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(screen.queryByRole('complementary', { name: 'Sub agents' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Terminal' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(screen.queryByRole('complementary', { name: 'Terminal' })).not.toBeInTheDocument()
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

  it('opens settings as a window over the chat rather than in place of it', async () => {
    vi.stubGlobal('fetch', stubBackend())

    render(<App />)
    await screen.findByText('General chat')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }))

    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    // The columns are still underneath: the window is over the chat, not instead of it.
    expect(screen.getByRole('complementary', { name: 'Conversations' })).toBeInTheDocument()
    expect(within(settings).getByRole('heading', { name: 'Application settings' })).toBeInTheDocument()

    fireEvent.click(within(settings).getByRole('button', { name: 'Close Settings' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('General chat')).toBeInTheDocument()
  })

  it('opens workspaces as a window and re-reads the lists when it closes', async () => {
    const backend = stubBackend()
    vi.stubGlobal('fetch', backend)

    render(<App />)
    await screen.findByText('General chat')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Workspaces' }))

    const workspacesWindow = await screen.findByRole('dialog', { name: 'Workspaces' })
    await within(workspacesWindow).findByRole('button', { name: /platform/i })

    const before = backend.mock.calls.length
    fireEvent.click(within(workspacesWindow).getByRole('button', { name: 'Close Workspaces' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Workspaces, agents and keys change there, so closing re-reads both lists.
    await waitFor(() => expect(backend.mock.calls.length).toBeGreaterThan(before))
  })
})
