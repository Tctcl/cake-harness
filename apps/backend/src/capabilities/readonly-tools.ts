import { Buffer } from 'node:buffer'
import { posix as path } from 'node:path'

import { withAbortSignal } from '@earendil-works/chord/context'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import type { Context } from '@earendil-works/chord/context'

const WORKSPACE_ROOT = '/home/dev/workspace'
const OUTPUT_LIMIT_BYTES = 50 * 1024
const DEFAULT_MAX_RESULTS = 200
const MAX_RESULTS = 1000
const TIMEOUT_MS = 30_000
const EXT_DIFF_SUBCOMMANDS = new Set(['log', 'diff', 'show'])
const OUTPUT_FILE_SUBCOMMANDS = new Set(['log', 'diff', 'show'])
const FORBIDDEN_GIT_PREFIXES = [
  '--output',
  '--exec',
  '--upload-pack',
  '--config',
  '--git-dir',
  '--work-tree',
  '--ext-diff',
  '--textconv',
  '--contents',
  '--no-index',
  '--pathspec-from-file',
  '--pathspec-file-nul',
] as const
const READ_ONLY_BRANCH_FLAGS = new Set([
  '-a',
  '--all',
  '-r',
  '--remotes',
  '-v',
  '-vv',
  '--verbose',
  '--no-abbrev',
  '--list',
  '--show-current',
  '--color',
  '--no-color',
])

export type ReadonlyEnvironment = Pick<ExecutionEnv, 'cwd' | 'exec' | 'canonicalPath' | 'listDir'>

interface CapturedOutput {
  stdout: string
  stderr: string
  bytes: number
  omittedBytes: number
}

export interface GrepInput {
  readonly pattern: string
  readonly path?: string | undefined
  readonly glob?: string | undefined
  readonly ignoreCase?: boolean | undefined
  readonly maxResults?: number | undefined
}

export interface FindInput {
  readonly path?: string | undefined
  readonly name?: string | undefined
  readonly type?: 'file' | 'dir' | undefined
  readonly maxDepth?: number | undefined
  readonly maxResults?: number | undefined
}

export interface LsInput {
  readonly path?: string | undefined
}

export interface GitInput {
  readonly subcommand: 'status' | 'log' | 'diff' | 'show' | 'blame' | 'branch' | 'remote'
  readonly args?: readonly string[] | undefined
}

const appendCapped = (captured: CapturedOutput, stream: 'stdout' | 'stderr', chunk: string): void => {
  const available = OUTPUT_LIMIT_BYTES - captured.bytes
  let accepted = ''
  let acceptedBytes = 0

  for (const character of chunk) {
    const bytes = Buffer.byteLength(character)
    if (acceptedBytes + bytes > available) break
    accepted += character
    acceptedBytes += bytes
  }

  captured[stream] += accepted
  captured.bytes += acceptedBytes
  captured.omittedBytes += Buffer.byteLength(chunk.slice(accepted.length))
}

const capturedText = (captured: CapturedOutput): string => {
  const sections = [captured.stdout]
  if (captured.stderr !== '') sections.push(`[stderr]\n${captured.stderr}`)
  if (captured.omittedBytes > 0) {
    sections.push(`[output truncated; omitted ${captured.omittedBytes} bytes]`)
  }

  return sections.filter((section) => section !== '').join('\n')
}

const collectCommand = async (
  env: ReadonlyEnvironment,
  argv: readonly string[],
  context: Context,
  options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
): Promise<{ readonly text: string; readonly exitCode: number }> => {
  const captured: CapturedOutput = { stdout: '', stderr: '', bytes: 0, omittedBytes: 0 }
  const result = await env.exec(argv, {
    cwd: options.cwd,
    timeout: TIMEOUT_MS,
    ...(options.env === undefined ? {} : { env: { ...options.env } }),
    onOutput(text, _context, { stream }) {
      appendCapped(captured, stream, text)
    },
  }, context)
  if (!result.ok) throw new Error(result.error.message)

  return { text: capturedText(captured), exitCode: result.value.exitCode }
}

const isInside = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root === '/' ? '/' : `${root}/`)

export const resolveWorkspacePath = async (
  env: ReadonlyEnvironment,
  inputPath: string,
  context: Context,
): Promise<{ readonly root: string; readonly path: string }> => {
  const workspace = await env.canonicalPath(WORKSPACE_ROOT, context)
  if (!workspace.ok) throw new Error(`Workspace directory is unavailable: ${workspace.error.code}`)

  const canonicalRoot = workspace.value.replace(/\/+$/, '') || '/'
  const canonical = await env.canonicalPath(inputPath, context)
  if (!canonical.ok) throw new Error(`Cannot resolve path: ${canonical.error.code}`)
  if (!isInside(canonicalRoot, canonical.value)) {
    throw new Error('Path must remain inside /home/dev/workspace')
  }

  return { root: canonicalRoot, path: canonical.value }
}

