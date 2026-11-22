import type { Pool } from 'pg'

import type { Queryable, Value } from '../storage/postgres/db.js'
import { withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** One server an agent may use, with the credential it runs as. `null` means the workspace's default for that server. */
export interface McpGrant {
  readonly serverId: string
  readonly credentialId: string | null
}

/** What a workspace allows its agents to reach. The credentials listed here are the ones an agent may choose from. */
export interface WorkspaceGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly McpGrant[]
  readonly credentials: readonly string[]
}

/** What one agent selected out of its workspace's ceiling. */
export interface AgentGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly McpGrant[]
}

/** The three statements one flat link table needs, built once from identifiers this module owns. */
interface LinkSql {
  readonly read: string
  readonly clear: string
  readonly insert: string
}

/** The same three statements for the two MCP link tables, whose second value is a credential rather than a plain id. */
interface McpSql {
  readonly read: string
  readonly clear: string
  readonly insert: string
}

const linkSql = (table: string, subject: string, reference: string): LinkSql => ({
  read: `SELECT ${reference} AS id FROM ${table} WHERE ${subject} = $1`,
  clear: `DELETE FROM ${table} WHERE ${subject} = $1`,
  insert: `INSERT INTO ${table} (${subject}, ${reference}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
})

const mcpSql = (table: string, subject: string, credential: string): McpSql => ({
  read: `SELECT mcp_server_id, ${credential} FROM ${table} WHERE ${subject} = $1`,
  clear: `DELETE FROM ${table} WHERE ${subject} = $1`,
  insert: `INSERT INTO ${table} (${subject}, mcp_server_id, ${credential}) VALUES ($1, $2, $3)`,
})

/**
 * The link tables, as one read and one replace per side. A replace is a delete-then-insert inside one transaction, so a
 * caller sends the whole selection rather than a delta and cannot leave the set half-written.
 *
 * The tables are separate rather than one polymorphic table, which is what lets the database refuse a grant of a row
 * that does not exist. The cost is the repetition below: every statement names its own two columns.
 */
export class CapabilityLinks {
  readonly #pool: Pool
  readonly #sql: {
    readonly workspace: {
      readonly tools: LinkSql
      readonly prompts: LinkSql
      readonly skills: LinkSql
      readonly credentials: LinkSql
      readonly servers: McpSql
    }
    readonly agent: {
      readonly tools: LinkSql
      readonly prompts: LinkSql
      readonly skills: LinkSql
      readonly servers: McpSql
    }
  }

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    const { tables } = schema
    this.#sql = {
      workspace: {
        tools: linkSql(tables.workspaceTools, 'workspace_id', 'tool_id'),
        prompts: linkSql(tables.workspacePrompts, 'workspace_id', 'prompt_id'),
        skills: linkSql(tables.workspaceSkills, 'workspace_id', 'skill_id'),
        credentials: linkSql(tables.workspaceMcpCredentials, 'workspace_id', 'credential_id'),
        servers: mcpSql(tables.workspaceMcpServers, 'workspace_id', 'default_credential_id'),
      },
      agent: {
        tools: linkSql(tables.agentTools, 'agent_id', 'tool_id'),
        prompts: linkSql(tables.agentPrompts, 'agent_id', 'prompt_id'),
        skills: linkSql(tables.agentSkills, 'agent_id', 'skill_id'),
        servers: mcpSql(tables.agentMcpServers, 'agent_id', 'credential_id'),
      },
    }
  }

  async readWorkspace(workspaceId: string): Promise<WorkspaceGrants> {
    const sql = this.#sql.workspace

    return await withTransaction(
      this.#pool,
      async (client) => ({
        tools: await this.#ids(client, sql.tools.read, workspaceId),
        prompts: await this.#ids(client, sql.prompts.read, workspaceId),
        skills: await this.#ids(client, sql.skills.read, workspaceId),
        mcpServers: await this.#grants(client, sql.servers.read, workspaceId),
        credentials: await this.#ids(client, sql.credentials.read, workspaceId),
      }),
      { readOnly: true },
    )
  }

  /** Replaces everything the workspace allows. Servers, credentials and the per-server default are written together. */
  async replaceWorkspace(workspaceId: string, grants: WorkspaceGrants): Promise<void> {
    const sql = this.#sql.workspace

    await withTransaction(this.#pool, async (client) => {
      await this.#replace(client, sql.tools, workspaceId, grants.tools)
      await this.#replace(client, sql.prompts, workspaceId, grants.prompts)
      await this.#replace(client, sql.skills, workspaceId, grants.skills)
      await this.#replace(client, sql.credentials, workspaceId, grants.credentials)
      await client.query(sql.servers.clear, [workspaceId])
      for (const grant of grants.mcpServers) {
        await client.query(sql.servers.insert, [workspaceId, grant.serverId, grant.credentialId])
      }
    })
  }

  async readAgent(agentId: string): Promise<AgentGrants> {
    const sql = this.#sql.agent

    return await withTransaction(
      this.#pool,
      async (client) => ({
        tools: await this.#ids(client, sql.tools.read, agentId),
        prompts: await this.#ids(client, sql.prompts.read, agentId),
        skills: await this.#ids(client, sql.skills.read, agentId),
        mcpServers: await this.#grants(client, sql.servers.read, agentId),
      }),
      { readOnly: true },
    )
  }

  /** Replaces an agent's selection. A `null` credential keeps the workspace's default for that server. */
  async replaceAgent(agentId: string, grants: AgentGrants): Promise<void> {
    const sql = this.#sql.agent

    await withTransaction(this.#pool, async (client) => {
      await this.#replace(client, sql.tools, agentId, grants.tools)
      await this.#replace(client, sql.prompts, agentId, grants.prompts)
      await this.#replace(client, sql.skills, agentId, grants.skills)
      await client.query(sql.servers.clear, [agentId])
      for (const grant of grants.mcpServers) {
        await client.query(sql.servers.insert, [agentId, grant.serverId, grant.credentialId])
      }
    })
  }

  async #ids(client: Queryable, text: string, subjectId: string): Promise<string[]> {
    const values: Value[] = [subjectId]

    return (await client.query<{ id: string }>(text, values)).rows.map((row) => row.id)
  }

  async #grants(client: Queryable, text: string, subjectId: string): Promise<McpGrant[]> {
    const rows = await client.query<{
      readonly mcp_server_id: string
      readonly default_credential_id?: string | null
      readonly credential_id?: string | null
    }>(text, [subjectId])

    return rows.rows.map((row) => ({
      serverId: row.mcp_server_id,
      credentialId: row.credential_id ?? row.default_credential_id ?? null,
    }))
  }

  async #replace(client: Queryable, sql: LinkSql, subjectId: string, references: readonly string[]): Promise<void> {
    await client.query(sql.clear, [subjectId])
    for (const reference of new Set(references)) {
      await client.query(sql.insert, [subjectId, reference])
    }
  }
}
