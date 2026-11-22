import type { LiveState } from '@earendil-works/pi-durable'

/** Cap on the argument and result text one tool call carries: a transcript is a view, not the record. */
export const TOOL_TEXT_LIMIT = 4000

export const clipped = (text: string): string =>
  text.length <= TOOL_TEXT_LIMIT ? text : `${text.slice(0, TOOL_TEXT_LIMIT)}\u2026`

/**
 * One block of the answer still being written, in the order the provider produced it: reasoning first, then text, and a
 * later turn's reasoning after the text it followed. A call streams its arguments while the model is still writing them.
 */
export type LiveBlock =
  | { readonly type: 'text'; readonly text: string }
  /** `redacted` reasoning has no text on purpose, only the signature the provider round-trips. */
  | { readonly type: 'thinking'; readonly text: string; readonly redacted: boolean }
  /** A call whose arguments are still arriving: `arguments` is the JSON text so far, not yet valid on every frame. */
  | {
      readonly type: 'toolCall'
      readonly callId: string
      readonly name: string
      readonly arguments: string
    }

/** A tool call as the run holds it now, running or settled: the live slot, not the entry that will record it. */
export interface LiveToolCall {
  readonly id: string
  readonly name: string
  readonly status: 'pending' | 'running' | 'sleeping' | 'waiting' | 'done'
  /** What the call has published so far, clipped like the settled view; null while it has produced nothing. */
  readonly output: string | null
  /** What the output bound dropped, so a short list does not look complete. */
  readonly droppedBytes: number
  readonly droppedLines: number
  readonly diagnostics: readonly string[]
}

/** Why a run ended without an answer, kept until a later run starts, so a dead run is not just a stale spinner. */
export interface RunFailureView {
  readonly reason: string
  readonly detail: string | null
}

/**
 * What the conversation is doing right now, straight from `pi.live`: the answer's committed partial, the tool round's
 * slots, the runs and compactions in flight, and the last run that failed. An idle conversation carries none of it,
 * which is how a client tells "working" from "waiting for you" without guessing at the transcript.
 */
export interface LiveActivity {
  /** The answer being written: its text and its reasoning, in order. Empty while nothing is streaming. */
  readonly blocks: readonly LiveBlock[]
  /** The current tool round, in call order. A settled call keeps its slot until the round ends. */
  readonly tools: readonly LiveToolCall[]
  /** Tool rounds the current run has taken, which the conversation's `maxTurns` bounds. */
  readonly turns: number
  /** Compactions running alongside the answer. */
  readonly compacting: number
  readonly failure: RunFailureView | null
}

/**
 * The live document as a frame's picture of the work in flight. An idle conversation has none of it, so an empty activity
 * is the honest "nothing is running" rather than something the client has to infer from the tail of the transcript.
 */
export const liveActivity = (state: Readonly<LiveState> | undefined): LiveActivity => {
  const content = state?.generation?.message?.content ?? []
  const blocks = content.flatMap((block): LiveBlock[] => {
    if (block.type === 'text') return block.text === '' ? [] : [{ type: 'text', text: block.text }]
    // A redacted block has no text on purpose; keeping it is how a client says so instead of showing nothing.
    if (block.type === 'thinking') {
      return [{ type: 'thinking', text: block.thinking, redacted: block.redacted === true }]
    }

    return [
      {
        type: 'toolCall',
        callId: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      },
    ]
  })

  const failure = state?.runFailure

  return {
    blocks,
    tools: (state?.tools ?? []).map((slot) => ({
      id: slot.callId,
      name: slot.name,
      status: slot.status,
      output: slot.output === undefined ? null : clipped(slot.output),
      droppedBytes: slot.droppedBytes ?? 0,
      droppedLines: slot.droppedLines ?? 0,
      diagnostics: (slot.diagnostics ?? []).map((diagnostic) => diagnostic.message),
    })),
    turns: state?.run?.turns ?? 0,
    compacting: state?.compactions?.length ?? 0,
    failure: failure === undefined ? null : { reason: failure.reason, detail: failure.detail ?? null },
  }
}
