import type { AgentGrants, WorkspaceGrants } from '../capabilities/capability-links.js'
import { AppError } from '../errors.js'

/** What a workspace permits, plus the flag that lets it permit everything without naming it. */
export type CapabilityCeiling = WorkspaceGrants & { readonly allowAll: boolean }

const notAllowed = (requested: readonly string[], allowed: readonly string[]): readonly string[] =>
  requested.filter((id) => !allowed.includes(id))

const deniedGrants = (
  requested: readonly { readonly serverId: string }[],
  allowed: readonly { readonly serverId: string }[],
): readonly string[] => {
  const permitted = new Set(allowed.map((grant) => grant.serverId))

  return requested.filter((grant) => !permitted.has(grant.serverId)).map((grant) => grant.serverId)
}

/**
 * A workspace is the ceiling: an agent may only reach what its workspace reaches. Both sides are catalog ids rather
 * than names, so a grant that survived this check is also a row the database still has.
 *
 * `allowAll` on the workspace skips the check entirely — that is the general workspace, which exists so a capability
 * added tomorrow needs no edit here.
 */
export const assertWithinCeiling = (ceiling: CapabilityCeiling, requested: AgentGrants): void => {
  if (ceiling.allowAll) return

  const denied = [
    ...notAllowed(requested.tools, ceiling.tools),
    ...notAllowed(requested.prompts, ceiling.prompts),
    ...notAllowed(requested.skills, ceiling.skills),
    ...deniedGrants(requested.mcpServers, ceiling.mcpServers),
    // A credential the workspace never added is not available to its agents, even on a server it does allow.
    ...notAllowed(
      requested.mcpServers.flatMap((grant) => (grant.credentialId === null ? [] : [grant.credentialId])),
      ceiling.credentials,
    ),
  ]
  const unique = [...new Set(denied)]
  if (unique.length === 0) return

  throw new AppError(`the workspace does not allow: ${unique.join(', ')}`, {
    statusCode: 400,
    code: 'CAPABILITY_NOT_ALLOWED',
  })
}
