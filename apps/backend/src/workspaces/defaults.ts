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
  'Every tool, MCP server and skill. Sessions here run on this host, not in an environment.'

/** What migration 4 seeded; kept verbatim because a released migration is never edited. */
export const DEFAULT_AGENT_DESCRIPTION = 'The default profile: everything enabled, no instructions.'

/** The default agent's description once it carries the starter system prompt (migration 18). */
export const DEFAULT_AGENT_PROMPTED_DESCRIPTION =
  'The default profile: everything enabled, with a starter system prompt to build your own agents from.'

/** The agent a workspace other than the default one starts with; it can be renamed and reconfigured, never archived. */
export const WORKSPACE_AGENT_NAME = 'Assistant'
export const WORKSPACE_AGENT_DESCRIPTION = 'The agent this workspace started with.'
