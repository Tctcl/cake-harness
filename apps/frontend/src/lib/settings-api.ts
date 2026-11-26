import { request } from './http.ts'

export interface ApplicationSettings {
  readonly singleUser: boolean
  readonly requireTwoFactor: boolean
  readonly systemPrompt: string
  readonly defaultSystemPrompt: string
  readonly subagentSystemPrompt: string
  readonly defaultSubagentSystemPrompt: string
}

export const readSettings = async (): Promise<ApplicationSettings> =>
  await request<ApplicationSettings>('/settings')

export const updateSettings = async (
  patch: Partial<Pick<ApplicationSettings, 'systemPrompt' | 'subagentSystemPrompt'>>,
): Promise<ApplicationSettings> =>
  await request<ApplicationSettings>('/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
