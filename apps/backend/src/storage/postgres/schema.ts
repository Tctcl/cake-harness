import type { Pool } from 'pg'
import { LOCAL_USER_ID, LOCAL_USER_NAME } from '../../threads/local-user.js'
import {
  ALL_CAPABILITIES,
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  DEFAULT_WORKSPACE_DESCRIPTION,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from '../../workspaces/defaults.js'
import type { Queryable } from './db.js'
import { withTransaction } from './db.js'

/**
 * Immutable table and index names. Two prefixes apply: `DURABLE_PREFIX` marks the durable log's tables, and the
 * caller's prefix isolates a whole set, so one database can hold several independent copies of the schema.
 */
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
    readonly users: string
    readonly chatThreads: string
    readonly workspaces: string
    readonly agents: string
    readonly tools: string
    readonly prompts: string
    readonly skills: string
    readonly mcpServers: string
    readonly mcpCredentials: string
    readonly workspaceTools: string
    readonly workspacePrompts: string
    readonly workspaceSkills: string
    readonly workspaceMcpServers: string
    readonly workspaceMcpCredentials: string
    readonly agentTools: string
    readonly agentPrompts: string
    readonly agentSkills: string
    readonly agentMcpServers: string
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
    readonly chatThreadsByOwner: string
    readonly chatThreadsByWorkspace: string
    readonly workspacesByOwner: string
    readonly oneDefaultWorkspace: string
    readonly agentsByWorkspace: string
    readonly oneDefaultAgent: string
    readonly toolsByName: string
    readonly promptsByName: string
    readonly skillsByName: string
    readonly mcpServersByName: string
    readonly mcpCredentialsByLabel: string
    readonly mcpCredentialsByIdServer: string
  }
}

/**
 * The durable log's namespace. `apps/backend` owns these tables too, but they hold durable's internal state while the
 * bare names are the platform's own, so the two never collide in one database.
 */
export const DURABLE_PREFIX = 'durable_'

// Names are written without any prefix; `createSchema` adds `DURABLE_PREFIX` to the log and the caller's prefix to both.
const DURABLE_TABLE_NAMES = {
  durableSchema: 'schema',
  durableMetadata: 'metadata',
  recordIds: 'record_ids',
  conversations: 'conversations',
  entries: 'entries',
  tasks: 'tasks',
  submissions: 'submissions',
  documents: 'documents',
  documentRevisions: 'document_revisions',
} as const

const PLATFORM_TABLE_NAMES = {
  users: 'users',
  chatThreads: 'chat_threads',
  workspaces: 'workspaces',
  agents: 'agents',
  tools: 'tools',
  prompts: 'prompts',
  skills: 'skills',
  mcpServers: 'mcp_servers',
  mcpCredentials: 'mcp_credentials',
  workspaceTools: 'workspace_tools',
  workspacePrompts: 'workspace_prompts',
  workspaceSkills: 'workspace_skills',
  workspaceMcpServers: 'workspace_mcp_servers',
  workspaceMcpCredentials: 'workspace_mcp_credentials',
  agentTools: 'agent_tools',
  agentPrompts: 'agent_prompts',
  agentSkills: 'agent_skills',
  agentMcpServers: 'agent_mcp_servers',
} as const

