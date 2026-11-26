import { createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { createCodingTools } from '@earendil-works/pi-durable/tools'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { afterAll, describe, expect, it } from 'vitest'

import { createCakeExtension, createSubagentCakeExtension } from './cake-extension.js'
import { createAskUserExtension } from '../capabilities/ask-user.js'
import { createReadonlyToolsExtension } from '../capabilities/readonly-tools.js'
import { createWebExtension } from '../capabilities/web.js'
import { selectTools } from './tool-selection.js'
import type { ToolSelectionInput } from './tool-selection.js'

const registry = createRegistry()
const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 })
// The same order agent.ts installs them in, so "registry order" below is the order a real run offers tools.
registry.install(createCakeExtension(async () => 'Cake prompt'))
registry.install(createSubagentCakeExtension(async () => 'Subagent prompt'))
registry.install(createCodingTools())
registry.install(createReadonlyToolsExtension())
registry.install(createWebExtension())
registry.install(createCodemodeExtension({ sandbox, models: false }))
registry.install(createAskUserExtension())
registry.install(defineExtension({
  name: 'delegate',
  tools: [defineTool({
    name: 'delegate',
    description: 'Delegate work',
    parameters: { type: 'object' },
    execute: async () => ({ output: [] }),
  })],
}))
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
  ['ask-user-id', 'ask_user'],
])

const input = (overrides: {
  workspace?: Partial<ToolSelectionInput['workspace']>
  agent?: Partial<ToolSelectionInput['agent']>
  hasEnvironment?: boolean
  subagent?: boolean
  canDelegate?: boolean
} = {}): ToolSelectionInput => ({
  workspace: { isDefault: false, ...overrides.workspace },
  agent: { allowAll: true, toolGrants: [], ...overrides.agent },
  hasEnvironment: overrides.hasEnvironment ?? true,
  catalog,
  registry: snapshot,
  ...(overrides.subagent === undefined ? {} : { subagent: overrides.subagent }),
  ...(overrides.canDelegate === undefined ? {} : { canDelegate: overrides.canDelegate }),
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
      'ask_user',
    ])
    expect(selection.extensions.map(({ name }) => name)).toEqual([
      'cake',
      'coding-tools',
      'readonly-tools',
      'web',
      'codemode',
      'ask-user',
    ])
  })

  it('keeps code mode in General but drops environment tools even though its container exists', () => {
    const selection = selectTools(input({ workspace: { isDefault: true } }))

    expect(names(selection)).toEqual(['web_fetch', 'codemode', 'ask_user'])
    expect(selection.extensions.map(({ name }) => name)).toEqual(['cake', 'web', 'codemode', 'ask-user'])
  })

  it('drops environment-backed tools when a non-default workspace has no environment', () => {
    expect(names(selectTools(input({ hasEnvironment: false })))).toEqual(['web_fetch', 'codemode', 'ask_user'])
  })

  it('gives a restricted agent exactly its granted tools', () => {
    const selection = selectTools(input({
      agent: { allowAll: false, toolGrants: ['bash-id', 'web-id', 'ask-user-id'] },
    }))

    expect(names(selection)).toEqual(['bash', 'web_fetch', 'ask_user'])
  })

  it('filters unavailable environment tools out of explicit grants', () => {
    const selection = selectTools(input({
      workspace: { isDefault: true },
      agent: { allowAll: false, toolGrants: ['read-id', 'web-id', 'ask-user-id'] },
    }))

    expect(names(selection)).toEqual(['web_fetch', 'ask_user'])
  })

  it('ignores grants for ids absent from the live catalog', () => {
    const selection = selectTools(input({
      agent: { allowAll: false, toolGrants: ['missing-id'] },
    }))

    expect(selection.extensions.map(({ name }) => name)).toEqual(['cake'])
    expect(selection.tools).toEqual([])
  })

  it('offers delegate only to an ordinary agent with callable sub agents', () => {
    expect(names(selectTools(input()))).not.toContain('delegate')
    const selection = selectTools(input({ canDelegate: true }))

    expect(names(selection)).toContain('delegate')
    expect(selection.extensions.map(({ name }) => name)).toContain('delegate')
  })

  it('uses the subagent prompt and strips ask_user and delegate even when granted', () => {
    const selection = selectTools(input({ subagent: true, canDelegate: true }))

    expect(names(selection)).not.toContain('ask_user')
    expect(names(selection)).not.toContain('delegate')
    expect(selection.extensions.map(({ name }) => name)).toContain('cake-subagent')
    expect(selection.extensions.map(({ name }) => name)).not.toContain('cake')
    expect(selection.extensions.map(({ name }) => name)).not.toContain('delegate')
  })
})
