/**
 * What a person may do. Names are `resource.action`, and each one is checked by a route: a permission nothing enforces
 * is a promise the product does not keep, so this list stays short until a route needs the next one.
 *
 * Ownership is deliberately absent. "This workspace is yours" is data — an `owner_id` on a row — and a boolean
 * permission cannot express it, so handlers scope their queries instead of consulting a list.
 */
export const PERMISSIONS = [
  'workspaces.create',
  'agents.create',
  'environments.create',
  'tools.manage',
  'skills.manage',
  'mcp.manage',
  'updates.manage',
  'users.manage',
  'roles.manage',
  'settings.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** What the built-in admin role holds: everything, including permissions that do not exist yet. */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS

/**
 * The seeded `member` role: someone who builds their own material without changing what the install shares. This seeds
 * the first migration only — afterwards the role is a row an admin edits, and its permissions live in the database.
 */
export const MEMBER_PERMISSIONS: readonly Permission[] = ['workspaces.create', 'agents.create', 'environments.create']

const known: ReadonlySet<string> = new Set(PERMISSIONS)

export const isPermission = (value: string): value is Permission => known.has(value)