const DURABLE_INDEX_NAMES = {
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

const PLATFORM_INDEX_NAMES = {
  chatThreadsByOwner: 'chat_threads_by_owner',
  chatThreadsByWorkspace: 'chat_threads_by_workspace',
  workspacesByOwner: 'workspaces_by_owner',
  oneDefaultWorkspace: 'workspaces_one_default',
  agentsByWorkspace: 'agents_by_workspace',
  oneDefaultAgent: 'agents_one_default',
  toolsByName: 'tools_by_owner_name',
  promptsByName: 'prompts_by_owner_name',
  skillsByName: 'skills_by_owner_name',
  mcpServersByName: 'mcp_servers_by_owner_name',
  mcpCredentialsByLabel: 'mcp_credentials_by_server_label',
  // Lets a link name a credential together with its server, so the database refuses a credential bound to the wrong one.
  mcpCredentialsByIdServer: 'mcp_credentials_by_id_server',
} as const

const PREFIX = /^[a-z0-9_]*$/

const quote = (name: string): string => `"${name}"`

const prefixed = <Names extends Record<string, string>>(names: Names, prefix: string): Names =>
  Object.fromEntries(Object.entries(names).map(([key, name]) => [key, quote(`${prefix}${name}`)])) as Names

/**
 * Build immutable identifiers for a set of tables. The caller's prefix isolates the whole set — the durable log included
 * — so a test can create and drop one set per case, while `DURABLE_PREFIX` only names the log within that set.
 */
export const createSchema = (prefix = ''): PostgresSchema => {
  if (!PREFIX.test(prefix)) throw new Error(`Invalid schema prefix: ${prefix}`)
  return {
    prefix,
    tables: {
      ...prefixed(DURABLE_TABLE_NAMES, `${DURABLE_PREFIX}${prefix}`),
      ...prefixed(PLATFORM_TABLE_NAMES, prefix),
    },
    indexes: {
      ...prefixed(DURABLE_INDEX_NAMES, `${DURABLE_PREFIX}${prefix}`),
      ...prefixed(PLATFORM_INDEX_NAMES, prefix),
    },
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

/** `Object.keys` widens to `string[]`; these are the maps' own key lists. */
const TABLE_KEYS = Object.keys(DURABLE_TABLE_NAMES) as readonly (keyof typeof DURABLE_TABLE_NAMES)[]
const INDEX_KEYS = Object.keys(DURABLE_INDEX_NAMES) as readonly (keyof typeof DURABLE_INDEX_NAMES)[]

/**
 * Repairs databases written before the log was namespaced: that layout created the log's tables and indexes
 * unprefixed (`conversations`, `tasks_by_status`, ...) while recording version 1, so a corrected version 1 never
 * reached them. Every statement is conditional, so a database that already has the prefixed names — every fresh one —
 * skips all of them.
 *
 * Constraint names are left as they are: `RENAME CONSTRAINT` has no `IF EXISTS`, Postgres scopes the names to their
 * table, and nothing outside `pg_constraint` refers to them.
 */
const legacyNameRepair = (schema: PostgresSchema): readonly string[] => [
  ...TABLE_KEYS.map(
    (key) =>
      `ALTER TABLE IF EXISTS ${quote(`${schema.prefix}${DURABLE_TABLE_NAMES[key]}`)} RENAME TO ${schema.tables[key]}`,
  ),
  ...INDEX_KEYS.map(
    (key) =>
      `ALTER INDEX IF EXISTS ${quote(`${schema.prefix}${DURABLE_INDEX_NAMES[key]}`)} RENAME TO ${schema.indexes[key]}`,
  ),
]

/**
 * Users and chat threads. A thread holds only what the durable log cannot: its owner, its title and which durable
 * conversation carries its transcript — the messages stay in `entries`. There are no identity columns yet; multi-user
 * mode adds a separate identities table rather than rewriting these rows.
 */
const platformMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema
  return [
    `CREATE TABLE ${tables.users} (
      id uuid PRIMARY KEY,
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    // `bigint` matches the durable conversation id it points at, so neither side converts the value.
    `CREATE TABLE ${tables.chatThreads} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      title text,
      durable_conversation_id bigint NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX ${indexes.chatThreadsByOwner}
      ON ${tables.chatThreads} (owner_id, updated_at DESC)`,
  ]
}

/** `ALTER`/`CREATE` never carry a value, but seeding does: escape it rather than relying on the constants. */
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`

/**
 * Workspaces and the agents inside them. A workspace declares the ceiling — which tools, MCP servers and skills its
 * agents may use, and whether sessions need a dev container — while an agent is one profile within it: its own
 * selection, prompts and instructions.
 *
 * The default pair is seeded here rather than only by the code that opens the database, because the thread backfill
 * below needs both rows to exist before it can point at them.
 */
const workspaceMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema
  const everything = `ARRAY[${literal(ALL_CAPABILITIES)}]`

  return [
    `CREATE TABLE ${tables.workspaces} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      is_default boolean NOT NULL DEFAULT false,
      container jsonb,
      allowed_tools text[] NOT NULL DEFAULT '{}',
      allowed_mcp_servers text[] NOT NULL DEFAULT '{}',
      allowed_skills text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    // One default per owner, and one default agent per workspace: the seed cannot be duplicated by a retry.
    `CREATE UNIQUE INDEX ${indexes.oneDefaultWorkspace} ON ${tables.workspaces} (owner_id) WHERE is_default`,
    `CREATE INDEX ${indexes.workspacesByOwner} ON ${tables.workspaces} (owner_id, updated_at DESC)`,
    `CREATE TABLE ${tables.agents} (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      is_default boolean NOT NULL DEFAULT false,
      tools text[] NOT NULL DEFAULT '{}',
      mcp_servers text[] NOT NULL DEFAULT '{}',
      skills text[] NOT NULL DEFAULT '{}',
      system_prompt text NOT NULL DEFAULT '',
      instructions text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX ${indexes.oneDefaultAgent} ON ${tables.agents} (workspace_id) WHERE is_default`,
    `CREATE INDEX ${indexes.agentsByWorkspace} ON ${tables.agents} (workspace_id, name)`,
    `INSERT INTO ${tables.users} (id, display_name)
      VALUES (${literal(LOCAL_USER_ID)}, ${literal(LOCAL_USER_NAME)}) ON CONFLICT (id) DO NOTHING`,
    `INSERT INTO ${tables.workspaces}
      (id, owner_id, name, description, is_default, container, allowed_tools, allowed_mcp_servers, allowed_skills)
      VALUES (${literal(DEFAULT_WORKSPACE_ID)}, ${literal(LOCAL_USER_ID)}, ${literal(DEFAULT_WORKSPACE_NAME)},
        ${literal(DEFAULT_WORKSPACE_DESCRIPTION)}, true, NULL, ${everything}, ${everything}, ${everything})
      ON CONFLICT (id) DO NOTHING`,
    `INSERT INTO ${tables.agents}
      (id, workspace_id, name, description, is_default, tools, mcp_servers, skills)
      VALUES (${literal(DEFAULT_AGENT_ID)}, ${literal(DEFAULT_WORKSPACE_ID)}, ${literal(DEFAULT_AGENT_NAME)},
        ${literal(DEFAULT_AGENT_DESCRIPTION)}, true, ${everything}, ${everything}, ${everything})
      ON CONFLICT (id) DO NOTHING`,
    `ALTER TABLE ${tables.chatThreads} ADD COLUMN workspace_id uuid REFERENCES ${tables.workspaces} (id)`,
    `ALTER TABLE ${tables.chatThreads} ADD COLUMN agent_id uuid REFERENCES ${tables.agents} (id)`,
    // Threads that predate workspaces belong to the default pair.
    `UPDATE ${tables.chatThreads}
      SET workspace_id = ${literal(DEFAULT_WORKSPACE_ID)}, agent_id = ${literal(DEFAULT_AGENT_ID)}
      WHERE workspace_id IS NULL`,
    `ALTER TABLE ${tables.chatThreads} ALTER COLUMN workspace_id SET NOT NULL`,
    `ALTER TABLE ${tables.chatThreads} ALTER COLUMN agent_id SET NOT NULL`,
    `CREATE INDEX ${indexes.chatThreadsByWorkspace} ON ${tables.chatThreads} (workspace_id, updated_at DESC)`,
  ]
}

/**
 * Archiving, as one nullable column per table. A row that carries a timestamp is kept but hidden from the default
 * listing, so the data stays readable while the live views stay short. `NULL` means live; the later long-term storage
 * component reads the same column to decide what to move out of the app database.
 */
const archiveMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables } = schema
  return [
    `ALTER TABLE ${tables.workspaces} ADD COLUMN archived_at timestamptz`,
    `ALTER TABLE ${tables.agents} ADD COLUMN archived_at timestamptz`,
    `ALTER TABLE ${tables.chatThreads} ADD COLUMN archived_at timestamptz`,
  ]
}

/**
 * The catalogs a workspace and an agent point at, and the link tables that point.
 *
 * A catalog row is the thing itself — a tool the registry offers, a prompt, a skill, an MCP server — and every link is a
 * foreign key, so the database refuses a grant of something that does not exist. An MCP server carries no secret: an
 * `mcp_credentials` row names a CipherGate consumer instead, and the value is fetched when a run starts. A workspace
 * links the servers and the credentials it may use and marks one credential per server as the default; an agent links
 * its own selection and may name a different credential for a server, which is how two agents share one server and still
 * authenticate as different identities.
 */
const capabilityMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema

  return [
    `CREATE TABLE ${tables.tools} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT 'registry',
      input_schema jsonb,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX ${indexes.toolsByName} ON ${tables.tools} (owner_id, name)`,

    // Prompts are and skills are for now the same three columns: a name, one line about it, and the text itself.
    `CREATE TABLE ${tables.prompts} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX ${indexes.promptsByName} ON ${tables.prompts} (owner_id, name)`,
    `CREATE TABLE ${tables.skills} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX ${indexes.skillsByName} ON ${tables.skills} (owner_id, name)`,

    // A server says how to reach it and which environment it needs, never what to authenticate with. `env_schema` maps
    // an env var name to the CipherGate secret name it expects, so a credential only has to answer that map.
    `CREATE TABLE ${tables.mcpServers} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      transport text NOT NULL CHECK (transport IN ('stdio', 'http')),
      command text,
      args text[] NOT NULL DEFAULT '{}',
      url text,
      env_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT mcp_servers_transport_target CHECK (
        (transport = 'stdio' AND command IS NOT NULL AND url IS NULL)
        OR (transport = 'http' AND url IS NOT NULL AND command IS NULL)
      )
    )`,
    `CREATE UNIQUE INDEX ${indexes.mcpServersByName} ON ${tables.mcpServers} (owner_id, name)`,
    `CREATE TABLE ${tables.mcpCredentials} (
      id uuid PRIMARY KEY,
      mcp_server_id uuid NOT NULL REFERENCES ${tables.mcpServers} (id) ON DELETE CASCADE,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      label text NOT NULL,
      consumer text NOT NULL,
      secret_map jsonb NOT NULL DEFAULT '{}'::jsonb,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX ${indexes.mcpCredentialsByLabel} ON ${tables.mcpCredentials} (mcp_server_id, label)`,
    `CREATE UNIQUE INDEX ${indexes.mcpCredentialsByIdServer} ON ${tables.mcpCredentials} (id, mcp_server_id)`,

    `CREATE TABLE ${tables.workspaceTools} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      tool_id uuid NOT NULL REFERENCES ${tables.tools} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, tool_id)
    )`,
    `CREATE TABLE ${tables.workspacePrompts} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      prompt_id uuid NOT NULL REFERENCES ${tables.prompts} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, prompt_id)
    )`,
    `CREATE TABLE ${tables.workspaceSkills} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      skill_id uuid NOT NULL REFERENCES ${tables.skills} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, skill_id)
    )`,
    // The default is per server, so one row per server and no second default to resolve. `SET NULL (default_credential_id)`
    // is not used: a credential is archived, never deleted, so the reference is expected to outlive the row.
    `CREATE TABLE ${tables.workspaceMcpServers} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      mcp_server_id uuid NOT NULL REFERENCES ${tables.mcpServers} (id) ON DELETE CASCADE,
      default_credential_id uuid,
      PRIMARY KEY (workspace_id, mcp_server_id),
      FOREIGN KEY (default_credential_id, mcp_server_id)
        REFERENCES ${tables.mcpCredentials} (id, mcp_server_id)
    )`,
    `CREATE TABLE ${tables.workspaceMcpCredentials} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      credential_id uuid NOT NULL REFERENCES ${tables.mcpCredentials} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, credential_id)
    )`,

    `CREATE TABLE ${tables.agentTools} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      tool_id uuid NOT NULL REFERENCES ${tables.tools} (id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, tool_id)
    )`,
    `CREATE TABLE ${tables.agentPrompts} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      prompt_id uuid NOT NULL REFERENCES ${tables.prompts} (id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, prompt_id)
    )`,
    `CREATE TABLE ${tables.agentSkills} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      skill_id uuid NOT NULL REFERENCES ${tables.skills} (id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, skill_id)
    )`,
    // A null credential means "the workspace's default for this server", so an agent only stores a row here when it
    // disagrees with its siblings; the composite foreign key keeps the credential paired with its own server.
    `CREATE TABLE ${tables.agentMcpServers} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      mcp_server_id uuid NOT NULL REFERENCES ${tables.mcpServers} (id) ON DELETE CASCADE,
      credential_id uuid,
      PRIMARY KEY (agent_id, mcp_server_id),
      FOREIGN KEY (credential_id, mcp_server_id)
        REFERENCES ${tables.mcpCredentials} (id, mcp_server_id)
    )`,
  ]
}

/**
 * Makes the link tables the only record of what a workspace allows and what an agent selected, replacing the `text[]`
 * columns those lists used to live in. Names cannot be a foreign key, so a list held a typo forever; the links cannot.
 *
 * `'*'` meant "everything, including the tools that do not exist yet", which a link table cannot express — the default
 * workspace carries `allow_all` instead, and a capability added later needs no row anywhere to reach it.
 */
const capabilityLinkMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables } = schema
  return [
    `ALTER TABLE ${tables.workspaces} ADD COLUMN allow_all boolean NOT NULL DEFAULT false`,
    `ALTER TABLE ${tables.agents} ADD COLUMN allow_all boolean NOT NULL DEFAULT false`,
    `UPDATE ${tables.workspaces}
      SET allow_all = '*' = ANY(allowed_tools) OR '*' = ANY(allowed_mcp_servers) OR '*' = ANY(allowed_skills)`,
    `UPDATE ${tables.agents}
      SET allow_all = '*' = ANY(tools) OR '*' = ANY(mcp_servers) OR '*' = ANY(skills)`,

    // Backfill by name only where the catalog has the row: a name with no catalog entry has nothing to point at, and
    // an unknown name was never enforceable anyway.
    `INSERT INTO ${tables.workspaceTools} (workspace_id, tool_id)
      SELECT w.id, t.id FROM ${tables.workspaces} w
      JOIN ${tables.tools} t ON t.owner_id = w.owner_id AND t.name = ANY(w.allowed_tools)
      ON CONFLICT DO NOTHING`,
    `INSERT INTO ${tables.workspaceSkills} (workspace_id, skill_id)
      SELECT w.id, s.id FROM ${tables.workspaces} w
      JOIN ${tables.skills} s ON s.owner_id = w.owner_id AND s.name = ANY(w.allowed_skills)
      ON CONFLICT DO NOTHING`,
    `INSERT INTO ${tables.workspaceMcpServers} (workspace_id, mcp_server_id)
      SELECT w.id, m.id FROM ${tables.workspaces} w
      JOIN ${tables.mcpServers} m ON m.owner_id = w.owner_id AND m.name = ANY(w.allowed_mcp_servers)
      ON CONFLICT DO NOTHING`,
    `INSERT INTO ${tables.agentTools} (agent_id, tool_id)
      SELECT a.id, t.id FROM ${tables.agents} a
      JOIN ${tables.workspaces} w ON w.id = a.workspace_id
      JOIN ${tables.tools} t ON t.owner_id = w.owner_id AND t.name = ANY(a.tools)
      ON CONFLICT DO NOTHING`,
    `INSERT INTO ${tables.agentSkills} (agent_id, skill_id)
      SELECT a.id, s.id FROM ${tables.agents} a
      JOIN ${tables.workspaces} w ON w.id = a.workspace_id
      JOIN ${tables.skills} s ON s.owner_id = w.owner_id AND s.name = ANY(a.skills)
      ON CONFLICT DO NOTHING`,
    `INSERT INTO ${tables.agentMcpServers} (agent_id, mcp_server_id)
      SELECT a.id, m.id FROM ${tables.agents} a
      JOIN ${tables.workspaces} w ON w.id = a.workspace_id
      JOIN ${tables.mcpServers} m ON m.owner_id = w.owner_id AND m.name = ANY(a.mcp_servers)
      ON CONFLICT DO NOTHING`,

    `ALTER TABLE ${tables.workspaces}
      DROP COLUMN allowed_tools, DROP COLUMN allowed_mcp_servers, DROP COLUMN allowed_skills`,
    `ALTER TABLE ${tables.agents} DROP COLUMN tools, DROP COLUMN mcp_servers, DROP COLUMN skills`,
  ]
}

/**
 * Records which open of the storage may write. Durable assumes one writer, and the storage keeps its next ID in memory,
 * so a second process committing to the same log would mint the same IDs. Each open stamps a fresh token here and every
 * commit checks it, so the older process fails loudly instead of interleaving. Null until the first open stamps it.
 */
const writerMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.durableMetadata} ADD COLUMN writer uuid`,
]

