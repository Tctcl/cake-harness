import type { Pool } from 'pg'

import type { Queryable, Value } from '../storage/postgres/db.js'
import { withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** What a workspace allows its agents to reach. MCP servers are not a grant: the workspace owns them outright. */
export interface WorkspaceGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
}

/** What one agent selected out of its workspace's ceiling. MCP servers are ids of the workspace's own rows. */
export interface AgentGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly string[]
}

/** The three statements one flat link table needs, built once from identifiers this module owns. */
interface LinkSql {
  readonly read: string
  readonly clear: string
  readonly insert: string
}


const linkSql = (table: string, subject: string, reference: string): LinkSql => ({
  read: `SELECT ${reference} AS id FROM ${table} WHERE ${subject} = $1`,
  clear: `DELETE FROM ${table} WHERE ${subject} = $1`,
  insert: `INSERT INTO ${table} (${subject}, ${reference}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
    }
    readonly agent: {
      readonly tools: LinkSql
      readonly prompts: LinkSql
      readonly skills: LinkSql
      readonly servers: LinkSql
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
      },
      agent: {
        tools: linkSql(tables.agentTools, 'agent_id', 'tool_id'),
        prompts: linkSql(tables.agentPrompts, 'agent_id', 'prompt_id'),
        skills: linkSql(tables.agentSkills, 'agent_id', 'skill_id'),
        // A server id here is one of the workspace's own rows: `mcpServerRepository` is what enforces that on write.
        servers: linkSql(tables.agentMcpServers, 'agent_id', 'mcp_server_id'),
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
      }),
      { readOnly: true },
    )
  }

  /** Replaces everything the workspace allows. MCP servers are not a grant, so they are not written here. */
  async replaceWorkspace(workspaceId: string, grants: WorkspaceGrants): Promise<void> {
    const sql = this.#sql.workspace

    await withTransaction(this.#pool, async (client) => {
      await this.#replace(client, sql.tools, workspaceId, grants.tools)
      await this.#replace(client, sql.prompts, workspaceId, grants.prompts)
      await this.#replace(client, sql.skills, workspaceId, grants.skills)
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
        mcpServers: await this.#ids(client, sql.servers.read, agentId),
      }),
      { readOnly: true },
    )
  }

  /** Replaces an agent's selection. The server ids must be rows of the agent's own workspace. */
  async replaceAgent(agentId: string, grants: AgentGrants): Promise<void> {
    const sql = this.#sql.agent

    await withTransaction(this.#pool, async (client) => {
      await this.#replace(client, sql.tools, agentId, grants.tools)
      await this.#replace(client, sql.prompts, agentId, grants.prompts)
      await this.#replace(client, sql.skills, agentId, grants.skills)
      await this.#replace(client, sql.servers, agentId, grants.mcpServers)
    })
  }

  async #ids(client: Queryable, text: string, subjectId: string): Promise<string[]> {
    const values: Value[] = [subjectId]

    return (await client.query<{ id: string }>(text, values)).rows.map((row) => row.id)
  }

  async #replace(client: Queryable, sql: LinkSql, subjectId: string, references: readonly string[]): Promise<void> {
    await client.query(sql.clear, [subjectId])
    for (const reference of new Set(references)) {
      await client.query(sql.insert, [subjectId, reference])
    }
  }
}
