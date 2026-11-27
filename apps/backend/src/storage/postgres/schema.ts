import type { Pool } from 'pg'
import { LOCAL_USER_ID, LOCAL_USER_NAME } from '../../threads/local-user.js'
import {
  ALL_CAPABILITIES,
  DEFAULT_AGENT_DESCRIPTION,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_PROMPTED_DESCRIPTION,
  DEFAULT_WORKSPACE_DESCRIPTION,
  LEGACY_DEFAULT_WORKSPACE_DESCRIPTION,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from '../../workspaces/defaults.js'
import { MEMBER_PERMISSIONS } from '../../auth/permissions.js'
import {
  ADMIN_ROLE_DESCRIPTION,
  ADMIN_ROLE_ID,
  ADMIN_ROLE_NAME,
  MEMBER_ROLE_DESCRIPTION,
  MEMBER_ROLE_ID,
  MEMBER_ROLE_NAME,
} from '../../auth/roles.js'
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
    /** The prompt text a conversation started with, frozen so its request prefix never moves under the cache. */
    readonly conversationPrompts: string
    readonly conversationAgentPrompts: string
    readonly workspaces: string
    readonly agents: string
    readonly subagentCallers: string
    readonly delegations: string
    readonly devEnvironments: string
    readonly workspaceEnvironments: string
    readonly agentEnvironments: string
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
    readonly roles: string
    readonly rolePermissions: string
    readonly userPermissionOverrides: string
    readonly sessions: string
    readonly appSettings: string
    /** User-owned secrets: API keys and MCP credentials, kept apart from the capability catalog they serve. */
    readonly userCredentials: string
    /** Public keys authorized in every container the owner starts; private material never enters this table. */
    readonly userSshKeys: string
    /** What a provider serves, cached; and the two link tables that say what one workspace may spend. */
    readonly providerModels: string
    readonly workspaceProviderLogins: string
    readonly workspaceProviderModels: string
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
    readonly workspacesByOwnerOrder: string
    readonly oneDefaultWorkspace: string
    readonly agentsByWorkspace: string
    readonly oneDefaultAgent: string
    readonly subagentCallersByAgent: string
    readonly delegationsByThread: string
    readonly delegationsByStatus: string
    readonly devEnvironmentsByOwner: string
    readonly agentEnvironmentsOnePerAgent: string
    readonly workspaceEnvironmentsOnePerWorkspace: string
    readonly userCredentialsByOwnerKind: string
    readonly userCredentialsByOwnerMcp: string
    readonly toolsByName: string
    readonly promptsByName: string
    readonly skillsByName: string
    readonly mcpServersByName: string
    readonly mcpCredentialsByLabel: string
    readonly mcpCredentialsByIdServer: string
    readonly workspaceMcpServersByName: string
    readonly sessionsByUser: string
    readonly usersByUsername: string
    readonly userSshKeysByOwner: string
  }
}

