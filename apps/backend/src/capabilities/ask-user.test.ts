import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Context } from '@earendil-works/chord/context'
import { describe, expect, it, vi } from 'vitest'

import { ASK_USER_ANSWER, executeAskUser } from './ask-user.js'
import type { AskUserQuestion } from './ask-user.js'

describe('ask_user', () => {
  it('parks on its answer signal, then returns the delivered answer when woken', async () => {
    const details = vi.fn(async (_value: AskUserQuestion, _context: Context) => {})
    const api = {
      callId: 'call-1',
      wake: undefined,
      checkpoint: undefined,
      details,
      readSignal: async () => undefined,
    }

    const parked = await executeAskUser(
      { question: 'Choose a release channel', options: ['Stable', 'Preview'], allowFreeText: false },
      api,
      BACKGROUND_CONTEXT,
    )

    expect(parked).toEqual({
      sleep: {
        signals: [ASK_USER_ANSWER.key('call-1')],
        checkpoint: {
          text: 'Choose a release channel',
          options: ['Stable', 'Preview'],
          allowFreeText: false,
        },
      },
    })
    expect(details).toHaveBeenCalledWith(
      { text: 'Choose a release channel', options: ['Stable', 'Preview'], allowFreeText: false },
      BACKGROUND_CONTEXT,
    )

    const resumed = await executeAskUser(
      { question: 'Choose a release channel', options: ['Stable', 'Preview'], allowFreeText: false },
      {
        ...api,
        wake: { reason: 'signal', signal: ASK_USER_ANSWER.name, key: 'call-1' },
        readSignal: async () => ({ value: 'Preview' }),
      },
      BACKGROUND_CONTEXT,
    )

    expect(resumed).toEqual({ output: [{ type: 'text', text: 'The user answered: Preview' }] })
  })
})
