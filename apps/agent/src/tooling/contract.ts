/**
 * The tooling contract between the backend and a development environment.
 *
 * The backend owns the desired state; the container owns the actual state. Both
 * sides speak the shapes below, so the reconciler and the future HTTP route share
 * one definition instead of guessing at each other.
 *
 * Two rules the shapes encode:
 *
 * - `version` is exact. `26.13.1`, never `^26` or `latest`; a range cannot be
 *   reconciled against, only resolved to something.
 * - `id` is a canonical slug (`node`, `python`, `go`, `rust`, `php`), not a
 *   package name, path or installer. Adding a language means adding an `id` the
 *   reconciler knows how to install, never a new fenced-in section of this
 *   contract.
 */

/** What the backend asks for. Served to a container at startup. */
export interface ToolingConfig {
  /**
   * Bumped only on a breaking change to these shapes. A reader that sees a
   * version it does not know must refuse rather than guess.
   */
  readonly schemaVersion: 1
  readonly tools: readonly DesiredTool[]
}

/** One requested tool at one exact version. */
export interface DesiredTool {
  readonly id: string
  /** Exact released version, e.g. `26.13.1`. */
  readonly version: string
}

/** What the container reports back. Desired state is never overwritten by this. */
export interface ToolingState {
  readonly schemaVersion: 1
  /** ISO 8601 instant the report was produced. */
  readonly reportedAt: string
  readonly tools: readonly InstalledTool[]
}

/** One tool that is actually present on disk. */
export interface InstalledTool extends DesiredTool {
  /**
   * Where the version was found, or `null` when the tool is on `PATH` but its
   * install location cannot be determined.
   */
  readonly path: string | null
  /** `image` when the base image shipped it, `installed` when reconciliation added it. */
  readonly source: 'image' | 'installed'
}