/**
 * The durable log's namespace. `apps/backend` owns these tables too, but they hold durable's internal state while the
 * bare names are Cake's own, so the two never collide in one database.
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
  conversationPrompts: 'conversation_prompts',
  conversationAgentPrompts: 'conversation_agent_prompts',
  workspaces: 'workspaces',
  agents: 'agents',
  subagentCallers: 'subagent_callers',
  delegations: 'delegations',
  devEnvironments: 'dev_environments',
  workspaceEnvironments: 'workspace_environments',
  agentEnvironments: 'agent_environments',
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
  roles: 'roles',
  rolePermissions: 'role_permissions',
  userPermissionOverrides: 'user_permission_overrides',
  sessions: 'sessions',
  // Key and value rather than a column per setting: what belongs here changes with the product, and a migration per
  // checkbox is a migration nobody needs.
  appSettings: 'app_settings',
  userCredentials: 'user_credentials',
  userSshKeys: 'user_ssh_keys',
  // The catalog of what a provider serves, cached because the upstream call is somebody else's rate limit.
  providerModels: 'provider_models',
  workspaceProviderLogins: 'workspace_provider_logins',
  workspaceProviderModels: 'workspace_provider_models',
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
  // The list order the user arranges by dragging: one position per workspace, per owner.
  workspacesByOwnerOrder: 'workspaces_by_owner_order',
  oneDefaultWorkspace: 'workspaces_one_default',
  agentsByWorkspace: 'agents_by_workspace',
  oneDefaultAgent: 'agents_one_default',
  subagentCallersByAgent: 'subagent_callers_by_agent',
  delegationsByThread: 'delegations_by_thread',
  delegationsByStatus: 'delegations_by_status',
  devEnvironmentsByOwner: 'dev_environments_by_owner',
  // One environment per agent, for now: the index is the constraint, so lifting it later drops the index and
  // nothing else. The model beneath it is already many-to-many, which is what the composite primary key says.
  agentEnvironmentsOnePerAgent: 'agent_environments_one_per_agent',
  workspaceEnvironmentsOnePerWorkspace: 'workspace_environments_one_per_workspace',
  // The credentials page reads one kind at a time, and the MCP form looks them up by the server they answer for.
  userCredentialsByOwnerKind: 'user_credentials_by_owner_kind',
  userCredentialsByOwnerMcp: 'user_credentials_by_owner_mcp',
  toolsByName: 'tools_by_owner_name',
  promptsByName: 'prompts_by_owner_name',
  skillsByName: 'skills_by_owner_name',
  mcpServersByName: 'mcp_servers_by_owner_name',
  mcpCredentialsByLabel: 'mcp_credentials_by_server_label',
  // Lets a link name a credential together with its server, so the database refuses a credential bound to the wrong one.
  mcpCredentialsByIdServer: 'mcp_credentials_by_id_server',
  workspaceMcpServersByName: 'workspace_mcp_servers_by_workspace_name',
  sessionsByUser: 'sessions_by_user',
  usersByUsername: 'users_by_username',
  userSshKeysByOwner: 'user_ssh_keys_by_owner',
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

/** Frozen value from the original profile starter; migration history must not depend on today's default prompt. */
export const LEGACY_DEFAULT_SYSTEM_PROMPT = `You are a capable, direct assistant working with one person inside their workspace.

How you work:
- Understand the request before acting. If something is ambiguous and a wrong guess would be costly, ask one short question; otherwise make a sensible assumption, say what it was, and continue.
- Use the tools you are given when they help, and only those. Never claim to have run a command, read a file, or checked a fact you did not. If a task needs a tool you do not have, say so plainly instead of pretending.
- Read before you change anything: look at the existing files, code or data first and follow the conventions you find there.
- Prefer the smallest change that solves the problem. Do not refactor, rename or "improve" things you were not asked to touch.
- Before anything destructive or hard to undo (deleting files, overwriting work, force operations, anything touching production or other people), stop and confirm.
- When something fails, read the error, find the cause, and fix that. Do not retry blindly or hide the failure.
- Verify your work where you can (run the tests, re-read the result) and report what you verified and what you did not.

How you answer:
- Lead with the answer or the result, then the detail that supports it. Keep it as short as the question allows.
- Use Markdown: code blocks with a language tag, lists for steps, tables only for real comparisons.
- Be honest about uncertainty. "I don't know" or "I couldn't check" is better than a confident guess.
- Write in the language the person writes to you in.`

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
 * Development environments as rows of their own, instead of a JSON column on the workspace that held one image name.
 *
 * A workspace may have several environments (one per repository, in a polyrepo) and an environment may serve several
 * workspaces, so both relations are link tables. An agent points at one environment for now: the composite primary key
 * of `agent_environments` is the general many-to-many shape, while a unique index on `agent_id` narrows it to one until
 * the product needs otherwise. Dropping that index is the whole change when it does.
 */
const environmentMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema
  const hasImage = `jsonb_typeof(container) = 'object' AND container->>'image' <> ''`
  // The workspace's own id, laid out as a uuid: a stable value that needs no extension and lets the backfill link the
  // rows it just created without reading them back.
  const derived = `(substr(md5(w.id::text), 1, 8) || '-' || substr(md5(w.id::text), 9, 4) || '-' ||
    substr(md5(w.id::text), 13, 4) || '-' || substr(md5(w.id::text), 17, 4) || '-' ||
    substr(md5(w.id::text), 21, 12))::uuid`

  return [
    `CREATE TABLE ${tables.devEnvironments} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id),
      name text NOT NULL,
      image text NOT NULL,
      -- The container this environment runs as, or NULL until it is first started.
      container_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX ${indexes.devEnvironmentsByOwner}
      ON ${tables.devEnvironments} (owner_id, updated_at DESC)`,
    `CREATE TABLE ${tables.workspaceEnvironments} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      environment_id uuid NOT NULL REFERENCES ${tables.devEnvironments} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, environment_id)
    )`,
    `CREATE TABLE ${tables.agentEnvironments} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      environment_id uuid NOT NULL REFERENCES ${tables.devEnvironments} (id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, environment_id)
    )`,
    `CREATE UNIQUE INDEX ${indexes.agentEnvironmentsOnePerAgent} ON ${tables.agentEnvironments} (agent_id)`,

    // One environment per workspace that named a container, keeping the image it named: an install that is upgraded
    // keeps the environment it had instead of starting without one.
    `INSERT INTO ${tables.devEnvironments} (id, owner_id, name, image)
      SELECT ${derived}, w.owner_id, w.name, w.container->>'image'
      FROM ${tables.workspaces} w WHERE ${hasImage}`,
    `INSERT INTO ${tables.workspaceEnvironments} (workspace_id, environment_id)
      SELECT w.id, ${derived} FROM ${tables.workspaces} w WHERE ${hasImage}`,

    `ALTER TABLE ${tables.workspaces} DROP COLUMN container`,
  ]
}

