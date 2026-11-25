import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TerminalPayload } from './terminal-api.ts'
import {
  attachTerminal,
  CLOSE_UNKNOWN_TERMINAL,
  createTerminal,
  deleteTerminal,
  listTerminals,
} from './terminal-api.ts'

const WORKSPACE_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'
const ENVIRONMENT_ID = '7d3a2b44-8c1e-4f60-9a05-3b2c1d4e5f60'
const TERMINAL_ID = 'c4a9d0e2-1b3f-4a55-8e77-9f00aa11bb22'

const ROOT = `/workspaces/${WORKSPACE_ID}/environments/${ENVIRONMENT_ID}/terminals`

const terminal: TerminalPayload = {
  id: TERMINAL_ID,
  environmentId: ENVIRONMENT_ID,
  label: 'shell 1',
  createdAt: '2026-03-01T10:00:00.000Z',
  size: { cols: 80, rows: 24 },
  attached: false,
}

const reply = (status: number, body?: unknown) =>
  Promise.resolve({
    status,
    ok: status < 400,
    json: () => Promise.resolve(body),
  } as Response)

type Sent = string | Uint8Array

/** The smallest `WebSocket` the client uses: an open flag, a listener table and a record of what went out. */
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  readonly sent: Sent[] = []
  readonly url: string
  readyState = FakeSocket.OPEN
  binaryType = 'blob'

  constructor(url: string) {
    this.url = url
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  send(payload: Sent): void {
    this.sent.push(payload)
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED
    this.emit('close', { code: CLOSE_UNKNOWN_TERMINAL, reason: '' })
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  /** A text frame, as the server sends its control messages. */
  sendText(text: string): void {
    this.emit('message', { data: text })
  }

  /** A binary frame, as the server sends PTY output. */
  sendBytes(bytes: number[]): void {
    this.emit('message', { data: new Uint8Array(bytes).buffer })
  }
}

const opened = (): FakeSocket => {
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('no socket was opened')

  return socket
}

function record() {
  const frames: string[] = []
  const output: number[][] = []

  return {
    frames,
    output,
    handlers: {
      onReady: (payload: TerminalPayload) => frames.push(`ready ${payload.size.cols}x${payload.size.rows}`),
      onOutput: (bytes: Uint8Array) => output.push([...bytes]),
      onExit: (exit: { code: number | null; signal: string | null }) =>
        frames.push(`exit ${exit.code ?? 'null'}/${exit.signal ?? 'null'}`),
      onError: (failure: { code: string; message: string }) => frames.push(`error ${failure.code}: ${failure.message}`),
      onClosed: (event: CloseEvent) => frames.push(`closed ${event.code}`),
    },
  }
}

afterEach(() => {
  FakeSocket.opened.length = 0
  vi.unstubAllGlobals()
})

describe('terminal requests', () => {
  it('lists the sessions of an environment', async () => {
    const fetchStub = vi.fn(() => reply(200, { terminals: [terminal] }))
    vi.stubGlobal('fetch', fetchStub)

    await expect(listTerminals(WORKSPACE_ID, ENVIRONMENT_ID)).resolves.toEqual([terminal])
    expect(fetchStub).toHaveBeenCalledWith(ROOT, undefined)
  })

  it('creates a session with the size it was given', async () => {
    const fetchStub = vi.fn(() => reply(201, terminal))
    vi.stubGlobal('fetch', fetchStub)

    await expect(
      createTerminal(WORKSPACE_ID, ENVIRONMENT_ID, { label: 'shell 1', size: { cols: 120, rows: 40 } }),
    ).resolves.toEqual(terminal)
    expect(fetchStub).toHaveBeenCalledWith(ROOT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'shell 1', size: { cols: 120, rows: 40 } }),
    })
  })

  it('sends an empty body when the backend should pick the default', async () => {
    const fetchStub = vi.fn(() => reply(201, terminal))
    vi.stubGlobal('fetch', fetchStub)

    await createTerminal(WORKSPACE_ID, ENVIRONMENT_ID)

    expect(fetchStub).toHaveBeenCalledWith(ROOT, expect.objectContaining({ body: '{}' }))
  })

  it('kills a session and resolves on 204 without parsing a body', async () => {
    const json = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 204, ok: true, json } as unknown as Response)))

    await expect(deleteTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID)).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('surfaces the backend code and message rather than the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reply(409, { error: { code: 'environment_not_running', message: 'the environment is not running' } }),
      ),
    )

    await expect(listTerminals(WORKSPACE_ID, ENVIRONMENT_ID)).rejects.toThrow('the environment is not running')
  })

  it('falls back to the status when the body carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(404, {})))

    await expect(listTerminals(WORKSPACE_ID, ENVIRONMENT_ID)).rejects.toThrow('request failed with status 404')
  })
})

describe('attaching', () => {
  it('upgrades the same route the REST handlers live under', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const seen = record()

    attachTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID, seen.handlers)

    expect(opened().url).toBe(`ws://localhost:3000${ROOT}/${TERMINAL_ID}/attach`)
    expect(opened().binaryType).toBe('arraybuffer')
  })

  it('reports the ready size, then hands over bytes untouched', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const seen = record()

    attachTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID, seen.handlers)
    opened().sendText(JSON.stringify({ type: 'ready', terminal }))
    opened().sendBytes([27, 91, 50, 74])

    expect(seen.frames).toEqual(['ready 80x24'])
    expect(seen.output).toEqual([[27, 91, 50, 74]])
  })

  it('passes control frames through and drops one it cannot read', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const seen = record()

    attachTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID, seen.handlers)
    opened().sendText(JSON.stringify({ type: 'exit', code: 0, signal: null }))
    opened().sendText(JSON.stringify({ type: 'error', code: 'terminal_exited', message: 'it is gone' }))
    opened().sendText(JSON.stringify({ type: 'ready' }))
    opened().sendText('not json')
    opened().sendText(JSON.stringify({ type: 'something-new' }))

    expect(seen.frames).toEqual(['exit 0/null', 'error terminal_exited: it is gone'])
    expect(seen.output).toEqual([])
  })

  it('sends keystrokes as bytes and resize as json, and nothing at all once closed', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const seen = record()

    const link = attachTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID, seen.handlers)
    link.write('ls\r')
    link.resize({ cols: 120, rows: 40 })

    const socket = opened()
    expect(ArrayBuffer.isView(socket.sent[0])).toBe(true)
    expect([...(socket.sent[0] as Uint8Array)]).toEqual([108, 115, 13])
    expect(socket.sent[1]).toBe(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))

    socket.readyState = FakeSocket.CLOSED
    link.write('ignored')
    link.resize({ cols: 1, rows: 1 })

    expect(socket.sent).toHaveLength(2)
  })

  it('reports the close so a 1006 after a backend restart is not a silent void', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const seen = record()

    const link = attachTerminal(WORKSPACE_ID, ENVIRONMENT_ID, TERMINAL_ID, seen.handlers)
    link.close()

    expect(seen.frames).toEqual([`closed ${CLOSE_UNKNOWN_TERMINAL}`])
  })
})
