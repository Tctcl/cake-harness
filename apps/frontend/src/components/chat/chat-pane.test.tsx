import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatPane } from './chat-pane.tsx'
import { STREAM_EVENT, resetThreads } from '../../lib/chat-store.ts'

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
      STREAM_EVENT,
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
      STREAM_EVENT,
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

    stream()?.emit(STREAM_EVENT, {
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

    stream()?.emit(STREAM_EVENT, frame([{ id: 11, role: 'user', text: 'hello there' }]))

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

  it('keeps a failed line where it was sent rather than at the bottom', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? reply({ error: { message: 'the agent is unavailable' } }, false)
          : reply({ messages: [], nextCursor: null }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    const sent = [
      { id: 4, role: 'assistant', text: 'the first answer' },
      { id: 5, role: 'user', text: 'a question' },
    ]
    stream()?.emit(STREAM_EVENT, frame(sent))
    await screen.findByText('a question')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'the failed follow-up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Not sent')).toBeInTheDocument()

    stream()?.emit(STREAM_EVENT, frame([...sent, { id: 6, role: 'assistant', text: 'a later answer' }]))
    await screen.findByText('a later answer')

    const transcript = screen.getByLabelText('Transcript').textContent ?? ''
    expect(transcript.indexOf('the failed follow-up')).toBeGreaterThan(transcript.indexOf('a question'))
    expect(transcript.indexOf('the failed follow-up')).toBeLessThan(transcript.indexOf('a later answer'))
  })

  it('does not show the working indicator for a line that never reached a run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? reply({ error: { message: 'the agent is unavailable' } }, false)
          : reply({ messages: [], nextCursor: null }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'still here' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('Not sent')).toBeInTheDocument()
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()

    stream()?.emit(STREAM_EVENT, {
      messages: [],
      tools: [],
      run: null,
      usage: NO_USAGE,
      live: { blocks: [], tools: [], turns: 0, compacting: 0, failure: null },
    })

    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
  })

  it('shows the working indicator while the live state says a run is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    stream()?.emit(STREAM_EVENT, {
      messages: [],
      tools: [],
      run: null,
      usage: NO_USAGE,
      live: { blocks: [], tools: [], turns: 1, compacting: 0, failure: null },
    })

    expect(await screen.findByText('Thinking…')).toBeInTheDocument()
  })

  it('says why a message was refused for want of a key, and offers the fix', async () => {
    const refusal = new Response(
      JSON.stringify({ error: { code: 'AGENT_NO_KEY', message: 'No OpenCode Go key reaches this agent.' } }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'POST' ? Promise.resolve(refusal) : reply({ messages: [], nextCursor: null }),
      ),
    )
    const onSetUpKeys = vi.fn()

    render(<ChatPane threadId={THREAD_ID} onSetUpKeys={onSetUpKeys} />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    expect(await screen.findByText(/No OpenCode Go key reaches this agent/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up a key' }))
    expect(onSetUpKeys).toHaveBeenCalledOnce()
  })

  it('asks for no conversation when no thread is selected', () => {
    render(<ChatPane threadId={null} />)

    expect(screen.getByText('No conversation open')).toBeInTheDocument()
  })
})