/**
 * What the container reported about itself. Beside the environment rather than in a table of its own: there is one report
 * per environment, each boot replaces it, and nothing reads it by anything but the environment id. `reported_at` is the
 * report's own instant, so it survives being stored in a different timezone than it was produced in.
 */
const reportedStateMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.devEnvironments} ADD COLUMN reported_state jsonb`,
  `ALTER TABLE ${schema.tables.devEnvironments} ADD COLUMN reported_at timestamptz`,
]

/**
 * Identity: who may sign in, what a role lets them do, and which sessions are live.
 *
 * Roles carry permissions through a table rather than an array column, matching how capabilities are linked everywhere
 * else here. Overrides are a grant or a deny per user per permission, because that is the whole feature: someone who
 * needs one more thing than their role allows, or one thing less.
 *
 * `sessions.authenticated_at` is the half-signed-in state. A password on its own opens a session that may only finish
 * the second factor or the forced password change, so "2FA is required and not set up yet" needs no second table.
 */
const authMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema
  const memberGrants = MEMBER_PERMISSIONS.map((permission) => `('${MEMBER_ROLE_ID}', '${permission}')`).join(', ')

  return [
    `CREATE TABLE ${tables.roles} (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      description text NOT NULL DEFAULT '',
      -- The seeded admin: every permission, including ones that do not exist yet. Enumerating them would mean editing
      -- this row every time a route gains a check.
      grants_all boolean NOT NULL DEFAULT false,
      is_builtin boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE ${tables.rolePermissions} (
      role_id uuid NOT NULL REFERENCES ${tables.roles} (id) ON DELETE CASCADE,
      permission text NOT NULL,
      PRIMARY KEY (role_id, permission)
    )`,
    `CREATE TABLE ${tables.userPermissionOverrides} (
      user_id uuid NOT NULL REFERENCES ${tables.users} (id) ON DELETE CASCADE,
      permission text NOT NULL,
      -- false is a deny, and a deny beats the role: "less than the role" has to be expressible to be useful.
      allowed boolean NOT NULL,
      PRIMARY KEY (user_id, permission)
    )`,
    `CREATE TABLE ${tables.sessions} (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES ${tables.users} (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      -- NULL until the second factor and any forced password change are done.
      authenticated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`,
    `CREATE INDEX ${indexes.sessionsByUser} ON ${tables.sessions} (user_id)`,
    `CREATE TABLE ${tables.appSettings} (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    // Nullable because the seeded row owns every existing workspace, thread and agent before anyone signs in: the
    // installer gives it a name and a password, and the id — the whole identity of the owner — never changes.
    `ALTER TABLE ${tables.users}
      ADD COLUMN username text,
      ADD COLUMN password_hash text,
      ADD COLUMN role_id uuid REFERENCES ${tables.roles} (id),
      ADD COLUMN disabled boolean NOT NULL DEFAULT false,
      ADD COLUMN totp_secret text,
      ADD COLUMN totp_confirmed_at timestamptz,
      ADD COLUMN must_change_password boolean NOT NULL DEFAULT false`,
    `CREATE UNIQUE INDEX ${indexes.usersByUsername} ON ${tables.users} (username) WHERE username IS NOT NULL`,

    `INSERT INTO ${tables.roles} (id, name, description, grants_all, is_builtin) VALUES
      ('${ADMIN_ROLE_ID}', '${ADMIN_ROLE_NAME}', '${ADMIN_ROLE_DESCRIPTION}', true, true),
      ('${MEMBER_ROLE_ID}', '${MEMBER_ROLE_NAME}', '${MEMBER_ROLE_DESCRIPTION}', false, true)`,
    `INSERT INTO ${tables.rolePermissions} (role_id, permission) VALUES ${memberGrants}`,

    // The owner of everything that already exists becomes the admin: an install that upgrades signs in without losing
    // access to what it made.
    `UPDATE ${tables.users} SET role_id = '${ADMIN_ROLE_ID}' WHERE role_id IS NULL`,

    // Single-user is what this install was until now — no sign-in, one identity — so an existing database keeps
    // behaving exactly as it did, and enabling accounts is the change an admin makes deliberately.
    `INSERT INTO ${tables.appSettings} (key, value) VALUES
      ('single_user', 'true'::jsonb),
      ('require_two_factor', 'false'::jsonb)`,
  ]
}

/**
 * The order the workspaces are listed in. A position, not `updated_at`: the list is the user's arrangement, and it must
 * not reshuffle because a workspace was renamed. Existing rows backfill newest-first, which is the order the list showed
 * before anyone could drag one.
 */
const workspaceOrderMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema

  return [
    `ALTER TABLE ${tables.workspaces} ADD COLUMN position integer NOT NULL DEFAULT 0`,
    `UPDATE ${tables.workspaces} AS w SET position = ranked.rn
      FROM (
        SELECT id, (row_number() OVER (PARTITION BY owner_id ORDER BY created_at DESC, id) - 1)::integer AS rn
        FROM ${tables.workspaces}
      ) AS ranked
      WHERE w.id = ranked.id`,
    `CREATE INDEX ${indexes.workspacesByOwnerOrder} ON ${tables.workspaces} (owner_id, position)`,
  ]
}

/**
 * At most one environment per workspace, in the database rather than only in the routes: a workspace is a container to
 * work in, with no picker to choose among several, so a second link would be a state nothing can read or undo. The
 * index is the rule; the repository creates the one row and `ensureEnvironments` seeds it for what predates this.
 */
const oneEnvironmentPerWorkspaceMigration = (schema: PostgresSchema): readonly string[] => [
  `CREATE UNIQUE INDEX ${schema.indexes.workspaceEnvironmentsOnePerWorkspace}
    ON ${schema.tables.workspaceEnvironments} (workspace_id)`,
]

/**
 * A credential the user owns, independent of the catalog it unlocks: `kind` decides which fields apply, and the check
 * makes that a row nobody can half-write. `expires_at` is nullable because "never" is a real choice; `value` is the
 * secret and is never read back over HTTP.
 */
const credentialsMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema

  return [
    `CREATE TABLE ${tables.userCredentials} (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES ${tables.users} (id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('opencode-go', 'mcp')),
      name text NOT NULL,
      value text NOT NULL,
      expires_at timestamptz,
      email text,
      note text,
      mcp_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT user_credentials_fields CHECK (
        (kind = 'opencode-go' AND email IS NOT NULL AND mcp_id IS NULL)
        OR (kind = 'mcp' AND mcp_id IS NOT NULL AND email IS NULL)
      )
    )`,
    `CREATE INDEX ${indexes.userCredentialsByOwnerKind} ON ${tables.userCredentials} (owner_id, kind)`,
    // Not unique: several credentials may answer for one server, which is the point of keeping them apart from it.
    `CREATE INDEX ${indexes.userCredentialsByOwnerMcp} ON ${tables.userCredentials} (owner_id, mcp_id)`,
  ]
}

