import { request } from './http.ts'

/**
 * Terminals: a program running in an environment's container, driven over a websocket.
 *
 * The contract is `docs/terminals.md` and `apps/backend/src/terminal/contract.ts`. Bytes travel as binary frames in
 * both directions and are never decoded here; text frames are the control messages below. That split is why a paste of
 * escape sequences survives the round trip unchanged.
 */

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

/** A session as the platform knows it; the container and the pid stay on the backend's side. */
export interface TerminalPayload {
  readonly id: string
  readonly environmentId: string
  readonly label: string
  readonly createdAt: string
  readonly size: TerminalSize
  readonly attached: boolean
}

/** Frames the server sends as text. Output arrives beside them as binary frames. */
export type ServerFrame =
  | { readonly type: 'ready'; readonly terminal: TerminalPayload }
  | { readonly type: 'exit'; readonly code: number | null; readonly signal: string | null }
  | { readonly type: 'error'; readonly code: string; readonly message: string }

/** The one frame a client sends as text; keystrokes go as binary frames. */
export type ClientFrame = { readonly type: 'resize'; readonly cols: number; readonly rows: number }

/** `4404` means the session is gone (closed, or the backend restarted). */
export const CLOSE_UNKNOWN_TERMINAL = 4404

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** A terminal is a use of an environment, so every path is rooted in the workspace and the environment that owns it. */
const root = (workspaceId: string, environmentId: string): string =>
  `/workspaces/${encodeURIComponent(workspaceId)}/environments/${encodeURIComponent(environmentId)}/terminals`

export const listTerminals = async (
  workspaceId: string,
  environmentId: string,
): Promise<TerminalPayload[]> =>
  (await request<{ terminals: TerminalPayload[] }>(root(workspaceId, environmentId))).terminals

/** Opens a session in the container. An omitted size is the backend's default, which is better than a guess from here. */
export const createTerminal = async (
  workspaceId: string,
  environmentId: string,
  options: { readonly label?: string; readonly size?: TerminalSize } = {},
): Promise<TerminalPayload> =>
  await request<TerminalPayload>(root(workspaceId, environmentId), json('POST', options))

/** Kills the program; the answer only arrives once nothing of it is left running. */
export const deleteTerminal = async (
  workspaceId: string,
  environmentId: string,
  terminalId: string,
): Promise<void> =>
  await request<void>(`${root(workspaceId, environmentId)}/${encodeURIComponent(terminalId)}`, {
    method: 'DELETE',
  })

export interface TerminalExit {
  readonly code: number | null
  readonly signal: string | null
}

export interface TerminalHandlers {
  readonly onReady: (terminal: TerminalPayload) => void
  /** PTY bytes, exactly as the program wrote them. */
  readonly onOutput: (bytes: Uint8Array) => void
  readonly onExit: (exit: TerminalExit) => void
  readonly onError: (failure: { readonly code: string; readonly message: string }) => void
  readonly onClosed: (event: CloseEvent) => void
}

export interface TerminalAttachment {
  /** Sends keystrokes as bytes, never as text: the server does not parse binary frames. */
  readonly write: (data: string) => void
  readonly resize: (size: TerminalSize) => void
  readonly close: () => void
}

const socketUrl = (path: string): string => {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'

  return `${scheme}://${window.location.host}${path}`
}

const asPayload = (candidate: unknown): TerminalPayload | undefined => {
  if (typeof candidate !== 'object' || candidate === null) return undefined

  const terminal = candidate as Partial<TerminalPayload>
  if (typeof terminal.id !== 'string' || typeof terminal.label !== 'string') return undefined
  const size = terminal.size
  if (typeof size !== 'object' || size === null) return undefined

  return terminal as TerminalPayload
}

/** A frame this client does not understand is dropped rather than thrown: the socket outlives one bad message. */
const parseServerFrame = (text: string): ServerFrame | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined

  const candidate = parsed as {
    type?: unknown
    terminal?: unknown
    code?: unknown
    signal?: unknown
    message?: unknown
  }

  if (candidate.type === 'ready') {
    const terminal = asPayload(candidate.terminal)

    return terminal === undefined ? undefined : { type: 'ready', terminal }
  }

  if (candidate.type === 'exit') {
    return {
      type: 'exit',
      code: typeof candidate.code === 'number' ? candidate.code : null,
      signal: typeof candidate.signal === 'string' ? candidate.signal : null,
    }
  }

  if (candidate.type === 'error' && typeof candidate.message === 'string') {
    return {
      type: 'error',
      code: typeof candidate.code === 'string' ? candidate.code : 'TERMINAL_ERROR',
      message: candidate.message,
    }
  }

  return undefined
}

/**
 * Opens the socket and reports what arrives on it. The first `ready` frame carries the size to apply before any output,
 * so a full-screen program's cursor addressing lands in the right place; the backend then replays its scrollback as one
 * binary frame, which this hands over like any other output.
 */
export const attachTerminal = (
  workspaceId: string,
  environmentId: string,
  terminalId: string,
  handlers: TerminalHandlers,
): TerminalAttachment => {
  const path = `${root(workspaceId, environmentId)}/${encodeURIComponent(terminalId)}/attach`
  const socket = new WebSocket(socketUrl(path))
  socket.binaryType = 'arraybuffer'

  const send = (frame: ClientFrame): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
  }

  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') {
      const frame = parseServerFrame(event.data)
      if (frame === undefined) return
      if (frame.type === 'ready') handlers.onReady(frame.terminal)
      else if (frame.type === 'exit') handlers.onExit({ code: frame.code, signal: frame.signal })
      else handlers.onError({ code: frame.code, message: frame.message })

      return
    }

    if (event.data instanceof ArrayBuffer) handlers.onOutput(new Uint8Array(event.data))
  })

  socket.addEventListener('close', (event) => handlers.onClosed(event))

  return {
    write: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data))
    },
    resize: (size) => send({ type: 'resize', cols: size.cols, rows: size.rows }),
    close: () => socket.close(),
  }
}
