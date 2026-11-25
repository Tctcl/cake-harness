import type { Pool, QueryResultRow } from 'pg'

import type { SecretBox } from '../auth/secret-box.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'
import type { UpstreamModel } from './provider-client.js'

/**
 * The only provider this build talks to. The tables and the wire shapes already hold more than one, because a second
 * provider changes what is stored, not how it is stored; this constant is where that assumption is written down.
 */
export const SUPPORTED_PROVIDER = 'opencode-go'

/** A key the user stored, named so two keys on one provider can be told apart. The key itself is never served. */
export interface ProviderLogin {
  readonly id: string
  readonly provider: string
  readonly label: string
  readonly createdAt: string
}

/** What a provider serves, as the catalog caches it. */
export interface ProviderModel {
  readonly id: string
  readonly provider: string
  readonly name: string
  readonly contextWindow: number | null
  readonly maxOutput: number | null
  readonly inputUsdPerMillion: number | null
  readonly outputUsdPerMillion: number | null
  readonly supportsReasoning: boolean
  readonly supportsTools: boolean
}

/** What one workspace may spend: the logins it links, and which of their models it allows. */
export interface WorkspaceProviders {
  readonly loginIds: readonly string[]
  readonly allowedModels: readonly string[]
  readonly allowAllModels: boolean
}

/** What the workspace's providers have been used for. Nothing writes usage yet, so the counters stay zero. */
export interface ProviderUsage {
  readonly provider: string
  readonly loginCount: number
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
}

interface LoginRow {
  readonly id: string
  readonly name: string
  readonly created_at: Date
}

interface ModelRow {
  readonly provider: string
  readonly model_id: string
  readonly name: string
  readonly context_window: number | null
  readonly max_output: number | null
  readonly input_usd_per_million: string | null
  readonly output_usd_per_million: string | null
  readonly supports_reasoning: boolean
  readonly supports_tools: boolean
}

const LOGIN_COLUMNS = 'id, name, created_at'

const MODEL_COLUMNS =
  'provider, model_id, name, context_window, max_output, input_usd_per_million, output_usd_per_million, supports_reasoning, supports_tools'

/** `numeric` arrives as a string so no precision is lost on the wire; a price is a float here, so it is parsed once. */
const priceOrNull = (value: string | null): number | null => (value === null ? null : Number(value))

/** The pool and a transaction's client both answer queries, so these two readers are the only difference. */
const poolRows = async <R extends QueryResultRow>(
  pool: Pool,
  text: string,
  values: readonly Value[] = [],
): Promise<R[]> => (await pool.query<R>(text, [...values])).rows

const toLogin = (row: LoginRow): ProviderLogin => ({
  id: row.id,
  provider: SUPPORTED_PROVIDER,
  label: row.name,
  createdAt: row.created_at.toISOString(),
})

const toModel = (row: ModelRow): ProviderModel => ({
  id: row.model_id,
  provider: row.provider,
  name: row.name,
  contextWindow: row.context_window,
  maxOutput: row.max_output,
  inputUsdPerMillion: priceOrNull(row.input_usd_per_million),
  outputUsdPerMillion: priceOrNull(row.output_usd_per_million),
  supportsReasoning: row.supports_reasoning,
  supportsTools: row.supports_tools,
})

/**
 * Every statement this repository runs, built once from the schema's identifiers. Interpolating them here rather than
 * at the call site keeps the SQL in one place and keeps a value from ever reaching a statement by concatenation.
 */
