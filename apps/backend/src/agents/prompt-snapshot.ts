import type { Pool } from 'pg'

import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * The text a conversation sends before anything else, frozen when it sends its first message. A provider caches the
 * longest identical prefix of a request, so a prompt that changes up front invalidates every cached token after it;
 * editing a setting therefore steers new conversations only, and a running one keeps the text it started with.
 *
 * `live` is read only when nothing is recorded yet, which is the first message of a conversation.
 */
export interface PromptSnapshots {
  /** The app-wide system prompt this conversation started with. */
  systemPrompt(conversationId: number, live: () => Promise<string>): Promise<string>
  /**
   * The system prompt append this agent started with in this conversation. Per agent, because switching agents gives the
   * conversation a different append, and switching back must resume the text it had rather than today's setting.
   */
  append(conversationId: number, agentId: string, live: () => Promise<string>): Promise<string>
}

interface TextRow {
  readonly text: string
}

/** Reads and writes the two snapshot tables over the pool the durable storage already owns. */
export class PromptSnapshotRepository implements PromptSnapshots {
  readonly #pool: Pool
  readonly #schema: PostgresSchema

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
  }

  async systemPrompt(conversationId: number, live: () => Promise<string>): Promise<string> {
    const { conversationPrompts } = this.#schema.tables
    const selected = `SELECT system_prompt AS text FROM ${conversationPrompts} WHERE conversation_id = $1`
    const stored = await this.#text(selected, [conversationId])
    if (stored !== undefined) return stored

    // Two first messages can race; the row that landed first is the text both requests send.
    const inserted = await this.#text(
      `INSERT INTO ${conversationPrompts} (conversation_id, system_prompt) VALUES ($1, $2)
        ON CONFLICT (conversation_id) DO NOTHING RETURNING system_prompt AS text`,
      [conversationId, await live()],
    )
    if (inserted !== undefined) return inserted

    const raced = await this.#text(selected, [conversationId])
    if (raced === undefined) throw new Error('the system prompt snapshot vanished after it was written')

    return raced
  }

  async append(conversationId: number, agentId: string, live: () => Promise<string>): Promise<string> {
    const { conversationAgentPrompts } = this.#schema.tables
    const selected = `SELECT system_prompt_append AS text FROM ${conversationAgentPrompts}
      WHERE conversation_id = $1 AND agent_id = $2`
    const stored = await this.#text(selected, [conversationId, agentId])
    if (stored !== undefined) return stored

    const inserted = await this.#text(
      `INSERT INTO ${conversationAgentPrompts} (conversation_id, agent_id, system_prompt_append) VALUES ($1, $2, $3)
        ON CONFLICT (conversation_id, agent_id) DO NOTHING RETURNING system_prompt_append AS text`,
      [conversationId, agentId, await live()],
    )
    if (inserted !== undefined) return inserted

    const raced = await this.#text(selected, [conversationId, agentId])
    if (raced === undefined) throw new Error('the system prompt append snapshot vanished after it was written')

    return raced
  }

  async #text(text: string, values: readonly Value[]): Promise<string | undefined> {
    const rows = await withClient(this.#pool, (client) => rowsOf<TextRow>(client, text, values))

    return rows[0]?.text
  }
}
