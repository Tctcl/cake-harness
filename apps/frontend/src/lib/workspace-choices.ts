import type { WorkspaceSummary } from './chat-api.ts'
import type { ProviderLogin, ProviderModel, WorkspaceProviders } from './provider-api.ts'

/** The keys and models a workspace offers, shared by agent defaults and per-conversation overrides. */
export interface Choices {
  readonly keys: readonly ProviderLogin[]
  readonly models: readonly ProviderModel[]
}

export const choicesOf = (
  workspace: WorkspaceSummary,
  logins: readonly ProviderLogin[],
  models: readonly ProviderModel[],
  providers: WorkspaceProviders,
): Choices => ({
  keys: workspace.allowAll ? logins : logins.filter((login) => providers.loginIds.includes(login.id)),
  models:
    workspace.allowAll || providers.allowAllModels
      ? models
      : models.filter((model) => providers.allowedModels.includes(model.id)),
})
