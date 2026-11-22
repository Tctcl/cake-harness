import type { Storage } from '@earendil-works/pi-durable'

import { isConnectFailure, isTransient, withRetry, type RetryOptions } from './retry.js'

/** Three tries, 100 ms then 200 ms: long enough to ride out a dropped connection, short enough not to stall a request. */
const STORAGE_RETRY: RetryOptions = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }

/**
 * Wrap `storage` so a blip is absorbed inside the call, which is the only place durable permits it: an error that
 * escapes a `Storage` method fails the Session for good.
 *
 * Reads retry any lost connection. Writes (`commit`, `mintId`) retry only a connection that never opened, because a
 * statement that may have landed cannot be replayed: `commit` is one transaction, so a reply lost in flight is either
 * all or nothing and only the backend that ran it can say which.
 *
 * `close` is deliberately unwrapped — closing is final, and `publishing` is absent because this backend does not
 * implement it.
 */
export const retryingStorage = (storage: Storage, options: RetryOptions = STORAGE_RETRY): Storage => {
  const read = <T>(run: () => Promise<T>): Promise<T> => withRetry(options, isTransient, run)
  const write = <T>(run: () => Promise<T>): Promise<T> => withRetry(options, isConnectFailure, run)

  return {
    commit: (batches, receive, context) => write(() => storage.commit(batches, receive, context)),
    mintId: () => write(() => storage.mintId()),
    conversation: (id, context) => read(() => storage.conversation(id, context)),
    scanConversations: (query, limit, cursor, context) =>
      read(() => storage.scanConversations(query, limit, cursor, context)),
    // Both `entry` overloads take numbers, so the runtime cannot tell them apart; the arity does.
    entry: ((first: never, second: never, third?: never) =>
      third === undefined
        ? read(() => storage.entry(first, second))
        : read(() => storage.entry(first, second, third))) as Storage['entry'],
    findLatestHeadMarker: (conversationId, atOrBeforeEntryId, context) =>
      read(() => storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context)),
    scanEntries: (query, limit, cursor, context) => read(() => storage.scanEntries(query, limit, cursor, context)),
    task: (id, context) => read(() => storage.task(id, context)),
    scanTasks: (query, limit, cursor, context) => read(() => storage.scanTasks(query, limit, cursor, context)),
    submission: (id, context) => read(() => storage.submission(id, context)),
    scanSubmissions: (query, limit, cursor, context) =>
      read(() => storage.scanSubmissions(query, limit, cursor, context)),
    submissionByRequest: (conversationId, requestId, context) =>
      read(() => storage.submissionByRequest(conversationId, requestId, context)),
    findDocument: (address, at, context) => read(() => storage.findDocument(address, at, context)),
    document: (id, at, context) => read(() => storage.document(id, at, context)),
    scanDocuments: (query, limit, cursor, context) => read(() => storage.scanDocuments(query, limit, cursor, context)),
    close: (context) => storage.close(context),
  }
}
