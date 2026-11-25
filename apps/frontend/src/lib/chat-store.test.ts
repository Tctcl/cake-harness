import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from './chat-api.ts'
import {
  loadOlder,
  mergeMessages,
  openThread,
  resetThreads,
  retry,
  send,
  snapshotOf,
  STREAM_EVENT,
} from './chat-store.ts'

const THREAD_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'

/** The smallest `EventSource` the store uses: a URL, a listener table, and an explicit frame emitter. */
class FakeStream {
  static readonly opened: FakeStream[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
  readonly url: string
  closed = false

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
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>)
    }
  }
}

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) })

const page = (messages: ChatMessage[], nextCursor: string | null = null) => ({ messages, nextCursor })

function stubBackend(pages: Record<string, { messages: ChatMessage[]; nextCursor: string | null }>) {
  return vi.fn((path: string) => {
    const cursor = new URL(path, 'http://localhost').searchParams.get('cursor')
    const body = pages[cursor ?? 'first']
    if (body === undefined) return reply({ messages: [], nextCursor: null })

    return reply(body)
  })
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeStream)
  FakeStream.opened.length = 0
})

afterEach(() => {
  resetThreads()
  vi.unstubAllGlobals()
})

describe('mergeMessages', () => {
  it('keeps older pages and lets the streamed window replace its own ids', () => {
    const older: ChatMessage = { id: 1, role: 'user', text: 'first' }
    const partial: ChatMessage = { id: 9, role: 'assistant', text: 'an' }
    const grown: ChatMessage = { id: 9, role: 'assistant', text: 'an answer' }

    const withOlder = mergeMessages([older], [partial])
    expect(withOlder.map((message) => message.id)).toEqual([1, 9])

    const regrown = mergeMessages(withOlder, [grown])
    expect(regrown).toEqual([older, grown])
  })

  it('ignores an empty window so a quiet stream does not clear the pane', () => {
    const messages: ChatMessage[] = [{ id: 3, role: 'user', text: 'kept' }]

    expect(mergeMessages(messages, [])).toEqual(messages)
  })
})

describe('chat store', () => {
  it('opens one stream per thread and keeps it across selections', () => {
    vi.stubGlobal('fetch', stubBackend({ first: page([]) }))

    openThread(THREAD_ID)
    openThread(THREAD_ID)

    expect(FakeStream.opened).toHaveLength(1)
  })

  it('loads the newest page, then the page above it', async () => {
    const fetchStub = stubBackend({
      first: page([{ id: 8, role: 'user', text: 'newest' }], 'above'),
      above: page([{ id: 4, role: 'user', text: 'older' }], 'start'),
    })
    vi.stubGlobal('fetch', fetchStub)

    openThread(THREAD_ID)
    await vi.waitFor(() => expect(snapshotOf(THREAD_ID).messages).toHaveLength(1))

    loadOlder(THREAD_ID)
    await vi.waitFor(() => expect(snapshotOf(THREAD_ID).messages).toHaveLength(2))

    expect(snapshotOf(THREAD_ID).messages.map((message) => message.text)).toEqual([
      'older',
      'newest',
    ])
    expect(snapshotOf(THREAD_ID).nextCursor).toBe('start')
  })

  it('shows a sent line at once and drops it when the stream carries the real entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'POST' ? reply({ submissionId: 'sub_1' }) : reply(page([])),
      ),
    )

    openThread(THREAD_ID)
    send(THREAD_ID, 'hello')
    expect(snapshotOf(THREAD_ID).pending).toHaveLength(1)

    const stream = FakeStream.opened[0]
    stream?.emit(STREAM_EVENT, {
      messages: [{ id: 12, role: 'user', text: 'hello' }],
    })

    expect(snapshotOf(THREAD_ID).pending).toHaveLength(0)
    expect(snapshotOf(THREAD_ID).messages).toEqual([{ id: 12, role: 'user', text: 'hello' }])
  })

  it('marks a failed send and re-sends the same line on retry', async () => {
    let attempts = 0
    const fetchStub = vi.fn((_path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply(page([]))

      attempts += 1
      return attempts === 1
        ? reply({ error: { message: 'the agent is unavailable' } }, false)
        : reply({ submissionId: 'sub_2' })
    })
    vi.stubGlobal('fetch', fetchStub)

    openThread(THREAD_ID)
    send(THREAD_ID, 'hello again')
    await vi.waitFor(() => expect(snapshotOf(THREAD_ID).pending[0]?.state).toBe('failed'))

    const localId = snapshotOf(THREAD_ID).pending[0]?.localId ?? 0
    retry(THREAD_ID, localId)

    await vi.waitFor(() => expect(snapshotOf(THREAD_ID).pending[0]?.state).toBe('sending'))
    expect(attempts).toBe(2)
    expect(snapshotOf(THREAD_ID).error).toBeNull()
  })
})
