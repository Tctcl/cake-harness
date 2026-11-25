import type { DesiredTool, InstalledTool, ToolingConfig, ToolingState } from './contract.js'

/** A desired tool that is installed at a different version. */
export interface VersionMismatch {
  readonly desired: DesiredTool
  readonly installed: InstalledTool
}

export interface ReconcilePlan {
  /** Desired, not installed at all. */
  readonly install: readonly DesiredTool[]
  /** Desired, installed at another version. */
  readonly replace: readonly VersionMismatch[]
  /** Desired and already at the exact version. */
  readonly keep: readonly DesiredTool[]
  /**
   * Installed but not desired. The plan only names them: whether an extra tool is
   * removed or left alone is a policy question that has not been decided, and
   * deleting somebody's toolchain by omission would be a poor default.
   */
  readonly extra: readonly InstalledTool[]
}

/**
 * Turns desired and actual state into work to do. Pure on purpose: this is the
 * part worth testing exhaustively, and it must not touch the network or the disk.
 */
export const planReconcile = (desired: ToolingConfig, actual: ToolingState): ReconcilePlan => {
  const installedById = new Map(actual.tools.map((tool) => [tool.id, tool]))
  const desiredIds = new Set(desired.tools.map((tool) => tool.id))

  const install: DesiredTool[] = []
  const replace: VersionMismatch[] = []
  const keep: DesiredTool[] = []

  for (const tool of desired.tools) {
    const installed = installedById.get(tool.id)
    if (!installed) {
      install.push(tool)
    } else if (installed.version === tool.version) {
      keep.push(tool)
    } else {
      replace.push({ desired: tool, installed })
    }
  }

  const extra = actual.tools.filter((tool) => !desiredIds.has(tool.id))

  return { install, replace, keep, extra }
}
