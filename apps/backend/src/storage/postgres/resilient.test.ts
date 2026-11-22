import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Storage } from '@earendil-works/pi-durable'
import { describe, expect, it, vi } from 'vitest'

import { retryingStorage } from './resilient.js'

const CONTEXT = BACKGROUND_CONTEXT
const fast = { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 }

const refused = (): Error => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
const lost = (): Error => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })

const unstubbed = (name: string) => () => {
  throw new Error(`${name} is not stubbed`)
}

const stub = (overrides: Partial<Storage>): Storage => ({
  commit: unstubbed('commit'),
  mintId: unstubbed('mintId'),
  conversation: unstubbed('conversation'),
  scanConversations: unstubbed('scanConversations'),
  entry: unstubbed('entry'),
  findLatestHeadMarker: unstubbed('findLatestHeadMarker'),
  scanEntries: unstubbed('scanEntries'),
  task: unstubbed('task'),
  scanTasks: unstubbed('scanTasks'),
  submission: unstubbed('submission'),
  scanSubmissions: unstubbed('scanSubmissions'),
  submissionByRequest: unstubbed('submissionByRequest'),
  findDocument: unstubbed('findDocument'),
  document: unstubbed('document'),
  scanDocuments: unstubbed('scanDocuments'),
  close: unstubbed('close'),
  ...overrides,
})

describe('retryingStorage', () => {
  it('repeats a read that lost its connection', async () => {
    const conversation = vi
      .fn<Storage['conversation']>()
      .mockRejectedValueOnce(lost())
      .mockResolvedValue(undefined)

    await expect(
      retryingStorage(stub({ conversation }), fast).conversation(1 as never, CONTEXT),
    ).resolves.toBeUndefined()
    expect(conversation).toHaveBeenCalledTimes(2)
  })

  it('never repeats a commit that may have been applied', async () => {
    const commit = vi.fn<Storage['commit']>().mockRejectedValue(lost())

    await expect(
      retryingStorage(stub({ commit }), fast).commit([], () => undefined, CONTEXT),
    ).rejects.toThrow('ECONNRESET')
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('repeats a commit the server never saw', async () => {
    const commit = vi
      .fn<Storage['commit']>()
      .mockRejectedValueOnce(refused())
      .mockResolvedValue({ stored: 1 })

    await expect(
      retryingStorage(stub({ commit }), fast).commit([], () => undefined, CONTEXT),
    ).resolves.toEqual({ stored: 1 })
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('leaves a genuine failure alone', async () => {
    const conversation = vi.fn<Storage['conversation']>().mockRejectedValue(new Error('bad cursor'))

    await expect(
      retryingStorage(stub({ conversation }), fast).conversation(1 as never, CONTEXT),
    ).rejects.toThrow('bad cursor')
    expect(conversation).toHaveBeenCalledTimes(1)
  })

  it('forwards both entry arities', async () => {
    const entry = vi.fn(async () => undefined)

    const storage = retryingStorage(stub({ entry }), fast)

    await expect(storage.entry(1 as never, CONTEXT)).resolves.toBeUndefined()
    await expect(storage.entry(2 as never, 3 as never, CONTEXT)).resolves.toBeUndefined()

    expect(entry).toHaveBeenNthCalledWith(1, 1, CONTEXT)
    expect(entry).toHaveBeenNthCalledWith(2, 2, 3, CONTEXT)
  })
})
