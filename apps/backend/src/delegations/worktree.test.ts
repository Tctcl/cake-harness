import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { describe, expect, it, vi } from 'vitest'

import { createWorktree, worktreePlan } from './worktree.js'

const DELEGATION_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'

describe('worktreePlan', () => {
  it('uses the parent cwd by default and constructs an isolated path, branch and argv', () => {
    const plan = worktreePlan(DELEGATION_ID, '/home/dev/workspace/service', undefined)

    expect(plan).toEqual({
      repoPath: '/home/dev/workspace/service',
      path: `/home/dev/workspace/.cake/worktrees/${DELEGATION_ID}`,
      branch: `cake/${DELEGATION_ID}`,
      check: ['git', '-C', '/home/dev/workspace/service', 'rev-parse', '--show-toplevel'],
      add: [
        'git',
        '-C',
        '/home/dev/workspace/service',
        'worktree',
        'add',
        '-b',
        `cake/${DELEGATION_ID}`,
        `/home/dev/workspace/.cake/worktrees/${DELEGATION_ID}`,
      ],
    })
  })

  it('keeps repoPath relative to the workspace and rejects absolute or escaping paths', () => {
    expect(worktreePlan(DELEGATION_ID, undefined, 'service/api').repoPath).toBe('/home/dev/workspace/service/api')
    expect(() => worktreePlan(DELEGATION_ID, undefined, '/etc')).toThrow(/relative/)
    expect(() => worktreePlan(DELEGATION_ID, undefined, '../etc')).toThrow(/relative/)
  })
})

describe('createWorktree', () => {
  it('checks the repository and runs git worktree add without shell interpolation', async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { exitCode: 1 } })
      .mockResolvedValueOnce({ ok: true, value: { exitCode: 0 } })
      .mockResolvedValueOnce({ ok: true, value: { exitCode: 0 } })
    const plan = worktreePlan(DELEGATION_ID, undefined, 'repo')

    await createWorktree({ exec } as never, plan, BACKGROUND_CONTEXT)

    expect(exec.mock.calls.map((call) => call[0])).toEqual([
      ['git', '-C', plan.path, 'rev-parse', '--show-toplevel'],
      plan.check,
      plan.add,
    ])
  })

  it('does not recreate an existing worktree on a durable replay', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true, value: { exitCode: 0 } })

    await createWorktree({ exec } as never, worktreePlan(DELEGATION_ID, undefined, undefined), BACKGROUND_CONTEXT)

    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('fails clearly when the requested path is not a git repository', async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { exitCode: 1 } })
      .mockResolvedValueOnce({ ok: true, value: { exitCode: 128 } })
    const plan = worktreePlan(DELEGATION_ID, undefined, 'not-a-repo')

    await expect(createWorktree({ exec } as never, plan, BACKGROUND_CONTEXT)).rejects.toThrow(
      '/home/dev/workspace/not-a-repo is not a git repository',
    )
    expect(exec).toHaveBeenCalledTimes(2)
  })
})
