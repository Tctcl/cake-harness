import { AppError } from '../errors.js'
import type { Queryable } from '../storage/postgres/db.js'
import { rowsOf } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

export interface SshPortRange {
  readonly first: number
  readonly last: number
}

export const DEFAULT_SSH_PORT_RANGE: SshPortRange = { first: 22_000, last: 22_999 }

/** The configuration stays text at the process edge; the rest of the backend receives two checked integers. */
export const parseSshPortRange = (value: string): SshPortRange | null => {
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(value)
  if (match === null) return null

  const first = Number(match[1])
  const last = Number(match[2])
  if (first < 1 || last > 65_535 || first > last) return null

  return { first, last }
}

/** Deterministic allocation makes a freed port reusable and keeps startup backfill independent of row order. */
export const lowestFreeSshPort = (
  used: ReadonlySet<number>,
  range: SshPortRange,
): number | null => {
  for (let port = range.first; port <= range.last; port += 1) {
    if (!used.has(port)) return port
  }

  return null
}

const exhausted = (): AppError =>
  new AppError('no SSH ports remain in CAKE_SSH_PORT_RANGE', {
    statusCode: 503,
    code: 'SSH_PORT_EXHAUSTED',
  })

/**
 * Reserve the lowest free port inside the caller's transaction. The advisory lock covers creation and startup backfill
 * in every backend process sharing this schema; the unique column is the final guard against a concurrent writer.
 */
export const reserveSshPort = async (
  client: Queryable,
  schema: PostgresSchema,
  range: SshPortRange,
): Promise<number> => {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cake-ssh-ports:${schema.prefix}`])
  const used = new Set(
    (await rowsOf<{ readonly ssh_port: number }>(
      client,
      `SELECT ssh_port FROM ${schema.tables.devEnvironments} WHERE ssh_port IS NOT NULL`,
    )).map((row) => row.ssh_port),
  )
  const port = lowestFreeSshPort(used, range)
  if (port === null) throw exhausted()

  return port
}