const boundedResults = (text: string, maxResults: number): string => {
  if (text === '') return text
  const marker = text.match(/\[output truncated; omitted \d+ bytes\]$/)?.[0]
  const content = marker === undefined ? text : text.slice(0, -marker.length - 1)
  const allLines = content.split('\n')
  const lines = content.endsWith('\n') ? allLines.slice(0, -1) : allLines
  if (lines.length <= maxResults) return text

  const omittedLines = lines.length - maxResults

  return [
    lines.slice(0, maxResults).join('\n'),
    `[results limited to ${maxResults} ${maxResults === 1 ? 'line' : 'lines'}; omitted ${omittedLines} lines]`,
    ...(marker === undefined ? [] : [marker]),
  ].join('\n')
}

const checkedMaxResults = (maxResults: number | undefined): number => {
  const value = maxResults ?? DEFAULT_MAX_RESULTS
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`maxResults must be an integer from 1 to ${MAX_RESULTS}`)
  }

  return value
}

const checkedPath = (inputPath: string | undefined): string => inputPath ?? '.'

const withToolTimeout = (context: Context): Context =>
  withAbortSignal(AbortSignal.timeout(TIMEOUT_MS), context)

export const buildGrepArgv = (
  input: GrepInput,
  searchPath: string,
  executable: 'rg' | 'grep',
): readonly string[] => {
  if (executable === 'rg') {
    return [
      'rg',
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      ...(input.ignoreCase === true ? ['--ignore-case'] : []),
      ...(input.glob === undefined ? [] : ['--glob', input.glob]),
      '--',
      input.pattern,
      searchPath,
    ]
  }

  return [
    'grep',
    '-rnH',
    // rg skips version-control internals on its own; plain grep would report git's binary index as a match.
    '--exclude-dir=.git',
    ...(input.ignoreCase === true ? ['-i'] : []),
    '-e',
    input.pattern,
    '--',
    searchPath,
  ]
}

export const buildFindArgv = (input: FindInput, searchPath: string): readonly string[] => [
  'find',
  '--',
  searchPath,
  ...(input.maxDepth === undefined ? [] : ['-maxdepth', String(input.maxDepth)]),
  ...(input.type === undefined ? [] : ['-type', input.type === 'dir' ? 'd' : 'f']),
  ...(input.name === undefined ? [] : ['-name', input.name]),
  '-print',
]

const gitArgumentIsForbidden = (subcommand: GitInput['subcommand'], argument: string): boolean =>
  FORBIDDEN_GIT_PREFIXES.some((prefix) => argument.startsWith(prefix)) ||
  (argument.startsWith('-c') && !argument.startsWith('--')) ||
  (OUTPUT_FILE_SUBCOMMANDS.has(subcommand) && argument.startsWith('-o'))

const gitArgs = (subcommand: GitInput['subcommand'], args: readonly string[]): readonly string[] => {
  for (const argument of args) {
    if (gitArgumentIsForbidden(subcommand, argument)) {
      throw new Error(`git argument is not allowed: ${argument}`)
    }
    if (
      argument.startsWith('/') ||
      /^[a-zA-Z]:[\\/]/.test(argument) ||
      argument.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`git path must remain inside /home/dev/workspace: ${argument}`)
    }
  }

  if (subcommand === 'branch') {
    const separator = args.indexOf('--')
    if (separator === args.length - 1) throw new Error('git path separator must be followed by a pattern')
    const flags = separator === -1 ? args.filter((argument) => argument.startsWith('-')) : args.slice(0, separator)
    const patterns = separator === -1
      ? args.filter((argument) => !argument.startsWith('-'))
      : args.slice(separator + 1)
    const invalidFlag = flags.find((argument) => !READ_ONLY_BRANCH_FLAGS.has(argument))
    if (invalidFlag !== undefined) throw new Error(`git branch option is not read-only: ${invalidFlag}`)

    return [...flags, ...(patterns.length === 0 ? [] : ['--', ...patterns])]
  }

  if (subcommand === 'remote') {
    if (args.every((argument) => argument === '-v' || argument === '--verbose')) {
      return args
    }

    if (args[0] === 'show') {
      const remoteArgs = args.slice(1)
      const invalid = remoteArgs.find((argument) => argument.startsWith('-') && argument !== '-n' && argument !== '--no-query')
      if (invalid !== undefined) throw new Error(`git remote show option is not read-only: ${invalid}`)

      return ['show', ...(remoteArgs.includes('-n') || remoteArgs.includes('--no-query') ? remoteArgs : ['-n', ...remoteArgs])]
    }

    if (args[0] === 'get-url') {
      const remoteArgs = args.slice(1)
      const names = remoteArgs.filter((argument) => argument !== '--all' && argument !== '--push')
      if (names.length !== 1 || names[0]?.startsWith('-') === true) {
        throw new Error('git remote get-url requires exactly one remote name')
      }

      return args
    }

    throw new Error('git remote supports only listing, show, and get-url')
  }

  if (args.includes('--') && args.at(-1) === '--') {
    throw new Error('git path separator must be followed by a path')
  }

  return args
}

