import { describe, expect, it } from 'vitest'

import type { AgentProfile } from './agent-repository.js'
import {
  credentialIdOf,
  mergeRunSettings,
  providerIdFor,
  resolveRunSettings,
  validateRunSettings,
  validateSubagentRunSettings,
} from './run-settings.js'
import type { KeyCatalog, WorkspaceReach } from './run-settings.js'

const agent = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'agent-1',
  kind: 'agent',
  workspaceId: 'ws-1',
  name: 'Coder',
  description: '',
  isDefault: false,
  allowAll: true,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low',
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const reach = (overrides: Partial<WorkspaceReach> = {}): WorkspaceReach => ({
  allowAll: false,
  loginIds: [],
  allowAllModels: false,
  allowedModels: [],
  ...overrides,
})

/** Two stored keys, newest first, and part of the provider's catalog. */
const keys: KeyCatalog = { loginIds: ['new', 'old'], modelIds: new Set(['deepseek-v4.1-flash', 'kimi-k3']) }

describe('provider ids', () => {
  it('round-trips a key id through its provider id, and leaves the bare provider alone', () => {
    expect(providerIdFor('abc')).toBe('opencode-go~abc')
    expect(credentialIdOf('opencode-go~abc')).toBe('abc')
    expect(credentialIdOf('opencode-go')).toBeUndefined()
    expect(credentialIdOf('anthropic~abc')).toBeUndefined()
  })
})

describe('mergeRunSettings', () => {
  it('overlays only the fields a conversation overrides and leaves the agent unchanged', () => {
    const profile = agent({ credentialId: 'old', modelId: 'kimi-k3', thinkingLevel: 'low' })
    const merged = mergeRunSettings(profile, { credentialId: 'new', thinkingLevel: 'high' })

    expect(merged).toMatchObject({ credentialId: 'new', modelId: 'kimi-k3', thinkingLevel: 'high' })
    expect(profile).toMatchObject({ credentialId: 'old', modelId: 'kimi-k3', thinkingLevel: 'low' })
  })

  it('uses the agent setting wherever a conversation override is null or omitted', () => {
    const profile = agent({ credentialId: 'old', modelId: 'kimi-k3', thinkingLevel: 'medium' })

    expect(mergeRunSettings(profile)).toEqual(profile)
    expect(
      mergeRunSettings(profile, { credentialId: null, modelId: null, thinkingLevel: null }),
    ).toEqual(profile)
  })
})

describe('resolveRunSettings', () => {
  it('uses the agent s own key, model and thinking level when the workspace allows them', () => {
    const settings = resolveRunSettings(
      agent({ credentialId: 'old', modelId: 'kimi-k3', thinkingLevel: 'high' }),
      reach({ loginIds: ['old'], allowedModels: ['kimi-k3'] }),
      keys,
    )

    expect(settings).toEqual({
      model: { provider: 'opencode-go~old', modelId: 'kimi-k3' },
      thinkingLevel: 'high',
      credentialId: 'old',
    })
  })

  it('falls back to the newest key the workspace links, then to the default model', () => {
    const settings = resolveRunSettings(agent(), reach({ loginIds: ['old', 'new'], allowAllModels: true }), keys)

    expect(settings.model).toEqual({ provider: 'opencode-go~new', modelId: 'deepseek-v4.1-flash' })
  })

  it('lets a workspace that reaches everything use the owner s newest key and any model', () => {
    expect(resolveRunSettings(agent(), reach({ allowAll: true }), keys).credentialId).toBe('new')
  })

  it('ignores an agent key the workspace no longer links instead of running with it', () => {
    expect(resolveRunSettings(agent({ credentialId: 'old' }), reach({ loginIds: ['new'], allowAllModels: true }), keys)
      .credentialId).toBe('new')
  })

  it('refuses with what to do when no key reaches the agent', () => {
    expect(() => resolveRunSettings(agent(), reach(), keys)).toThrow(expect.objectContaining({ code: 'AGENT_NO_KEY' }))
    expect(() => resolveRunSettings(agent(), reach({ allowAll: true }), { ...keys, loginIds: [] })).toThrow(
      /Settings → Credentials/,
    )
  })

  it('refuses a model the workspace does not allow', () => {
    expect(() => resolveRunSettings(agent({ modelId: 'kimi-k3' }), reach({ loginIds: ['new'] }), keys)).toThrow(
      expect.objectContaining({ code: 'AGENT_MODEL_NOT_ALLOWED', statusCode: 409 }),
    )
  })
})

describe('validateSubagentRunSettings', () => {
  it('requires a unique allowed list containing the default and validates every model and the key', () => {
    const valid = {
      credentialId: 'new',
      modelId: 'deepseek-v4.1-flash',
      allowedModels: ['deepseek-v4.1-flash', 'kimi-k3'],
    }
    expect(() => validateSubagentRunSettings(
      valid,
      reach({ loginIds: ['new'], allowedModels: valid.allowedModels }),
      keys,
    )).not.toThrow()
    expect(() => validateSubagentRunSettings(
      { ...valid, modelId: 'gpt-1', allowedModels: ['deepseek-v4.1-flash'] },
      reach({ loginIds: ['new'], allowAllModels: true }),
      keys,
    )).toThrow(expect.objectContaining({ code: 'SUBAGENT_DEFAULT_MODEL_NOT_ALLOWED' }))
    expect(() => validateSubagentRunSettings(
      { ...valid, allowedModels: ['deepseek-v4.1-flash', 'deepseek-v4.1-flash'] },
      reach({ loginIds: ['new'], allowAllModels: true }),
      keys,
    )).toThrow(expect.objectContaining({ code: 'SUBAGENT_MODELS_INVALID' }))
    expect(() => validateSubagentRunSettings(
      valid,
      reach({ loginIds: ['new'], allowedModels: ['deepseek-v4.1-flash'] }),
      keys,
    )).toThrow(expect.objectContaining({ code: 'AGENT_MODEL_NOT_ALLOWED' }))
  })
})

describe('validateRunSettings', () => {
  it('accepts a linked key and an allowed, known model, and leaves unset fields alone', () => {
    expect(() =>
      validateRunSettings({ credentialId: 'new', modelId: 'kimi-k3' }, reach({ loginIds: ['new'], allowedModels: ['kimi-k3'] }), keys),
    ).not.toThrow()
    expect(() => validateRunSettings({}, reach(), keys)).not.toThrow()
    expect(() => validateRunSettings({ credentialId: null, modelId: null }, reach(), keys)).not.toThrow()
  })

  it('names the problem: an unlinked key, an unknown model, a disallowed model', () => {
    expect(() => validateRunSettings({ credentialId: 'old' }, reach({ loginIds: ['new'] }), keys)).toThrow(
      expect.objectContaining({ code: 'AGENT_KEY_NOT_LINKED', statusCode: 400 }),
    )
    expect(() => validateRunSettings({ modelId: 'gpt-1' }, reach({ allowAllModels: true }), keys)).toThrow(
      expect.objectContaining({ code: 'AGENT_MODEL_UNKNOWN' }),
    )
    expect(() => validateRunSettings({ modelId: 'kimi-k3' }, reach(), keys)).toThrow(
      expect.objectContaining({ code: 'AGENT_MODEL_NOT_ALLOWED' }),
    )
  })
})
