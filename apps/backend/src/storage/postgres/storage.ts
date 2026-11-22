import type { Op } from '@earendil-works/chord/delta'
import { apply } from '@earendil-works/chord/delta'
import type { Context } from '@earendil-works/chord/context'
import type { JsonValue } from '@earendil-works/chord/json'
import type {
	CommitResult,
	ConversationId,
	ConversationQuery,
	ConversationRecord,
	Cursor,
	DocumentAddress,
	DocumentId,
	DocumentPoint,
	DocumentQuery,
	DocumentRecord,
	EntryId,
	EntryQuery,
	EntryRecord,
	Id,
	JsonObject,
	Page,
	Seq,
	Storage,
	StorageWrite,
	StoredDocument,
	SubmissionId,
	SubmissionQuery,
	SubmissionRecord,
	TaskId,
	TaskQuery,
	TaskRecord,
} from '@earendil-works/pi-durable'
import { StorageRequestError } from '@earendil-works/pi-durable'
import type { Pool } from 'pg'
import type { DocumentAction } from './commit.js'
import { claimOf, CommitState, PendingWrites, prepareDocumentActions } from './commit.js'
import type { Queryable, Value } from './db.js'
import { createPool, rowsOf, withClient, withTransaction } from './db.js'
import { idFromNumber, seqFromNumber } from './ids.js'
import { addressParts, encodeIndexedString, isCurrentOnly, scopeColumns } from './rows.js'
import type { PostgresSchema } from './schema.js'
import { createSchema, migrate } from './schema.js'
import { nextCursor, scanStart } from './scan.js'

type EntryLookup = { readonly entry: EntryRecord; readonly commitSeq: Seq }
type HeadMarker = EntryRecord & { readonly head: EntryId }

/** Turns a stored entry into a marker, or nothing when it is not one (`head IS NOT NULL` in the query). */
const marker = (record: EntryRecord): HeadMarker | undefined =>
	record.head === undefined ? undefined : { ...record, head: record.head }

/** Where a scan starts inside one table: its ID condition, the bound value, and the `ORDER BY` direction. */
const scanSql = (start: { order: 'ascending' | 'descending'; after: number | undefined }): {
	clause: string
	param: number
	direction: 'ASC' | 'DESC'
} =>
	start.order === 'ascending'
		? { clause: 'id >', param: start.after ?? -1, direction: 'ASC' }
		: { clause: 'id <', param: start.after ?? Number.MAX_SAFE_INTEGER, direction: 'DESC' }

const isAliveAt = (record: DocumentRecord, at: DocumentPoint): boolean => {
	if (at === 'current') return record.retiredAt === undefined
	if (record.createdAt > at) return false
	return record.retiredAt === undefined || at < record.retiredAt
}

/** One listed result and its continuation, or no continuation when the page was not truncated. */
const page = <T extends { readonly id: number }>(
	values: readonly T[],
	limit: number,
	order: 'ascending' | 'descending',
): Page<T, Cursor> => {
	if (values.length <= limit) return { items: values }
	const items = values.slice(0, limit)
	const last = items.at(-1)
	return { items, next: nextCursor(last === undefined ? 0 : last.id, order) }
}

/** Portable Postgres implementation of the Durable storage contract, over a pool this instance owns. */
export class PostgresStorage implements Storage {
	readonly #pool: Pool
	readonly #schema: PostgresSchema
	#nextId: number
	#closed = false
	#closing: Promise<void> | undefined
	#admittedReads = 0
	#readsDrained: (() => void) | undefined

	constructor(pool: Pool, schema: PostgresSchema, nextId: number) {
		this.#pool = pool
		this.#schema = schema
		this.#nextId = nextId
	}

