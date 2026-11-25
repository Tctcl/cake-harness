/**
 * What a terminal client is promised, and nothing more.
 *
 * Escape sequences are not interpreted anywhere in this process: the program in the container emits them and the
 * emulator in the browser renders them, so the shapes below are only the control messages that travel beside the
 * bytes. Keeping them here rather than in the route file makes the wire contract one import for a client, a test and
 * `docs/terminals.md`.
 */

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

/** A PTY sized zero hangs every program that asks, so a resize is bounded rather than refused. */
export const MIN_TERMINAL_SIZE: TerminalSize = { cols: 2, rows: 1 }
export const MAX_TERMINAL_SIZE: TerminalSize = { cols: 500, rows: 300 }
export const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 80, rows: 24 }

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(Math.round(value), min), max)

/**
 * A resize storm is normal — every frame of a window drag sends one — so an out-of-range size is brought inside the
 * bounds instead of being answered with an error the client would have to retry.
 */
export const clampSize = (
  candidate: { readonly cols?: number | undefined; readonly rows?: number | undefined },
  fallback: TerminalSize,
): TerminalSize => ({
  cols: clamp(candidate.cols ?? fallback.cols, MIN_TERMINAL_SIZE.cols, MAX_TERMINAL_SIZE.cols),
  rows: clamp(candidate.rows ?? fallback.rows, MIN_TERMINAL_SIZE.rows, MAX_TERMINAL_SIZE.rows),
})

/** The limits `config.ts` reads once at startup. */
export interface TerminalLimits {
  /** Sessions one environment may hold at a time; the cap a user hits by opening tabs. */
  readonly maxSessions: number
  /** Bytes of recent output replayed to a client that attaches, so a reattach is not a blank screen. */
  readonly scrollbackBytes: number
  /** Close a session with no attached client after this long without traffic; `0` never reaps. */
  readonly idleTimeoutMs: number
}

/** A session as the platform knows it. The container, the exec id and the pid stay on this side of the boundary. */
export interface TerminalView {
  readonly id: string
  readonly environmentId: string
  readonly label: string
  readonly createdAt: Date
  readonly size: TerminalSize
  readonly attached: boolean
}

/** The same view on the wire: `Date` serializes through `String()`, which is not the ISO form the schema promises. */
export interface TerminalPayload {
  readonly id: string
  readonly label: string
  readonly createdAt: string
  readonly size: TerminalSize
  readonly attached: boolean
}

export const toPayload = (view: TerminalView): TerminalPayload => ({
  id: view.id,
  label: view.label,
  createdAt: view.createdAt.toISOString(),
  size: view.size,
  attached: view.attached,
})

/**
 * Frames the server sends as text. Terminal output is sent as binary frames in both directions, so output bytes are
 * never re-encoded and a byte-for-byte round trip is the contract.
 */
export type ServerFrame =
  | { readonly type: 'ready'; readonly terminal: TerminalPayload }
  | { readonly type: 'exit'; readonly code: number | null; readonly signal: string | null }
  | { readonly type: 'error'; readonly code: string; readonly message: string }

/** The one frame a client sends as text; keystrokes go as binary frames. */
export type ClientFrame = { readonly type: 'resize'; readonly cols: number; readonly rows: number }

/** Close codes that mean something specific to the panel, above the standard 1000/1001. */
export const CLOSE_UNKNOWN_TERMINAL = 4404
export const CLOSE_UNAVAILABLE = 4409
