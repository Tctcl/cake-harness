import { execFile } from 'node:child_process'
import { join } from 'node:path'

import type { DesiredTool, InstalledTool, ToolKind } from './contract.js'
import type { RecordedTool } from './record.js'

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000

export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>

type PackageTool = DesiredTool & { readonly kind: ToolKind; readonly name: string }

export interface InstallOptions {
  readonly run?: CommandRunner
  readonly home?: string
  /** One success/failure event per tool; output contains no credentials. */
  readonly onResult?: (tool: PackageTool, result: InstalledTool) => void
}

export interface InstallOutcome {
  readonly results: readonly InstalledTool[]
  readonly record: ReadonlyMap<string, RecordedTool>
}

const runCommand: CommandRunner = async (command, args) => await new Promise((resolve, reject) => {
  execFile(
    command,
    [...args],
    { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message))
      } else {
        resolve({ stdout, stderr })
      }
    },
  )
})

const isPackageTool = (tool: DesiredTool): tool is PackageTool =>
  (tool.kind === 'apt' || tool.kind === 'npm') && tool.name !== undefined

const packageSpec = (tool: PackageTool): string => {
  if (tool.version === 'latest') return tool.name
  return tool.kind === 'apt' ? `${tool.name}=${tool.version}` : `${tool.name}@${tool.version}`
}

const failure = (tool: PackageTool, error: unknown): InstalledTool => ({
  ...tool,
  path: null,
  source: 'installed',
  status: 'failed',
  error: error instanceof Error ? error.message : String(error),
})

const installed = (tool: PackageTool, version: string, path: string | null): InstalledTool => ({
  ...tool,
  version,
  path,
  source: 'installed',
  status: 'installed',
})

const npmVersion = (tool: PackageTool, output: string): string => {
  try {
    const parsed: unknown = JSON.parse(output)
    if (typeof parsed !== 'object' || parsed === null) return tool.version
    const dependencies = 'dependencies' in parsed ? parsed.dependencies : undefined
    if (typeof dependencies !== 'object' || dependencies === null) return tool.version
    const entry = Object.entries(dependencies).find(([name]) => name === tool.name)?.[1]
    if (typeof entry !== 'object' || entry === null) return tool.version
    const version = 'version' in entry ? entry.version : undefined
    return typeof version === 'string' ? version : tool.version
  } catch {
    return tool.version
  }
}

/**
 * Applies apt as one transaction (one update and install per boot), then npm one package at a time. A failed apt batch
 * or npm package is a reported result, never an exception that prevents later packages or SSH from starting.
 */
export const installPackages = async (
  desired: readonly DesiredTool[],
  previous: ReadonlyMap<string, RecordedTool>,
  options: InstallOptions = {},
): Promise<InstallOutcome> => {
  const run = options.run ?? runCommand
  const home = options.home ?? process.env['HOME'] ?? '/home/dev'
  const record = new Map(previous)
  const tools = desired.filter(isPackageTool)
  const results: InstalledTool[] = []
  const finish = (tool: PackageTool, result: InstalledTool): void => {
    results.push(result)
    options.onResult?.(tool, result)
    if (result.status === 'failed') record.delete(tool.id)
    else record.set(tool.id, { id: tool.id, version: result.version, path: result.path })
  }

  const apt = tools.filter((tool) => tool.kind === 'apt')
  if (apt.length > 0) {
    try {
      await run('sudo', ['apt-get', 'update'])
      await run('sudo', ['apt-get', 'install', '-y', ...apt.map(packageSpec)])
      for (const tool of apt) finish(tool, installed(tool, tool.version, null))
    } catch (error) {
      for (const tool of apt) finish(tool, failure(tool, error))
    }
  }

  for (const tool of tools.filter((candidate) => candidate.kind === 'npm')) {
    const path = join(home, '.local', 'lib', 'node_modules', tool.name)
    try {
      const current = await run('npm', ['ls', '--global', '--depth=0', '--json', tool.name])
      finish(tool, installed(tool, npmVersion(tool, current.stdout), path))
      continue
    } catch {
      // `npm ls` exits non-zero for an absent package. Installation below decides whether that is recoverable.
    }

    try {
      await run('npm', ['install', '--global', packageSpec(tool)])
      try {
        const current = await run('npm', ['ls', '--global', '--depth=0', '--json', tool.name])
        finish(tool, installed(tool, npmVersion(tool, current.stdout), path))
      } catch {
        // The install succeeded even if a follow-up probe could not pretty-print its local tree.
        finish(tool, installed(tool, tool.version, path))
      }
    } catch (error) {
      finish(tool, failure(tool, error))
    }
  }

  return { results, record }
}
