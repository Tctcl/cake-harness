import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels } from '@earendil-works/pi-ai/models'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux'
import type { FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux'
import { getCurrentSystemPrompt } from '@earendil-works/pi-ai/utils/transcript'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it, vi } from 'vitest'

import type { PromptSnapshots } from './prompt-snapshot.js'
import { createCakeExtension, createSubagentCakeExtension } from './cake-extension.js'

const CONTEXT = BACKGROUND_CONTEXT

/** The two tables, in memory: what the repository does over Postgres, without a server for these cases. */
const memorySnapshots = (): PromptSnapshots => {
  const prompts = new Map<number, string>()
  const appends = new Map<string, string>()

  return {
    async systemPrompt(conversationId, live) {
      const stored = prompts.get(conversationId)
      if (stored !== undefined) return stored
      const text = await live()
      prompts.set(conversationId, text)

      return text
    },
    async append(conversationId, agentId, live) {
      const key = `${String(conversationId)}:${agentId}`
      const stored = appends.get(key)
      if (stored !== undefined) return stored
      const text = await live()
      appends.set(key, text)

      return text
    },
  }
}

describe('Cake prompt extensions', () => {
  it('renders the separate global subagent prompt without reading the user-facing prompt', async () => {
    const userPrompt = vi.fn(async () => 'user-facing prompt')
    const subagentPrompt = vi.fn(async () => 'machine-to-machine prompt')
    const snapshots = memorySnapshots()
    const ordinary = createCakeExtension((conversationId) => snapshots.systemPrompt(conversationId, userPrompt))
    const subagent = createSubagentCakeExtension((conversationId) => snapshots.systemPrompt(conversationId, subagentPrompt))
    const ordinarySection = ordinary.sections?.[0]
    const subagentSection = subagent.sections?.[0]
    if (ordinarySection === undefined || subagentSection === undefined) throw new Error('prompt sections are missing')
    const input = (conversationId: number) => ({ conversationId }) as never

    await expect(ordinarySection.render(input(1), CONTEXT)).resolves.toBe('user-facing prompt')
    await expect(subagentSection.render(input(2), CONTEXT)).resolves.toBe('machine-to-machine prompt')
    expect(userPrompt).toHaveBeenCalledTimes(1)
    expect(subagentPrompt).toHaveBeenCalledTimes(1)
  })

  it('keeps a running conversation on the system prompt it started with, and starts new ones from the new text', async () => {
    const faux = fauxProvider({ provider: 'faux', models: [{ id: 'parent' }] })
    const models = createModels()
    models.setProvider(faux.provider)
    const registry = createRegistry()
    const snapshots = memorySnapshots()
    let setting = 'the prompt as it was'
    const cake = createCakeExtension((conversationId) => snapshots.systemPrompt(conversationId, async () => setting))
    registry.install(cake)
    const memory = new MemoryStorage()
    const harness = await Harness.open(memory, { models, registry }, CONTEXT)
    try {
      const open = async () =>
        await harness.createConversation(
          {
            ownership: { kind: 'ownerless' },
            agent: {
              model: { provider: 'faux', modelId: 'parent' },
              thinkingLevel: 'low',
              extensions: [cake],
              tools: [],
            },
          },
          CONTEXT,
        )
      const prompts: string[] = []
      const capture = (context: Parameters<FauxResponseFactory>[0]) => {
        prompts.push(getCurrentSystemPrompt(context.messages))

        return fauxAssistantMessage('done')
      }
      faux.setResponses([capture, capture, capture, capture])
      const running = await open()
      const turn = async (conversation: Awaited<ReturnType<typeof open>>, text: string): Promise<void> => {
        await (await conversation.submit({ type: 'input', content: text }, CONTEXT)).wait(CONTEXT)
      }

      await turn(running, 'first')
      setting = 'a prompt edited afterwards'
      await turn(running, 'second')
      const fresh = await open()
      await turn(fresh, 'first')

      expect(prompts).toHaveLength(3)
      expect(prompts[0]).toContain('the prompt as it was')
      // The edit did not rewrite the start of the running conversation, which is what keeps its cached prefix.
      expect(prompts[1]).toContain('the prompt as it was')
      expect(prompts[1]).not.toContain('a prompt edited afterwards')
      // A conversation that starts after the edit reads it.
      expect(prompts[2]).toContain('a prompt edited afterwards')
    } finally {
      await harness.close(CONTEXT)
      await memory.close(CONTEXT)
    }
  }, 20_000)
})
