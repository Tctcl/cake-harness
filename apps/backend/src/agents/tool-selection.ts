import type { Extension, RegistrySnapshot, ToolRegistration } from '@earendil-works/pi-durable'

export const CODING_TOOLS_EXTENSION = 'coding-tools'
export const CAKE_EXTENSION = 'cake'
export const ENV_EXTENSIONS: ReadonlySet<string> = new Set([CODING_TOOLS_EXTENSION, 'readonly-tools'])

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
 * tools; it only determines whether environment-backed extensions can run. Environment-free extensions remain
 * available in General and when an environment is absent.
 */
export const selectTools = (input: ToolSelectionInput): ToolSelection => {
  const cake = input.registry.extension(CAKE_EXTENSION)
  if (cake === undefined) throw new Error('the Cake system prompt extension is not installed')

  // General's container runs skills and MCP servers, never the agent's own shell or file tools.
  const hasEnvironment = !input.workspace.isDefault && input.hasEnvironment
  const available = input.registry.tools().filter(
    ({ extension }) => hasEnvironment || !ENV_EXTENSIONS.has(extension.name),
  )
  const granted = input.agent.allowAll
    ? undefined
    : grantedNames(input.agent.toolGrants, input.catalog)
  const selected = available.filter(({ tool }) => granted === undefined || granted.has(tool.name))
  const extensions = new Map<string, Extension>([[cake.name, cake]])
  for (const { extension } of selected) extensions.set(extension.name, extension)

  return { extensions: [...extensions.values()], tools: selected.map(({ tool }) => tool) }
}
