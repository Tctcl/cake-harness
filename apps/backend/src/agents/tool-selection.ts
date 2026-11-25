import type { Extension, RegistrySnapshot, ToolRegistration } from '@earendil-works/pi-durable'

export const CODING_TOOLS_EXTENSION = 'coding-tools'

export interface ToolSelectionInput {
  readonly workspace: { readonly isDefault: boolean }
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
 * Resolve durable's object-valued AgentChange from the registry and the agent's grants. The workspace no longer limits
 * tools; it only determines whether coding-tools can run. Web remains available in General and when an environment is
 * absent, while read/write/edit/bash require a workspace container.
 */
export const selectTools = (input: ToolSelectionInput): ToolSelection => {
  const environmentTools = !input.workspace.isDefault && input.hasEnvironment
  const available = input.registry.tools().filter(
    ({ extension }) => environmentTools || extension.name !== CODING_TOOLS_EXTENSION,
  )
  const granted = input.agent.allowAll
    ? undefined
    : grantedNames(input.agent.toolGrants, input.catalog)
  const selected = available.filter(({ tool }) => granted === undefined || granted.has(tool.name))
  const extensions = new Map<string, Extension>()
  for (const { extension } of selected) extensions.set(extension.name, extension)

  return { extensions: [...extensions.values()], tools: selected.map(({ tool }) => tool) }
}
