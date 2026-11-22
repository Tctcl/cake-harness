import type { Storage } from '@earendil-works/pi-durable'

/**
 * Share one `Storage` across every harness the process opens.
 *
 * `Harness.close()` closes the storage it was opened with, which is right for a single harness in a script but wrong
 * here: this backend opens a new harness whenever a Session fails, and closing the storage with it would leave a pool
 * whose every statement fails with "is closed". Closing is therefore the process's call alone, at shutdown.
 */
export const sharedStorage = (storage: Storage): Storage => ({
  commit: (batches, receive, context) => storage.commit(batches, receive, context),
  mintId: () => storage.mintId(),
  conversation: (id, context) => storage.conversation(id, context),
  scanConversations: (query, limit, cursor, context) =>
    storage.scanConversations(query, limit, cursor, context),
  // Both `entry` overloads take numbers, so the runtime cannot tell them apart; the arity does.
  entry: ((first: never, second: never, third?: never) =>
    third === undefined ? storage.entry(first, second) : storage.entry(first, second, third)) as Storage['entry'],
  findLatestHeadMarker: (conversationId, atOrBeforeEntryId, context) =>
    storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context),
  scanEntries: (query, limit, cursor, context) => storage.scanEntries(query, limit, cursor, context),
  task: (id, context) => storage.task(id, context),
  scanTasks: (query, limit, cursor, context) => storage.scanTasks(query, limit, cursor, context),
  submission: (id, context) => storage.submission(id, context),
  scanSubmissions: (query, limit, cursor, context) => storage.scanSubmissions(query, limit, cursor, context),
  submissionByRequest: (conversationId, requestId, context) =>
    storage.submissionByRequest(conversationId, requestId, context),
  findDocument: (address, at, context) => storage.findDocument(address, at, context),
  document: (id, at, context) => storage.document(id, at, context),
  scanDocuments: (query, limit, cursor, context) => storage.scanDocuments(query, limit, cursor, context),
  close: async () => undefined,
})
