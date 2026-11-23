import { describe, expect, it } from 'vitest'

import { DETECTORS, parseToolVersion } from './detect.js'

describe('parseToolVersion', () => {
  it('reads the version each supported tool actually prints', () => {
    expect(parseToolVersion('node', 'v22.21.1\n')).toBe('22.21.1')
    expect(parseToolVersion('python', 'Python 3.11.2\n')).toBe('3.11.2')
    expect(parseToolVersion('go', 'go version go1.25.3 linux/amd64\n')).toBe('1.25.3')
    expect(parseToolVersion('rust', 'rustc 1.91.0 (1d1a7c2e4 2026-11-01)\n')).toBe('1.91.0')
    expect(parseToolVersion('php', 'PHP 8.4.14 (cli) (built: Oct 22 2026)\n')).toBe('8.4.14')
    expect(parseToolVersion('ruby', 'ruby 3.4.5 (2026-09-16 revision 1a2b3c) [x86_64-linux]\n')).toBe('3.4.5')
  })

  it('returns null for output it cannot read', () => {
    expect(parseToolVersion('node', 'command not found\n')).toBeNull()
    expect(parseToolVersion('python', '')).toBeNull()
  })

  it('returns null for a tool with no detector', () => {
    expect(parseToolVersion('brainfuck', 'brainfuck 1.0.0')).toBeNull()
    expect(DETECTORS['brainfuck']).toBeUndefined()
  })

  it('does not mistake the year in a build stamp for the version', () => {
    expect(parseToolVersion('rust', 'rustc 1.91.0 (2026-11-01)\n')).toBe('1.91.0')
  })
})
