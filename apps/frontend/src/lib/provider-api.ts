/**
 * Provider logins and the models behind them. A login is the user's, not a workspace's: it is stored once, and a
 * workspace links the ones it may use, the same way a tool or a prompt is granted rather than copied.
 *
 * The key itself never comes back from the server; it is sent once on `createLogin` and afterwards only named by label.
 */

import { request } from './http.ts'

/** One stored provider key, belonging to the user. Two keys on one provider are two logins. */
export interface ProviderLogin {
  readonly id: string
  readonly provider: string
  /** What the user called it, so two keys on one provider can be told apart. */
  readonly label: string
  readonly createdAt: string
}

/** What the catalog knows about a model, which is what a run reports once it uses one. */
export interface ProviderModel {
  /** Provider-qualified, e.g. `anthropic/claude-sonnet-4`, which is how a grant names a model. */
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly contextWindow: number | null
  readonly maxOutput: number | null
  readonly inputUsdPerMillion: number | null
  readonly outputUsdPerMillion: number | null
  readonly supportsReasoning: boolean
  readonly supportsTools: boolean
}

/** What a workspace may reach: the logins it links, and which of their models it allows. */
export interface WorkspaceProviders {
  readonly loginIds: readonly string[]
  /** Provider-qualified model ids. Meaningful only while the model's provider has a linked login. */
  readonly allowedModels: readonly string[]
  /** Every model any linked login reaches, so a model added later is allowed without being listed. */
  readonly allowAllModels: boolean
}

export interface ProviderLoginInput {
  readonly provider: string
  readonly label: string
  /** Sent once; the server stores it and answers with the login, never the key. */
  readonly key: string
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const listProviderLogins = async (): Promise<ProviderLogin[]> =>
  (await request<{ logins: ProviderLogin[] }>('/providers/logins')).logins

export const createProviderLogin = async (input: ProviderLoginInput): Promise<ProviderLogin> =>
  await request<ProviderLogin>('/providers/logins', json('POST', input))

/** Every model the user's logins reach; the workspace's selection is picked out of it. */
export const listProviderModels = async (): Promise<ProviderModel[]> =>
  (await request<{ models: ProviderModel[] }>('/providers/models')).models

export const getWorkspaceProviders = async (workspaceId: string): Promise<WorkspaceProviders> =>
  await request<WorkspaceProviders>(`/workspaces/${workspaceId}/providers`)

export const setWorkspaceProviders = async (
  workspaceId: string,
  providers: WorkspaceProviders,
): Promise<WorkspaceProviders> =>
  await request<WorkspaceProviders>(`/workspaces/${workspaceId}/providers`, json('PUT', providers))

/** What one provider has been used for since it was linked, in the units a run reports. */
export interface ProviderUsage {
  readonly provider: string
  /** Two keys on one provider are two logins; the panel says so rather than listing the same provider twice. */
  readonly loginCount: number
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
}

/** The usage of the providers this workspace reaches, one row per provider. */
export const listProviderUsage = async (workspaceId: string): Promise<ProviderUsage[]> =>
  (await request<{ usage: ProviderUsage[] }>(`/workspaces/${workspaceId}/providers/usage`)).usage