export const buildGitArgv = (input: GitInput): readonly string[] => {
  const args = gitArgs(input.subcommand, input.args ?? [])

  return [
    'git',
    '--no-pager',
    '-c',
    'core.fsmonitor=false',
    input.subcommand,
    ...(EXT_DIFF_SUBCOMMANDS.has(input.subcommand) ? ['--no-ext-diff', '--no-textconv'] : []),
    ...args,
  ]
}

export const grepInWorkspace = async (
  input: GrepInput,
  env: ReadonlyEnvironment,
  context: Context,
): Promise<string> => {
  const timedContext = withToolTimeout(context)
  const maxResults = checkedMaxResults(input.maxResults)
  const { root, path: searchPath } = await resolveWorkspacePath(env, checkedPath(input.path), timedContext)
  const detection = await collectCommand(
    env,
    ['sh', '-c', 'command -v rg'],
    timedContext,
    { cwd: root },
  )
  const executable = detection.exitCode === 0 ? 'rg' : 'grep'
  const result = await collectCommand(
    env,
    buildGrepArgv(input, searchPath, executable),
    timedContext,
    { cwd: root },
  )
  if (result.exitCode > 1) throw new Error(result.text || `${executable} failed with exit code ${result.exitCode}`)

  return boundedResults(result.text, maxResults)
}

const findInWorkspace = async (
  input: FindInput,
  env: ReadonlyEnvironment,
  context: Context,
): Promise<string> => {
  const timedContext = withToolTimeout(context)
  const maxResults = checkedMaxResults(input.maxResults)
  if (input.maxDepth !== undefined && (!Number.isInteger(input.maxDepth) || input.maxDepth < 0)) {
    throw new Error('maxDepth must be a non-negative integer')
  }
  const { root, path: searchPath } = await resolveWorkspacePath(env, checkedPath(input.path), timedContext)
  const result = await collectCommand(env, buildFindArgv(input, searchPath), timedContext, { cwd: root })
  if (result.exitCode !== 0) throw new Error(result.text || `find failed with exit code ${result.exitCode}`)

  const marker = result.text.match(/\[output truncated; omitted \d+ bytes\]$/)?.[0]
  const pathOutput = marker === undefined ? result.text : result.text.slice(0, -marker.length - 1)
  const relativePaths = pathOutput
    .split('\n')
    .filter((entry) => entry !== '')
    .map((entry) => path.relative(root, entry) || '.')

  const output = [
    relativePaths.join('\n'),
    ...(marker === undefined ? [] : [marker]),
  ].filter((line) => line !== '').join('\n')

  return boundedResults(output, maxResults)
}

const listWorkspaceDirectory = async (
  input: LsInput,
  env: ReadonlyEnvironment,
  context: Context,
): Promise<string> => {
  const timedContext = withToolTimeout(context)
  const { path: directory } = await resolveWorkspacePath(env, checkedPath(input.path), timedContext)
  const result = await env.listDir(directory, timedContext)
  if (!result.ok) throw new Error(`Cannot list directory: ${result.error.code}`)

  const captured: CapturedOutput = { stdout: '', stderr: '', bytes: 0, omittedBytes: 0 }
  for (const { kind, name, size } of result.value) {
    appendCapped(captured, 'stdout', `${kind}\t${size}\t${name}\n`)
  }

  return capturedText(captured)
}

