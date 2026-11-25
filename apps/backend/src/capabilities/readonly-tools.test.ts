import { Buffer } from 'node:buffer'
import { posix as path } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import { describe, expect, it } from 'vitest'

import {
  buildFindArgv,
  buildGitArgv,
  buildGrepArgv,
  gitInWorkspace,
  grepInWorkspace,
  resolveWorkspacePath,
} from './readonly-tools.js'
import type { GitInput, ReadonlyEnvironment } from './readonly-tools.js'

const ROOT = '/home/dev/workspace'

const successful = (exitCode = 0) => ({ ok: true as const, value: { exitCode } })

const environment = (
  exec: ExecutionEnv['exec'] = async () => successful(),
): ReadonlyEnvironment => ({
  cwd: ROOT,
  async canonicalPath(target) {
    return { ok: true, value: path.resolve(ROOT, target) }
  },
  async listDir() {
    return { ok: true, value: [] }
  },
  exec,
})

describe('read-only tool argv', () => {
  it('places the end-of-options marker before grep patterns and paths', () => {
    expect(buildGrepArgv(
      { pattern: '--write-something', path: 'src', glob: '*.ts', ignoreCase: true },
      `${ROOT}/src`,
      'rg',
    )).toEqual([
      'rg',
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--ignore-case',
      '--glob',
      '*.ts',
      '--',
      '--write-something',
      `${ROOT}/src`,
    ])
    expect(buildGrepArgv({ pattern: '-n' }, ROOT, 'grep')).toEqual([
      'grep',
      '-rnH',
      '--exclude-dir=.git',
      '-e',
      '-n',
      '--',
      ROOT,
    ])
  })

  it('places the end-of-options marker before the find root and builds predicates as separate arguments', () => {
    expect(buildFindArgv(
      { name: '-exec', type: 'file', maxDepth: 2 },
      `${ROOT}/src`,
    )).toEqual([
      'find',
      '--',
      `${ROOT}/src`,
      '-maxdepth',
      '2',
      '-type',
      'f',
      '-name',
      '-exec',
      '-print',
    ])
  })

  it('uses only the supported git subcommands and disables pagers and external diffs', () => {
    expect(buildGitArgv({ subcommand: 'diff', args: ['--stat'] })).toEqual([
      'git',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--stat',
    ])
    expect(buildGitArgv({ subcommand: 'status' })).toEqual([
      'git',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      'status',
    ])
    expect(buildGitArgv({ subcommand: 'branch', args: ['--list', '--', '-feature'] })).toEqual([
      'git',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      'branch',
      '--list',
      '--',
      '-feature',
    ])
    expect(buildGitArgv({ subcommand: 'remote', args: ['show', 'origin'] })).toEqual([
      'git',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      'remote',
      'show',
      '-n',
      'origin',
    ])
  })

  const forbiddenArguments: { readonly argument: string; readonly subcommand: GitInput['subcommand'] }[] = [
    { argument: '--output=report', subcommand: 'diff' },
    { argument: '--exec=command', subcommand: 'diff' },
    { argument: '--upload-pack=command', subcommand: 'diff' },
    { argument: '-c', subcommand: 'diff' },
    { argument: '-cfoo=bar', subcommand: 'diff' },
    { argument: '--config=core.pager=command', subcommand: 'diff' },
    { argument: '--git-dir=/tmp/repo', subcommand: 'diff' },
    { argument: '--work-tree=/tmp/repo', subcommand: 'diff' },
    { argument: '--ext-diff', subcommand: 'diff' },
    { argument: '--textconv', subcommand: 'show' },
    { argument: '--contents=/tmp/input', subcommand: 'blame' },
    { argument: '--no-index', subcommand: 'diff' },
    { argument: '--pathspec-from-file=/tmp/list', subcommand: 'status' },
    { argument: '--pathspec-file-nul', subcommand: 'diff' },
    { argument: '-o', subcommand: 'diff' },
    { argument: '-oresult', subcommand: 'log' },
    { argument: '-ofile', subcommand: 'show' },
  ]

  it.each(forbiddenArguments)('rejects forbidden git argument $argument', ({ argument, subcommand }) => {
    expect(() => buildGitArgv({
      subcommand,
      args: [argument],
    })).toThrow('git argument is not allowed')
  })

  it('refuses branch and remote arguments that mutate repository state', () => {
    expect(() => buildGitArgv({ subcommand: 'branch', args: ['--delete', 'feature'] }))
      .toThrow('not read-only')
    expect(() => buildGitArgv({ subcommand: 'remote', args: ['update'] }))
      .toThrow('only listing, show, and get-url')
  })

  it('rejects git path traversal arguments', () => {
    expect(() => buildGitArgv({ subcommand: 'diff', args: ['--', '../outside'] }))
      .toThrow('git path must remain inside')
  })
})

