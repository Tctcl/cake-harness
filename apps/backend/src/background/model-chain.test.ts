import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'

import type { BackgroundModelChain, BackgroundModels } from './model-chain.js'
import { completeWithBackgroundChain, isOutOfUsageFailure, validateBackgroundModel } from './model-chain.js'

const FIRST = { credentialId: 'first', modelId: 'model-one', thinkingLevel: 'low' } as const
const SECOND = { credentialId: 'second', modelId: 'model-two', thinkingLevel: 'high' } as const
const CHAIN: BackgroundModelChain = [FIRST, SECOND]

const answer = (stopReason: AssistantMessage['stopReason'] = 'stop', errorMessage?: string): AssistantMessage => ({
  role: 'assistant',
  content: stopReason === 'stop' ? [{ type: 'text', text: 'A short title' }] : [],
  api: 'openai-completions',
  provider: 'opencode-go',
  model: 'model-one',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  ...(errorMessage === undefined ? {} : { errorMessage }),
  timestamp: 0,
})

const modelsWith = (complete: (provider: string, reasoning: string | undefined) => Promise<AssistantMessage>) => {
  const calls: { provider: string; reasoning: string | undefined }[] = []
  const models = {
    getModel: (provider: string, id: string) => ({ provider, id }),
    completeSimple: async (
      model: { provider: string },
      _context: unknown,
      options: { reasoning?: string },
    ) => {
      calls.push({ provider: model.provider, reasoning: options.reasoning })
      return complete(model.provider, options.reasoning)
    },
  } as unknown as BackgroundModels

  return { models, calls }
}

const context = { messages: [{ role: 'user' as const, content: 'title this', timestamp: 0 }] }

describe('completeWithBackgroundChain', () => {
  it('uses the second entry after a 429 GoUsageLimitError from the first key', async () => {
    const { models, calls } = modelsWith(async (provider) =>
      provider === 'opencode-go~first'
        ? answer('error', '429 {"error":{"type":"GoUsageLimitError","message":"usage limit reached"}}')
        : answer(),
    )

    await expect(completeWithBackgroundChain(models, CHAIN, context)).resolves.toMatchObject({ stopReason: 'stop' })
    expect(calls).toEqual([
      { provider: 'opencode-go~first', reasoning: 'low' },
      { provider: 'opencode-go~second', reasoning: 'high' },
    ])
  })

  it('does not fall back after an ordinary provider error', async () => {
    const { models, calls } = modelsWith(async () => answer('error', '502 upstream temporarily unavailable'))

    await expect(completeWithBackgroundChain(models, CHAIN, context)).rejects.toThrow('502 upstream')
    expect(calls).toHaveLength(1)
  })

  it('falls back when the first key is rejected, but not when its model is missing', async () => {
    const { models, calls } = modelsWith(async (provider) => {
      if (provider === 'opencode-go~first') throw new Error('401 invalid api key')
      return answer()
    })
    await expect(completeWithBackgroundChain(models, CHAIN, context)).resolves.toMatchObject({ stopReason: 'stop' })
    expect(calls).toHaveLength(2)

    const missing = {
      getModel: () => undefined,
      completeSimple: vi.fn(),
    } as unknown as BackgroundModels
    await expect(completeWithBackgroundChain(missing, CHAIN, context)).rejects.toThrow('not installed')
    expect(missing.completeSimple).not.toHaveBeenCalled()
  })
})

describe('background model settings', () => {
  it('validates keys and models against the install catalog', () => {
    const keys = { loginIds: ['first'], modelIds: new Set(['model-one']) }
    expect(() => validateBackgroundModel([FIRST], keys)).not.toThrow()
    expect(() => validateBackgroundModel([SECOND], keys)).toThrow(/key|linked/i)
    expect(() => validateBackgroundModel(
      [{ credentialId: 'first', modelId: 'unknown', thinkingLevel: 'low' }],
      keys,
    )).toThrow(/not a model/i)
  })

  it('recognizes only explicit quota and key-auth failures', () => {
    expect(isOutOfUsageFailure(new Error('429 Too Many Requests'))).toBe(true)
    expect(isOutOfUsageFailure(new Error('403 credential revoked'))).toBe(true)
    expect(isOutOfUsageFailure(new Error('429 upstream busy'))).toBe(false)
    expect(isOutOfUsageFailure(new Error('500 model failed'))).toBe(false)
  })
})
