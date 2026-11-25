import { z } from 'zod'

import type { SecretBox } from './auth/secret-box.js'
import { createSecretBox } from './auth/secret-box.js'

import type { DockerConnection } from './environments/docker-connection.js'
import { parseDockerConnection } from './environments/docker-connection.js'
import type { TerminalLimits } from './terminal/contract.js'

// A checkout's .env fills variables the process environment does not already set; it never overrides one. A missing
// file is the normal case in a container. Anything else (a file Node cannot read or parse) is a startup failure.
try {
  process.loadEnvFile()
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
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
  /** Where a workspace container reaches this backend for its documents, or `null` when it is not wired to fetch them. */
  readonly workspaceBackendUrl: string | null
  /** The Docker network the backend is reachable on from a workspace container, or `null` for Docker's default. */
  readonly workspaceNetwork: string | null
  /** Where this install's releases come from; a staging install tracks a moving tag instead of a version. */
  readonly channel: ReleaseChannel
  /** The release this install runs, or `undefined` when nothing said (a checkout, `pnpm dev`). */
  readonly version: string | undefined
  /** How often to ask whether a newer release exists; `0` turns the check off. */
  readonly updateCheckIntervalMs: number
  /** The secrets store this install reads credentials from, or `undefined` when nothing configured one. */
  readonly ciphergate: CipherGateConfig | undefined
  /** The built SPA to serve, or `undefined` when Vite serves the frontend in development. */
  readonly frontendDir: string | undefined
  /** Seals the second-factor secrets: with `.env` gone a database dump is not a second factor as well. */
  readonly secrets: SecretBox
  /** Whether `X-Forwarded-*` from the proxy is believed. Without it a cookie is never `Secure` behind TLS. */
  readonly trustProxy: boolean
  /** How many terminals an environment may hold, how much output a reattach replays, and when an abandoned one ends. */
  readonly terminals: TerminalLimits
}

export interface CipherGateConfig {
  /** The REST API of the secrets store; the UI listener is not this. */
  readonly url: string
  /** The reader consumer's key. It opens the store, so it is the one secret `.env` keeps. */
  readonly token: string
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
  // Both or neither: a container that cannot resolve the backend gets no documents and boots without them.
  WORKSPACE_BACKEND_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).optional(),
  WORKSPACE_NETWORK: z.string().min(1).optional(),
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
  // A shell is a resource. Eight tabs is more than a person reads and far fewer than a runaway loop can open, and the
  // idle timeout is what stops a forgotten tab from holding a container open for a week.
  TERMINAL_MAX_SESSIONS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .max(32, 'must be at most 32')
    .default(8),
  TERMINAL_SCROLLBACK_BYTES: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(0, 'must be 0 or more')
    .max(4_194_304, 'must be at most 4194304')
    .default(262_144),
  TERMINAL_IDLE_TIMEOUT_MS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(0, 'must be 0 or more')
    .default(1_800_000),
  // Both or neither: a URL without a key cannot read anything, and a key without a URL has nowhere to send it.
  CIPHERGATE_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }).optional(),
  CIPHERGATE_TOKEN: z.string().min(1).optional(),
  // Any passphrase: it is hashed to a 32-byte key, so length is a cost decision rather than a correctness one.
  SECRET_KEY: z.string().min(16, 'must be at least 16 characters').optional(),
  // Not `z.coerce.boolean()`: that turns the string "false" into `true`.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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

  const ciphergate = cipherGateConfig(parsed.data.CIPHERGATE_URL, parsed.data.CIPHERGATE_TOKEN)
  const workspace = workspaceWiring(parsed.data.WORKSPACE_BACKEND_URL, parsed.data.WORKSPACE_NETWORK)

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    databasePoolSize: parsed.data.DATABASE_POOL_SIZE,
    docker,
    workspaceImage: parsed.data.WORKSPACE_IMAGE,
    workspaceBackendUrl: workspace.backendUrl,
    workspaceNetwork: workspace.network,
    channel: parsed.data.TCTCL_CHANNEL,
    version: parsed.data.TCTCL_VERSION,
    updateCheckIntervalMs: parsed.data.UPDATE_CHECK_INTERVAL_MS,
    ciphergate,
    frontendDir: parsed.data.FRONTEND_DIR,
    secrets: secretBox(parsed.data.SECRET_KEY, parsed.data.NODE_ENV, parsed.data.DATABASE_URL),
    trustProxy: parsed.data.TRUST_PROXY,
    terminals: {
      maxSessions: parsed.data.TERMINAL_MAX_SESSIONS,
      scrollbackBytes: parsed.data.TERMINAL_SCROLLBACK_BYTES,
      idleTimeoutMs: parsed.data.TERMINAL_IDLE_TIMEOUT_MS,
    },
  }
}

/** Unwired when neither variable is set; setting only one is a startup failure, not a silent fallback. */
const workspaceWiring = (
  backendUrl: string | undefined,
  network: string | undefined,
): { readonly backendUrl: string | null; readonly network: string | null } => {
  if (backendUrl === undefined && network === undefined) return { backendUrl: null, network: null }
  if (backendUrl === undefined) throw new ConfigError(['WORKSPACE_BACKEND_URL: required when WORKSPACE_NETWORK is set'])
  if (network === undefined) throw new ConfigError(['WORKSPACE_NETWORK: required when WORKSPACE_BACKEND_URL is set'])

  // Containers append the environment's own path, so a trailing slash would double up.
  return { backendUrl: backendUrl.replace(/\/+$/, ''), network }
}

/** Absent when neither variable is set; a half-configured store is a startup failure, not a silent fallback. */
const cipherGateConfig = (url: string | undefined, token: string | undefined): CipherGateConfig | undefined => {
  if (url === undefined && token === undefined) return undefined
  if (url === undefined) throw new ConfigError(['CIPHERGATE_URL: required when CIPHERGATE_TOKEN is set'])
  if (token === undefined) throw new ConfigError(['CIPHERGATE_TOKEN: required when CIPHERGATE_URL is set'])

  // A trailing slash would double up when a path is appended.
  return { url: url.replace(/\/+$/, ''), token }
}

/**
 * Production refuses to start without a key: the alternative is a sealed secret nobody can open after a restart, or one
 * every install opens. Development derives a stable one from the database URL so a checkout runs without ceremony, and
 * says so once, because a made-up key silently protects nothing.
 */
const secretBox = (configured: string | undefined, nodeEnv: NodeEnvironment, databaseUrl: string): SecretBox => {
  if (configured !== undefined) return createSecretBox(configured)

  if (nodeEnv === 'production') {
    throw new ConfigError(['SECRET_KEY: required in production, and must stay the same across restarts'])
  }

  process.emitWarning('SECRET_KEY is not set: deriving one from DATABASE_URL for local use only', {
    code: 'TCTCL_DERIVED_SECRET',
  })

  return createSecretBox(`development:${databaseUrl}`)
}
