import type { Pool } from 'pg'
import type { Queryable } from './db.js'
import { withTransaction } from './db.js'

/** Immutable table and index names, each optionally carrying a prefix so one database can hold isolated sets. */
export type PostgresSchema = {
  readonly prefix: string
  readonly tables: {
    readonly durableSchema: string
    readonly durableMetadata: string
    readonly recordIds: string
    readonly conversations: string
    readonly entries: string
    readonly tasks: string
    readonly submissions: string
    readonly documents: string
    readonly documentRevisions: string
  }
  readonly indexes: {
    readonly conversationsByOwnerConversation: string
    readonly conversationsByOwnerTask: string
    readonly entriesByConversation: string
    readonly entryHeadsByConversation: string
    readonly tasksByStatus: string
    readonly tasksByConversation: string
    readonly tasksByKind: string
    readonly submissionsByRequest: string
    readonly submissionsByConversation: string
    readonly submissionsByStatus: string
    readonly documentsByAddress: string
    readonly documentsByScope: string
    readonly documentsByScopeKind: string
    readonly documentRevisionsByKind: string
  }
}

const TABLE_NAMES = {
  durableSchema: 'durable_schema',
  durableMetadata: 'durable_metadata',
  recordIds: 'record_ids',
  conversations: 'conversations',
  entries: 'entries',
  tasks: 'tasks',
  submissions: 'submissions',
  documents: 'documents',
  documentRevisions: 'document_revisions',
} as const

const INDEX_NAMES = {
  conversationsByOwnerConversation: 'conversations_by_owner_conversation',
  conversationsByOwnerTask: 'conversations_by_owner_task',
  entriesByConversation: 'entries_by_conversation',
  entryHeadsByConversation: 'entry_heads_by_conversation',
  tasksByStatus: 'tasks_by_status',
  tasksByConversation: 'tasks_by_conversation',
  tasksByKind: 'tasks_by_kind',
  submissionsByRequest: 'submissions_by_request',
  submissionsByConversation: 'submissions_by_conversation',
  submissionsByStatus: 'submissions_by_status',
  documentsByAddress: 'documents_by_address',
  documentsByScope: 'documents_by_scope',
  documentsByScopeKind: 'documents_by_scope_kind',
  documentRevisionsByKind: 'document_revisions_by_kind',
} as const

const PREFIX = /^[a-z0-9_]*$/

const quote = (name: string): string => `"${name}"`

const prefixed = <Names extends Record<string, string>>(names: Names, prefix: string): Names =>
  Object.fromEntries(Object.entries(names).map(([key, name]) => [key, quote(`${prefix}${name}`)])) as Names

/** Build immutable identifiers for a set of tables, optionally isolated by a prefix. */
export const createSchema = (prefix = ''): PostgresSchema => {
  if (!PREFIX.test(prefix)) throw new Error(`Invalid schema prefix: ${prefix}`)
  return {
    prefix,
    tables: prefixed(TABLE_NAMES, prefix),
    indexes: prefixed(INDEX_NAMES, prefix),
  }
}

export const DEFAULT_SCHEMA = createSchema()

/**
 * A record's `json` column keeps the JSON text Durable wrote, while the columns beside it carry the values scans and
 * checks query, which is the layout the SQLite backend uses.
 */