/**
 * MCP servers belong to the workspace whose container runs them, so the catalog-wide definition and its separate
 * credential rows are gone. `cwd` and `env` only mean anything inside one workspace's container, and the credential a
 * server authenticates with is now named on the server row itself. An agent keeps a selection, which is a list of ids
 * and nothing more: the configuration it points at lives with the workspace that owns it.
 *
 * Dropped in foreign-key order — the links first, then the credentials they named, then the definitions.
 */
const workspaceMcpMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema

  return [
    `DROP TABLE ${tables.agentMcpServers}`,
    `DROP TABLE ${tables.workspaceMcpServers}`,
    `DROP TABLE ${tables.workspaceMcpCredentials}`,
    `DROP TABLE ${tables.mcpCredentials}`,
    `DROP TABLE ${tables.mcpServers}`,

    `CREATE TABLE ${tables.workspaceMcpServers} (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      transport text NOT NULL CHECK (transport IN ('stdio', 'http')),
      command text,
      args text[] NOT NULL DEFAULT '{}',
      cwd text,
      url text,
      env jsonb NOT NULL DEFAULT '{}'::jsonb,
      mcp_id text,
      credential_id uuid REFERENCES ${tables.userCredentials} (id) ON DELETE SET NULL,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT workspace_mcp_servers_transport_target CHECK (
        (transport = 'stdio' AND command IS NOT NULL AND url IS NULL)
        OR (transport = 'http' AND url IS NOT NULL AND command IS NULL)
      )
    )`,
    // Two workspaces may each run a server called `files`; one workspace may not have two.
    `CREATE UNIQUE INDEX ${indexes.workspaceMcpServersByName}
      ON ${tables.workspaceMcpServers} (workspace_id, name)`,
    `CREATE TABLE ${tables.agentMcpServers} (
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      mcp_server_id uuid NOT NULL REFERENCES ${tables.workspaceMcpServers} (id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, mcp_server_id)
    )`,
  ]
}

