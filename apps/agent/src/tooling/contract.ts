/** Desired and actual tooling shared with the backend over the environment manifest/state routes. */
export interface ToolingConfig {
  readonly schemaVersion: 1
  readonly tools: readonly DesiredTool[]
}

export type ToolKind = 'apt' | 'npm'
export type ToolStatus = 'installed' | 'failed' | 'missing'

/** The image floor has only an id/version; user packages also name their installer and package. */
export interface DesiredTool {
  readonly id: string
  /** Exact released version, or `latest` for the package source's current version. */
  readonly version: string
  readonly kind?: ToolKind
  readonly name?: string
}

export interface ToolingState {
  readonly schemaVersion: 1
  readonly reportedAt: string
  readonly tools: readonly InstalledTool[]
}

/** One observed outcome. Older reports omit `status`, which means `installed`. */
export interface InstalledTool extends DesiredTool {
  readonly path: string | null
  readonly source: 'image' | 'installed'
  readonly status?: ToolStatus
  /** Why installation failed; never included for a successful/missing result. */
  readonly error?: string
}
