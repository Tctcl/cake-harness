import { text } from 'node:stream/consumers'

import { AuthService } from './auth/service.js'
import { loadConfig } from './config.js'
import { createPool } from './storage/postgres/db.js'
import { createSchema, migrate } from './storage/postgres/schema.js'

/**
 * Gives a fresh install its first sign-in: `node dist/bootstrap-admin.js <username>`, with the password on stdin so it
 * never appears in a process list or an environment. `install.sh` runs it once inside the app container.
 *
 * It opens a plain pool, not the durable storage: opening storage claims the log's single writer, which would fence off
 * the server that is already running. The migrations take their own advisory lock, so running them here is safe.
 *
 * Prints `created`, or `exists` when the owner already has a password, and exits 0 either way.
 */
const main = async (): Promise<void> => {
  const username = process.argv[2]
  if (username === undefined || username === '') {
    throw new Error('usage: bootstrap-admin <username>   (password on stdin)')
  }

  const password = (await text(process.stdin)).replace(/\r?\n$/, '')
  const config = loadConfig()
  const pool = createPool(config.databaseUrl, { max: 1 })

  try {
    const schema = createSchema('')
    await migrate(pool, schema)
    const auth = new AuthService({ pool, schema, secrets: config.secrets })

    process.stdout.write(`${await auth.bootstrapOwner(username, password)}\n`)
  } finally {
    await pool.end()
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
