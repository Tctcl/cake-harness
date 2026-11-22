# Storage backend: a Postgres adapter for pi-durable

Design note for replacing `MemoryStorage` with a Postgres-backed `Storage` in
`apps/backend`. Written after reading `pi-durable@1.6.0`'s shipped backends, so the
next reader does not have to.

Status: **shape B shipped.** `apps/backend/src/storage/postgres/` implements `Storage`
as a relational store mirroring `sqlite/`, gated by `registerStorageConformance`
(33 cases, all green against container `tlabs-pg`). `DATABASE_URL` selects it in
`src/agent.ts`; without the variable the backend still runs `MemoryStorage`.

Shape A below is kept because it was the first recommendation and the reason it lost
is worth not rediscovering: A delegates reads to `MemoryStorage`, so nothing is
queryable in SQL and a second process sees nothing until it reopens — the properties
that make the database worth having. The user chose B ("the more proper option"), and
its cost was the document engine, which is now ported.

Related: [`docs/durable.md`](./durable.md) (why durable, what it owns, the
single-writer constraint), whose open question 3 ("storage choice per environment")
this note narrows to "does the backend talk to Postgres or to a file".

## What storage is for

Durable is a log, not just an agent loop. Every mutation goes through
`Storage.commit(batches, receive, context)`: one atomic write per batch, one `seq`
each, and nothing is shown before its commit is stored. The in-memory objects are a
cache over that log. What the five record tables and the document namespace hold:

| Table | Holds |
| --- | --- |
| `conversations` | one row per conversation, `owner` points at a conversation or a task |
| `entries` | the transcript: `pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.reset`, `pi.compaction` |
| `tasks` | every task's state machine (`pending`/`running`/`waiting`/`sleeping`/`completing`/`terminal`), its checkpoint `record`, `abortRequested`, `restarts` |
| `submissions` | admitted inputs, with `requestId` for idempotent retry |
| `record_ids` | the Session-global numeric ID namespace |
| documents | `pi.agent` (model/thinking/tools/instructions), `pi.provider` (provider `sessionId` for prompt cache), `pi.live` (running generation + tools), `pi.inbox` (queued inputs), `pi.usage` (spend) |

Losing the log means: no `harness.resume()` after a restart, no idempotent
`submit({ requestId })`, no sleeping task that survives a deploy, no second reader.
`MemoryStorage` gives all of that within one process lifetime, which is why the
backend works today and why a restart forgets the conversation.

## The contract

`Storage` (`pi-durable/dist/types.d.ts:1168`) is 16 methods plus `commit`. The only
data model a backend has to understand is `StorageWrite` (`:862`) — a closed union of
eight shapes:

```ts
{ type: 'conversation', value } | { type: 'entry', value }
| { type: 'task', value } | { type: 'submission', value }
| { type: 'document.create', record, content } | { type: 'document.copy', record, source }
| { type: 'document.change', id, content } | { type: 'document.retire', id }
```

Contract details that shape the design:

- `commit` persists batches in order, each as its own atomic commit with its own
  `seq`, each checked against the state the earlier ones left, and stops at the first
  batch durable's own checks refuse (global IDs, document actions, copy resolution).
  Batches before it are durable; it and the rest are not.
- `receive(index, seq)` is called once per durable batch, in order, synchronously,
  **after all of them are durable** and before the next commit starts. It is a
  durability receipt, not publication.
- An error from `commit()` or `mintId()` is fatal to the Session. Transient failures
  must be retried inside the method.
- `mintId` must be greater than every ID minted since open *and* every stored ID
  "also across reopen" — so it is derived from what the log contains, not from a
  counter the backend invents and loses.