	/** Open storage over `connectionString`, creating the schema's tables if they are missing. */
	static async open(
		connectionString: string,
		options: { readonly prefix?: string; readonly schema?: PostgresSchema; readonly max?: number } = {},
	): Promise<PostgresStorage> {
		const pool = createPool(
			connectionString,
			options.max === undefined ? {} : { max: options.max },
		)
		try {
			const schema = options.schema ?? createSchema(options.prefix ?? '')
			await migrate(pool, schema)
			const metadata = await withClient(pool, (client) => readMetadata(client, schema))
			return new PostgresStorage(pool, schema, metadata.nextId)
		} catch (error) {
			try {
				await pool.end()
			} catch {
				// Preserve the initialization failure.
			}
			throw error
		}
	}

	get schema(): PostgresSchema {
		return this.#schema
	}

	/**
	 * Commit `batches` in one transaction, each with its own seq. Each batch is checked before it writes anything,
	 * against the state the earlier ones left, and the first refused batch ends the call: the transaction commits the
	 * batches before it. The checks read the stored state of all batches up front and run in memory, and the accepted
	 * batches are written per table in multi-row statements, so a call costs a few statements whatever its batch count.
	 */
	async commit(
		batches: readonly (readonly StorageWrite[])[],
		receive: (index: number, seq: Seq) => void,
		_context: Context,
	): Promise<CommitResult> {
		this.#assertOpen()
		const tables = this.#schema.tables
		const seqs: number[] = []
		let refused: unknown
		let candidateNextId = this.#nextId
		await withTransaction(this.#pool, async (client) => {
			const metadata = await readMetadata(client, this.#schema)
			let next = metadata.nextSeq
			// A failure of the database rejects the call and rolls back the batches before it with the transaction.
			const state = await CommitState.read(client, tables, batches)
			const pending = new PendingWrites()
			for (const writes of batches) {
				const checked = await this.#checkBatch(client, state, pending, writes)
				if ('refused' in checked) {
					refused = checked.refused
					break
				}
				const seq = next++
				state.apply(writes, checked.actions, seqFromNumber(seq))
				pending.add(writes, checked.actions, seqFromNumber(seq), state)
				seqs.push(seq)
				candidateNextId = Math.max(candidateNextId, candidateNextIdOf(writes, this.#nextId))
			}
			await pending.flush(client, tables)
			if (seqs.length > 0) {
				await writeMetadata(client, this.#schema, Math.max(metadata.nextId, candidateNextId), next)
			}
		})
		this.#nextId = Math.max(this.#nextId, candidateNextId)
		// `COMMIT` returned: the stored batches are durable.
		for (const [index, seq] of seqs.entries()) receive(index, seqFromNumber(seq))
		return refused === undefined ? { stored: seqs.length } : { stored: seqs.length, refused }
	}

	/** Durable's own checks of one batch, resolving a copy's source from the database. */
	async #checkBatch(
		client: Queryable,
		state: CommitState,
		pending: PendingWrites,
		writes: readonly StorageWrite[],
	): Promise<{ actions: Map<DocumentId, DocumentAction> } | { refused: unknown }> {
		let actions: Map<DocumentId, DocumentAction>
		try {
			actions = prepareDocumentActions(writes)
			state.check(writes, actions)
		} catch (error) {
			return { refused: error }
		}
		if (![...actions.values()].some((action) => action.copy !== undefined)) return { actions }
		await pending.flush(client, this.#schema.tables)
		const calls = { failed: false }
		try {
			await this.#resolveCopies(client, actions, calls)
		} catch (error) {
			if (calls.failed) throw error
			return { refused: error }
		}
		return { actions }
	}

	async mintId<I extends Id<string>>(): Promise<I> {
		this.#assertOpen()
		if (!Number.isSafeInteger(this.#nextId)) throw new Error('ID space is exhausted')
		return idFromNumber<I>(this.#nextId++)
	}

	async conversation(id: ConversationId, _context: Context): Promise<ConversationRecord | undefined> {
		this.#assertOpen()
		return this.#readConversation(id)
	}

	async scanConversations(
		query: ConversationQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<ConversationRecord, Cursor>> {
		this.#assertOpen()
		const start = scanStart(cursor, 'ascending', query.order)
		const scan = scanSql(start)
		const clauses = [`${scan.clause} $1`]
		const params: Value[] = [scan.param]
		if (query.ownerConversationId !== undefined) {
			params.push(query.ownerConversationId)
			clauses.push(`owner_conversation_id = $${params.length}`)
		}
		if (query.ownerTaskId !== undefined) {
			params.push(query.ownerTaskId)
			clauses.push(`owner_task_id = $${params.length}`)
		}
		params.push(limit + 1)
		const text = `SELECT record FROM ${this.#schema.tables.conversations} WHERE ${clauses.join(' AND ')}
			ORDER BY id ${scan.direction} LIMIT $${params.length}`
		const rows = await this.#all<{ record: ConversationRecord }>(text, params)
		return page(
			rows.map((row) => row.record),
			limit,
			start.order,
		)
	}

	entry(id: EntryId, context: Context): Promise<EntryLookup | undefined>
	entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<EntryLookup | undefined>
	entry(
		first: EntryId | ConversationId,
		second: EntryId | Context,
		third?: Context,
	): Promise<EntryLookup | undefined> {
		if (third === undefined) {
			return this.#admitRead(() => this.#readEntry(idFromNumber<EntryId>(first), undefined))
		}
		const conversationId = idFromNumber<ConversationId>(first)
		const id = typeof second === 'number' ? idFromNumber<EntryId>(second) : undefined
		if (id === undefined) throw new StorageRequestError('Storage.entry() requires an entry ID')
		return this.#admitRead(() => this.#readEntry(id, conversationId))
	}

	findLatestHeadMarker(
		conversationId: ConversationId,
		atOrBeforeEntryId: EntryId | undefined,
		_context: Context,
	): Promise<HeadMarker | undefined> {
		return this.#admitRead(() => this.#readLatestHeadMarker(conversationId, atOrBeforeEntryId))
	}

	scanEntries(
		query: EntryQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<EntryRecord, Cursor>> {
		return this.#admitRead(() => this.#readEntries(query, limit, cursor))
	}

	async #readEntry(id: EntryId, conversationId: ConversationId | undefined): Promise<EntryLookup | undefined> {
		const text = `SELECT record, commit_seq FROM ${this.#schema.tables.entries} WHERE id = $1`
		const rows = await this.#all<{ record: EntryRecord; commit_seq: string }>(text, [id])
		const row = rows[0]
		if (row === undefined) return undefined
		const entry = row.record
		if (conversationId !== undefined) {
			let conversation = await this.#readConversation(conversationId)
			if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${conversationId}`)
			let upper: number = Number.POSITIVE_INFINITY
			while (conversation.id !== entry.conversationId) {
				if (conversation.parent === undefined) return undefined
				upper = Math.min(upper, conversation.parent.at)
				const parent: ConversationRecord | undefined = await this.#readConversation(
					conversation.parent.conversationId,
				)
				if (parent === undefined) return undefined
				conversation = parent
			}
			if (entry.id > upper) return undefined
		}
		return { entry, commitSeq: seqFromNumber(Number(row.commit_seq)) }
	}

	async #readLatestHeadMarker(conversationId: ConversationId, atOrBefore: EntryId | undefined): Promise<HeadMarker | undefined> {
		let conversation = await this.#readConversation(conversationId)
		if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${conversationId}`)
		let upper: number | undefined = atOrBefore
		while (true) {
			const clauses = ['conversation_id = $1', 'head IS NOT NULL']
			const params: Value[] = [conversation.id]
			if (upper !== undefined) {
				params.push(upper)
				clauses.push(`id <= $${params.length}`)
			}
			const text = `SELECT record FROM ${this.#schema.tables.entries} WHERE ${clauses.join(' AND ')}
				ORDER BY id DESC LIMIT 1`
			const rows = await this.#all<{ record: EntryRecord }>(text, params)
			const row = rows[0]
			if (row !== undefined) return marker(row.record)
			if (conversation.parent === undefined) return undefined
			upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at)
			const parent: ConversationRecord | undefined = await this.#readConversation(conversation.parent.conversationId)
			if (parent === undefined) return undefined
			conversation = parent
		}
	}

	async #readEntries(
		query: EntryQuery,
		limit: number,
		cursor: Cursor | undefined,
	): Promise<Page<EntryRecord, Cursor>> {
		const { order, after } = scanStart(cursor, 'descending', query.order)
		if (order === 'ascending') return this.#readEntriesAscending(query, limit, after)
		let conversation = await this.#readConversation(query.conversationId)
		if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`)
		let upper: number | undefined = query.maxEntryId
		if (after !== undefined) upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1)
		const values: EntryRecord[] = []
		while (true) {
			const clauses = ['conversation_id = $1']
			const params: Value[] = [conversation.id]
			if (query.minEntryId !== undefined) {
				params.push(query.minEntryId)
				clauses.push(`id >= $${params.length}`)
			}
			if (upper !== undefined) {
				params.push(upper)
				clauses.push(`id <= $${params.length}`)
			}
			params.push(limit + 1 - values.length)
			const text = `SELECT record FROM ${this.#schema.tables.entries} WHERE ${clauses.join(' AND ')}
				ORDER BY id DESC LIMIT $${params.length}`
			const rows = await this.#all<{ record: EntryRecord }>(text, params)
			values.push(...rows.map((row) => row.record))
			if (values.length > limit || conversation.parent === undefined) break
			upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at)
			if (query.minEntryId !== undefined && upper < query.minEntryId) break
			const parent: ConversationRecord | undefined = await this.#readConversation(conversation.parent.conversationId)
			if (parent === undefined) break
			conversation = parent
		}
		return page(values, limit, 'descending')
	}

	/** Oldest first: the fork chain's segments from the root conversation forward, each up to its fork point. */
	async #readEntriesAscending(
		query: EntryQuery,
		limit: number,
		after: number | undefined,
	): Promise<Page<EntryRecord, Cursor>> {
		const segments: { conversationId: ConversationId; upper: number | undefined }[] = []
		let conversation = await this.#readConversation(query.conversationId)
		if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`)
		let upper: number | undefined = query.maxEntryId
		while (true) {
			segments.push({ conversationId: conversation.id, upper })
			if (conversation.parent === undefined) break
			upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at)
			if (query.minEntryId !== undefined && upper < query.minEntryId) break
			const parent: ConversationRecord | undefined = await this.#readConversation(conversation.parent.conversationId)
			if (parent === undefined) break
			conversation = parent
		}
		let lower: number | undefined = query.minEntryId
		if (after !== undefined) lower = Math.max(lower ?? after + 1, after + 1)
		const values: EntryRecord[] = []
		for (const segment of segments.reverse()) {
			const clauses = ['conversation_id = $1']
			const params: Value[] = [segment.conversationId]
			if (lower !== undefined) {
				params.push(lower)
				clauses.push(`id >= $${params.length}`)
			}
			if (segment.upper !== undefined) {
				params.push(segment.upper)
				clauses.push(`id <= $${params.length}`)
			}
			params.push(limit + 1 - values.length)
			const text = `SELECT record FROM ${this.#schema.tables.entries} WHERE ${clauses.join(' AND ')}
				ORDER BY id ASC LIMIT $${params.length}`
			const rows = await this.#all<{ record: EntryRecord }>(text, params)
			values.push(...rows.map((row) => row.record))
			if (values.length > limit) break
		}
		return page(values, limit, 'ascending')
	}

	async task(id: TaskId, _context: Context): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined> {
		this.#assertOpen()
		const text = `SELECT record FROM ${this.#schema.tables.tasks} WHERE id = $1`
		const rows = await this.#all<{ record: TaskRecord<JsonValue, JsonValue, JsonValue> }>(text, [id])
		return rows[0]?.record
	}

	async scanTasks(
		query: TaskQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>> {
		this.#assertOpen()
		const start = scanStart(cursor, 'ascending', query.order)
		const scan = scanSql(start)
		const clauses = [`${scan.clause} $1`]
		const params: Value[] = [scan.param]
		if (query.conversationId !== undefined) {
			params.push(query.conversationId)
			clauses.push(`conversation_id = $${params.length}`)
		}
		if (query.kind !== undefined) {
			params.push(encodeIndexedString(query.kind))
			clauses.push(`kind = $${params.length}`)
		}
		if (query.status !== undefined) {
			params.push(query.status)
			clauses.push(`status = $${params.length}`)
		}
		if (query.abortRequested !== undefined) {
			params.push(query.abortRequested)
			clauses.push(`abort_requested = $${params.length}`)
		}
		if (query.background !== undefined) {
			params.push(query.background)
			clauses.push(`background = $${params.length}`)
		}
		params.push(limit + 1)
		const text = `SELECT record FROM ${this.#schema.tables.tasks} WHERE ${clauses.join(' AND ')}
			ORDER BY id ${scan.direction} LIMIT $${params.length}`
		const rows = await this.#all<{ record: TaskRecord<JsonValue, JsonValue, JsonValue> }>(text, params)
		return page(
			rows.map((row) => row.record),
			limit,
			start.order,
		)
	}

	async submission(id: SubmissionId, _context: Context): Promise<SubmissionRecord | undefined> {
		this.#assertOpen()
		const text = `SELECT record FROM ${this.#schema.tables.submissions} WHERE id = $1`
		const rows = await this.#all<{ record: SubmissionRecord }>(text, [id])
		return rows[0]?.record
	}

	async scanSubmissions(
		query: SubmissionQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<SubmissionRecord, Cursor>> {
		this.#assertOpen()
		const start = scanStart(cursor, 'ascending', query.order)
		const scan = scanSql(start)
		const clauses = [`${scan.clause} $1`]
		const params: Value[] = [scan.param]
		if (query.conversationId !== undefined) {
			params.push(query.conversationId)
			clauses.push(`conversation_id = $${params.length}`)
		}
		if (query.status !== undefined) {
			params.push(query.status)
			clauses.push(`status = $${params.length}`)
		}
		params.push(limit + 1)
		const text = `SELECT record FROM ${this.#schema.tables.submissions} WHERE ${clauses.join(' AND ')}
			ORDER BY id ${scan.direction} LIMIT $${params.length}`
		const rows = await this.#all<{ record: SubmissionRecord }>(text, params)
		return page(
			rows.map((row) => row.record),
			limit,
			start.order,
		)
	}

	async submissionByRequest(
		conversationId: ConversationId,
		requestId: string,
		_context: Context,
	): Promise<SubmissionRecord | undefined> {
		this.#assertOpen()
		const text = `SELECT record FROM ${this.#schema.tables.submissions} WHERE conversation_id = $1 AND request_id = $2`
		const rows = await this.#all<{ record: SubmissionRecord }>(text, [conversationId, encodeIndexedString(requestId)])
		return rows[0]?.record
	}

	async findDocument(address: DocumentAddress, at: DocumentPoint, _context: Context): Promise<DocumentRecord | undefined> {
		this.#assertOpen()
		const parts = addressParts(address)
		const params: Value[] = [parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue]
		const where = 'kind = $1 AND scope_kind = $2 AND owner_id = $3 AND family = $4 AND key_value = $5'
		const alive =
			at === 'current' ? 'retired_at IS NULL' : 'created_at <= $6 AND (retired_at IS NULL OR retired_at > $6)'
		if (at !== 'current') params.push(at)
		const text = `SELECT record FROM ${this.#schema.tables.documents} WHERE ${where} AND ${alive}
			ORDER BY created_at DESC LIMIT 1`
		const rows = await this.#all<{ record: DocumentRecord }>(text, params)
		return rows[0]?.record
	}

	async document(id: DocumentId, at: DocumentPoint, _context: Context): Promise<StoredDocument | undefined> {
		this.#assertOpen()
		// The record and revision queries must observe one committed state; a commit between them can replace the base.
		return withTransaction(this.#pool, (client) => this.#materializeDocument(client, id, at), { readOnly: true })
	}

	async scanDocuments(
		query: DocumentQuery,
		limit: number,
		cursor: Cursor | undefined,
		_context: Context,
	): Promise<Page<DocumentRecord, Cursor>> {
		this.#assertOpen()
		const scope = scopeColumns(query.scope)
		const clauses = ['scope_kind = $1', 'owner_id = $2', 'id > $3']
		const after = cursor?.['after']
		const params: Value[] = [scope.scopeKind, scope.ownerId, typeof after === 'number' ? after : -1]
		if (query.kind !== undefined) {
			params.push(encodeIndexedString(query.kind))
			clauses.push(`kind = $${params.length}`)
		}
		if (query.at === 'current') {
			clauses.push('retired_at IS NULL')
		} else {
			params.push(query.at)
			clauses.push(`created_at <= $${params.length}`, `(retired_at IS NULL OR retired_at > $${params.length})`)
		}
		params.push(limit + 1)
		const text = `SELECT record FROM ${this.#schema.tables.documents} WHERE ${clauses.join(' AND ')}
			ORDER BY id LIMIT $${params.length}`
		const rows = await this.#all<{ record: DocumentRecord }>(text, params)
		return page(
			rows.map((row) => row.record),
			limit,
			'ascending',
		)
	}

	async close(_context: Context): Promise<void> {
		if (this.#closing === undefined) {
			this.#closed = true
			this.#closing = this.#closePool()
		}
		return this.#closing
	}

	async #closePool(): Promise<void> {
		if (this.#admittedReads > 0) {
			await new Promise<void>((resolve) => {
				this.#readsDrained = resolve
			})
		}
		await this.#pool.end()
	}

	/**
	 * Runs a read that issues several queries. Close waits for admitted reads, so their later queries never reach a
	 * closed pool. Single-query reads and transactions are already ordered before close by the pool.
	 */
	async #admitRead<T>(read: () => Promise<T>): Promise<T> {
		this.#assertOpen()
		this.#admittedReads++
		try {
			return await read()
		} finally {
			if (--this.#admittedReads === 0) this.#readsDrained?.()
		}
	}

	#assertOpen(): void {
		if (this.#closed) throw new Error('PostgresStorage is closed')
	}

	#all<R extends Record<string, unknown>>(text: string, params: readonly Value[] = []): Promise<R[]> {
		return withClient(this.#pool, (client) => rowsOf<R>(client, text, params))
	}

	async #readConversation(id: ConversationId): Promise<ConversationRecord | undefined> {
		const text = `SELECT record FROM ${this.#schema.tables.conversations} WHERE id = $1`
		const rows = await this.#all<{ record: ConversationRecord }>(text, [id])
		return rows[0]?.record
	}

	/** Rows from `text`, recording a database failure when the caller distinguishes one from a refusal. */
	async #rows<R extends Record<string, unknown>>(
		client: Queryable,
		text: string,
		params: readonly Value[],
		calls?: { failed: boolean },
	): Promise<R[]> {
		if (calls === undefined) return rowsOf<R>(client, text, params)
		try {
			return await rowsOf<R>(client, text, params)
		} catch (error) {
			calls.failed = true
			throw error
		}
	}

	/** The stored document's record, its base at or below `at`, and the deltas replayed on top of it. */
	async #materializeDocument(
		client: Queryable,
		id: DocumentId,
		at: DocumentPoint,
		calls?: { failed: boolean },
	): Promise<StoredDocument | undefined> {
		const tables = this.#schema.tables
		const recordText = `SELECT record FROM ${tables.documents} WHERE id = $1`
		const stored = await this.#rows<{ record: DocumentRecord }>(client, recordText, [id], calls)
		const row = stored[0]
		if (row === undefined) return undefined
		const record = row.record
		if (at !== 'current' && isCurrentOnly(record)) {
			throw new StorageRequestError(`Document ${id} does not retain historical content`)
		}
		if (!isAliveAt(record, at)) return undefined
		const upper = at === 'current' ? Number.MAX_SAFE_INTEGER : at
		const baseText = `SELECT seq, kind, version, content FROM ${tables.documentRevisions}
			WHERE document_id = $1 AND kind = 'base' AND seq <= $2 ORDER BY seq DESC LIMIT 1`
		const baseRow = await this.#rows<{ seq: string; version: number; content: JsonObject }>(client, baseText, [id, upper], calls)
		const base = baseRow[0]
		if (base === undefined) throw new Error(`Document ${id} is missing a required base`)
		let value = base.content
		const tailText = `SELECT seq, kind, version, content FROM ${tables.documentRevisions}
			WHERE document_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq`
		const tail = await this.#rows<{ kind: 'base' | 'delta'; version: number; content: JsonObject | readonly Op[] }>(
			client,
			tailText,
			[id, Number(base.seq), upper],
			calls,
		)
		for (const revision of tail) {
			if (revision.kind !== 'delta' || revision.version !== base.version) {
				throw new Error(`Document ${id} crosses a stored version boundary without a base`)
			}
			// A delta revision stores its operations, which the query selected by kind.
			value = apply(value, revision.content as readonly Op[])
		}
		return { record, version: base.version, value, deltasSinceBase: tail.length }
	}

	/** Resolve each copy to a base of its source's state before this batch, which may not change the source. */
	async #resolveCopies(
		client: Queryable,
		actions: ReadonlyMap<DocumentId, DocumentAction>,
		calls: { failed: boolean },
	): Promise<void> {
		for (const [id, action] of actions) {
			if (action.copy === undefined) continue
			try {
				const stored = await this.#materializeDocument(client, action.copy.id, action.copy.at, calls)
				if (stored === undefined) throw new Error(`Fork source document ${action.copy.id} cannot be read`)
				const create = action.create
				if (
					create === undefined ||
					stored.record.scope.kind !== 'conversation' ||
					create.scope.kind !== 'conversation' ||
					stored.record.kind !== create.kind ||
					stored.record.key !== create.key ||
					stored.record.history !== create.history ||
					stored.record.fork !== create.fork
				) {
					throw new Error(`Fork source document ${action.copy.id} does not match the copied record`)
				}
				action.content = { kind: 'base', version: stored.version, value: stored.value }
			} catch (error) {
				throw new Error(`Document copy ${id} was rejected`, { cause: error })
			}
		}
	}
}

const candidateNextIdOf = (writes: readonly StorageWrite[], current: number): number => {
	let nextId = current
	for (const write of writes) {
		const id = claimOf(write)?.id
		if (id !== undefined) nextId = Math.max(nextId, id + 1)
	}
	return nextId
}

const readMetadata = async (
	client: Queryable,
	schema: PostgresSchema,
): Promise<{ nextId: number; nextSeq: number }> => {
	// Identifiers come from `createSchema`; the singleton is the only value this query needs.
	const text = `SELECT next_id, next_seq FROM ${schema.tables.durableMetadata} WHERE singleton = 1`
	const rows = await rowsOf<{ next_id: string; next_seq: string }>(client, text)
	const row = rows[0]
	if (row === undefined) throw new Error('Durable Postgres metadata is missing')
	return { nextId: Number(row.next_id), nextSeq: Number(row.next_seq) }
}

const writeMetadata = async (
	client: Queryable,
	schema: PostgresSchema,
	nextId: number,
	nextSeq: number,
): Promise<void> => {
	const text = `UPDATE ${schema.tables.durableMetadata} SET next_id = $1, next_seq = $2 WHERE singleton = 1`
	await client.query(text, [nextId, nextSeq])
}

/** Open Postgres storage over `connectionString`, in the default schema unless `options` says otherwise. */
export const openPostgresStorage = (
	connectionString: string,
	options: { readonly prefix?: string; readonly max?: number } = {},
) => PostgresStorage.open(connectionString, options)
