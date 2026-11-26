import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'

import type { BackgroundModelChain } from '../background/model-chain.js'
import { AutoTitles, cleanTitle, titleTranscript } from './auto-title.js'
import type { ChatThread } from './thread-repository.js'

const CHAIN: BackgroundModelChain = [
  { credentialId: 'key', modelId: 'model', thinkingLevel: 'off' },
]

const answer = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-completions',
  provider: 'opencode-go',
  model: 'model',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 0,
})

const threadOf = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: 'thread',
  title: null,
  titleSource: 'auto',
  autoTitleEntryId: null,
  workspaceId: 'workspace',
  agentId: 'agent',
  durableConversationId: 1,
  overrides: { credentialId: null, modelId: null, thinkingLevel: null },
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const setup = (initial: ChatThread, chain: BackgroundModelChain = CHAIN) => {
  let thread = initial
  const complete = vi.fn(async () => answer('A useful title'))
  const readTranscript = vi.fn(async () => ({ latestEntryId: 12, text: 'user: hello\nassistant: world' }))
  const log = vi.fn()
  const threads = {
    find: async () => ({ ...thread }),
    setAutoTitle: async (_id: string, title: string, entryId: number) => {
      if (thread.titleSource === 'user') return undefined
      thread = { ...thread, title, titleSource: 'auto', autoTitleEntryId: entryId }
      return { ...thread }
    },
  }
  const titles = new AutoTitles({
    threads,
    settings: { currentSettings: async () => ({ backgroundModel: chain }) },
    readTranscript,
    complete,
    log,
  })

  return { titles, complete, readTranscript, log, current: () => thread }
}

describe('AutoTitles', () => {
  it('does not generate or replace a user-set title', async () => {
    const { titles, complete, readTranscript, current } = setup(threadOf({ title: 'Mine', titleSource: 'user' }))

    titles.runFinished('thread')
    await titles.close()

    expect(readTranscript).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(current().title).toBe('Mine')
  })

  it('generates for an untitled thread and notifies its stream listeners', async () => {
    const { titles, complete, current } = setup(threadOf())
    const listener = vi.fn()
    titles.listen('thread', listener)

    titles.runFinished('thread')
    await titles.close()

    expect(complete).toHaveBeenCalledWith(CHAIN, expect.objectContaining({
      messages: [expect.objectContaining({ content: 'Conversation:\nuser: hello\nassistant: world' })],
    }))
    expect(current()).toMatchObject({ title: 'A useful title', titleSource: 'auto', autoTitleEntryId: 12 })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('generates a replacement for an existing automatic title only when new prose arrived', async () => {
    const { titles, complete, readTranscript } = setup(threadOf({
      title: 'Old automatic title',
      titleSource: 'auto',
      autoTitleEntryId: 12,
    }))

    titles.runFinished('thread')
    await titles.close()
    expect(complete).not.toHaveBeenCalled()

    readTranscript.mockResolvedValue({ latestEntryId: 13, text: 'user: something new' })
    titles.runFinished('thread')
    await titles.close()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('does nothing with an empty chain and logs completion failures without rethrowing', async () => {
    const empty = setup(threadOf(), [])
    empty.titles.runFinished('thread')
    await empty.titles.close()
    expect(empty.complete).not.toHaveBeenCalled()

    const failed = setup(threadOf())
    failed.complete.mockRejectedValue(new Error('provider offline'))
    failed.titles.runFinished('thread')
    await failed.titles.close()
    expect(failed.log).toHaveBeenCalledOnce()
    expect(failed.current().title).toBeNull()
  })
})

describe('title transcript and answer cleanup', () => {
  it('uses only recent user and assistant text', () => {
    expect(titleTranscript([
      { id: 1, role: 'user', text: ' first ' },
      { id: 2, role: 'context', text: 'system text' },
      { id: 3, role: 'assistant', text: ' answer ' },
      { id: 4, role: 'assistant', text: '' },
    ])).toEqual({ latestEntryId: 3, text: 'user: first\nassistant: answer' })
  })

  it('strips wrapping quotes and a trailing period and caps verbose answers at six words', () => {
    expect(cleanTitle(answer('"One two three four five six seven."'))).toBe('One two three four five six')
    expect(cleanTitle(answer('   '))).toBeNull()
  })
})
