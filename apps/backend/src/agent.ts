import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { Harness, MemoryStorage, SessionFailed, createRegistry } from '@earendil-works/pi-durable'
import type { Conversation, EntryRecord, Storage, SubmissionRecord } from '@earendil-works/pi-durable'

import type { Config } from './config.js'
import { AppError } from './errors.js'
import { openPostgresStorage } from './storage/postgres/index.js'
import { retryingStorage } from './storage/postgres/resilient.js'
import { sharedStorage } from './storage/postgres/shared.js'
import { isConnectFailure, withRetryUntil } from './storage/postgres/retry.js'

// One background context for the whole process: it never cancels and carries no telemetry.
const CONTEXT = BACKGROUND_CONTEXT

const MODEL = { provider: 'opencode-go', modelId: 'deepseek-v4.1-flash' } as const
const THINKING_LEVEL = 'low'

/**
 * How long a request waits for Postgres before answering 503. Reopening needs a connection, not a healthy Session, so
 * a restart within this window is invisible to the caller; past it the request fails and the next one tries again.
 */
const REOPEN_WINDOW_MS = 10_000
const REOPEN_RETRY = { baseDelayMs: 100, maxDelayMs: 1000 }

export interface Agent {
  /** Send one input and resolve with the answer's text. */
  ask(input: string): Promise<string>
  close(): Promise<void>
}

function answerText(entry: EntryRecord | undefined): string {
  const message = entry?.model?.[0]
  if (message?.role !== 'assistant') return ''

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

const unavailable = (error: unknown): AppError =>
  new AppError('the agent is unavailable', {
    statusCode: 503,
    code: 'AGENT_UNAVAILABLE',
    cause: error,
  })

interface Live {
  readonly harness: Harness
  readonly conversation: Conversation
}

/**
 * Owns the harness and reopens it when its Session fails. Durable is explicit that this is the recovery: a `SessionFailed`
 * says "Reopen the Session; reopening recovers from what was committed", and nothing above storage retries.
 */
class Supervisor {
  #live: Live | undefined
  #opening: Promise<Live> | undefined
  readonly #open: () => Promise<Live>

  constructor(open: () => Promise<Live>) {
    this.#open = open
  }

  /** The live conversation, reopening first when the previous harness was discarded. */
  async conversation(): Promise<Conversation> {
    const live = this.#live
    if (live !== undefined) return live.conversation

    return (await this.#reopen()).conversation
  }

  /** Drop a failed harness: what it committed stays, and the next request resumes from there. */
  discard(): void {
    const live = this.#live
    if (live === undefined) return
    this.#live = undefined

    live.harness.close(CONTEXT).catch(() => {
      // The Session already failed; closing it is cleanup, and its error would only hide the cause.
    })
  }

  async close(): Promise<void> {
    const live = this.#live
    this.#live = undefined
    await live?.harness.close(CONTEXT)
  }

  // Single-flight: concurrent requests during an outage wait on one reopen instead of racing to build harnesses.
  async #reopen(): Promise<Live> {
    this.#opening ??= withRetryUntil(REOPEN_WINDOW_MS, REOPEN_RETRY, isConnectFailure, async () => {
      const live = await this.#open()
      this.#live = live

      return live
    }).finally(() => {
      this.#opening = undefined
    })

    return this.#opening
  }
}

async function askOnce(supervisor: Supervisor, input: string): Promise<SubmissionRecord> {
  let conversation: Conversation
  try {
    conversation = await supervisor.conversation()
  } catch (error) {
    throw unavailable(error)
  }

  try {
    const submission = await conversation.submit({ type: 'input', content: input }, CONTEXT)

    return await submission.wait(CONTEXT)
  } catch (error) {
    // Only a dead Session is worth discarding; a provider error leaves the harness usable.
    if (error instanceof SessionFailed) supervisor.discard()

    throw unavailable(error)
  }
}

/**
 * A `DATABASE_URL` keeps the transcript in Postgres, so a restart resumes it; without one, MemoryStorage keeps it in
 * this process and a restart starts over.
 */
export async function createAgent(config: Config): Promise<Agent> {
  const models = createModels()
  models.setProvider(opencodeGoProvider())

  const backing: Storage =
    config.databaseUrl === undefined
      ? new MemoryStorage()
      : retryingStorage(
          // Waiting at boot too: a database that is restarting deserves the same window as one that went away later.
          await withRetryUntil(REOPEN_WINDOW_MS, REOPEN_RETRY, isConnectFailure, () =>
            openPostgresStorage(config.databaseUrl ?? '', { max: config.databasePoolSize }),
          ),
        )

  // Harnesses come and go as Sessions fail; the storage outlives them and only the process closes it.
  const storage = sharedStorage(backing)

  const supervisor = new Supervisor(async () => {
    const harness = await Harness.open(storage, { models, registry: createRegistry() }, CONTEXT)

    try {
      const conversation = await harness.root(CONTEXT, {
        agent: { model: MODEL, thinkingLevel: THINKING_LEVEL },
      })

      return { harness, conversation }
    } catch (error) {
      await harness.close(CONTEXT).catch(() => {
        // Opening never completed, so there is nothing useful to report from cleanup.
      })

      throw error
    }
  })

  return {
    async ask(input) {
      const settled = await askOnce(supervisor, input)

      if (settled.status !== 'done') {
        throw new AppError('the agent did not answer', {
          statusCode: 502,
          code: 'AGENT_UNANSWERED',
          cause: settled,
        })
      }

      const conversation = await supervisor.conversation()
      const view = await conversation.context(CONTEXT)

      return answerText(view.entries.find((entry) => entry.id === settled.answer))
    },
    async close() {
      await supervisor.close()
      await backing.close(CONTEXT)
    },
  }
}
