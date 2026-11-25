import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EnvironmentStatus } from '../../lib/environment-api.ts'
import { WorkspaceEnvironmentPanel } from './workspace-environment.tsx'

const ENVIRONMENT_ID = 'environment-1'
const WORKSPACE_ID = 'workspace-1'

const environment = {
  id: ENVIRONMENT_ID,
  name: 'General',
  image: 'cake-harness/dev-env:latest',
  containerId: 'container-1',
  sshPort: 2222,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const metrics = {
  cpuPercent: 10,
  memoryUsedBytes: 256 * 1024 * 1024,
  memoryLimitBytes: 1024 * 1024 * 1024,
  networkReceiveBytes: 0,
  networkTransmitBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
}

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)

function backend(initialStatus: EnvironmentStatus = 'stopped', exposed = false) {
  let status = initialStatus

  return vi.fn((path: string, init?: RequestInit) => {
    if (path === `/workspaces/${WORKSPACE_ID}/environments`) return json({ environments: [environment] })
    if (path === `/environments/${ENVIRONMENT_ID}/metrics`) return json(metrics)
    if (path === `/environments/${ENVIRONMENT_ID}/ssh`) {
      return json(exposed && status === 'running'
        ? { host: 'dev.example', port: 2222, user: 'dev', command: 'ssh -p 2222 dev@dev.example', running: true }
        : null)
    }
    if (path === `/environments/${ENVIRONMENT_ID}/ports`) return json({ ports: [] })
    if (path === '/account/ssh-keys') return json({ keys: [] })
    if (path === `/environments/${ENVIRONMENT_ID}/start` && init?.method === 'POST') {
      status = 'running'
      return json(environment)
    }
    if (path === `/environments/${ENVIRONMENT_ID}/stop` && init?.method === 'POST') {
      status = 'stopped'
      return json(environment)
    }
    if (path === `/environments/${ENVIRONMENT_ID}`) return json({ ...environment, status })

    return json({ error: { message: `unexpected ${path}` } }, 404)
  })
}

const renderPanel = (onOpenTerminal = () => {}, isDefault = false) =>
  render(
    <WorkspaceEnvironmentPanel
      workspaceId={WORKSPACE_ID}
      workspaceName="My Workspace"
      isDefault={isDefault}
      onOpenSshKeys={() => {}}
      onOpenTerminal={onOpenTerminal}
    />,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('WorkspaceEnvironmentPanel', () => {
  it('renders status and starts and stops the container through the API', async () => {
    const fetchMock = backend()
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/environments/${ENVIRONMENT_ID}/start`, { method: 'POST' })

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/environments/${ENVIRONMENT_ID}/stop`, { method: 'POST' })
  })

  it('renders a missing container and offers to create it with Start', async () => {
    vi.stubGlobal('fetch', backend('missing'))
    renderPanel()

    expect(await screen.findByText('Missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('restarts by stopping before starting', async () => {
    const fetchMock = backend('running')
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }))
    await waitFor(() => {
      const actions = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([path]) => path)
      expect(actions).toEqual([
        `/environments/${ENVIRONMENT_ID}/stop`,
        `/environments/${ENVIRONMENT_ID}/start`,
      ])
    })
  })

  it('shows the SSH config block and opens the Remote-SSH target', async () => {
    vi.stubGlobal('fetch', backend('running', true))
    renderPanel()

    expect(await screen.findByText('dev.example')).toBeInTheDocument()
    expect(screen.getByText('2222')).toBeInTheDocument()
    expect(screen.getByText('dev', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText(/Host cake-my-workspace/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in VS Code' })).toHaveAttribute(
      'href',
      'vscode://vscode-remote/ssh-remote+cake-my-workspace/home/dev/workspace',
    )
  })

  it('shows the tooling placeholder when the container has no SSH data', async () => {
    vi.stubGlobal('fetch', backend())
    renderPanel(() => {}, true)

    expect(await screen.findByText('SSH is not available for this container.')).toBeInTheDocument()
    expect(screen.getByText(/General’s agent never uses this container directly/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tooling — coming next' })).toBeInTheDocument()
  })

  it('opens the terminal for this workspace through the callback', async () => {
    vi.stubGlobal('fetch', backend())
    const onOpenTerminal = vi.fn()
    renderPanel(onOpenTerminal)

    fireEvent.click(await screen.findByRole('button', { name: 'Open terminal' }))
    expect(onOpenTerminal).toHaveBeenCalledWith(WORKSPACE_ID)
  })
})
