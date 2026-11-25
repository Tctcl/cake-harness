import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '../../lib/chat-api.ts'
import { ChatPane } from './chat-pane.tsx'
import { STREAM_EVENT, resetThreads } from '../../lib/chat-store.ts'

vi.mock('../../lib/chat-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chat-api.ts')>()

  return {
    ...actual,
    readThread: async () => ({
      id: '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f',
      title: 'First',
      workspaceId: '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e',
      agentId: '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f',
      overrides: { credentialId: null, modelId: null, thinkingLevel: null },
    }),
    getWorkspace: async () => ({
      id: '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e',
      name: 'General',
      description: '',
      isDefault: false,
      allowAll: false,
      position: 0,
    }),
    listAgents: async () => [
      {
        id: '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f',
        workspaceId: '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e',
        name: 'General',
        description: '',
        isDefault: true,
        allowAll: true,
        systemPrompt: '',
        instructions: '',
        credentialId: null,
        modelId: null,
        thinkingLevel: 'low',
      },
    ],
  }
})

vi.mock('../../lib/provider-api.ts', () => ({
  listProviderLogins: async () => [
    { id: 'key-1', provider: 'opencode-go', label: 'Work key', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  listProviderModels: async () => [
    {
      id: 'deepseek-v4.1-flash',
      provider: 'opencode-go',
      name: 'DeepSeek Flash',
      contextWindow: 1000,
      maxOutput: 100,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      supportsReasoning: true,
      supportsTools: true,
    },
    {
      id: 'kimi-k3',
      provider: 'opencode-go',
      name: 'Kimi K3',
      contextWindow: 1000,
      maxOutput: 100,
      inputUsdPerMillion: null,
      outputUsdPerMillion: null,
      supportsReasoning: true,
      supportsTools: true,
    },
  ],
  getWorkspaceProviders: async () => ({
    loginIds: ['key-1'],
    allowedModels: ['deepseek-v4.1-flash', 'kimi-k3'],
    allowAllModels: false,
  }),
}))

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

const chatMessage = (
  id: number,
  role: ChatMessage['role'],
  text: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  text,
  blocks: text === '' ? [] : [{ type: 'text', text }],
  stopReason: role === 'assistant' ? 'stop' : null,
  errorMessage: null,
  reason: null,
  ...overrides,
})

const threadResponse = (thinkingLevel: 'high' | null) => ({
  id: THREAD_ID,
  title: 'First',
  workspaceId: '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e',
  agentId: '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f',
  overrides: { credentialId: null, modelId: null, thinkingLevel },
})

/** A stream frame is the whole visible state, not just the lines: tools, model and spend travel with it. */
const frame = (messages: ChatMessage[], tools: unknown[] = []) => ({
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
          messages: [chatMessage(4, 'assistant', 'earlier answer')],
          nextCursor: null,
        }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)

    expect(await screen.findByText('earlier answer')).toBeInTheDocument()

    stream()?.emit(
      STREAM_EVENT,
      frame([
        chatMessage(4, 'assistant', 'earlier answer'),
        chatMessage(5, 'user', 'a question'),
      ]),
    )

    expect(await screen.findByText('a question')).toBeInTheDocument()
  })

  it('shows the run tool calls under the reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ messages: [chatMessage(4, 'assistant', 'done')], nextCursor: null })),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    await screen.findByText('done')

    stream()?.emit(
      STREAM_EVENT,
      frame(
        [chatMessage(4, 'assistant', 'done')],
        [
          {
            id: 'call_1',
            entryId: 99,
            name: 'read',
            arguments: '{"path":"README.md"}',
            status: 'ok',
            result: '# Cake',
            durationMs: 12,
          },
        ],
      ),
    )

    expect(await screen.findByText('read')).toBeInTheDocument()
    expect(screen.getByText('12 ms')).toBeInTheDocument()
  })

  it('renders committed thinking, its tool row and text in order inside the assistant turn', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    stream()?.emit(
      STREAM_EVENT,
      frame(
        [
          chatMessage(4, 'assistant', 'committed final text', {
            blocks: [
              { type: 'thinking', text: 'committed reasoning', redacted: false },
              { type: 'toolCall', callId: 'call_1', name: 'read', arguments: '{"path":"README.md"}' },
              { type: 'text', text: 'committed final text' },
            ],
          }),
          chatMessage(5, 'assistant', 'later answer'),
        ],
        [
          {
            id: 'call_1',
            entryId: 4,
            name: 'read',
            arguments: '{"path":"README.md"}',
            status: 'ok',
            result: '# Cake',
            durationMs: 12,
          },
        ],
      ),
    )

    const thinking = await screen.findByRole('button', { name: 'Thought for a few seconds' })
    expect(screen.queryByText('committed reasoning')).not.toBeInTheDocument()
    fireEvent.click(thinking)
    expect(await screen.findByText('committed reasoning')).toBeInTheDocument()

    const transcript = screen.getByLabelText('Transcript').textContent ?? ''
    expect(transcript.indexOf('committed reasoning')).toBeLessThan(transcript.indexOf('read'))
    expect(transcript.indexOf('read')).toBeLessThan(transcript.indexOf('committed final text'))
    expect(transcript.indexOf('committed final text')).toBeLessThan(transcript.indexOf('later answer'))
  })

  it('shows a compaction as a collapsed context row rather than a user bubble', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    stream()?.emit(
      STREAM_EVENT,
      frame([
        chatMessage(4, 'compaction', 'the exact **summary**', { reason: 'threshold' }),
      ]),
    )

    const trigger = await screen.findByText('Context compacted (threshold)')
    const details = trigger.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details?.querySelector('[data-slot="bubble"]')).toBeNull()
  })

  it('shows a committed assistant error above its answer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    stream()?.emit(
      STREAM_EVENT,
      frame([
        chatMessage(4, 'assistant', 'partial answer', {
          stopReason: 'error',
          errorMessage: 'provider disconnected',
        }),
      ]),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('provider disconnected')
    expect(screen.getByText('partial answer')).toBeInTheDocument()
  })

  it('marks an unresolved committed tool call when no run is active', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)
    await waitFor(() => expect(stream()).toBeDefined())

    stream()?.emit(
      STREAM_EVENT,
      frame(
        [
          chatMessage(4, 'assistant', '', {
            blocks: [
              { type: 'toolCall', callId: 'call_1', name: 'read', arguments: '{"path":"README.md"}' },
            ],
          }),
        ],
        [
          {
            id: 'call_1',
            entryId: 4,
            name: 'read',
            arguments: '{"path":"README.md"}',
            status: 'running',
            result: null,
            durationMs: null,
          },
        ],
      ),
    )

    expect(await screen.findByText('No result recorded')).toBeInTheDocument()
    expect(screen.queryByText('Running…')).not.toBeInTheDocument()
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
          { type: 'text', text: 'text after the call' },
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
    const transcript = screen.getByLabelText('Transcript').textContent ?? ''
    expect(transcript.indexOf('styles hit: .shimmer')).toBeLessThan(transcript.indexOf('text after the call'))
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

    stream()?.emit(STREAM_EVENT, frame([chatMessage(11, 'user', 'hello there')]))

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
      chatMessage(4, 'assistant', 'the first answer'),
      chatMessage(5, 'user', 'a question'),
    ]
    stream()?.emit(STREAM_EVENT, frame(sent))
    await screen.findByText('a question')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'the failed follow-up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Not sent')).toBeInTheDocument()

    stream()?.emit(STREAM_EVENT, frame([...sent, chatMessage(6, 'assistant', 'a later answer')]))
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

  it('shows the agent defaults in the conversation run controls', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ messages: [], nextCursor: null })))

    render(<ChatPane threadId={THREAD_ID} />)

    expect(await screen.findByRole('combobox', { name: 'Model' })).toHaveDisplayValue(
      'Agent default (deepseek-v4.1-flash)',
    )
    expect(screen.getByRole('combobox', { name: 'Thinking' })).toHaveDisplayValue('Agent default (low)')
    expect(screen.getByRole('combobox', { name: 'Key' })).toHaveDisplayValue('Agent default (Work key)')
  })

  it('patches a thinking override as soon as it is chosen', async () => {
    const backend = vi.fn((_path: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? reply(threadResponse('high')) : reply({ messages: [], nextCursor: null }),
    )
    vi.stubGlobal('fetch', backend)

    render(<ChatPane threadId={THREAD_ID} />)
    const thinking = await screen.findByRole('combobox', { name: 'Thinking' })
    fireEvent.change(thinking, { target: { value: 'high' } })

    await waitFor(() => expect(thinking).toHaveValue('high'))
    const patch = backend.mock.calls.find((call) => call[1]?.method === 'PATCH')
    expect(patch?.[0]).toBe(`/threads/${THREAD_ID}/run-settings`)
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ thinkingLevel: 'high' })
  })

  it('sends null when thinking returns to the agent default', async () => {
    const backend = vi.fn((_path: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return reply({ messages: [], nextCursor: null })
      const body = JSON.parse(String(init.body)) as { thinkingLevel: 'high' | null }

      return reply(threadResponse(body.thinkingLevel))
    })
    vi.stubGlobal('fetch', backend)

    render(<ChatPane threadId={THREAD_ID} />)
    const thinking = await screen.findByRole('combobox', { name: 'Thinking' })
    fireEvent.change(thinking, { target: { value: 'high' } })
    await waitFor(() => expect(thinking).toHaveValue('high'))
    fireEvent.change(thinking, { target: { value: '' } })

    await waitFor(() => expect(thinking).toHaveValue(''))
    const patches = backend.mock.calls.filter((call) => call[1]?.method === 'PATCH')
    expect(patches).toHaveLength(2)
    expect(JSON.parse(String(patches[1]?.[1]?.body))).toEqual({ thinkingLevel: null })
  })

  it('shows a run settings refusal and reverts the select', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? reply({ error: { code: 'AGENT_MODEL_NOT_ALLOWED', message: 'That setting is not allowed here.' } }, false)
          : reply({ messages: [], nextCursor: null }),
      ),
    )

    render(<ChatPane threadId={THREAD_ID} />)
    const thinking = await screen.findByRole('combobox', { name: 'Thinking' })
    fireEvent.change(thinking, { target: { value: 'high' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('That setting is not allowed here.')
    expect(thinking).toHaveValue('')
    expect(thinking).toBeEnabled()
  })

  it('asks for no conversation when no thread is selected', () => {
    render(<ChatPane threadId={null} />)

    expect(screen.getByText('No conversation open')).toBeInTheDocument()
  })
})
