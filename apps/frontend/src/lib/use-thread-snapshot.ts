import { useCallback, useSyncExternalStore } from 'react'

import type { ThreadSnapshot } from './chat-store.ts'
import { snapshotOf, subscribeToThread } from './chat-store.ts'

/** Subscribe any conversation-aware chrome to the same durable stream state as the transcript. */
export function useThreadSnapshot(threadId: string | null): ThreadSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (threadId === null ? () => {} : subscribeToThread(threadId, listener)),
    [threadId],
  )
  const read = useCallback(() => snapshotOf(threadId), [threadId])

  return useSyncExternalStore(subscribe, read)
}
