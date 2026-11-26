import { posix } from 'node:path'

import type { Context } from '@earendil-works/chord/context'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'

export const WORKSPACE_ROOT = '/home/dev/workspace'

export interface WorktreePlan {
  readonly repoPath: string
  readonly path: string
  readonly branch: string
  readonly check: readonly string[]
  readonly add: readonly string[]
}

/** All paths are container paths; argv is never shell-interpolated. */
export const worktreePlan = (
  delegationId: string,
  parentCwd: string | undefined,
  repoPath: string | undefined,
): WorktreePlan => {
  const repo = repoPath === undefined
    ? posix.resolve(WORKSPACE_ROOT, parentCwd ?? WORKSPACE_ROOT)
    : posix.resolve(WORKSPACE_ROOT, repoPath)
  if (repoPath !== undefined && (posix.isAbsolute(repoPath) || repo !== WORKSPACE_ROOT && !repo.startsWith(`${WORKSPACE_ROOT}/`))) {
    throw new Error('repoPath must stay relative to /home/dev/workspace')
  }
  const path = `${WORKSPACE_ROOT}/.cake/worktrees/${delegationId}`
  const branch = `cake/${delegationId}`

  return {
    repoPath: repo,
    path,
    branch,
    check: ['git', '-C', repo, 'rev-parse', '--show-toplevel'],
    add: ['git', '-C', repo, 'worktree', 'add', '-b', branch, path],
  }
}

const run = async (
  env: Pick<ExecutionEnv, 'exec'>,
  argv: readonly string[],
  context: Context,
): Promise<{ readonly exitCode: number; readonly output: string }> => {
  let output = ''
  const result = await env.exec(argv, {
    timeout: 60_000,
    onOutput: (text) => {
      output += text
    },
  }, context)
  if (!result.ok) throw new Error(result.error.message)

  return { exitCode: result.value.exitCode, output }
}

/** A completed retry recognizes its existing worktree; no cleanup is ever attempted. */
export const createWorktree = async (
  env: Pick<ExecutionEnv, 'exec'>,
  plan: WorktreePlan,
  context: Context,
): Promise<void> => {
  const existing = await run(env, ['git', '-C', plan.path, 'rev-parse', '--show-toplevel'], context)
  if (existing.exitCode === 0) return

  const repository = await run(env, plan.check, context)
  if (repository.exitCode !== 0) {
    throw new Error(`${plan.repoPath} is not a git repository: ${repository.output.trim() || 'git rev-parse failed'}`)
  }

  const added = await run(env, plan.add, context)
  if (added.exitCode !== 0) {
    throw new Error(`could not create worktree ${plan.path}: ${added.output.trim() || `git exited ${added.exitCode}`}`)
  }
}