/**
 * Providers: a key is a `user_credentials` row, because that is where a user's keys already live, and a workspace names
 * the ones it may spend. `provider_models` caches what upstream serves so a page load is not an upstream call, and the
 * two link tables hold the workspace's selection for the same reason the capability links do.
 *
 * The `user_credentials` check is replaced rather than left alone: an `opencode-go` key was required to name an email,
 * which was true when the only way to add one was the credentials page. A provider login is a label and a key, and the
 * account behind it is something the provider knows, not something the user is asked to copy.
 */
const providerMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables } = schema

  return [
    `ALTER TABLE ${tables.userCredentials} DROP CONSTRAINT user_credentials_fields`,
    `ALTER TABLE ${tables.userCredentials} ADD CONSTRAINT user_credentials_fields CHECK (
      (kind = 'opencode-go' AND mcp_id IS NULL)
      OR (kind = 'mcp' AND mcp_id IS NOT NULL AND email IS NULL)
    )`,

    `ALTER TABLE ${tables.workspaces} ADD COLUMN allow_all_models boolean NOT NULL DEFAULT false`,

    `CREATE TABLE ${tables.providerModels} (
      provider text NOT NULL,
      model_id text NOT NULL,
      name text NOT NULL,
      context_window integer,
      max_output integer,
      input_usd_per_million numeric(12, 6),
      output_usd_per_million numeric(12, 6),
      supports_reasoning boolean NOT NULL DEFAULT false,
      supports_tools boolean NOT NULL DEFAULT false,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, model_id)
    )`,

    `CREATE TABLE ${tables.workspaceProviderLogins} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      credential_id uuid NOT NULL REFERENCES ${tables.userCredentials} (id) ON DELETE CASCADE,
      PRIMARY KEY (workspace_id, credential_id)
    )`,

    `CREATE TABLE ${tables.workspaceProviderModels} (
      workspace_id uuid NOT NULL REFERENCES ${tables.workspaces} (id) ON DELETE CASCADE,
      model_id text NOT NULL,
      PRIMARY KEY (workspace_id, model_id)
    )`,
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

/**
 * What an agent runs with: the stored key that pays for it, the model and how hard it thinks. The key and the model are
 * optional on the row; `agents/run-settings.ts` fills the gaps (the workspace's linked key, the default model) when a
 * run starts. Deleting a key leaves the agent without one rather than deleting the agent.
 */
const agentRunSettingsMigration = (schema: PostgresSchema): readonly string[] => [
  // The account email on a provider key is a note for telling keys apart, not something the provider needs. Requiring
  // it also made every key stored without one (the providers API did exactly that) a constraint violation.
  `ALTER TABLE ${schema.tables.userCredentials} DROP CONSTRAINT user_credentials_fields`,
  `ALTER TABLE ${schema.tables.userCredentials} ADD CONSTRAINT user_credentials_fields CHECK (
    (kind = 'opencode-go' AND mcp_id IS NULL)
    OR (kind = 'mcp' AND mcp_id IS NOT NULL AND email IS NULL)
  )`,
  `ALTER TABLE ${schema.tables.agents}
    ADD COLUMN credential_id uuid REFERENCES ${schema.tables.userCredentials} (id) ON DELETE SET NULL,
    ADD COLUMN model_id text,
    ADD COLUMN thinking_level text NOT NULL DEFAULT 'low'
      CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))`,
]

/**
 * Give every default agent that still has no system prompt the starter one, so a fresh conversation behaves like a
 * working agent and a new agent's editor has something to start from. Prompts someone already wrote are left alone, and
 * the General agent's description stops claiming it has no instructions only while it still says so.
 */
const defaultPromptMigration = (schema: PostgresSchema): readonly string[] => [
  `UPDATE ${schema.tables.agents} SET system_prompt = ${literal(LEGACY_DEFAULT_SYSTEM_PROMPT)}, updated_at = now()
    WHERE is_default AND system_prompt = ''`,
  `UPDATE ${schema.tables.agents} SET description = ${literal(DEFAULT_AGENT_PROMPTED_DESCRIPTION)}
    WHERE id = ${literal(DEFAULT_AGENT_ID)} AND description = ${literal(DEFAULT_AGENT_DESCRIPTION)}`,
]

/** One conversation may run differently from its agent without changing the profile other conversations use. */
const threadRunSettingsMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.chatThreads}
    ADD COLUMN credential_id uuid REFERENCES ${schema.tables.userCredentials} (id) ON DELETE SET NULL,
    ADD COLUMN model_id text,
    ADD COLUMN thinking_level text
      CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))`,
]

/** Prompts were superseded by skills; their grants and catalog have no remaining readers. */
const removePromptsMigration = (schema: PostgresSchema): readonly string[] => [
  `DELETE FROM ${schema.tables.rolePermissions} WHERE permission = 'prompts.manage'`,
  `DELETE FROM ${schema.tables.userPermissionOverrides} WHERE permission = 'prompts.manage'`,
  `DROP TABLE ${schema.tables.workspacePrompts}`,
  `DROP TABLE ${schema.tables.agentPrompts}`,
  `DROP TABLE ${schema.tables.prompts}`,
]

/** Move the profile prompt to an append-only field and remove only the unchanged legacy starter copy. */
const agentPromptAppendMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.agents} RENAME COLUMN system_prompt TO system_prompt_append`,
  `UPDATE ${schema.tables.agents} SET system_prompt_append = ''
    WHERE system_prompt_append = ${literal(LEGACY_DEFAULT_SYSTEM_PROMPT)}`,
]

