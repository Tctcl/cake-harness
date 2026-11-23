/**
 * The credential contract between the backend and a development environment.
 *
 * Deliberately a separate document from the tooling config: credentials rotate
 * on a different clock, and coupling them would make every rotation trigger a
 * full tooling reconcile. The backend resolves these values from CipherGate and
 * hands them over; the container never talks to CipherGate itself.
 *
 * Two channels, because env vars alone do not configure the tools that matter.
 * `gh` reads `GH_TOKEN`, but git over HTTPS needs a credential helper written to
 * `~/.gitconfig`, npm needs `~/.npmrc`, cargo needs `~/.cargo/credentials.toml`.
 */
export interface CredentialDocument {
  readonly schemaVersion: 1
  readonly credentials: readonly Credential[]
}

/** One secret-bearing tool configuration, e.g. everything GitHub needs. */
export interface Credential {
  readonly id: string
  /** Variables to place in the development user's environment. */
  readonly env: Readonly<Record<string, string>>
  /** Files to write for tools that do not read the environment. */
  readonly files: readonly CredentialFile[]
}

export interface CredentialFile {
  /** Absolute path, or a path starting with `~/` under the development user's home. */
  readonly path: string
  /** Octal permission string, e.g. `0600`. */
  readonly mode: string
  readonly content: string
}
