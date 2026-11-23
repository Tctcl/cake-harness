import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadJsonDocument } from '../config.js'
import { parseDesiredTooling, parseToolingState } from './parse.js'

const desiredPath = fileURLToPath(new URL('../../dev/desired-tooling.json', import.meta.url))

describe('parseDesiredTooling', () => {
  it('accepts the dummy document shipped for local development', () => {
    const config = loadJsonDocument(desiredPath, parseDesiredTooling)

    expect(config.schemaVersion).toBe(1)
    expect(config.tools.map((tool) => tool.id)).toEqual(['node', 'python', 'go', 'rust', 'php'])
    expect(config.tools.every((tool) => /^\d+\.\d+\.\d+$/.test(tool.version))).toBe(true)
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

describe('parseToolingState', () => {
  it('accepts a report with a null path', () => {
    const state = parseToolingState({
      schemaVersion: 1,
      reportedAt: '2026-11-23T12:00:00.000Z',
      tools: [{ id: 'node', version: '26.13.1', path: null, source: 'installed' }],
    })

    expect(state.tools[0]).toEqual({ id: 'node', version: '26.13.1', path: null, source: 'installed' })
  })

  it('rejects an unknown source', () => {
    expect(() =>
      parseToolingState({
        schemaVersion: 1,
        reportedAt: '2026-11-23T12:00:00.000Z',
        tools: [{ id: 'node', version: '26.13.1', path: null, source: 'downloaded' }],
      }),
    ).toThrow(/source must be "image" or "installed"/)
  })
})
