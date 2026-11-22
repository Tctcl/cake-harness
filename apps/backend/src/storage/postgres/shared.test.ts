import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { MemoryStorage } from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'
import { describe, expect, it, vi } from 'vitest'

import { sharedStorage } from './shared.js'

describe('sharedStorage', () => {
  it('survives a harness closing it', async () => {
    const storage = new MemoryStorage()
    const close = vi.spyOn(storage, 'close')

    await sharedStorage(storage).close(BACKGROUND_CONTEXT)

    expect(close).not.toHaveBeenCalled()
    // Still usable: this is what a reopened harness needs.
    await expect(storage.mintId()).resolves.toBeTypeOf('number')
  })

  it('forwards reads to the storage it wraps', async () => {
    const storage = new MemoryStorage()
    const id = await storage.mintId<ConversationId>()

    await expect(sharedStorage(storage).conversation(id, BACKGROUND_CONTEXT)).resolves.toBeUndefined()
  })
})
