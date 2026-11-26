import type { Pool } from 'pg'

import { withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'
import { DEFAULT_SUBAGENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from '../agents/base-prompt.js'
import { backgroundModelOr } from '../background/model-chain.js'
import type { BackgroundModelChain } from '../background/model-chain.js'

/**
 * The two switches that decide how the install treats people. Both live in the database rather than in the environment:
 * an admin changes them from the settings screen, and a restart must not be the way to turn single-user mode off.
 */
export interface Settings {
  /** No sign-in at all: every request is the owner, holding every permission. What this install was until now. */
  readonly singleUser: boolean
  /** A second factor is enrolled before a password is enough. Applying it to existing accounts forces enrolment. */
  readonly requireTwoFactor: boolean
  /** The app-wide system context; a missing or invalid row uses the built-in prompt. */
  readonly systemPrompt: string
  /** The separate app-wide context used only by throwaway sub agent conversations. */
  readonly subagentSystemPrompt: string
  /** Ordered models for titles and other background work. Ordinary agent runs never consult this list. */
  readonly backgroundModel: BackgroundModelChain
}

export const DEFAULT_SETTINGS: Settings = {
  singleUser: true,
  requireTwoFactor: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  subagentSystemPrompt: DEFAULT_SUBAGENT_SYSTEM_PROMPT,
  backgroundModel: [],
}

const SINGLE_USER = 'single_user'
const REQUIRE_TWO_FACTOR = 'require_two_factor'
const SYSTEM_PROMPT = 'system_prompt'
const SUBAGENT_SYSTEM_PROMPT = 'subagent_system_prompt'
const BACKGROUND_MODEL = 'background_model'

interface SettingRow {
  readonly key: string
  readonly value: unknown
}

export class SettingsRepository {
  readonly #pool: Pool
  readonly #select: string
  readonly #upsert: string

  constructor(pool: Pool, schema: PostgresSchema) {
    const { appSettings } = schema.tables
    this.#pool = pool
    this.#select = `SELECT key, value FROM ${appSettings}`
    this.#upsert = `INSERT INTO ${appSettings} (key, value, updated_at) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`
  }

  /** A row that is missing or of the wrong type falls back to the default, so a hand-edited table cannot crash a boot. */
  async read(): Promise<Settings> {
    const rows = await withClient(this.#pool, (client) => client.query<SettingRow>(this.#select))
    const values = new Map(rows.rows.map((row) => [row.key, row.value]))

    return {
      singleUser: booleanOr(values.get(SINGLE_USER), DEFAULT_SETTINGS.singleUser),
      requireTwoFactor: booleanOr(values.get(REQUIRE_TWO_FACTOR), DEFAULT_SETTINGS.requireTwoFactor),
      systemPrompt: stringOr(values.get(SYSTEM_PROMPT), DEFAULT_SETTINGS.systemPrompt),
      subagentSystemPrompt: stringOr(
        values.get(SUBAGENT_SYSTEM_PROMPT),
        DEFAULT_SETTINGS.subagentSystemPrompt,
      ),
      backgroundModel: backgroundModelOr(values.get(BACKGROUND_MODEL), DEFAULT_SETTINGS.backgroundModel),
    }
  }

  async write(patch: Partial<Settings>): Promise<Settings> {
    const entries: [string, boolean | string | BackgroundModelChain][] = []
    if (patch.singleUser !== undefined) entries.push([SINGLE_USER, patch.singleUser])
    if (patch.requireTwoFactor !== undefined) entries.push([REQUIRE_TWO_FACTOR, patch.requireTwoFactor])
    if (patch.systemPrompt !== undefined) entries.push([SYSTEM_PROMPT, patch.systemPrompt])
    if (patch.subagentSystemPrompt !== undefined) {
      entries.push([SUBAGENT_SYSTEM_PROMPT, patch.subagentSystemPrompt])
    }
    if (patch.backgroundModel !== undefined) entries.push([BACKGROUND_MODEL, patch.backgroundModel])

    for (const [key, value] of entries) {
      await withClient(this.#pool, (client) => client.query(this.#upsert, [key, JSON.stringify(value)]))
    }

    return this.read()
  }
}

const booleanOr = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