- There is an optional `publishing?(publish, context)` hook (run the Session's
  publication inside the backend's own transaction). Not needed for this design.

Reads return `Page<T, Cursor>` with opaque cursors, and two overloads of `entry`
(global, and ancestry-scoped) plus `findLatestHeadMarker`, `submissionByRequest`,
`findDocument`/`document`/`scanDocuments` with a `DocumentPoint`.

## Two viable shapes

### A. Log over `MemoryStorage` — not chosen

[SUPERSEDED: shape B shipped instead, so everything from here to "### B" describes an
option the repository does not implement. Kept for the comparison.]

This is exactly what the shipped JSONL backend does (`dist/storage/jsonl/storage.js`):
`private readonly memory` is a `MemoryStorage`, commits append to `main.jsonl` and
sidecars, reads delegate to memory, and the log is replayed at open.

```js
import { MemoryStorage } from "../memory.js";            // jsonl/storage.js:3
const prepared = this.memory.prepareCommit(writes);      // :228   validate + detach
memory.prepareCommit(writes, marker.seq).apply();        // :657   replay at open
async mintId() { return this.store.mintId(); }           // :296
```

`MemoryStorage.prepareCommit(writes, seq?)` is public (`storage/memory.d.ts:30`) and
returns `{ seq, writes, apply() }`; `apply()` returns the `Seq`. IDs need no storage
at all — `nextId` is recomputed from applied records (`memory.js:274`:
`nextId = Math.max(nextId, write.value.id + 1)`).

Postgres becomes a better file: one table, one row per write.

```sql
CREATE TABLE durable_log (
  seq     bigint  NOT NULL,
  batch   integer NOT NULL,
  ordinal integer NOT NULL,
  write   jsonb   NOT NULL,
  PRIMARY KEY (seq, batch, ordinal)
);
CREATE INDEX durable_log_seq_idx ON durable_log (seq);
```

**open** — `SELECT seq, batch, ordinal, write FROM durable_log ORDER BY seq, batch,
ordinal`, regroup by `seq`, then `memory.prepareCommit(writes, seqFromNumber(seq))
.apply()` per commit. `nextId` and every document incarnation fall out of the replay,
which is the same code path JSONL already exercises.

**commit** — per batch, `memory.prepareCommit(writes)` (checks, changes nothing,
throws the same refusal durable expects); then a single transaction:
`SELECT nextval('durable_log_seq')`, one bulk `INSERT` of all batches' writes,
`COMMIT`; then `receive(index, seq)` for each batch in order, then `.apply()` each
prepared commit. Atomicity is the transaction, recovery is the replay, and a refused
batch leaves earlier batches durable and later ones unwritten — the contract, for
free.

Scope: ~250 lines in `apps/backend/src/storage/postgres.ts`, plus a migration
statement and the conformance tests.

Trade-offs:

- Reads are in memory: no SQL over the transcript, and a second process does not see
  new commits without reopening (JSONL has the same property; its `readOnly` mode
  takes a snapshot at open).
- The log grows; JSONL handles that with a `.reclaim` pass, which is a
  `Storage`-internal concern outside the interface. Defer it and note the growth.
- Full replay at boot: fine for one session (JSONL parses a whole file too), and
  bounded by session size.

### B. Relational, mirroring `StoreStorage` — what shipped

Five tables plus a document engine: document incarnations, `document.copy`
resolution, retired/replaced history, point-in-time `findDocument`/`document`. This
is where `sqlite/storage.js` (531 lines) + `sqlite/commit.js` (370) +
`sqlite/migrations.js` (120) spend their complexity. It buys SQL-queryable
transcripts and real cross-process reads. Estimate: 900–1200 lines plus tests.

Pick this only for a concrete requirement shape A cannot meet — e.g. an admin query
surface over transcripts, or multiple backend processes reading one session.

## Method mapping (shape A)

| `Storage` method | Implementation |
| --- | --- |
| `commit` | as above: validate per batch, one transaction, `receive`, `apply` |
| `mintId` | delegate to the inner `MemoryStorage` |
| `conversation`, `scanConversations` | delegate |
| `entry` (both overloads), `findLatestHeadMarker`, `scanEntries` | delegate |
| `task`, `scanTasks` | delegate |
| `submission`, `scanSubmissions`, `submissionByRequest` | delegate |
| `findDocument`, `document`, `scanDocuments` | delegate |
| `close` | `memory.close(context)`, then end the pool |
| `publishing` | omit; the Session publishes directly |

## What shipped

`apps/backend/src/storage/postgres/`, ~1,000 lines, one concept per file:

| File | Contents |
| --- | --- |
| `schema.ts` | `createSchema(prefix)` identifiers, versioned DDL (`MIGRATIONS`), `applyMigrations` under `pg_advisory_xact_lock` |
| `rows.ts` | record/address mapping: `encodeJson`, `encodeIndexedString`, `addressParts`, `documentRow` |
| `statements.ts` | chunked multi-row `INSERT` (500 rows/statement) and `DELETE … = ANY` |
| `commit.ts` | `claimOf`, `prepareDocumentActions`, `CommitState` (up-front reads, in-memory checks), `PendingWrites` (net effect per table) |
| `storage.ts` | `PostgresStorage`: the 16 methods, `commit`, `#materializeDocument`, copy resolution, admit-then-close read guard |
| `db.ts` | pool, `withClient`, `withTransaction` (read-only transactions use `REPEATABLE READ READ ONLY`) |
| `ids.ts`, `scan.ts` | brand casts and `scanStart`/`nextCursor` — the package does not export these (`dist/storage/scan.js` has no subpath) |

Mapping decisions, each a deviation from the SQLite original:

- **`json` columns, not `jsonb`.** Durable stores records as JSON *text* and hands them
  back verbatim. `jsonb` normalizes key order, duplicate keys and number formatting on
  write, so the bytes returned would differ from the bytes written. `json` validates and
  preserves, and the queryable values live in the columns beside it — the same layout as
  SQLite (`record TEXT NOT NULL CHECK (json_valid(record))` + extracted columns).
- **No `json_each` smuggling.** SQLite binds one JSON parameter and unpacks it with
  `json_each(?)`/`json_extract` to dodge its parameter limit. Postgres binds rows
  directly and uses `= ANY($1::bigint[])` and `unnest($1::text[], …)` for the ID and
  address sets, so `statements.ts` is ~40 lines instead of 87.
- **Native `boolean`** for `abort_requested`/`background` (SQLite stores 0/1 under a CHECK).
- **`bigint` ids and seqs**, parsed with `Number()` at the boundary: node-postgres hands
  `int8` back as a string. SQLite used `TEXT` for the same reason, and `Number.isSafeInteger`
  still guards `mintId`.
- **Indexed strings stay JSON-encoded** (`"kind"`, `"request-id"`), as in SQLite, so a lone
  surrogate cannot reach a text column and an address key built from stored columns still
  equals one built from a record in memory.
- **Prefixes instead of schemas.** `createSchema('t1_')` gives each conformance case its own
  tables, which is why the suite runs 33 isolated cases against one database.

What the porting analysis predicted and the tests confirmed:

- `ON CONFLICT … DO NOTHING/DO UPDATE` carries over unchanged (SQLite and Postgres agree).
- Cursor stability needed no `COLLATE "C"`: those queries order by `bigint`, not by text.
- Single writer means no advisory locking on the commit path; MVCC never sees a second
  writer because the backend is the only writer (see `docs/durable.md`).
- Type affinity was a non-issue once every key column got an explicit column type and
  values are bound as their real types.

## Testing

The suite is registered from `src/storage/postgres/storage.test.ts`, which skips when
`DATABASE_URL` is unset so the gates pass with no database:

```ts
registerStorageConformance({ describe, expect, it }, 'PostgresStorage', (use) => …)
```

Each case opens storage with a fresh table prefix, runs, closes, and the file drops every
table it created in `afterAll`. Locally:

```bash
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/tlabs' \
  pnpm --filter backend test
```

A server is available locally: container `tlabs-pg`, Postgres 18.7 on port **55432**
(the default 5432 is already taken on this machine).

## Limits and open questions

1. **Retention.** Nothing prunes `entries` or `document_revisions`. Durable's own
   compaction rewrites a conversation's history through the same `Storage` interface,
   so growth is bounded by compaction policy, not by this adapter.
2. **Connection handling.** The pool ceiling is `DATABASE_POOL_SIZE` (1–100, default 10) and
   the backend holds one `Storage`. What the Session does when the database restarts
   mid-commit is still open: the error is fatal (`SessionFailed`), and nothing re-opens
   storage automatically.
3. **Single writer.** `docs/durable.md` records durable's assumption: one writer per
   storage. Postgres does not change that contract; two backend processes over one
   database still need the "sessions pinned to a process" rule.
4. **`DATABASE_URL` shape.** Implemented: `apps/backend/src/config.ts` validates it with
   `z.url({ protocol: /^postgres(ql)?$/ })`, so a wrong scheme or a bare `host:port`
   fails at startup with the other configuration problems rather than at connect time.
   `src/agent.ts` picks Postgres when it is set and `MemoryStorage` otherwise.
5. **Schema ownership.** Answered by `MIGRATIONS` in `schema.ts` plus the
   `durable_schema` version table, applied at open under an advisory lock. A release
   change appends a version; it never edits one.
