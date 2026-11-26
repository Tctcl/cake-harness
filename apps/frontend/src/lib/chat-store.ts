import type { ChatDelegation, ChatLive, ChatMessage, ChatRun, ChatToolCall, ChatUpdate, ChatUsage } from './chat-api.ts'
import { readMessages, sendMessage, streamPath } from './chat-api.ts'
import { HttpError } from './http.ts'

/** The server-sent event a thread's stream carries each frame in; it must match `frame('update', …)` in the backend. */
export const STREAM_EVENT = 'update'

/** Whether an optimistic line is still on its way to the backend, or gave up and offers a retry. */
export type PendingState = 'sending' | 'failed'

/** A line the user typed that the transcript does not carry yet. It is shown until its own entry arrives. */
export interface PendingInput {
  /** Negative and unique per pane, so it can key a list beside real entries without ever colliding with one. */
  readonly localId: number
  readonly text: string
  readonly state: PendingState
  /**
   * The newest stored entry when this line was sent, so a line that failed stays where it was typed instead of sinking to
   * the bottom of the transcript. Null when nothing was stored yet, and it never moves: a retry keeps the same row.
   */
  readonly afterId: number | null
}

/** `connecting` until the first frame, `live` while the stream delivers, `error` while it is reconnecting. */
export type StreamStatus = 'connecting' | 'live' | 'error'

export interface ThreadSnapshot {
  /** Oldest first, ordered by entry id. */
  readonly messages: readonly ChatMessage[]
  readonly pending: readonly PendingInput[]
  /** The cursor for the page above these lines, or null once the start of the conversation is loaded. */
  readonly nextCursor: string | null
  readonly status: StreamStatus
  readonly loadingOlder: boolean
  readonly error: string | null
  /** The backend's stable code for `error`, so the pane can offer the fix for a refusal it recognises. */
  readonly errorCode: string | null
  /** Tool calls of the run, newest last; the pane renders them between the lines. */
  readonly tools: readonly ChatToolCall[]
  /** The model the newest answer ran with, or null until the agent has answered once. */
  readonly run: ChatRun | null
  readonly usage: ChatUsage
  /** What the conversation is doing right now: streaming reasoning and text, running tools, or why a run died. */
  readonly live: ChatLive
  /** Compact child conversations started by this thread, in the server's start order. */
  readonly delegations: readonly ChatDelegation[]
}

const NO_USAGE: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }
const NO_LIVE: ChatLive = { blocks: [], tools: [], turns: 0, compacting: 0, failure: null }

interface ThreadEntry {
  snapshot: ThreadSnapshot
  readonly listeners: Set<() => void>
  source: EventSource | undefined
}

const EMPTY: ThreadSnapshot = {
  messages: [],
  pending: [],
  nextCursor: null,
  status: 'connecting',
  loadingOlder: false,
  error: null,
  errorCode: null,
  tools: [],
  run: null,
  usage: NO_USAGE,
  live: NO_LIVE,
  delegations: [],
}

/**
 * Thread state lives here, not in a component, because a run outlives the pane that started it: switching to another
 * conversation unmounts the chat but must not drop the stream or the lines already received.
 */
const threads = new Map<string, ThreadEntry>()

let nextLocalId = 1

function entryOf(threadId: string): ThreadEntry {
  const existing = threads.get(threadId)
  if (existing !== undefined) return existing

  const created: ThreadEntry = { snapshot: EMPTY, listeners: new Set(), source: undefined }
  threads.set(threadId, created)

  return created
}

function update(threadId: string, change: (snapshot: ThreadSnapshot) => ThreadSnapshot): void {
  const entry = entryOf(threadId)
  const next = change(entry.snapshot)
  if (next === entry.snapshot) return

  entry.snapshot = next
  for (const listener of entry.listeners) listener()
}

/** The current snapshot, identical by reference until something changes; `useSyncExternalStore` relies on that. */
export function snapshotOf(threadId: string | null): ThreadSnapshot {
  if (threadId === null) return EMPTY

  return entryOf(threadId).snapshot
}

export function subscribeToThread(threadId: string, listener: () => void): () => void {
  const entry = entryOf(threadId)
  entry.listeners.add(listener)

  return () => {
    entry.listeners.delete(listener)
  }
}

/**
 * Fold a window of lines into what is already on screen. Durable streams the newest entries while older pages are read
 * by hand, so both directions meet here: a line wins over an older copy of the same id (a partial answer grows into the
 * final one), and anything the window does not carry survives.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const merged = new Map<number, ChatMessage>()
  for (const message of [...current, ...incoming]) merged.set(message.id, message)

  return [...merged.values()].sort((left, right) => left.id - right.id)
}

/** Tool calls outlive the stream window just like their chat lines; a newer result replaces the same call id. */
export function mergeTools(
  current: readonly ChatToolCall[],
  incoming: readonly ChatToolCall[],
): ChatToolCall[] {
  const merged = new Map<string, ChatToolCall>()
  for (const call of current) merged.set(call.id, call)
  for (const call of incoming) {
    const known = merged.get(call.id)
    // A frame whose window lost the calling entry knows only the result: keep the arguments and turn seen earlier.
    merged.set(
      call.id,
      known !== undefined && call.arguments === null
        ? { ...call, arguments: known.arguments, entryId: known.entryId }
        : call,
    )
  }

  return [...merged.values()].sort((left, right) => left.entryId - right.entryId)
}

