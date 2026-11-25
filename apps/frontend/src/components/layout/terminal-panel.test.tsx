import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalPanel } from './terminal-panel.tsx'

const WORKSPACE_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'
const AGENT_ID = '9b8c7d6e-5f40-4321-8a9b-0c1d2e3f4a5b'
const ENVIRONMENT_ID = '7d3a2b44-8c1e-4f60-9a05-3b2c1d4e5f60'
const TERMINAL_ID = 'c4a9d0e2-1b3f-4a55-8e77-9f00aa11bb22'

const ROOT = `/workspaces/${WORKSPACE_ID}/environments/${ENVIRONMENT_ID}/terminals`

const terminal = {
  id: TERMINAL_ID,
  environmentId: ENVIRONMENT_ID,
  label: 'shell 1',
  createdAt: '2026-03-01T10:00:00.000Z',
  size: { cols: 80, rows: 24 },
  attached: false,
}

const json = (body: unknown, status = 200) =>
  Promise.resolve({ status, ok: status < 400, json: () => Promise.resolve(body) } as Response)

/** Long-lived terminal tabs must not fail a test on a socket that is only ever opened, so the emulator is stubbed too. */
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24

    loadAddon(): void {}
    open(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} }
    }
    write(): void {}
    writeln(): void {}
    resize(cols: number, rows: number): void {
      this.cols = cols
      this.rows = rows
    }
    dispose(): void {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}))

class FakeSocket {
  static readonly OPEN = 1
  readyState = FakeSocket.OPEN
  binaryType = 'blob'

  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

function backend(options: { environment?: unknown; terminals?: unknown[] } = {}) {
  const environment = options.environment === undefined ? { id: ENVIRONMENT_ID } : options.environment
  const terminals = options.terminals ?? []

  return vi.fn((path: string) => {
    if (path === `/workspaces/${WORKSPACE_ID}/agents/${AGENT_ID}/environment`) {
      return json({ environment })
    }
    if (path === ROOT) return json({ terminals })

    return json({}, 404)
  })
}

const renderPanel = () =>
  render(<TerminalPanel workspaceId={WORKSPACE_ID} agentId={AGENT_ID} />)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TerminalPanel', () => {
  it('lists the sessions the backend already has, oldest tab first', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', backend({ terminals: [terminal] }))

    renderPanel()

    const tab = await screen.findByRole('tab', { name: 'shell 1' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('No terminal session yet.')).toBeNull()
  })

  it('says so when the conversation has no environment', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', backend({ environment: null }))

    renderPanel()

    expect(await screen.findByText("This conversation's agent has no environment attached.")).toBeInTheDocument()
  })

  it('opens a session with the backend and makes it the active tab', async () => {
    const opened = { ...terminal, id: 'a1b2c3d4-0000-4111-8222-333344445555', label: 'shell 2' }
    const fetchStub = backend()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) =>
        init?.method === 'POST' ? json(opened, 201) : fetchStub(path),
      ),
    )

    renderPanel()
    await screen.findByText('No terminal session yet.')

    fireEvent.click(screen.getByRole('button', { name: 'New terminal session' }))

    const tab = await screen.findByRole('tab', { name: 'shell 2' })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('No terminal session yet.')).toBeNull()
  })

  it('closes through the backend and falls back to the tab that is left', async () => {
    const other = { ...terminal, id: 'a1b2c3d4-0000-4111-8222-333344445555', label: 'shell 2' }
    const deleted: string[] = []
    const fetchStub = backend({ terminals: [terminal, other] })
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          deleted.push(path)

          return json(undefined, 204)
        }

        return fetchStub(path)
      }),
    )

    renderPanel()
    await screen.findByRole('tab', { name: 'shell 2' })

    fireEvent.click(screen.getByRole('button', { name: 'Close shell 2' }))

    await waitFor(() => expect(deleted).toEqual([`${ROOT}/${other.id}`]))
    expect(screen.queryByRole('tab', { name: 'shell 2' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'shell 1' }).getAttribute('aria-selected')).toBe('true')
  })

  it('reports a backend that refuses to open another session', async () => {
    const fetchStub = backend()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? json({ error: { code: 'terminal_limit', message: 'eight terminals is the limit' } }, 409)
          : fetchStub(path),
      ),
    )

    renderPanel()
    await screen.findByText('No terminal session yet.')

    fireEvent.click(screen.getByRole('button', { name: 'New terminal session' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('eight terminals is the limit')
  })
})
