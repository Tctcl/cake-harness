import { describe, expect, it, vi } from 'vitest'

import { createUpdateChecker } from './checker.js'
import type { ReleaseSource } from './releases.js'

const releasesOf = (latest: () => Promise<{ tag: string; url: string }>): ReleaseSource => ({
  latest,
})

const githubAnswers = (tag: string): ReleaseSource =>
  releasesOf(async () => ({ tag, url: `https://github.com/Tctcl/cake-harness/releases/tag/${tag}` }))

describe('createUpdateChecker', () => {
  it('reports an available update when the release is newer', async () => {
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.2.0',
      releases: githubAnswers('v0.3.0'),
      intervalMs: 0,
    })

    const status = await checker.check()

    expect(status.available).toBe(true)
    expect(status.latest).toBe('0.3.0')
    expect(status.current).toBe('0.2.0')
    expect(status.checkedAt).not.toBeNull()
  })

  it('compares numerically, not as strings', async () => {
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.2.9',
      releases: githubAnswers('v0.2.10'),
      intervalMs: 0,
    })

    await expect(checker.check()).resolves.toMatchObject({ available: true })
  })

  it('reports no update when the versions match', async () => {
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.3.0',
      releases: githubAnswers('v0.3.0'),
      intervalMs: 0,
    })

    await expect(checker.check()).resolves.toMatchObject({ available: false })
  })

  it('reports no update when the release is older, as during a rollback', async () => {
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.4.0',
      releases: githubAnswers('v0.3.0'),
      intervalMs: 0,
    })

    await expect(checker.check()).resolves.toMatchObject({ available: false })
  })

  it('records the failure and keeps the previous answer', async () => {
    let answer: () => Promise<{ tag: string; url: string }> = async () => ({
      tag: 'v0.3.0',
      url: 'https://github.com/Tctcl/cake-harness/releases/tag/v0.3.0',
    })
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.2.0',
      releases: { latest: () => answer() },
      intervalMs: 0,
    })

    await checker.check()
    answer = async () => {
      throw new Error('GitHub answered 503 for the latest release')
    }

    const failed = await checker.check()

    expect(failed.error).toBe('GitHub answered 503 for the latest release')
    expect(failed.latest).toBe('0.3.0')
    expect(failed.available).toBe(true)
  })

  it('does not guess on staging: one tag, so "newer" has no meaning', async () => {
    const releases = releasesOf(vi.fn())
    const checker = createUpdateChecker({
      channel: 'staging',
      version: '0.2.0',
      releases,
      intervalMs: 0,
    })

    await expect(checker.check()).resolves.toMatchObject({ available: null, latest: null })
    expect(releases.latest).not.toHaveBeenCalled()
  })

  it('does not guess without a version: a checkout has nothing to compare', async () => {
    const checker = createUpdateChecker({
      channel: 'production',
      version: undefined,
      releases: releasesOf(vi.fn()),
      intervalMs: 0,
    })

    await expect(checker.check()).resolves.toMatchObject({ current: null, available: null })
  })

  it('shares one request between concurrent callers', async () => {
    const latest = vi.fn(async () => ({
      tag: 'v0.3.0',
      url: 'https://github.com/Tctcl/cake-harness/releases/tag/v0.3.0',
    }))
    const checker = createUpdateChecker({
      channel: 'production',
      version: '0.2.0',
      releases: { latest },
      intervalMs: 0,
    })

    await Promise.all([checker.check(), checker.check()])

    expect(latest).toHaveBeenCalledOnce()
  })

  it('leaves the timer off when the interval is zero, and clears it otherwise', () => {
    vi.useFakeTimers()

    try {
      const disabled = createUpdateChecker({
        channel: 'production',
        version: '0.2.0',
        releases: githubAnswers('v0.3.0'),
        intervalMs: 0,
      })
      disabled.start()
      expect(vi.getTimerCount()).toBe(0)

      const enabled = createUpdateChecker({
        channel: 'production',
        version: '0.2.0',
        releases: githubAnswers('v0.3.0'),
        intervalMs: 60_000,
      })
      enabled.start()
      expect(vi.getTimerCount()).toBe(1)
      enabled.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
