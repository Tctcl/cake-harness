import type { Pool } from 'pg'

import { withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'
import type { Permission } from './permissions.js'
import { isPermission } from './permissions.js'

export interface RoleRecord {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly grantsAll: boolean
  readonly isBuiltin: boolean
  readonly permissions: readonly Permission[]
}

interface RoleRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly grants_all: boolean
  readonly is_builtin: boolean
  readonly permissions: string[] | null
}

/** Unknown names are dropped rather than trusted: a permission this build does not check cannot be a grant. */
const toPermissions = (values: readonly string[] | null): readonly Permission[] =>
  (values ?? []).filter(isPermission)

const toRole = (row: RoleRow): RoleRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  grantsAll: row.grants_all,
  isBuiltin: row.is_builtin,
  permissions: toPermissions(row.permissions),
})

export class PermissionRepository {
  readonly #pool: Pool
  readonly #roles: string
  readonly #rolePermissions: string
  readonly #overrides: string

  constructor(pool: Pool, schema: PostgresSchema) {
    const { roles, rolePermissions, userPermissionOverrides } = schema.tables
    this.#pool = pool
    this.#roles = `SELECT r.id, r.name, r.description, r.grants_all, r.is_builtin,
        array_remove(array_agg(rp.permission ORDER BY rp.permission), NULL) AS permissions
      FROM ${roles} r LEFT JOIN ${rolePermissions} rp ON rp.role_id = r.id
      GROUP BY r.id, r.name, r.description, r.grants_all, r.is_builtin
      ORDER BY r.is_builtin DESC, r.name`
    this.#rolePermissions = `SELECT permission FROM ${rolePermissions} WHERE role_id = $1`
    this.#overrides = `SELECT permission, allowed FROM ${userPermissionOverrides} WHERE user_id = $1`
  }

  async roles(): Promise<readonly RoleRecord[]> {
    const rows = await withClient(this.#pool, (client) => client.query<RoleRow>(this.#roles))

    return rows.rows.map(toRole)
  }

  async role(id: string): Promise<RoleRecord | undefined> {
    const found = (await this.roles()).find((role) => role.id === id)

    return found
  }

  async permissionsOfRole(roleId: string): Promise<readonly Permission[]> {
    const rows = await withClient(this.#pool, (client) =>
      client.query<{ permission: string }>(this.#rolePermissions, [roleId]),
    )

    return toPermissions(rows.rows.map((row) => row.permission))
  }

  /** Per-user exceptions, in both directions: `allowed` is a grant, a deny beats the same permission from the role. */
  async overridesOf(userId: string): Promise<{ readonly granted: readonly Permission[]; readonly denied: readonly Permission[] }> {
    const rows = await withClient(this.#pool, (client) =>
      client.query<{ permission: string; allowed: boolean }>(this.#overrides, [userId]),
    )
    const granted = rows.rows.filter((row) => row.allowed).map((row) => row.permission)
    const denied = rows.rows.filter((row) => !row.allowed).map((row) => row.permission)

    return { granted: toPermissions(granted), denied: toPermissions(denied) }
  }
}
