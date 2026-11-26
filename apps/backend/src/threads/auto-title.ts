import type { AssistantMessage, Context } from '@earendil-works/pi-ai'

import type { BackgroundModelChain } from '../background/model-chain.js'
import type { ChatThread, ThreadRepository } from './thread-repository.js'

const TRANSCRIPT_LINES = 12
const TRANSCRIPT_CHARACTERS = 8_000
const TITLE_CHARACTERS = 120

export interface TitleLine {
  readonly id: number
  readonly role: string
  readonly text: string
}

export interface TitleTranscript {
  /** Newest text-bearing user/assistant entry; automatic generation is idempotent on this id. */
  readonly latestEntryId: number
  readonly text: string
}

/** Only conversation prose names a chat: tools, reasoning, compaction and failures never become title source text. */
export const titleTranscript = (messages: readonly TitleLine[]): TitleTranscript | null => {
  const lines = messages.filter((message) =>
    (message.role === 'user' || message.role === 'assistant') && message.text.trim() !== '',
  )
  const latest = lines.at(-1)
  if (latest === undefined) return null

  const recent = lines.slice(-TRANSCRIPT_LINES)
  const rendered = recent.map((line) => `${line.role}: ${line.text.trim()}`).join('\n')

  return {
    latestEntryId: latest.id,
    text: rendered.length <= TRANSCRIPT_CHARACTERS ? rendered : rendered.slice(-TRANSCRIPT_CHARACTERS),
  }
}

/** Keep the model's answer to one bare, short title even when it adds wrapping quotes or a final period anyway. */
export const cleanTitle = (answer: AssistantMessage): string | null => {
  const text = answer.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.。]+$/u, '')
    .trim()
  if (text === '') return null

  const words = text.split(' ')
  const short = words.length > 6 ? words.slice(0, 6).join(' ') : text

  return short.slice(0, TITLE_CHARACTERS).replace(/[.。]+$/u, '').trim() || null
}

export const titleContext = (transcript: string): Context => ({
  systemPrompt:
    'Write a short title for this conversation. Return only 3 to 6 words in the same language as the conversation. No quotes and no trailing period.',
  messages: [{ role: 'user', content: `Conversation:\n${transcript}`, timestamp: Date.now() }],
})

interface AutoTitleDependencies {
  readonly threads: Pick<ThreadRepository, 'find' | 'setAutoTitle'>
  readonly settings: { currentSettings(): Promise<{ readonly backgroundModel: BackgroundModelChain }> }
  readonly readTranscript: (thread: ChatThread) => Promise<TitleTranscript | null>
  readonly complete: (chain: BackgroundModelChain, context: Context) => Promise<AssistantMessage>
  readonly log: (failure: unknown) => void
}

/**
 * Serializes title jobs per thread, so overlapping stream watchers cannot spend duplicate requests or write an older
 * title over a newer one. A queued repeat normally finds the same entry id and exits without a model call.
 */
export class AutoTitles {
  readonly #dependencies: AutoTitleDependencies
  readonly #jobs = new Map<string, Promise<void>>()
  readonly #listeners = new Map<string, Set<() => void>>()

  constructor(dependencies: AutoTitleDependencies) {
    this.#dependencies = dependencies
  }

  /** A watcher asks to be refreshed after an automatic write; no title failure is sent through that watcher. */
  listen(threadId: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(threadId) ?? new Set<() => void>()
    listeners.add(listener)
    this.#listeners.set(threadId, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#listeners.delete(threadId)
    }
  }

  runFinished(threadId: string): void {
    const previous = this.#jobs.get(threadId) ?? Promise.resolve()
    const job = previous
      .then(() => this.#generate(threadId))
      .catch((failure: unknown) => {
        this.#dependencies.log(failure)
      })
      .finally(() => {
        if (this.#jobs.get(threadId) === job) this.#jobs.delete(threadId)
      })
    this.#jobs.set(threadId, job)
  }

  async close(): Promise<void> {
    await Promise.all(this.#jobs.values())
    this.#listeners.clear()
  }

  async #generate(threadId: string): Promise<void> {
    const { threads, settings, readTranscript, complete } = this.#dependencies
    const [thread, current] = await Promise.all([threads.find(threadId), settings.currentSettings()])
    if (thread === undefined || thread.titleSource === 'user' || current.backgroundModel.length === 0) return

    const transcript = await readTranscript(thread)
    if (transcript === null || transcript.latestEntryId === thread.autoTitleEntryId) return

    const answer = await complete(current.backgroundModel, titleContext(transcript.text))
    if (answer.stopReason === 'error') throw new Error(answer.errorMessage ?? 'Title generation failed')
    const title = cleanTitle(answer)
    if (title === null) throw new Error('Title generation returned no title')

    const updated = await threads.setAutoTitle(threadId, title, transcript.latestEntryId)
    if (updated === undefined) return
    for (const listener of this.#listeners.get(threadId) ?? []) listener()
  }
}
