import type { EntryRecord } from '@earendil-works/pi-durable'
import { CompactionEntry, ResetEntry, SystemEntry } from '@earendil-works/pi-durable'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { chatMessages, resolveThreadTarget, toolCalls } from './agent.js'

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

describe('resolveThreadTarget', () => {
  it('does not allow a subagent to own a user-facing chat thread', async () => {
    await expect(resolveThreadTarget(
      { find: async () => ({ id: 'workspace', archivedAt: null }) } as never,
      { find: async () => ({ id: 'subagent', kind: 'subagent', workspaceId: 'workspace', archivedAt: null }) } as never,
      'owner',
      { title: null, workspaceId: 'workspace', agentId: 'subagent' },
    )).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND', statusCode: 404 })
  })
})

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

  it('projects system prompt sections and tool changes as a context line', () => {
    const messages = chatMessages([
      entry(14, SystemEntry.kind, {
        model: [{
          role: 'system',
          content: '',
          sections: { 'cake-system': 'Base prompt', instructions: null },
          toolsAdded: [{ name: 'read', description: 'Read files', parameters: { type: 'object' } }],
          toolsRemoved: [{ name: 'write' }],
          timestamp: 0,
        }],
      }),
    ])

    expect(messages).toEqual([
      {
        id: 14,
        role: 'context',
        text: '',
        blocks: [],
        stopReason: null,
        errorMessage: null,
        reason: null,
        sections: [
          { key: 'cake-system', text: 'Base prompt' },
          { key: 'instructions', text: null },
        ],
        toolsAdded: ['read'],
        toolsRemoved: ['write'],
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
        truncated: false,
        fullByteLength: Buffer.byteLength('{"path":"README.md"}') + Buffer.byteLength('# Cake'),
      },
    ])
  })

  it('clips stream text while reporting truncation and the full UTF-8 byte length', () => {
    const output = 'a'.repeat(4001)
    const calls = toolCalls([
      entry(30, 'pi.assistant', {
        model: [
          assistant([
            { type: 'toolCall', id: 'call-large', name: 'read', arguments: { path: output } },
          ]),
        ],
      }),
      entry(31, 'pi.tool-result', {
        model: [
          {
            role: 'toolResult',
            toolCallId: 'call-large',
            toolName: 'read',
            content: [{ type: 'text', text: output }],
            isError: false,
            timestamp: 1,
          },
        ],
      }),
    ])

    expect(calls[0]).toMatchObject({
      truncated: true,
      fullByteLength: Buffer.byteLength(JSON.stringify({ path: output })) + Buffer.byteLength(output),
      arguments: `${JSON.stringify({ path: output }).slice(0, 4000)}…`,
      result: `${output.slice(0, 4000)}…`,
    })
  })
})
