import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatPane } from './chat-pane.tsx'
import { resetThreads } from '../../lib/chat-store.ts'

const THREAD_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'

/** The stream the pane opens: the store only needs a listener table and an explicit frame emitter. */
class FakeStream {
  static readonly opened: FakeStream[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

  constructor(_url: string) {
    FakeStream.opened.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  close(): void {}

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>)
    }
  }
}

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) })

const stream = () => FakeStream.opened[0]

const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }

/** A stream frame is the whole visible state, not just the lines: tools, model and spend travel with it. */
const frame = (messages: unknown[], tools: unknown[] = []) => ({
  messages,
  tools,
  run: null,
  usage: NO_USAGE,
})

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeStream)
  FakeStream.opened.length = 0
})

afterEach(() => {
  resetThreads()
  vi.unstubAllGlobals()
})

describe('ChatPane', () => {
  it('opens the thread, shows its newest page and follows the stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reply({
          messages: [{ id: 4, role: 'assistant', text: 'earlier answer' }],
          nextCursor: null,
        }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)

    expect(await screen.findByText('earlier answer')).toBeInTheDocument()

    stream()?.emit(
      'messages',
      frame([
        { id: 4, role: 'assistant', text: 'earlier answer' },
        { id: 5, role: 'user', text: 'a question' },
      ]),
    )

    expect(await screen.findByText('a question')).toBeInTheDocument()
  })

  it('shows the run tool calls under the reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ messages: [{ id: 4, role: 'assistant', text: 'done' }], nextCursor: null })),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await screen.findByText('done')

    stream()?.emit(
      'messages',
      frame(
        [{ id: 4, role: 'assistant', text: 'done' }],
        [
          {
            id: 'call_1',
            name: 'read',
            arguments: '{"path":"README.md"}',
            status: 'ok',
            result: '# tlabs',
            durationMs: 12,
          },
        ],
      ),
    )

    expect(await screen.findByText('read')).toBeInTheDocument()
    expect(screen.getByText('12 ms')).toBeInTheDocument()
  })

  it('shows reasoning, the partial answer and a running call while the run is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => {
      expect(stream()).toBeDefined()
    })

    stream()?.emit('messages', {
      messages: [],
      tools: [],
      run: null,
      usage: NO_USAGE,
      live: {
        blocks: [
          { type: 'thinking', text: 'weighing the two layouts', redacted: false },
          { type: 'text', text: 'the answer so far' },
          { type: 'toolCall', callId: 'call_9', name: 'grep', arguments: '{"pattern":"shimmer"}' },
        ],
        tools: [
          {
            id: 'call_9',
            name: 'grep',
            status: 'running',
            output: 'styles hit: .shimmer',
            droppedBytes: 0,
            droppedLines: 0,
            diagnostics: [],
          },
        ],
        turns: 1,
        compacting: 0,
        failure: null,
      },
    })

    expect(await screen.findByText('weighing the two layouts')).toBeInTheDocument()
    expect(await screen.findByText('the answer so far')).toBeInTheDocument()
    expect(screen.getByText('styles hit: .shimmer')).toBeInTheDocument()
  })

  it('shows a sent line immediately and replaces it with the stored entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? reply({ submissionId: 'sub_1' })
          : reply({ messages: [], nextCursor: null }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled())

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello there' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Sending')).toBeInTheDocument()
    expect(screen.getByText('hello there')).toBeInTheDocument()

    stream()?.emit('messages', frame([{ id: 11, role: 'user', text: 'hello there' }]))

    await waitFor(() => expect(screen.queryByText('Sending')).not.toBeInTheDocument())
    expect(screen.getByText('hello there')).toBeInTheDocument()
  })

  it('marks a failed send and sends it again on retry', async () => {
    let posts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) => {
        if (init?.method !== 'POST') return reply({ messages: [], nextCursor: null })

        posts += 1
        return posts === 1
          ? reply({ error: { message: 'the agent is unavailable' } }, false)
          : reply({ submissionId: 'sub_2' })
      }),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled())

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Not sent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByText('Not sent')).not.toBeInTheDocument())
    expect(posts).toBe(2)
  })

  it('asks for no conversation when no thread is selected', () => {
    render(<ChatPane threadId={null} />)

    expect(screen.getByText('No conversation yet')).toBeInTheDocument()
  })
})
