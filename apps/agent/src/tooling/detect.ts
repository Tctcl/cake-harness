import { execFileSync } from 'node:child_process'

import type { InstalledTool } from './contract.js'
import type { RecordedTool } from './record.js'

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
 * Reports what is actually on disk. A tool the installer recorded keeps that
 * provenance even though the probe still decides its version: the record says
 * where it came from, the probe says what is there now. Everything else was
 * shipped by the base image.
 */
export const detectInstalled = (
  ids: readonly string[],
  record: ReadonlyMap<string, RecordedTool>,
): InstalledTool[] => {
  const installed: InstalledTool[] = []
  for (const id of ids) {
    const detector = DETECTORS[id]
    if (!detector) {
      continue
    }
    const recorded = record.get(id)
    const output = run(detector.command, detector.args)
    const version = output === null ? null : parseToolVersion(id, output)
    if (version === null) {
      continue
    }
    installed.push({
      id,
      version,
      path: resolveCommandPath(detector.command) ?? recorded?.path ?? null,
      source: recorded === undefined ? 'image' : 'installed',
      status: 'installed',
    })
  }
  return installed
}
