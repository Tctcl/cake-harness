import { describe, expect, it } from 'vitest'

import { lowestFreeSshPort, parseSshPortRange } from './ssh-ports.js'

describe('SSH port allocation', () => {
  it('parses an inclusive range and rejects invalid bounds', () => {
    expect(parseSshPortRange('22000-22999')).toEqual({ first: 22_000, last: 22_999 })
    expect(parseSshPortRange('23000-22000')).toBeNull()
    expect(parseSshPortRange('0-10')).toBeNull()
    expect(parseSshPortRange('1-65536')).toBeNull()
    expect(parseSshPortRange('22000')).toBeNull()
  })

  it('chooses the lowest free port and reports an exhausted range', () => {
    expect(lowestFreeSshPort(new Set([22_000, 22_001, 22_003]), { first: 22_000, last: 22_004 })).toBe(22_002)
    expect(lowestFreeSshPort(new Set([22_000, 22_001]), { first: 22_000, last: 22_001 })).toBeNull()
  })
})
