/**
 * The workspace and agent every user starts with. Fixed ids rather than random ones, for the same reason as
 * `LOCAL_USER_ID`: a restart must find the pair the schema seeded, not add another. Both are immutable, so nothing
 * rewrites them later.
 */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
export const DEFAULT_AGENT_ID = '00000000-0000-4000-8000-000000000003'

/**
 * A capability list holding `'*'` grants everything, including tools that do not exist yet. The default workspace and
 * its agent carry it so a new capability needs no migration to reach them.
 */
export const ALL_CAPABILITIES = '*'

export const DEFAULT_WORKSPACE_NAME = 'General'
export const DEFAULT_AGENT_NAME = 'General'

export const DEFAULT_WORKSPACE_DESCRIPTION =
  'Every tool, MCP server and skill. No dev container: sessions here stay in the backend.'

export const DEFAULT_AGENT_DESCRIPTION = 'The default profile: everything enabled, no instructions.'
