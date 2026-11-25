import { createRegistry } from '@earendil-works/pi-durable'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { createCodingTools } from '@earendil-works/pi-durable/tools'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { afterAll, describe, expect, it } from 'vitest'

import { createCakeExtension } from './cake-extension.js'
import { createReadonlyToolsExtension } from '../capabilities/readonly-tools.js'
import { createWebExtension } from '../capabilities/web.js'
import { selectTools } from './tool-selection.js'
import type { ToolSelectionInput } from './tool-selection.js'

const registry = createRegistry()
const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 })
registry.install(createCodingTools())
registry.install(createReadonlyToolsExtension())
registry.install(createWebExtension())
registry.install(createCakeExtension(async () => 'Cake prompt'))
registry.install(createCodemodeExtension({ sandbox, models: false }))
const snapshot = registry.snapshot()
const catalog = new Map([
  ['read-id', 'read'],
  ['write-id', 'write'],
  ['edit-id', 'edit'],
  ['bash-id', 'bash'],
  ['web-id', 'web_fetch'],
  ['grep-id', 'grep'],
  ['find-id', 'find'],
  ['ls-id', 'ls'],
  ['git-id', 'git'],
  ['codemode-id', 'codemode'],
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
  afterAll(async () => sandbox.close())

  it('gives an allowAll agent every available installed tool in registry order', () => {
    const selection = selectTools(input())

    expect(names(selection)).toEqual([
      'read',
      'write',
      'edit',
      'bash',
      'grep',
      'find',
      'ls',
      'git',
      'web_fetch',
      'codemode',
    ])
    expect(selection.extensions.map(({ name }) => name)).toEqual([
      'cake',
      'coding-tools',
      'readonly-tools',
      'web',
      'codemode',
    ])
  })

  it('keeps code mode available in General but drops every environment-backed extension', () => {
    const selection = selectTools(input({ workspace: { isDefault: true } }))

    expect(names(selection)).toEqual(['web_fetch', 'codemode'])
    expect(selection.extensions.map(({ name }) => name)).toEqual(['cake', 'web', 'codemode'])
  })

  it('drops environment-backed tools when a non-default workspace has no environment', () => {
    expect(names(selectTools(input({ hasEnvironment: false })))).toEqual(['web_fetch', 'codemode'])
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

    expect(selection.extensions.map(({ name }) => name)).toEqual(['cake'])
    expect(selection.tools).toEqual([])
  })
})
