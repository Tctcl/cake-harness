import type { DocumentAddress, DocumentRecord } from '@earendil-works/pi-durable'

/**
 * How Durable's records map to Postgres: a `json` column, and indexed strings alongside it.
 *
 * Indexed strings are JSON-encoded like the SQLite backend's, so a lone surrogate never reaches a text column and the
 * address key derived from stored columns matches the one derived from a record in memory.
 */
export const encodeJson = (value: unknown): string => JSON.stringify(value)

/** Encodes an indexed string column. */
export const encodeIndexedString = (value: string): string => JSON.stringify(value)

/** A document scope's columns. */
export const scopeColumns = (
  scope: DocumentRecord['scope'],
): { scopeKind: 'session' | 'conversation' | 'task'; ownerId: number } => {
  switch (scope.kind) {
    case 'session':
      return { scopeKind: 'session', ownerId: 0 }
    case 'conversation':
      return { scopeKind: 'conversation', ownerId: scope.conversationId }
    case 'task':
      return { scopeKind: 'task', ownerId: scope.taskId }
  }
}

/** A document address's columns, as `documents` stores and indexes them. */
export const addressParts = (
  address: DocumentAddress,
): { kind: string; scopeKind: string; ownerId: number; family: 0 | 1; keyValue: string } => {
  const scope = scopeColumns(address.scope)
  return {
    kind: encodeIndexedString(address.kind),
    ...scope,
    family: address.key === undefined ? 0 : 1,
    keyValue: encodeIndexedString(address.key ?? ''),
  }
}

/** One string per document address, from its stored columns. */
export const addressColumnsKey = (
  kind: string,
  scopeKind: string,
  ownerId: number,
  family: number,
  keyValue: string,
): string => JSON.stringify([kind, scopeKind, ownerId, family, keyValue])

/** One string per document address. */
export const addressKey = (address: DocumentAddress): string => {
  const parts = addressParts(address)
  return addressColumnsKey(parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue)
}

/** Whether a document keeps only its current state: its revisions go at each new base and at retirement. */
export const isCurrentOnly = (record: DocumentRecord): boolean =>
  record.scope.kind !== 'conversation' || record.history === 'latest'

/** A document record's `documents` row, in `documentColumns` order. */
export const documentRow = (record: DocumentRecord): (string | number | null)[] => {
  const parts = addressParts(record)
  return [
    record.id,
    parts.kind,
    parts.family,
    parts.keyValue,
    parts.scopeKind,
    parts.ownerId,
    record.createdAt,
    record.retiredAt ?? null,
    encodeJson(record),
  ]
}

/** The columns `documentRow` writes, in order. */
export const documentColumns = [
  'id',
  'kind',
  'family',
  'key_value',
  'scope_kind',
  'owner_id',
  'created_at',
  'retired_at',
  'record',
] as const

/** A document revision's `document_revisions` row, in `revisionColumns` order. */
export const revisionRow = (
  id: number,
  seq: number,
  kind: 'base' | 'delta',
  version: number,
  encoded: string,
): (string | number)[] => [id, seq, kind, version, encoded]

/** The columns a revision row writes, in order. */
export const revisionColumns = ['document_id', 'seq', 'kind', 'version', 'content'] as const
