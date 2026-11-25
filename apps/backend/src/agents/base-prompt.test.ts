import { describe, expect, it } from 'vitest'

import { composeAgentInstructions } from './base-prompt.js'

describe('composeAgentInstructions', () => {
  it('labels agent append and instructions separately and omits empty parts', () => {
    expect(composeAgentInstructions(' Act as a reviewer. ', ' Never edit. ')).toBe(
      '## Agent\nAct as a reviewer.\n\n## Instructions\nNever edit.',
    )
    expect(composeAgentInstructions('', 'Keep it concise.')).toBe('## Instructions\nKeep it concise.')
    expect(composeAgentInstructions('Act as a reviewer.', '')).toBe('## Agent\nAct as a reviewer.')
    expect(composeAgentInstructions('  ', '\n')).toBeUndefined()
  })
})
