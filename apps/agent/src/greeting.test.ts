import { describe, expect, it } from 'vitest'

import { greeting } from './greeting.js'

describe('greeting', () => {
  it('is the placeholder used by the entry point', () => {
    expect(greeting).toBe('Hello, World!')
  })
})