const statements = (schema: PostgresSchema) => {
  const { tables } = schema

  return {
    logins: `SELECT ${LOGIN_COLUMNS} FROM ${tables.userCredentials}
      WHERE owner_id = $1 AND kind = 'opencode-go' ORDER BY created_at DESC`,
    key: `SELECT value FROM ${tables.userCredentials}
      WHERE owner_id = $1 AND id = $2 AND kind = 'opencode-go'`,
    workspace: `SELECT allow_all_models FROM ${tables.workspaces} WHERE id = $1 AND owner_id = $2`,
    loginIds: `SELECT credential_id FROM ${tables.workspaceProviderLogins} WHERE workspace_id = $1`,
    modelIds: `SELECT model_id FROM ${tables.workspaceProviderModels} WHERE workspace_id = $1`,
    touchWorkspace: `UPDATE ${tables.workspaces} SET allow_all_models = $3, updated_at = now()
      WHERE id = $1 AND owner_id = $2`,
    clearLogins: `DELETE FROM ${tables.workspaceProviderLogins} WHERE workspace_id = $1`,
    linkLogin: `INSERT INTO ${tables.workspaceProviderLogins} (workspace_id, credential_id)
      SELECT $1, id FROM ${tables.userCredentials}
      WHERE id = $2 AND owner_id = $3 AND kind = 'opencode-go'`,
    clearModels: `DELETE FROM ${tables.workspaceProviderModels} WHERE workspace_id = $1`,
    linkModel: `INSERT INTO ${tables.workspaceProviderModels} (workspace_id, model_id) VALUES ($1, $2)
      ON CONFLICT DO NOTHING`,
    allowAll: `SELECT allow_all_models FROM ${tables.workspaces} WHERE id = $1`,
    models: `SELECT ${MODEL_COLUMNS} FROM ${tables.providerModels} WHERE provider = $1 ORDER BY model_id`,
    clearProviderModels: `DELETE FROM ${tables.providerModels} WHERE provider = $1`,
    upsertModel: `INSERT INTO ${tables.providerModels}
      (provider, model_id, name, context_window, max_output, input_usd_per_million, output_usd_per_million,
       supports_reasoning, supports_tools, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (provider, model_id) DO UPDATE SET
        name = EXCLUDED.name,
        context_window = EXCLUDED.context_window,
        max_output = EXCLUDED.max_output,
        input_usd_per_million = EXCLUDED.input_usd_per_million,
        output_usd_per_million = EXCLUDED.output_usd_per_million,
        supports_reasoning = EXCLUDED.supports_reasoning,
        supports_tools = EXCLUDED.supports_tools,
        fetched_at = now()`,
    // Grouped on the workspace, not counted over a join: a workspace that is unknown or another's yields no row, which
    // is how "not found" and "no logins" stay two different answers. A workspace that reaches everything uses every key
    // its owner stored, whether or not it linked one, so those count instead of the links.
    usage: `SELECT (CASE
        WHEN w.allow_all THEN (SELECT count(*) FROM ${tables.userCredentials} c
          WHERE c.owner_id = w.owner_id AND c.kind = 'opencode-go')
        ELSE count(l.credential_id)
      END)::text AS login_count
      FROM ${tables.workspaces} w
      LEFT JOIN ${tables.workspaceProviderLogins} l ON l.workspace_id = w.id
      WHERE w.id = $1 AND w.owner_id = $2
      GROUP BY w.id, w.allow_all`,
  }
}

/**
 * A provider key is a `user_credentials` row of kind `opencode-go`: one place holds every secret a user owns, so a key
 * does not have to be deleted and re-entered when the provider it serves is reconfigured. The value is sealed with the
 * same key the TOTP secret uses, and it is opened only where a request is about to be made with it.
 */
export class ProviderRepository {
  readonly #pool: Pool
  readonly #secrets: SecretBox
  readonly #sql: ReturnType<typeof statements>

  constructor(pool: Pool, schema: PostgresSchema, secrets: SecretBox) {
    this.#pool = pool
    this.#secrets = secrets
    this.#sql = statements(schema)
  }

