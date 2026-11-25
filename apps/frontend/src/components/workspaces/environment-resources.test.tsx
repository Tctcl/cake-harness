import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentResources } from './environment-resources.tsx'

const sample = (
  cpuPercent: number,
  memoryUsedBytes: number,
  networkReceiveBytes: number,
  networkTransmitBytes: number,
  blockReadBytes: number,
  blockWriteBytes: number,
) => ({
  cpuPercent,
  memoryUsedBytes,
  memoryLimitBytes: 1024 * 1024 * 1024,
  networkReceiveBytes,
  networkTransmitBytes,
  blockReadBytes,
  blockWriteBytes,
})

const first = sample(10, 256 * 1024 * 1024, 1024, 0, 1024, 0)
const second = sample(20, 512 * 1024 * 1024, 3072, 4096, 10240, 6144)

const json = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('EnvironmentResources', () => {
  it('polls every two seconds, renders CPU and memory, and computes rates between samples', async () => {
    vi.useFakeTimers()
    const responses = [first, second]
    const fetchMock = vi.fn(() => json(responses.shift() ?? second))
    vi.stubGlobal('fetch', fetchMock)

    render(<EnvironmentResources environmentId="environment-1" />)
    await flush()

    expect(screen.getByText('10.0%')).toBeInTheDocument()
    expect(screen.getByText('256.0 MB / 1.0 GB')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'CPU usage' })).toHaveProperty('value', 10)
    expect(screen.getByRole('img', { name: 'CPU history' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Memory history' })).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(screen.getByText('20.0%')).toBeInTheDocument()
    expect(screen.getByText('512.0 MB / 1.0 GB')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB/s', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('2.0 KB/s')).toBeInTheDocument()
    expect(screen.getByText('4.5 KB/s')).toBeInTheDocument()
    expect(screen.getByText('3.0 KB/s')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/environments/environment-1/metrics', undefined)
  })

  it('stops polling when unmounted', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => json(first))
    vi.stubGlobal('fetch', fetchMock)

    const view = render(<EnvironmentResources environmentId="environment-1" />)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauses while the document is hidden and resumes with a fresh rate baseline', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => json(first))
    vi.stubGlobal('fetch', fetchMock)
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)

    render(<EnvironmentResources environmentId="environment-1" />)
    await flush()
    visibility.mockReturnValue(true)
    fireVisibilityChange()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue(false)
    fireVisibilityChange()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function fireVisibilityChange() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}