const migration = (schema: PostgresSchema): readonly string[] => {
  const { tables } = schema
  const { indexes } = schema
  return [
    `CREATE TABLE ${tables.durableMetadata} (
      singleton smallint PRIMARY KEY CHECK (singleton = 1),
      next_id bigint NOT NULL,
      next_seq bigint NOT NULL
    )`,
    `INSERT INTO ${tables.durableMetadata} (singleton, next_id, next_seq) VALUES (1, 2, 1)`,
    `CREATE TABLE ${tables.recordIds} (
      id bigint PRIMARY KEY,
      record_type text NOT NULL CHECK (record_type IN ('conversation', 'entry', 'task', 'submission', 'document'))
    )`,
    `CREATE TABLE ${tables.conversations} (
      id bigint PRIMARY KEY,
      owner_conversation_id bigint,
      owner_task_id bigint,
      record json NOT NULL
    )`,
    `CREATE INDEX ${indexes.conversationsByOwnerConversation} ON ${tables.conversations} (owner_conversation_id, id)`,
    `CREATE INDEX ${indexes.conversationsByOwnerTask} ON ${tables.conversations} (owner_task_id, id)`,
    `CREATE TABLE ${tables.entries} (
      id bigint PRIMARY KEY,
      conversation_id bigint NOT NULL,
      head bigint,
      commit_seq bigint NOT NULL,
      record json NOT NULL
    )`,
    `CREATE INDEX ${indexes.entriesByConversation} ON ${tables.entries} (conversation_id, id DESC)`,
    `CREATE INDEX ${indexes.entryHeadsByConversation} ON ${tables.entries} (conversation_id, id DESC) WHERE head IS NOT NULL`,
    `CREATE TABLE ${tables.tasks} (
      id bigint PRIMARY KEY,
      conversation_id bigint NOT NULL,
      kind text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'sleeping', 'completing', 'terminal')),
      abort_requested boolean NOT NULL,
      background boolean NOT NULL,
      record json NOT NULL
    )`,
    `CREATE INDEX ${indexes.tasksByStatus} ON ${tables.tasks} (status, id)`,
    `CREATE INDEX ${indexes.tasksByConversation} ON ${tables.tasks} (conversation_id, id)`,
    `CREATE INDEX ${indexes.tasksByKind} ON ${tables.tasks} (kind, id)`,
    `CREATE TABLE ${tables.submissions} (
      id bigint PRIMARY KEY,
      conversation_id bigint NOT NULL,
      request_id text,
      status text NOT NULL CHECK (status IN ('queued', 'placed', 'done', 'unanswered')),
      record json NOT NULL
    )`,
    `CREATE INDEX ${indexes.submissionsByRequest} ON ${tables.submissions} (conversation_id, request_id)`,
    `CREATE INDEX ${indexes.submissionsByConversation} ON ${tables.submissions} (conversation_id, id)`,
    `CREATE INDEX ${indexes.submissionsByStatus} ON ${tables.submissions} (status, id)`,
    `CREATE TABLE ${tables.documents} (
      id bigint PRIMARY KEY,
      kind text NOT NULL,
      family smallint NOT NULL CHECK (family IN (0, 1)),
      key_value text NOT NULL,
      scope_kind text NOT NULL CHECK (scope_kind IN ('session', 'conversation', 'task')),
      owner_id bigint NOT NULL,
      created_at bigint NOT NULL,
      retired_at bigint,
      record json NOT NULL
    )`,
    `CREATE INDEX ${indexes.documentsByAddress}
      ON ${tables.documents} (kind, scope_kind, owner_id, family, key_value, created_at DESC, retired_at)`,
    `CREATE INDEX ${indexes.documentsByScope} ON ${tables.documents} (scope_kind, owner_id, id)`,
    `CREATE INDEX ${indexes.documentsByScopeKind} ON ${tables.documents} (scope_kind, owner_id, kind, id)`,
    `CREATE TABLE ${tables.documentRevisions} (
      document_id bigint NOT NULL,
      seq bigint NOT NULL,
      kind text NOT NULL CHECK (kind IN ('base', 'delta')),
      version integer NOT NULL,
      content json NOT NULL,
      PRIMARY KEY (document_id, seq)
    )`,
    `CREATE INDEX ${indexes.documentRevisionsByKind} ON ${tables.documentRevisions} (document_id, kind, seq DESC)`,
  ]
}

/** Ordered schema history: a released version is never edited, a change appends one. */
export const MIGRATIONS: readonly { version: number; statements: (schema: PostgresSchema) => readonly string[] }[] = [
  { version: 1, statements: migration },
]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0

/** The versions already applied to `schema`'s database. */
const appliedVersions = async (client: Queryable, schema: PostgresSchema): Promise<Set<number>> => {
  // Identifiers are this module's constants, vetted by `createSchema`; every value is bound.
  const create = `CREATE TABLE IF NOT EXISTS ${schema.tables.durableSchema} (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`
  await client.query(create)
  const select = `SELECT version FROM ${schema.tables.durableSchema}`
  const rows = await client.query<{ version: number }>(select)
  return new Set(rows.rows.map((row) => row.version))
}

/**
 * Applies every pending migration in one transaction. `pg_advisory_xact_lock` serializes two processes opening the
 * same database at once, so one of them finds the schema already applied instead of racing it.
 */
export const applyMigrations = async (client: Queryable, schema: PostgresSchema): Promise<void> => {
  const applied = await appliedVersions(client, schema)
  const pending = MIGRATIONS.filter((entry) => !applied.has(entry.version))
  if (pending.length === 0) return
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pi-durable:${schema.prefix}`])
  const already = await appliedVersions(client, schema)
  for (const entry of MIGRATIONS) {
    if (already.has(entry.version)) continue
    for (const statement of entry.statements(schema)) await client.query(statement)
    const record = `INSERT INTO ${schema.tables.durableSchema} (version) VALUES ($1)`
    await client.query(record, [entry.version])
  }
}

/** Applies pending migrations in a transaction of their own. */
export const migrate = async (pool: Pool, schema: PostgresSchema): Promise<void> =>
  withTransaction(pool, (client) => applyMigrations(client, schema))
