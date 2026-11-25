import type { Extension, RegistrySnapshot, ToolRegistration } from '@earendil-works/pi-durable'

export const CODING_TOOLS_EXTENSION = 'coding-tools'

export interface ToolSelectionInput {
  readonly workspace: {
    readonly isDefault: boolean
    readonly allowAll: boolean
    readonly toolGrants: readonly string[]
  }
  readonly agent: {
    readonly allowAll: boolean
    readonly toolGrants: readonly string[]
  }
  /** A workspace with an environment gets one even while its container is stopped. */
  readonly hasEnvironment: boolean
  /** Live tool catalog rows, keyed by the id stored in grant links. */
  readonly catalog: ReadonlyMap<string, string>
  readonly registry: RegistrySnapshot
}

export interface ToolSelection {
  readonly extensions: readonly Extension[]
  readonly tools: readonly ToolRegistration[]
}

const grantedNames = (ids: readonly string[], catalog: ReadonlyMap<string, string>): Set<string> => {
  const names = new Set<string>()
  for (const id of ids) {
    const name = catalog.get(id)
    if (name !== undefined) names.add(name)
  }

  return names
}

/**
 * Resolve durable's object-valued AgentChange from the two grant sets. The workspace is always the ceiling; an agent
 * with allowAll inherits that ceiling rather than escaping it. Only coding-tools needs an ExecutionEnv, so web remains
 * available in General and in a non-default workspace whose environment link is absent.
 */
export const selectTools = (input: ToolSelectionInput): ToolSelection => {
  const registered = input.registry.tools()
  const workspaceNames = input.workspace.allowAll
    ? new Set(registered.map(({ tool }) => tool.name))
    : grantedNames(input.workspace.toolGrants, input.catalog)
  const agentNames = input.agent.allowAll
    ? workspaceNames
    : grantedNames(input.agent.toolGrants, input.catalog)
  const environmentTools = !input.workspace.isDefault && input.hasEnvironment
  const selected = registered.filter(
    ({ extension, tool }) =>
      workspaceNames.has(tool.name) &&
      agentNames.has(tool.name) &&
      (environmentTools || extension.name !== CODING_TOOLS_EXTENSION),
  )
  const extensions = new Map<string, Extension>()
  for (const { extension } of selected) extensions.set(extension.name, extension)

  return { extensions: [...extensions.values()], tools: selected.map(({ tool }) => tool) }
}