  /** Newest first, matching the order of "what did I just add". */
  async logins(ownerId: string): Promise<readonly ProviderLogin[]> {
    const rows = await poolRows<LoginRow>(this.#pool, this.#sql.logins, [ownerId])

    return rows.map(toLogin)
  }

  /** The stored key in the clear, or `undefined` when the id is unknown or belongs to somebody else. */
  async key(ownerId: string, id: string): Promise<string | undefined> {
    const [row] = await poolRows<{ readonly value: string }>(this.#pool, this.#sql.key, [ownerId, id])

    return row === undefined ? undefined : this.#secrets.open(row.value)
  }

  /** `undefined` when the workspace is unknown or belongs to somebody else, which are one answer at this layer. */
  async workspaceProviders(ownerId: string, workspaceId: string): Promise<WorkspaceProviders | undefined> {
    return withTransaction(
      this.#pool,
      async (client) => {
        const [workspace] = await rowsOf<{ readonly allow_all_models: boolean }>(client, this.#sql.workspace, [
          workspaceId,
          ownerId,
        ])

        if (workspace === undefined) return undefined

        const logins = await rowsOf<{ readonly credential_id: string }>(client, this.#sql.loginIds, [workspaceId])
        const models = await rowsOf<{ readonly model_id: string }>(client, this.#sql.modelIds, [workspaceId])

        return {
          loginIds: logins.map((row) => row.credential_id),
          allowedModels: models.map((row) => row.model_id),
          allowAllModels: workspace.allow_all_models,
        }
      },
      { readOnly: true },
    )
  }

  /**
   * Replaces the workspace's selection. Every login is inserted through a select that also requires the owner, so a
   * workspace cannot link somebody else's key by naming its id.
   */
  async setWorkspaceProviders(
    ownerId: string,
    workspaceId: string,
    providers: WorkspaceProviders,
  ): Promise<WorkspaceProviders | undefined> {
    return withTransaction(this.#pool, async (client) => {
      const updated = await client.query(this.#sql.touchWorkspace, [workspaceId, ownerId, providers.allowAllModels])
      if (updated.rowCount !== 1) return undefined

      await client.query(this.#sql.clearLogins, [workspaceId])
      for (const loginId of providers.loginIds) {
        await client.query(this.#sql.linkLogin, [workspaceId, loginId, ownerId])
      }

      await client.query(this.#sql.clearModels, [workspaceId])
      for (const modelId of providers.allowedModels) {
        await client.query(this.#sql.linkModel, [workspaceId, modelId])
      }

      // Read back inside the transaction so the answer is what was committed, not what was asked for.
      const { rows } = await client.query<{ readonly allow_all_models: boolean }>(this.#sql.allowAll, [workspaceId])

      return {
        loginIds: [...providers.loginIds],
        allowedModels: [...providers.allowedModels],
        allowAllModels: rows[0]?.allow_all_models ?? false,
      }
    })
  }

  /** Every model of one provider, cached by the last successful upstream call. */
  async models(provider: string): Promise<readonly ProviderModel[]> {
    const rows = await poolRows<ModelRow>(this.#pool, this.#sql.models, [provider])

    return rows.map(toModel)
  }

  /** Replaces the cache for a provider in one transaction, so a half-finished refresh is never served. */
  async replaceModels(provider: string, models: readonly UpstreamModel[]): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.clearProviderModels, [provider])

      for (const model of models) {
        const values: Value[] = [
          provider,
          model.id,
          model.name,
          model.contextWindow,
          model.maxOutput,
          model.inputUsdPerMillion,
          model.outputUsdPerMillion,
          model.supportsReasoning,
          model.supportsTools,
        ]

        await client.query(this.#sql.upsertModel, values)
      }
    })
  }

  /**
   * The counters are zero because nothing records them yet: the row exists so the panel can name the providers the
   * workspace reaches, and a zero there means "not recorded", not "free".
   */
  async usage(ownerId: string, workspaceId: string): Promise<readonly ProviderUsage[] | undefined> {
    const [counted] = await poolRows<{ readonly login_count: string }>(this.#pool, this.#sql.usage, [
      workspaceId,
      ownerId,
    ])

    if (counted === undefined) return undefined

    const loginCount = Number(counted.login_count)
    if (loginCount === 0) return []

    return [
      {
        provider: SUPPORTED_PROVIDER,
        loginCount,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
    ]
  }
}