export const gitInWorkspace = async (
  input: GitInput,
  env: ReadonlyEnvironment,
  context: Context,
): Promise<string> => {
  const timedContext = withToolTimeout(context)
  const { root } = await resolveWorkspacePath(env, '.', timedContext)
  const args = input.args ?? []
  const separator = input.subcommand === 'branch' ? -1 : args.indexOf('--')
  const safeInput = separator === -1
    ? input
    : {
        ...input,
        args: [
          ...args.slice(0, separator + 1),
          ...(await Promise.all(args.slice(separator + 1).map(async (userPath) => {
            if (userPath.startsWith(':') || userPath.split(/[\\/]/).includes('..')) {
              throw new Error(`git path must remain inside /home/dev/workspace: ${userPath}`)
            }
            const absolute = path.resolve(root, userPath)
            if (!isInside(root, absolute)) {
              throw new Error('Path must remain inside /home/dev/workspace')
            }

            const canonical = await env.canonicalPath(absolute, timedContext)
            if (canonical.ok) {
              if (!isInside(root, canonical.value)) {
                throw new Error('Path must remain inside /home/dev/workspace')
              }

              return canonical.value
            }

            const parent = await env.canonicalPath(path.dirname(absolute), timedContext)
            if (!parent.ok || !isInside(root, parent.value)) {
              throw new Error('Cannot resolve git path inside /home/dev/workspace')
            }

            return absolute
          }))),
        ],
      }
  const result = await collectCommand(
    env,
    buildGitArgv(safeInput),
    timedContext,
    {
      cwd: root,
      env: {
        GIT_PAGER: 'cat',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_NO_LAZY_FETCH: '1',
      },
    },
  )
  if (result.exitCode !== 0) throw new Error(result.text || `git ${input.subcommand} failed with exit code ${result.exitCode}`)

  return result.text
}

const failedToolResult = (name: string, error: unknown) => ({
  output: [{ type: 'text' as const, text: `${name} failed: ${error instanceof Error ? error.message : String(error)}` }],
  isError: true,
})

const grepParameters = {
  type: 'object',
  properties: {
    pattern: { type: 'string' },
    path: { type: 'string', default: '.' },
    glob: { type: 'string' },
    ignoreCase: { type: 'boolean' },
    maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: DEFAULT_MAX_RESULTS },
  },
  required: ['pattern'],
  additionalProperties: false,
} as const

const findParameters = {
  type: 'object',
  properties: {
    path: { type: 'string', default: '.' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['file', 'dir'] },
    maxDepth: { type: 'integer', minimum: 0 },
    maxResults: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: DEFAULT_MAX_RESULTS },
  },
  additionalProperties: false,
} as const

const lsParameters = {
  type: 'object',
  properties: { path: { type: 'string', default: '.' } },
  additionalProperties: false,
} as const

const gitParameters = {
  type: 'object',
  properties: {
    subcommand: { type: 'string', enum: ['status', 'log', 'diff', 'show', 'blame', 'branch', 'remote'] },
    args: { type: 'array', items: { type: 'string' } },
  },
  required: ['subcommand'],
  additionalProperties: false,
} as const

const executeWithEnv = async (
  name: string,
  api: { readonly env: ExecutionEnv | undefined },
  run: (env: ReadonlyEnvironment) => Promise<string>,
) => {
  if (api.env === undefined) return failedToolResult(name, 'This tool requires a workspace container')

  try {
    return { output: [{ type: 'text' as const, text: await run(api.env) }] }
  } catch (error) {
    return failedToolResult(name, error)
  }
}

const grepTool = defineTool({
  name: 'grep',
  description: 'Search workspace files for matching lines with ripgrep or grep.',
  parameters: grepParameters,
  replay: 'safe',
  outputLimits: { maxBytes: OUTPUT_LIMIT_BYTES + 128, retain: 'head' },
  async execute(args, api, context) {
    return executeWithEnv('grep', api, (env) => grepInWorkspace(args as GrepInput, env, context))
  },
})

const findTool = defineTool({
  name: 'find',
  description: 'Find workspace files and directories by name, type, and depth.',
  parameters: findParameters,
  replay: 'safe',
  outputLimits: { maxBytes: OUTPUT_LIMIT_BYTES + 128, retain: 'head' },
  async execute(args, api, context) {
    return executeWithEnv('find', api, (env) => findInWorkspace(args as FindInput, env, context))
  },
})

const lsTool = defineTool({
  name: 'ls',
  description: 'List workspace directory entries with their type and size.',
  parameters: lsParameters,
  replay: 'safe',
  outputLimits: { maxBytes: OUTPUT_LIMIT_BYTES + 128, retain: 'head' },
  async execute(args, api, context) {
    return executeWithEnv('ls', api, (env) => listWorkspaceDirectory(args as LsInput, env, context))
  },
})

const gitTool = defineTool({
  name: 'git',
  description: 'Read repository status, history, diffs, file history, branches, and remotes.',
  parameters: gitParameters,
  replay: 'safe',
  outputLimits: { maxBytes: OUTPUT_LIMIT_BYTES + 128, retain: 'head' },
  async execute(args, api, context) {
    return executeWithEnv('git', api, (env) => gitInWorkspace(args as GitInput, env, context))
  },
})

/** The read-only workspace inspection tools use the environment but never write to it. */
export const createReadonlyToolsExtension = () =>
  defineExtension({ name: 'readonly-tools', tools: [grepTool, findTool, lsTool, gitTool] })
