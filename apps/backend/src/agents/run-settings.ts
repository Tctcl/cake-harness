import { AppError } from '../errors.js'
import type { AgentProfile, ThinkingLevel } from './agent-repository.js'

/** The model an agent runs when it names none: cheap, fast and reasoning, on the one provider served today. */
export const DEFAULT_MODEL_ID = 'deepseek-v4.1-flash'

/** The provider family every stored key belongs to. */
export const PROVIDER = 'opencode-go'

const KEY_SEPARATOR = '~'

/**
 * The model-runtime provider id of one stored key. Each key is registered as its own provider, so a conversation names
 * the key it is paid by through its model reference; pi-durable has no per-conversation credential otherwise.
 */
export const providerIdFor = (credentialId: string): string => `${PROVIDER}${KEY_SEPARATOR}${credentialId}`

/** The stored key a provider id names, or `undefined` for the bare provider (conversations created before keys). */
export const credentialIdOf = (providerId: string): string | undefined =>
  providerId.startsWith(`${PROVIDER}${KEY_SEPARATOR}`) ? providerId.slice(PROVIDER.length + 1) : undefined

/** What a workspace makes available to its agents. */
export interface WorkspaceReach {
  /** "Reach every capability": every key the owner stored and every model. */
  readonly allowAll: boolean
  /** Keys linked on the workspace's Providers tab. */
  readonly loginIds: readonly string[]
  readonly allowAllModels: boolean
  readonly allowedModels: readonly string[]
}

/** The owner's stored keys, newest first, and the models the provider is known to serve. */
export interface KeyCatalog {
  readonly loginIds: readonly string[]
  readonly modelIds: ReadonlySet<string>
}

export interface RunSettings {
  readonly model: { readonly provider: string; readonly modelId: string }
  readonly thinkingLevel: ThinkingLevel
  readonly credentialId: string
}

/** One conversation's departures from its agent. Null keeps the agent's setting. */
export interface RunSettingsOverrides {
  readonly credentialId: string | null
  readonly modelId: string | null
  readonly thinkingLevel: ThinkingLevel | null
}

export type RunSettingsPatch = Partial<RunSettingsOverrides>

/** Overlay a conversation's settings without ever writing them back to the agent profile. */
export const mergeRunSettings = (agent: AgentProfile, overrides: RunSettingsPatch = {}): AgentProfile => ({
  ...agent,
  credentialId: overrides.credentialId ?? agent.credentialId,
  modelId: overrides.modelId ?? agent.modelId,
  thinkingLevel: overrides.thinkingLevel ?? agent.thinkingLevel,
})

const keyUsable = (credentialId: string, reach: WorkspaceReach, keys: KeyCatalog): boolean =>
  keys.loginIds.includes(credentialId) && (reach.allowAll || reach.loginIds.includes(credentialId))

const modelAllowed = (modelId: string, reach: WorkspaceReach): boolean =>
  reach.allowAll || reach.allowAllModels || reach.allowedModels.includes(modelId)

/**
 * Refuses settings an agent could never run with, at the moment they are saved rather than at the first message: a key
 * the workspace does not link, a model the workspace does not allow, or one the provider does not serve.
 */
export const validateRunSettings = (
  settings: { readonly credentialId?: string | null | undefined; readonly modelId?: string | null | undefined },
  reach: WorkspaceReach,
  keys: KeyCatalog,
): void => {
  const { credentialId, modelId } = settings
  if (credentialId !== undefined && credentialId !== null && !keyUsable(credentialId, reach, keys)) {
    throw new AppError('That key is not linked to this workspace. Link it on the workspace’s Providers tab first.', {
      statusCode: 400,
      code: 'AGENT_KEY_NOT_LINKED',
    })
  }
  if (modelId === undefined || modelId === null) return

  if (!keys.modelIds.has(modelId)) {
    throw new AppError(`${modelId} is not a model OpenCode Go serves.`, { statusCode: 400, code: 'AGENT_MODEL_UNKNOWN' })
  }
  if (!modelAllowed(modelId, reach)) {
    throw new AppError(`${modelId} is not allowed in this workspace. Allow it on the Providers tab first.`, {
      statusCode: 400,
      code: 'AGENT_MODEL_NOT_ALLOWED',
    })
  }
}

/**
 * What a run uses, filling the agent's gaps: its own key, else the newest key the workspace links, else (in a workspace
 * that reaches everything) the owner's newest key; its own model, else the default. Refuses with a message that says
 * what to do, because the alternative is a run that fails somewhere nobody looks.
 */
export const resolveRunSettings = (agent: AgentProfile, reach: WorkspaceReach, keys: KeyCatalog): RunSettings => {
  const linked = keys.loginIds.filter((id) => reach.loginIds.includes(id))
  const credentialId =
    (agent.credentialId !== null && keyUsable(agent.credentialId, reach, keys) ? agent.credentialId : undefined) ??
    linked[0] ??
    (reach.allowAll ? keys.loginIds[0] : undefined)

  if (credentialId === undefined) {
    throw new AppError(
      'No OpenCode Go key reaches this agent. Add one in Settings → Credentials, then link it on the workspace’s Providers tab.',
      { statusCode: 409, code: 'AGENT_NO_KEY' },
    )
  }

  const modelId = agent.modelId ?? DEFAULT_MODEL_ID
  if (!modelAllowed(modelId, reach)) {
    throw new AppError(`This agent runs ${modelId}, which the workspace does not allow. Allow it on the Providers tab.`, {
      statusCode: 409,
      code: 'AGENT_MODEL_NOT_ALLOWED',
    })
  }

  return { model: { provider: providerIdFor(credentialId), modelId }, thinkingLevel: agent.thinkingLevel, credentialId }
}
