import { createRegistry } from '@earendil-works/pi-durable'
import { createCodingTools } from '@earendil-works/pi-durable/tools'
import { describe, expect, it } from 'vitest'

import { createWebExtension } from '../capabilities/web.js'
import { selectTools } from './tool-selection.js'
import type { ToolSelectionInput } from './tool-selection.js'

const registry = createRegistry()
registry.install(createCodingTools())
registry.install(createWebExtension())
const snapshot = registry.snapshot()
const catalog = new Map([
  ['read-id', 'read'],
  ['write-id', 'write'],
  ['edit-id', 'edit'],
  ['bash-id', 'bash'],
  ['web-id', 'web_fetch'],
])

const input = (overrides: {
  workspace?: Partial<ToolSelectionInput['workspace']>
  agent?: Partial<ToolSelectionInput['agent']>
  hasEnvironment?: boolean
} = {}): ToolSelectionInput => ({
  workspace: { isDefault: false, ...overrides.workspace },
  agent: { allowAll: true, toolGrants: [], ...overrides.agent },
  hasEnvironment: overrides.hasEnvironment ?? true,
  catalog,
  registry: snapshot,
})

const names = (selection: ReturnType<typeof selectTools>): string[] =>
  selection.tools.map(({ name }) => name)

describe('selectTools', () => {
  it('gives an allowAll agent every available installed tool in registry order', () => {
    const selection = selectTools(input())

    expect(names(selection)).toEqual(['read', 'write', 'edit', 'bash', 'web_fetch'])
    expect(selection.extensions.map(({ name }) => name)).toEqual(['coding-tools', 'web'])
  })

  it('never gives the default workspace environment-backed tools', () => {
    const selection = selectTools(input({ workspace: { isDefault: true } }))

    expect(names(selection)).toEqual(['web_fetch'])
    expect(selection.extensions.map(({ name }) => name)).toEqual(['web'])
  })

  it('drops environment-backed tools when a non-default workspace has no environment', () => {
    expect(names(selectTools(input({ hasEnvironment: false })))).toEqual(['web_fetch'])
  })

  it('gives a restricted agent exactly its granted tools', () => {
    const selection = selectTools(input({
      agent: { allowAll: false, toolGrants: ['bash-id', 'web-id'] },
    }))

    expect(names(selection)).toEqual(['bash', 'web_fetch'])
  })

  it('filters unavailable environment tools out of explicit grants', () => {
    const selection = selectTools(input({
      workspace: { isDefault: true },
      agent: { allowAll: false, toolGrants: ['read-id', 'web-id'] },
    }))

    expect(names(selection)).toEqual(['web_fetch'])
  })

  it('ignores grants for ids absent from the live catalog', () => {
    const selection = selectTools(input({
      agent: { allowAll: false, toolGrants: ['missing-id'] },
    }))

    expect(selection).toEqual({ extensions: [], tools: [] })
  })
})
