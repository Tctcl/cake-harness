import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentCard } from './environment-card.tsx'
import type { DevEnvironment } from '../../lib/environment-api.ts'

const environment = (overrides: Partial<DevEnvironment> = {}): DevEnvironment => ({
  id: 'environment-1',
  name: 'Platform',
  image: 'cake-harness/dev-env:latest',
  tooling: [],
  containerId: 'container-1',
  sshPort: 22_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('EnvironmentCard', () => {
  it('shows what the running container uses and polls for it', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            cpuPercent: 12.5,
            memoryUsedBytes: 256 * 1024 * 1024,
            memoryLimitBytes: 1024 * 1024 * 1024,
            networkReceiveBytes: 0,
            networkTransmitBytes: 0,
            blockReadBytes: 0,
            blockWriteBytes: 0,
          }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<EnvironmentCard environment={environment()} onChanged={() => {}} />)

    expect(await screen.findByText('12.5%')).toBeInTheDocument()
    expect(screen.getByText('256.0 MiB / 1.0 GiB')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/environments/environment-1/metrics', undefined)
  })

  it('reads no numbers for a container that is not running', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<EnvironmentCard environment={environment({ containerId: null })} onChanged={() => {}} />)

    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts a stopped container and hands the new state back', async () => {
    const started = environment({ containerId: 'container-2' })
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started) }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    render(<EnvironmentCard environment={environment({ containerId: null })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(started))
    expect(fetchMock).toHaveBeenCalledWith('/environments/environment-1/start', { method: 'POST' })
  })

  it('keeps the previous state and reports why a stop failed', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: { message: 'the container is in use' } }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    render(<EnvironmentCard environment={environment()} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('the container is in use')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
