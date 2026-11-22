import { z } from 'zod'

// A local .env supplies the provider keys; the process environment wins nothing, Node only fills gaps.
try {
  process.loadEnvFile()
} catch {
  // No .env file: the environment must already carry everything.
}

const nodeEnvironments = ['development', 'test', 'production'] as const
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

type NodeEnvironment = (typeof nodeEnvironments)[number]
type LogLevel = (typeof logLevels)[number]

export interface Config {
  readonly nodeEnv: NodeEnvironment
  readonly host: string
  readonly port: number
  readonly logLevel: LogLevel
  /** Postgres for the durable log and the platform tables; the backend has no storage without it. */
  readonly databaseUrl: string
  /** Postgres pool ceiling. */
  readonly databasePoolSize: number
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(nodeEnvironments).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be between 1 and 65535')
    .max(65_535, 'must be between 1 and 65535')
    .default(8080),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  DATABASE_URL: z.url({
    protocol: /^postgres(ql)?$/,
    error: 'must be a postgres:// or postgresql:// URL',
  }),
  DATABASE_POOL_SIZE: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be between 1 and 100')
    .max(100, 'must be between 1 and 100')
    .default(10),
})

export class ConfigError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

// Environment variables are untyped strings, so validation happens once here and
// the rest of the process trusts the narrowed Config.
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = environmentSchema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    throw new ConfigError(issues)
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    databasePoolSize: parsed.data.DATABASE_POOL_SIZE,
  }
}
