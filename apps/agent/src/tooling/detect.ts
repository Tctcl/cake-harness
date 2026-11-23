import { execFileSync } from 'node:child_process'

import type { InstalledTool } from './contract.js'

interface Detector {
  readonly command: string
  readonly args: readonly string[]
  readonly versionPattern: RegExp
}

/**
 * How to ask each tool for its version. Adding a language means adding an entry
 * here, not a new branch somewhere in the reconciler.
 */
export const DETECTORS: Readonly<Record<string, Detector>> = {
  node: { command: 'node', args: ['--version'], versionPattern: /\bv?(\d+\.\d+\.\d+)/ },
  python: { command: 'python3', args: ['--version'], versionPattern: /\b(\d+\.\d+\.\d+)/ },
  go: { command: 'go', args: ['version'], versionPattern: /\bgo(\d+\.\d+\.\d+)/ },
  rust: { command: 'rustc', args: ['--version'], versionPattern: /\brustc (\d+\.\d+\.\d+)/ },
  php: { command: 'php', args: ['--version'], versionPattern: /\bPHP (\d+\.\d+\.\d+)/ },
  ruby: { command: 'ruby', args: ['--version'], versionPattern: /\bruby (\d+\.\d+\.\d+)/ },
}

/** Pure half of detection: the tool output to a version, or `null` if unreadable. */
export const parseToolVersion = (id: string, output: string): string | null => {
  const detector = DETECTORS[id]
  if (!detector) {
    return null
  }
  return detector.versionPattern.exec(output)?.[1] ?? null
}

const run = (command: string, args: readonly string[]): string | null => {
  try {
    return execFileSync(command, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    // A missing binary and a failing version probe are the same fact here: the
    // tool is not usable, so reconciliation decides what to do about it.
    return null
  }
}

const resolveCommandPath = (command: string): string | null => {
  // `command` comes from the fixed table above, never from configuration.
  const found = run('sh', ['-c', `command -v ${command}`])?.trim()
  return found === undefined || found === null || found.length === 0 ? null : found
}

/**
 * Reports what is actually on disk. Everything found at this point came from the
 * image: the reconciler records its own installs in a manifest it can consult,
 * and that manifest does not exist yet.
 */
export const detectInstalled = (ids: readonly string[]): InstalledTool[] => {
  const installed: InstalledTool[] = []
  for (const id of ids) {
    const detector = DETECTORS[id]
    if (!detector) {
      continue
    }
    const output = run(detector.command, detector.args)
    const version = output === null ? null : parseToolVersion(id, output)
    if (version === null) {
      continue
    }
    installed.push({ id, version, path: resolveCommandPath(detector.command), source: 'image' })
  }
  return installed
}
