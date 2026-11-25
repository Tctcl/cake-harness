import type { ContextView } from '@earendil-works/pi-durable'
import type { Message, Tool } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { estimateTokens, measureContext, replaySystem } from './context-usage.js'

// Entry ids are branded numbers in the durable log; a fixture only has to be a number the code never prints.
const entry = (messages: readonly Message[], kind = 'pi.entry'): ContextView['entries'][number] =>
  ({ id: 1, conversationId: 1, kind, model: messages }) as ContextView['entries'][number]

const system = (
  content: string,
  rest: { sections?: Record<string, string | null>; toolsAdded?: Tool[]; toolsRemoved?: { name: string }[] } = {},
): Message => ({ role: 'system', content, timestamp: 0, ...rest })

const user = (content: string): Message => ({ role: 'user', content, timestamp: 0 })

const tool = (name: string, description = 'does a thing'): Tool => ({
  name,
  description,
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
})

const view = (messages: readonly Message[]): ContextView => {
  const entries = [entry(messages)]

  return {
    head: { id: 0, conversationId: 1, kind: 'pi.system' } as ContextView['entries'][number],
    entries,
    contributions: [messages],
    messages,
  }
}

describe('estimateTokens', () => {
  it('is free for empty text and never rounds down to zero', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('replaySystem', () => {
  it('keeps the base prompt, appends sections and applies later edits by name', () => {
    const { prompt } = replaySystem([
      entry([system('base')]),
      entry([system('', { sections: { instructions: 'first', skills: 'listed' } })]),
      entry([system('', { sections: { instructions: 'second', skills: null } })]),
    ])

    expect(prompt).toBe('base\n\nsecond')
  })

  it('adds a tool when it is declared and drops it when it is removed by name', () => {
    const { tools } = replaySystem([
      entry([system('', { toolsAdded: [tool('read'), tool('grep')] })]),
      entry([system('', { toolsRemoved: [{ name: 'read' }] })]),
    ])

    expect(tools.map((candidate) => candidate.name)).toEqual(['grep'])
  })

  it('lets the last declaration of one tool win', () => {
    const { tools } = replaySystem([
      entry([system('', { toolsAdded: [tool('read', 'old')] })]),
      entry([system('', { toolsAdded: [tool('read', 'new')] })]),
    ])

    expect(tools).toHaveLength(1)
    expect(tools[0]?.description).toBe('new')
  })
})

describe('measureContext', () => {
  it('splits the request and sums the categories into the used total', () => {
    const usage = measureContext(
      view([system('a system prompt'), user('hello there'), user('again')]),
      { provider: 'opencode-go', modelId: 'deepseek-v4.1-flash' },
      1000,
    )

    const byKind = Object.fromEntries(usage.categories.map((category) => [category.kind, category.tokens]))

    expect(byKind['systemPrompt']).toBe(estimateTokens('a system prompt'))
    // System messages are the prompt, not transcript: only the two user messages count as messages.
    expect(byKind['messages']).toBe(
      estimateTokens(JSON.stringify(user('hello there'))) + estimateTokens(JSON.stringify(user('again'))),
    )
    expect(byKind['systemTools']).toBe(0)
    expect(usage.used).toBe(usage.categories.reduce((total, category) => total + category.tokens, 0))
    expect(usage.remaining).toBe(1000 - usage.used)
    expect(usage.provider).toBe('opencode-go')
    expect(usage.modelId).toBe('deepseek-v4.1-flash')
  })

  it('counts a tool by its schema, not just its name', () => {
    const usage = measureContext(view([system('', { toolsAdded: [tool('read')] })]), null, null)
    const tools = usage.categories.find((category) => category.kind === 'systemTools')

    expect(tools?.tokens).toBeGreaterThan(estimateTokens('read'))
  })

  it('reports an unknown window as null rather than inventing one', () => {
    const usage = measureContext(view([user('hi')]), null, null)

    expect(usage.provider).toBeNull()
    expect(usage.modelId).toBeNull()
    expect(usage.contextWindow).toBeNull()
    expect(usage.remaining).toBeNull()
  })

  it('never reports negative room, however far the estimate overshoots', () => {
    const usage = measureContext(view([user('x'.repeat(400))]), null, 10)

    expect(usage.remaining).toBe(0)
  })
})