/** Drops one optimistic line once the stream carries the entry the backend actually stored for it. */
function reconcilePending(pending: readonly PendingInput[], incoming: readonly ChatMessage[]): PendingInput[] {
  if (pending.length === 0) return [...pending]

  const unmatched = [...pending]
  for (const message of incoming) {
    if (message.role !== 'user') continue

    const index = unmatched.findIndex((item) => item.text === message.text)
    if (index !== -1) unmatched.splice(index, 1)
  }

  return unmatched.length === pending.length ? [...pending] : unmatched
}

function openStream(threadId: string): void {
  const entry = entryOf(threadId)
  // One stream per thread: an established source reconnects itself, and replacing it would drop frames already sent.
  if (entry.source !== undefined) return

  const source = new EventSource(streamPath(threadId))
  entry.source = source

  // `update` is the event name `routes/threads.ts` writes. This listened for `messages`, which nothing sends, so
  // answers only ever appeared after a reload.
  source.addEventListener(STREAM_EVENT, (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as ChatUpdate
    update(threadId, (snapshot) => ({
      ...snapshot,
      messages: mergeMessages(snapshot.messages, payload.messages),
      pending: reconcilePending(snapshot.pending, payload.messages),
      tools: mergeTools(snapshot.tools, payload.tools),
      run: payload.run,
      usage: payload.usage,
      live: payload.live ?? NO_LIVE,
      delegations: payload.delegations ?? [],
      status: 'live',
      error: null,
      errorCode: null,
    }))
  })

  source.addEventListener('error', () => {
    // EventSource reconnects on its own; the pane only has to say the transcript is stale.
    update(threadId, (snapshot) =>
      snapshot.status === 'error' ? snapshot : { ...snapshot, status: 'error' },
    )
  })
}

/** Read the newest page and keep the stream open, once per thread. Safe to call on every selection. */
export function openThread(threadId: string): void {
  const entry = entryOf(threadId)
  openStream(threadId)

  if (entry.snapshot.messages.length > 0 || entry.snapshot.loadingOlder) return

  update(threadId, (snapshot) => ({ ...snapshot, loadingOlder: true }))
  void readMessages(threadId).then(
    (page) => {
      update(threadId, (snapshot) => ({
        ...snapshot,
        messages: mergeMessages(snapshot.messages, [...page.messages].reverse()),
        nextCursor: page.nextCursor,
        loadingOlder: false,
      }))
    },
    (failure: unknown) => {
      update(threadId, (snapshot) => ({
        ...snapshot,
        loadingOlder: false,
        error: failure instanceof Error ? failure.message : 'the transcript failed to load',
        errorCode: null,
      }))
    },
  )
}

/** One page further into the past, for the scroll position the pane is about to preserve. */
export function loadOlder(threadId: string): void {
  const { snapshot } = entryOf(threadId)
  const cursor = snapshot.nextCursor
  if (cursor === null || snapshot.loadingOlder) return

  update(threadId, (current) => ({ ...current, loadingOlder: true }))
  void readMessages(threadId, cursor).then(
    (page) => {
      update(threadId, (current) => ({
        ...current,
        messages: mergeMessages(current.messages, [...page.messages].reverse()),
        nextCursor: page.nextCursor,
        loadingOlder: false,
      }))
    },
    (failure: unknown) => {
      update(threadId, (current) => ({
        ...current,
        loadingOlder: false,
        error: failure instanceof Error ? failure.message : 'older messages failed to load',
        errorCode: null,
      }))
    },
  )
}

function deliver(threadId: string, localId: number, text: string): void {
  update(threadId, (snapshot) => ({
    ...snapshot,
    pending: snapshot.pending.map((item) =>
      item.localId === localId ? { ...item, state: 'sending' } : item,
    ),
    error: null,
    errorCode: null,
  }))

  void sendMessage(threadId, text).then(
    () => undefined,
    (failure: unknown) => {
      update(threadId, (snapshot) => ({
        ...snapshot,
        pending: snapshot.pending.map((item) =>
          item.localId === localId ? { ...item, state: 'failed' } : item,
        ),
        error: failure instanceof Error ? failure.message : 'the message failed to send',
        errorCode: failure instanceof HttpError ? (failure.code ?? null) : null,
      }))
    },
  )
}

/** Show the line at once and hand it over; the answer comes back through the stream, not this call. */
export function send(threadId: string, text: string): void {
  const localId = nextLocalId
  nextLocalId += 1

  update(threadId, (snapshot) => ({
    ...snapshot,
    pending: [
      ...snapshot.pending,
      { localId, text, state: 'sending', afterId: snapshot.messages.at(-1)?.id ?? null },
    ],
    error: null,
    errorCode: null,
  }))
  openStream(threadId)
  deliver(threadId, localId, text)
}

/** Send a line that failed again, reusing the same optimistic row so the pane does not grow duplicates. */
export function retry(threadId: string, localId: number): void {
  const pending = entryOf(threadId).snapshot.pending.find((item) => item.localId === localId)
  if (pending === undefined || pending.state !== 'failed') return

  deliver(threadId, localId, pending.text)
}

/** Test seam: drops every thread and its stream, so one test cannot see another's state. */
export function resetThreads(): void {
  for (const entry of threads.values()) entry.source?.close()
  threads.clear()
  nextLocalId = 1
}

/** Refusals whose fix is in the workspace manager: no usable key, or a model the workspace does not allow. */
export const KEY_PROBLEMS: ReadonlySet<string> = new Set(['AGENT_NO_KEY', 'AGENT_MODEL_NOT_ALLOWED'])
