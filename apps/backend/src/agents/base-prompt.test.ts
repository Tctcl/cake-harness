import { describe, expect, it } from 'vitest'

import { composeSystemAppend } from './base-prompt.js'

describe('composeSystemAppend', () => {
  it('keeps only the agent append, trimmed, and omits an empty one', () => {
    expect(composeSystemAppend(' Act as a reviewer. ')).toBe('Act as a reviewer.')
    expect(composeSystemAppend('  ')).toBeUndefined()
    expect(composeSystemAppend('\n')).toBeUndefined()
  })
})
