import type { AssistantMessage, Context } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'

import { THINKING_LEVELS } from '../agents/agent-repository.js'
import type { ThinkingLevel } from '../agents/agent-repository.js'
import { providerIdFor, validateRunSettings } from '../agents/run-settings.js'
import type { KeyCatalog } from '../agents/run-settings.js'

/** One background job's model choice. Unlike a run, it may move down this list when its key is exhausted. */
export interface BackgroundModelEntry {
  readonly credentialId: string
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
}

export type BackgroundModelChain = readonly BackgroundModelEntry[]

export type BackgroundModels = Pick<Models, 'getModel' | 'completeSimple'>

/** Validate global background choices against every stored key, not against one workspace's narrower grants. */
export const validateBackgroundModel = (chain: BackgroundModelChain, keys: KeyCatalog): void => {
  const everywhere = { allowAll: true, loginIds: [], allowAllModels: true, allowedModels: [] } as const
  for (const entry of chain) validateRunSettings(entry, everywhere, keys)
}

/** A hand-edited or old settings value fails closed: background work is opt-in, never borrowed from an agent's key. */
export const backgroundModelOr = (value: unknown, fallback: BackgroundModelChain): BackgroundModelChain => {
  if (!Array.isArray(value)) return fallback

  const entries: BackgroundModelEntry[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return fallback
    if (!('credentialId' in candidate) || typeof candidate.credentialId !== 'string') return fallback
    if (!('modelId' in candidate) || typeof candidate.modelId !== 'string') return fallback
    if (!('thinkingLevel' in candidate) || typeof candidate.thinkingLevel !== 'string') return fallback
    const thinkingLevel = THINKING_LEVELS.find((level) => level === candidate.thinkingLevel)
    if (thinkingLevel === undefined) return fallback
    entries.push({ credentialId: candidate.credentialId, modelId: candidate.modelId, thinkingLevel })
  }

  return entries
}

const failureText = (failure: unknown): string => {
  if (failure instanceof Error) return failure.message
  if (typeof failure === 'object' && failure !== null && 'errorMessage' in failure) {
    return typeof failure.errorMessage === 'string' ? failure.errorMessage : ''
  }

  return typeof failure === 'string' ? failure : ''
}

/**
 * True only when this key cannot spend more (or is no longer accepted). Network failures, model errors and ordinary
 * provider 5xx responses must not make a background job spend the next key.
 */
export const isOutOfUsageFailure = (failure: unknown): boolean => {
  const text = failureText(failure)
  if (/GoUsageLimitError/i.test(text)) return true

  const status = (code: number): boolean => new RegExp(`(?:^|\\D)${code}(?:\\D|$)`).test(text)
  if (status(429) && /(?:usage|quota|rate.?limit|too many requests)/i.test(text)) return true
  if ((status(401) || status(403)) && /(?:auth|key|credential|token|unauthori[sz]ed|forbidden|permission)/i.test(text)) {
    return true
  }

  return /(?:provider is not configured|authentication failed|invalid (?:api.?key|credential|token)|(?:api.?key|credential|token) (?:is )?(?:invalid|expired|revoked))/i.test(text)
}

/**
 * Make one non-durable completion. The next entry is attempted only after an explicit quota/auth failure; an ordinary
 * error is thrown on the spot, and a chain whose keys are all exhausted throws the last of those failures.
 */
export const completeWithBackgroundChain = async (
  models: BackgroundModels,
  chain: BackgroundModelChain,
  context: Context,
): Promise<AssistantMessage> => {
  if (chain.length === 0) throw new Error('the background model chain is empty')

  let exhausted: unknown
  for (const entry of chain) {
    try {
      const model = models.getModel(providerIdFor(entry.credentialId), entry.modelId)
      if (model === undefined) throw new Error(`Background model is not installed: ${entry.modelId}`)
      const options = entry.thinkingLevel === 'off' ? {} : { reasoning: entry.thinkingLevel }
      const result = await models.completeSimple(model, context, options)
      if (result.stopReason === 'error') throw new Error(result.errorMessage ?? 'Background model failed')

      return result
    } catch (failure) {
      if (!isOutOfUsageFailure(failure)) throw failure
      exhausted = failure
    }
  }

  throw exhausted
}