/** Ordered schema history: a released version is never edited, a change appends one. */
export const MIGRATIONS: readonly { version: number; statements: (schema: PostgresSchema) => readonly string[] }[] = [
  { version: 1, statements: migration },
  { version: 2, statements: platformMigration },
  { version: 3, statements: legacyNameRepair },
  { version: 4, statements: workspaceMigration },
  { version: 5, statements: archiveMigration },
  { version: 6, statements: capabilityMigration },
  { version: 7, statements: capabilityLinkMigration },
  { version: 8, statements: writerMigration },
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
  // One lock for the whole database: the durable log and the platform tables share a schema and a runner. It is taken
  // before the first statement because even `CREATE TABLE IF NOT EXISTS` fails with a duplicate-type error when two
  // processes run it against a fresh database at once.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`durable-schema:${schema.prefix}`])
  const applied = await appliedVersions(client, schema)
  for (const entry of MIGRATIONS) {
    if (applied.has(entry.version)) continue
    for (const statement of entry.statements(schema)) await client.query(statement)
    const record = `INSERT INTO ${schema.tables.durableSchema} (version) VALUES ($1)`
    await client.query(record, [entry.version])
  }
}

/** Applies pending migrations in a transaction of their own. */
export const migrate = async (pool: Pool, schema: PostgresSchema): Promise<void> =>
  withTransaction(pool, (client) => applyMigrations(client, schema))