/** General now has a container for skills and MCP servers; preserve any description the user changed. */
const generalEnvironmentDescriptionMigration = (schema: PostgresSchema): readonly string[] => [
  `UPDATE ${schema.tables.workspaces} SET description = ${literal(DEFAULT_WORKSPACE_DESCRIPTION)}, updated_at = now()
    WHERE is_default AND description = ${literal(LEGACY_DEFAULT_WORKSPACE_DESCRIPTION)}`,
]

/** Stable host ports for Remote-SSH, and the owner's public keys delivered to each container at start and on change. */
const sshAccessMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.devEnvironments} ADD COLUMN ssh_port integer UNIQUE`,
  `CREATE TABLE ${schema.tables.userSshKeys} (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES ${schema.tables.users} (id) ON DELETE CASCADE,
    name text NOT NULL,
    public_key text NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ${schema.indexes.userSshKeysByOwner}
    ON ${schema.tables.userSshKeys} (owner_id, created_at)`,
]

/** Desired apt/npm packages, edited independently of the container's last reported state. */
const persistentToolingMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.devEnvironments} ADD COLUMN tooling jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ${schema.tables.userCredentials} DROP CONSTRAINT ${schema.prefix}user_credentials_kind_check`,
  `ALTER TABLE ${schema.tables.userCredentials} ADD CONSTRAINT user_credentials_kind_check
    CHECK (kind IN ('opencode-go', 'mcp', 'github-token'))`,
  `ALTER TABLE ${schema.tables.userCredentials} DROP CONSTRAINT user_credentials_fields`,
  `ALTER TABLE ${schema.tables.userCredentials} ADD CONSTRAINT user_credentials_fields CHECK (
    (kind = 'opencode-go' AND mcp_id IS NULL)
    OR (kind = 'mcp' AND mcp_id IS NOT NULL AND email IS NULL)
    OR (kind = 'github-token' AND mcp_id IS NULL AND email IS NULL)
  )`,
  `ALTER TABLE ${schema.tables.users}
    ADD COLUMN git_name text,
    ADD COLUMN git_email text`,
]

