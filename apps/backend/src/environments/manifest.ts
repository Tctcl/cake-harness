import type { SecretReader } from '../secrets/ciphergate.js'

/**
 * The two documents a development environment bootstraps from, in the shapes `apps/agent` parses. They are defined here
 * rather than shared through a package because the wire format is the contract: the container's parser is the authority,
 * and a field this module invented would fail there instead of here.
 */
export interface ToolingDocument {
  readonly schemaVersion: 1
  readonly tools: readonly { readonly id: string; readonly version: string }[]
}

export interface CredentialFile {
  readonly path: string
  readonly mode: string
  readonly content: string
}

export interface Credential {
  readonly id: string
  readonly env: Readonly<Record<string, string>>
  readonly files: readonly CredentialFile[]
}

export interface CredentialDocument {
  readonly schemaVersion: 1
  readonly credentials: readonly Credential[]
}

export interface EnvironmentManifest {
  readonly tooling: ToolingDocument
  readonly credentials: CredentialDocument
}

/**
 * What every environment gets, not what a user chose: the language versions this repository pins. Node matches
 * `.node-version`, so a workspace runs what CI runs rather than what its base image happened to ship.
 */
const desiredTooling: ToolingDocument = {
  schemaVersion: 1,
  tools: [{ id: 'node', version: '26.13.1' }],
}

interface Integration {
  readonly id: string
  /** The store's name for the value; the store refuses names that are not SCREAMING_SNAKE_CASE. */
  readonly secret: string
  /** The credential that carries `value` to the container. */
  readonly credential: (value: string) => Credential
}

/**
 * The integrations a workspace authenticates. The list is fixed until something edits it — the grant tables name what an
 * agent may use, not what a workspace holds — so a missing secret drops the credential instead of failing the manifest:
 * an environment without a GitHub token still has to boot.
 */
const integrations: readonly Integration[] = [
  {
    id: 'github',
    secret: 'GITHUB_TOKEN',
    credential: (value) => ({
      id: 'github',
      // `gh` reads either; both are set because tools disagree about which one they look for.
      env: { GH_TOKEN: value, GITHUB_TOKEN: value },
      files: [
        {
          path: '~/.gitconfig-gh',
          mode: '0600',
          content: '[credential "https://github.com"]\n\thelper = !gh auth git-credential\n',
        },
      ],
    }),
  },
  {
    id: 'npm',
    secret: 'NPM_TOKEN',
    credential: (value) => ({
      id: 'npm',
      env: {},
      files: [{ path: '~/.npmrc', mode: '0600', content: `//registry.npmjs.org/:_authToken=${value}\n` }],
    }),
  },
]

/**
 * Reads every credential out of the store and returns what an environment bootstraps from. A reader that is not
 * configured answers `undefined` for every name, so the same path serves an install without a store: it simply serves no
 * credentials instead of pretending to have some.
 */
export const buildManifest = async (secrets: SecretReader): Promise<EnvironmentManifest> => {
  const values = await Promise.all(integrations.map(async (integration) => {
    const value = await secrets.read(integration.secret)
    return value === undefined ? undefined : integration.credential(value)
  }))

  return {
    tooling: desiredTooling,
    credentials: { schemaVersion: 1, credentials: values.filter((entry) => entry !== undefined) },
  }
}
