import type { AgentGrants, WorkspaceGrants } from '../capabilities/capability-links.js'
import { AppError } from '../errors.js'

/** What a workspace permits, the servers it owns, plus the flag that lets it permit everything without naming it. */
export type CapabilityCeiling = WorkspaceGrants & {
  readonly allowAll: boolean
  /** The ids of the workspace's own servers: the only ones its agents can be given. */
  readonly mcpServers: readonly string[]
}

const notAllowed = (requested: readonly string[], allowed: readonly string[]): readonly string[] =>
  requested.filter((id) => !allowed.includes(id))

/**
 * Skills and MCP servers retain the workspace ceiling; tool grants belong to the agent alone. Both sides are catalog
 * ids rather than names, so a grant that survived this check is also a row the database still has.
 *
 * `allowAll` on the workspace skips the check entirely — that is the general workspace, which exists so a capability
 * added tomorrow needs no edit here.
 */
export const assertWithinCeiling = (ceiling: CapabilityCeiling, requested: AgentGrants): void => {
  if (ceiling.allowAll) return

  const denied = [
    ...notAllowed(requested.skills, ceiling.skills),
    // A server the workspace never created is not reachable, even by an agent that names it.
    ...notAllowed(requested.mcpServers, ceiling.mcpServers),
  ]
  const unique = [...new Set(denied)]
  if (unique.length === 0) return

  throw new AppError(`the workspace does not allow: ${unique.join(', ')}`, {
    statusCode: 400,
    code: 'CAPABILITY_NOT_ALLOWED',
  })
}
