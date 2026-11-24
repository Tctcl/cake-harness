import { z } from 'zod'

import type { DockerConnection } from './environments/docker-connection.js'
import { parseDockerConnection } from './environments/docker-connection.js'

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
  /** The Docker API this process provisions environments through. */
  readonly docker: DockerConnection
  /** The tooling image a new environment is created from unless it records another. */
  readonly workspaceImage: string
  /** Where this install's releases come from; a staging install tracks a moving tag instead of a version. */
  readonly channel: ReleaseChannel
  /** The release this install runs, or `undefined` when nothing said (a checkout, `pnpm dev`). */
  readonly version: string | undefined
  /** How often to ask whether a newer release exists; `0` turns the check off. */
  readonly updateCheckIntervalMs: number
  /** The built SPA to serve, or `undefined` when Vite serves the frontend in development. */
  readonly frontendDir: string | undefined
}

export const releaseChannels = ['production', 'staging'] as const

export type ReleaseChannel = (typeof releaseChannels)[number]

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
  DOCKER_HOST: z.string().min(1).default('unix:///var/run/docker.sock'),
  // The local development image the agent workspace is built as; an install sets this to the released tag.
  WORKSPACE_IMAGE: z.string().min(1).default('tctcl/dev-env:dev'),
  TCTCL_CHANNEL: z.enum(releaseChannels).default('production'),
  // Absent in a checkout: there is nothing to compare against, so the check reports that instead of guessing.
  TCTCL_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'must be X.Y.Z')
    .optional(),
  UPDATE_CHECK_INTERVAL_MS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(0, 'must be 0 or more')
    .default(900_000),
  FRONTEND_DIR: z.string().min(1).optional(),
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

  const docker = parseDockerConnection(parsed.data.DOCKER_HOST)
  if (docker === undefined) {
    throw new ConfigError(['DOCKER_HOST: must be unix:///path or tcp://host:port'])
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    databasePoolSize: parsed.data.DATABASE_POOL_SIZE,
    docker,
    workspaceImage: parsed.data.WORKSPACE_IMAGE,
    channel: parsed.data.TCTCL_CHANNEL,
    version: parsed.data.TCTCL_VERSION,
    updateCheckIntervalMs: parsed.data.UPDATE_CHECK_INTERVAL_MS,
    frontendDir: parsed.data.FRONTEND_DIR,
  }
}