/** Sub agents reuse agent rows and grants, and are callable only by linked parent agents. */
const subagentMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables, indexes } = schema

  return [
    `ALTER TABLE ${tables.agents} ADD COLUMN kind text NOT NULL DEFAULT 'agent'
      CHECK (kind IN ('agent', 'subagent'))`,
    `CREATE TABLE ${tables.subagentCallers} (
      subagent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      PRIMARY KEY (subagent_id, agent_id)
    )`,
    `CREATE INDEX ${indexes.subagentCallersByAgent} ON ${tables.subagentCallers} (agent_id, subagent_id)`,
    `CREATE TABLE ${tables.delegations} (
      id uuid PRIMARY KEY,
      parent_thread_id uuid NOT NULL REFERENCES ${tables.chatThreads} (id) ON DELETE CASCADE,
      parent_conversation_id bigint NOT NULL,
      parent_task_id bigint NOT NULL,
      parent_call_id text NOT NULL,
      subagent_id uuid NOT NULL REFERENCES ${tables.agents} (id),
      child_conversation_id bigint NOT NULL UNIQUE,
      status text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
      worktree_path text,
      worktree_branch text,
      result_summary text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`,
    `CREATE INDEX ${indexes.delegationsByThread} ON ${tables.delegations} (parent_thread_id, started_at)`,
    `CREATE INDEX ${indexes.delegationsByStatus} ON ${tables.delegations} (status, started_at)`,
  ]
}

/** A sub agent's default model and thinking level use the existing run-setting columns; its model ceiling is new. */
const subagentModelsMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.agents} ADD COLUMN allowed_models text[]`,
  `ALTER TABLE ${schema.tables.agents} ADD CONSTRAINT subagent_model_settings CHECK (
    kind = 'agent' OR (
      model_id IS NOT NULL
      AND allowed_models IS NOT NULL
      AND cardinality(allowed_models) > 0
      AND model_id = ANY(allowed_models)
    )
  )`,
]

/** Automatic titles never replace a person's title; the entry marker makes regeneration idempotent. */
const automaticTitlesMigration = (schema: PostgresSchema): readonly string[] => [
  `ALTER TABLE ${schema.tables.chatThreads} ADD COLUMN title_source text NOT NULL DEFAULT 'auto'
    CHECK (title_source IN ('user', 'auto'))`,
  `UPDATE ${schema.tables.chatThreads} SET title_source = 'user' WHERE title IS NOT NULL`,
  `ALTER TABLE ${schema.tables.chatThreads} ADD COLUMN auto_title_entry_id bigint`,
]

/**
 * The text a conversation started with, kept by conversation rather than by thread: a delegation's child conversation
 * has no thread row, and a conversation may run under more than one agent (switching), each with its own append.
 */
const promptSnapshotMigration = (schema: PostgresSchema): readonly string[] => {
  const { tables } = schema

  return [
    `CREATE TABLE ${tables.conversationPrompts} (
      conversation_id bigint PRIMARY KEY,
      system_prompt text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE ${tables.conversationAgentPrompts} (
      conversation_id bigint NOT NULL,
      agent_id uuid NOT NULL REFERENCES ${tables.agents} (id) ON DELETE CASCADE,
      system_prompt_append text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, agent_id)
    )`,
  ]
}

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
  { version: 9, statements: environmentMigration },
  { version: 10, statements: reportedStateMigration },
  { version: 11, statements: authMigration },
  { version: 12, statements: workspaceOrderMigration },
  { version: 13, statements: oneEnvironmentPerWorkspaceMigration },
  { version: 14, statements: credentialsMigration },
  { version: 15, statements: workspaceMcpMigration },
  { version: 16, statements: providerMigration },
  { version: 17, statements: agentRunSettingsMigration },
  { version: 18, statements: defaultPromptMigration },
  { version: 19, statements: threadRunSettingsMigration },
  { version: 20, statements: removePromptsMigration },
  { version: 21, statements: agentPromptAppendMigration },
  { version: 22, statements: generalEnvironmentDescriptionMigration },
  { version: 23, statements: sshAccessMigration },
  { version: 24, statements: persistentToolingMigration },
  { version: 25, statements: subagentMigration },
  { version: 26, statements: subagentModelsMigration },
  { version: 27, statements: automaticTitlesMigration },
  { version: 28, statements: promptSnapshotMigration },
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
  // One lock for the whole database: the durable log and Cake's tables share a schema and a runner. It is taken
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
