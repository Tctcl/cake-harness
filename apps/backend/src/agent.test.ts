import type { EntryRecord } from '@earendil-works/pi-durable'
import { CompactionEntry, ResetEntry } from '@earendil-works/pi-durable'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { chatMessages, toolCalls } from './agent.js'

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

// Entry and conversation ids are branded numbers; these fixtures only need stable numeric identities.
const entry = (id: number, kind: string, rest: Partial<EntryRecord> = {}): EntryRecord =>
  ({ id, conversationId: 1, kind, ...rest }) as EntryRecord

const assistant = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
  errorMessage?: string,
): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'opencode-go',
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
  usage: USAGE,
  stopReason,
  timestamp: 0,
  ...(errorMessage === undefined ? {} : { errorMessage }),
})

const user = (content: string): Message => ({ role: 'user', content, timestamp: 0 })

describe('chatMessages', () => {
  it('keeps thinking and text blocks in their original order, including redacted thinking', () => {
    const messages = chatMessages([
      entry(7, 'pi.assistant', {
        model: [
          assistant([
            { type: 'thinking', thinking: 'first thought' },
            { type: 'text', text: 'before ' },
            { type: 'thinking', thinking: '', thinkingSignature: 'opaque', redacted: true },
            { type: 'text', text: 'after' },
          ]),
        ],
      }),
    ])

    expect(messages).toEqual([
      {
        id: 7,
        role: 'assistant',
        text: 'before after',
        blocks: [
          { type: 'thinking', text: 'first thought', redacted: false },
          { type: 'text', text: 'before ' },
          { type: 'thinking', text: '', redacted: true },
          { type: 'text', text: 'after' },
        ],
        stopReason: 'stop',
        errorMessage: null,
        reason: null,
      },
    ])
  })

  it('keeps an assistant entry that contains only a tool call', () => {
    const messages = chatMessages([
      entry(8, 'pi.assistant', {
        model: [
          assistant([
            { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
          ]),
        ],
      }),
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 8,
      role: 'assistant',
      text: '',
      blocks: [
        { type: 'toolCall', callId: 'call-1', name: 'read', arguments: '{"path":"README.md"}' },
      ],
    })
  })

  it('carries an assistant failure even when the answer has no content', () => {
    const messages = chatMessages([
      entry(9, 'pi.assistant', { model: [assistant([], 'error', 'provider disconnected')] }),
    ])

    expect(messages).toEqual([
      {
        id: 9,
        role: 'assistant',
        text: '',
        blocks: [],
        stopReason: 'error',
        errorMessage: 'provider disconnected',
        reason: null,
      },
    ])
  })

  it('projects compaction and reset entries as their own visible line kinds', () => {
    const messages = chatMessages([
      entry(10, CompactionEntry.kind, {
        model: [user('summary of the earlier context')],
        data: { reason: 'threshold' },
      }),
      entry(11, ResetEntry.kind, { model: [user('continue with this handoff')] }),
      entry(12, ResetEntry.kind),
    ])

    expect(messages).toEqual([
      {
        id: 10,
        role: 'compaction',
        text: 'summary of the earlier context',
        blocks: [{ type: 'text', text: 'summary of the earlier context' }],
        stopReason: null,
        errorMessage: null,
        reason: 'threshold',
      },
      {
        id: 11,
        role: 'reset',
        text: 'continue with this handoff',
        blocks: [{ type: 'text', text: 'continue with this handoff' }],
        stopReason: null,
        errorMessage: null,
        reason: null,
      },
      {
        id: 12,
        role: 'reset',
        text: '',
        blocks: [],
        stopReason: null,
        errorMessage: null,
        reason: null,
      },
    ])
  })

  it('gives user lines the same ordered block shape', () => {
    expect(chatMessages([entry(13, 'pi.user', { model: [user('hello')] })])).toEqual([
      {
        id: 13,
        role: 'user',
        text: 'hello',
        blocks: [{ type: 'text', text: 'hello' }],
        stopReason: null,
        errorMessage: null,
        reason: null,
      },
    ])
  })
})

describe('toolCalls', () => {
  it('joins a result to its call and retains the assistant entry id', () => {
    const calls = toolCalls([
      entry(20, 'pi.assistant', {
        model: [
          assistant([
            { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
          ]),
        ],
      }),
      entry(21, 'pi.tool-result', {
        model: [
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'read',
            content: [{ type: 'text', text: '# Cake' }],
            isError: false,
            timestamp: 1,
            durationMs: 12,
          },
        ],
      }),
    ])

    expect(calls).toEqual([
      {
        id: 'call-1',
        entryId: 20,
        name: 'read',
        arguments: '{"path":"README.md"}',
        status: 'ok',
        result: '# Cake',
        durationMs: 12,
      },
    ])
  })
})
