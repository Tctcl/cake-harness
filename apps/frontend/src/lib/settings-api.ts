import { request } from './http.ts'
import type { ThinkingLevel } from './chat-api.ts'

export interface BackgroundModelEntry {
  readonly credentialId: string
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
}

export interface ApplicationSettings {
  readonly singleUser: boolean
  readonly requireTwoFactor: boolean
  readonly systemPrompt: string
  readonly defaultSystemPrompt: string
  readonly subagentSystemPrompt: string
  readonly defaultSubagentSystemPrompt: string
  readonly backgroundModel: readonly BackgroundModelEntry[]
}

export const readSettings = async (): Promise<ApplicationSettings> =>
  await request<ApplicationSettings>('/settings')

export const updateSettings = async (
  patch: Partial<Pick<ApplicationSettings, 'systemPrompt' | 'subagentSystemPrompt' | 'backgroundModel'>>,
): Promise<ApplicationSettings> =>
  await request<ApplicationSettings>('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
