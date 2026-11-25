/**
 * The two roles every install starts with. Fixed ids so the migration, the installer and the checks all name the same
 * row without a lookup; the descriptions are what the settings screen shows beside them.
 */
export const ADMIN_ROLE_ID = '00000000-0000-4000-8000-0000000000a1'
export const MEMBER_ROLE_ID = '00000000-0000-4000-8000-0000000000a2'

export const ADMIN_ROLE_NAME = 'admin'
export const MEMBER_ROLE_NAME = 'member'

export const ADMIN_ROLE_DESCRIPTION = 'Everything, including the settings that decide who else may sign in.'
export const MEMBER_ROLE_DESCRIPTION = 'Can create their own workspaces, agents and environments.'