describe('read-only workspace operations', () => {
  it('refuses canonical paths outside the workspace root', async () => {
    await expect(resolveWorkspacePath(environment(), '../outside', BACKGROUND_CONTEXT)).rejects.toThrow(
      'Path must remain inside /home/dev/workspace',
    )
    await expect(resolveWorkspacePath(environment(), '/home/dev/workspace-other/file', BACKGROUND_CONTEXT)).rejects.toThrow(
      'Path must remain inside /home/dev/workspace',
    )
  })

  it('refuses git path arguments whose canonical target escapes through a symlink', async () => {
    const env = {
      ...environment(),
      async canonicalPath(target: string) {
        return { ok: true as const, value: target.endsWith('/link') ? '/outside/secret' : path.resolve(ROOT, target) }
      },
    }

    await expect(gitInWorkspace(
      { subcommand: 'diff', args: ['--', 'link'] },
      env,
      BACKGROUND_CONTEXT,
    )).rejects.toThrow('Path must remain inside /home/dev/workspace')
  })

  it('falls back to grep when rg is unavailable', async () => {
    const calls: string[][] = []
    const env = environment(async (command, options, context) => {
      if (typeof command === 'string') throw new Error('test expected argv execution')
      calls.push([...command])
      if (command[0] === 'sh') return successful(127)
      options?.onOutput?.('src/a.ts:1:needle\n', context, { stream: 'stdout' })

      return successful()
    })

    const result = await grepInWorkspace({ pattern: 'needle', path: 'src', ignoreCase: true }, env, BACKGROUND_CONTEXT)

    expect(result).toBe('src/a.ts:1:needle\n')
    expect(calls).toEqual([
      ['sh', '-c', 'command -v rg'],
      ['grep', '-rnH', '--exclude-dir=.git', '-i', '-e', 'needle', '--', `${ROOT}/src`],
    ])
  })

  it('uses rg when detected and caps streamed output with an omission notice', async () => {
    const calls: string[][] = []
    const env = environment(async (command, options, context) => {
      if (typeof command === 'string') throw new Error('test expected argv execution')
      if (command[0] === 'sh') return successful()
      calls.push([...command])
      options?.onOutput?.('x'.repeat(60 * 1024), context, { stream: 'stdout' })

      return successful()
    })

    const result = await grepInWorkspace({ pattern: 'needle' }, env, BACKGROUND_CONTEXT)

    expect(calls[0]?.[0]).toBe('rg')
    expect(result).toContain(`[output truncated; omitted ${10 * 1024} bytes]`)
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50 * 1024 + 128)
  })

  it('keeps the byte-cap notice when grep results also exceed maxResults', async () => {
    const env = environment(async (command, options, context) => {
      if (typeof command === 'string') throw new Error('test expected argv execution')
      if (command[0] === 'sh') return successful()
      options?.onOutput?.('x\n'.repeat(30 * 1024), context, { stream: 'stdout' })

      return successful()
    })

    const result = await grepInWorkspace({ pattern: 'x', maxResults: 1 }, env, BACKGROUND_CONTEXT)

    expect(result).toContain('[results limited to 1 line; omitted')
    expect(result).toContain('[output truncated; omitted 10240 bytes]')
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(50 * 1024 + 128)
  })

  it('does not resolve branch patterns as filesystem paths', async () => {
    const canonicalPaths: string[] = []
    const commands: string[][] = []
    const env = {
      ...environment(async (command) => {
        if (typeof command === 'string') throw new Error('test expected argv execution')
        commands.push([...command])

        return successful()
      }),
      async canonicalPath(target: string) {
        canonicalPaths.push(target)
        return { ok: true as const, value: path.resolve(ROOT, target) }
      },
    }

    await gitInWorkspace(
      { subcommand: 'branch', args: ['--list', '--', '-feature'] },
      env,
      BACKGROUND_CONTEXT,
    )

    expect(canonicalPaths).toEqual(['/home/dev/workspace', '.'])
    expect(commands[0]).toEqual([
      'git',
      '--no-pager',
      '-c',
      'core.fsmonitor=false',
      'branch',
      '--list',
      '--',
      '-feature',
    ])
  })
})
