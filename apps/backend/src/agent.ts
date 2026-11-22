import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'

import { AppError } from './errors.js'

// One background context for the whole process: it never cancels and carries no telemetry.
const CONTEXT = BACKGROUND_CONTEXT

const MODEL = { provider: 'opencode-go', modelId: 'deepseek-v4.1-flash' } as const
const THINKING_LEVEL = 'low'

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

// MemoryStorage keeps the transcript in this process: a restart starts over.
export async function createAgent(): Promise<Agent> {
  const models = createModels()
  models.setProvider(opencodeGoProvider())

  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry: createRegistry() },
    CONTEXT,
  )
  const root = await harness.root(CONTEXT, {
    agent: { model: MODEL, thinkingLevel: THINKING_LEVEL },
  })

  return {
    async ask(input) {
      const submission = await root.submit({ type: 'input', content: input }, CONTEXT)
      const settled = await submission.wait(CONTEXT)

      if (settled.status !== 'done') {
        throw new AppError('the agent did not answer', {
          statusCode: 502,
          code: 'AGENT_UNANSWERED',
          cause: settled.reason,
        })
      }

      const view = await root.context(CONTEXT)
      return answerText(view.entries.find((entry) => entry.id === settled.answer))
    },
    close: () => harness.close(CONTEXT),
  }
}
