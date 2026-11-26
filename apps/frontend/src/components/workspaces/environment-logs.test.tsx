import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentLogs } from './environment-logs.tsx'

/** Stands in for the browser's EventSource: records what was opened and lets a test emit frames. */
class FakeStream {
  static readonly CLOSED = 2
  static opened: FakeStream[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
  readyState = 1
  closed = false

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeStream.opened.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  close(): void {
    this.closed = true
    this.readyState = FakeStream.CLOSED
  }

  emit(type: string, data: unknown): void {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data) } as MessageEvent<string>)
      }
    })
  }
}

beforeEach(() => {
  FakeStream.opened = []
  vi.stubGlobal('EventSource', FakeStream)
})
afterEach(() => vi.unstubAllGlobals())

describe('EnvironmentLogs', () => {
  it('follows the environment log and shows each line, stderr marked', () => {
    render(<EnvironmentLogs environmentId="env-1" />)

    const stream = FakeStream.opened[0]
    expect(stream?.url).toBe('/environments/env-1/logs')
    stream?.emit('line', { stream: 'stdout', at: '2026-11-26T00:00:00Z', text: 'bootstrap.start' })
    stream?.emit('line', { stream: 'stderr', at: null, text: 'cannot read manifest: 401 Unauthorized' })

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('bootstrap.start')).toBeInTheDocument()
    const failure = screen.getByText('cannot read manifest: 401 Unauthorized')
    expect(failure.closest('div')).toHaveClass('text-destructive')
  })

  it('closes the stream when the container stops, and follows again on request', () => {
    render(<EnvironmentLogs environmentId="env-1" />)
    const first = FakeStream.opened[0]
    first?.emit('line', { stream: 'stdout', at: null, text: 'last words' })
    first?.emit('end', {})

    expect(first?.closed).toBe(true)
    expect(screen.getByText('The container stopped; the log ended.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Follow again' }))

    expect(FakeStream.opened).toHaveLength(2)
    // The new follow starts with Docker's tail again, so the old rows are cleared rather than repeated.
    expect(screen.queryByText('last words')).toBeNull()
  })

  it('closes the stream while paused and reopens it on resume', () => {
    render(<EnvironmentLogs environmentId="env-1" />)
    const first = FakeStream.opened[0]

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(first?.closed).toBe(true)
    expect(screen.getByText('Paused')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(FakeStream.opened).toHaveLength(2)
    expect(FakeStream.opened[1]?.closed).toBe(false)
  })

  it('ignores a frame that is not a log line', () => {
    render(<EnvironmentLogs environmentId="env-1" />)
    FakeStream.opened[0]?.emit('line', { nonsense: true })

    expect(screen.getByText('No output yet.')).toBeInTheDocument()
  })
})
