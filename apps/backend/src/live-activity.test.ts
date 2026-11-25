import { describe, expect, it } from 'vitest'

import { TOOL_TEXT_LIMIT, liveActivity } from './live-activity.js'

// Only the shape matters here: the mapper reads content and slots, never the ledger.
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

describe('liveActivity', () => {
  it('reports an idle conversation as empty rather than inventing work', () => {
    expect(liveActivity(undefined)).toEqual({
      blocks: [],
      tools: [],
      turns: 0,
      compacting: 0,
      failure: null,
    })
    expect(liveActivity({})).toEqual({
      blocks: [],
      tools: [],
      turns: 0,
      compacting: 0,
      failure: null,
    })
  })

  it('keeps the streaming answer in the order the provider produced it', () => {
    const activity = liveActivity({
      generation: {
        attempt: 1,
        message: {
          role: 'assistant',
          api: 'opencode-go',
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          stopReason: 'stop',
          timestamp: 0,
          content: [
            { type: 'thinking', thinking: 'weighing the options' },
            { type: 'text', text: 'First, ' },
            { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a' } },
            { type: 'text', text: 'then this.' },
          ],
          usage: USAGE,
        },
      },
    })

    expect(activity.blocks).toEqual([
      { type: 'thinking', text: 'weighing the options', redacted: false },
      { type: 'text', text: 'First, ' },
      { type: 'toolCall', callId: 'call-1', name: 'read', arguments: '{"path":"a"}' },
      { type: 'text', text: 'then this.' },
    ])
  })

  it('keeps redacted reasoning visible as a block, with no text and the flag set', () => {
    const activity = liveActivity({
      generation: {
        attempt: 1,
        message: {
          role: 'assistant',
          api: 'opencode-go',
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          stopReason: 'stop',
          timestamp: 0,
          content: [{ type: 'thinking', thinking: '', thinkingSignature: 'opaque', redacted: true }],
          usage: USAGE,
        },
      },
    })

    expect(activity.blocks).toEqual([{ type: 'thinking', text: '', redacted: true }])
  })

  it('drops an empty text block so a blank line never renders', () => {
    const activity = liveActivity({
      generation: {
        attempt: 1,
        message: {
          role: 'assistant',
          api: 'opencode-go',
          provider: 'opencode-go',
          model: 'deepseek-v4.1-flash',
          stopReason: 'stop',
          timestamp: 0,
          content: [{ type: 'text', text: '' }],
          usage: USAGE,
        },
      },
    })

    expect(activity.blocks).toEqual([])
  })

  it('carries the running tool round with its output, what was dropped, and its diagnostics', () => {
    const long = 'x'.repeat(TOOL_TEXT_LIMIT + 10)
    const activity = liveActivity({
      tools: [
        { callId: 'call-1', name: 'read', status: 'running', output: long, droppedLines: 3 },
        {
          callId: 'call-2',
          name: 'grep',
          status: 'pending',
          diagnostics: [{ severity: 'warn', message: 'the pattern matched nothing' }],
        },
        { callId: 'call-3', name: 'bash', status: 'done' },
      ],
      run: {
        taskId: 7 as never,
        inputs: [],
        turns: 2,
      },
      compactions: [
        { taskId: 9 as never, trigger: 'threshold', blocking: false, attempt: 1 },
      ],
    })

    expect(activity.turns).toBe(2)
    expect(activity.compacting).toBe(1)
    expect(activity.tools).toEqual([
      {
        id: 'call-1',
        name: 'read',
        status: 'running',
        output: `${long.slice(0, TOOL_TEXT_LIMIT)}\u2026`,
        droppedBytes: 0,
        droppedLines: 3,
        diagnostics: [],
        question: null,
      },
      {
        id: 'call-2',
        name: 'grep',
        status: 'pending',
        output: null,
        droppedBytes: 0,
        droppedLines: 0,
        diagnostics: ['the pattern matched nothing'],
        question: null,
      },
      {
        id: 'call-3',
        name: 'bash',
        status: 'done',
        output: null,
        droppedBytes: 0,
        droppedLines: 0,
        diagnostics: [],
        question: null,
      },
    ])
  })

  it('exposes an ask_user question from its live tool details', () => {
    const activity = liveActivity({
      tools: [
        {
          callId: 'question-call',
          name: 'ask_user',
          status: 'sleeping',
          details: { text: 'Which option?', options: ['A', 'B'], allowFreeText: false },
        },
      ],
    })

    expect(activity.tools[0]?.question).toEqual({
      text: 'Which option?',
      options: ['A', 'B'],
      allowFreeText: false,
    })
  })

  it('reports why a run ended without an answer, with its detail when there is one', () => {
    expect(
      liveActivity({
        runFailure: { taskId: 4 as never, inputs: [], reason: 'turn_limit', detail: '2 turns' },
      }).failure,
    ).toEqual({ reason: 'turn_limit', detail: '2 turns' })

    expect(
      liveActivity({ runFailure: { taskId: 4 as never, inputs: [], reason: 'aborted' } }).failure,
    ).toEqual({ reason: 'aborted', detail: null })
  })
})
