import { describe, expect, it } from 'vitest'

import { parseDesiredTooling } from './parse.js'

describe('parseDesiredTooling', () => {
  it('accepts a document with exact versions', () => {
    const config = parseDesiredTooling({
      schemaVersion: 1,
      tools: [
        { id: 'node', version: '26.13.1' },
        { id: 'python', version: '3.13.4' },
      ],
    })

    expect(config.tools.map((tool) => tool.id)).toEqual(['node', 'python'])
    expect(config.tools.every((tool) => /^\d+\.\d+\.\d+$/.test(tool.version))).toBe(true)
  })

  it('accepts apt and npm package entries with their installer metadata', () => {
    const config = parseDesiredTooling({
      schemaVersion: 1,
      tools: [{ id: 'npm:cowsay', kind: 'npm', name: 'cowsay', version: 'latest' }],
    })

    expect(config.tools[0]).toEqual({ id: 'npm:cowsay', kind: 'npm', name: 'cowsay', version: 'latest' })
    expect(() => parseDesiredTooling({
      schemaVersion: 1,
      tools: [{ id: 'apt:jq', kind: 'apt', version: 'latest' }],
    })).toThrow(/name must be a non-empty string/)
  })

  it('rejects an unknown schema version instead of guessing', () => {
    expect(() => parseDesiredTooling({ schemaVersion: 2, tools: [] })).toThrow(/schemaVersion must be 1/)
  })

  it('rejects a non-string version', () => {
    expect(() => parseDesiredTooling({ schemaVersion: 1, tools: [{ id: 'node', version: 26 }] })).toThrow(
      /tools\[0\]\.version must be a non-empty string/,
    )
  })

  it('rejects a version range, because a range cannot be reconciled', () => {
    expect(() => parseDesiredTooling({ schemaVersion: 1, tools: [{ id: 'node', version: '' }] })).toThrow(
      /must be a non-empty string/,
    )
  })
})
