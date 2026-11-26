import type { DesiredTool } from './environment-repository.js'
import type { SecretReader } from '../secrets/ciphergate.js'

/** The wire documents `apps/agent` parses. Kept here rather than shared because the container parser is the authority. */
export interface ToolingDocument {
  readonly schemaVersion: 1
  readonly tools: readonly {
    readonly id: string
    readonly version: string
    readonly kind?: 'apt' | 'npm'
    readonly name?: string
  }[]
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

export interface GitIdentity {
  readonly name: string
  readonly email: string
}

export interface ManifestOptions {
  readonly tooling?: readonly DesiredTool[]
  readonly githubToken?: string | undefined
  readonly gitIdentity?: GitIdentity | undefined
}

/** The runtime floor stays managed by the image/reconciler; user packages are additional entries. */
const toolFloor = [{ id: 'node', version: '26.13.1' }] as const

const gitConfigValue = (value: string): string => JSON.stringify(value)

const gitConfig = (identity: GitIdentity | undefined, github: boolean): string => {
  const sections: string[] = []
  if (identity !== undefined) {
    const name = identity.name.trim() === '' ? '' : `\tname = ${gitConfigValue(identity.name)}\n`
    const email = identity.email.trim() === '' ? '' : `\temail = ${gitConfigValue(identity.email)}\n`
    if (name !== '' || email !== '') sections.push(`[user]\n${name}${email}`)
  }
  if (github) sections.push('[credential "https://github.com"]\n\thelper = !gh auth git-credential\n')

  return sections.join('\n')
}

const githubCredential = (value: string, config: string): Credential => ({
  id: 'github',
  env: { GH_TOKEN: value, GITHUB_TOKEN: value },
  files: [
    {
      path: '~/.config/gh/hosts.yml',
      mode: '0600',
      content: `github.com:\n  oauth_token: ${JSON.stringify(value)}\n  git_protocol: https\n`,
    },
    ...(config === '' ? [] : [{ path: '~/.gitconfig', mode: '0600', content: config }]),
  ],
})

/** Builds both boot documents. Secret values are returned only over the environment-token-protected manifest route. */
export const buildManifest = async (
  secrets: SecretReader,
  options: ManifestOptions = {},
): Promise<EnvironmentManifest> => {
  const storedGithub = options.githubToken ?? await secrets.read('GITHUB_TOKEN')
  const npmToken = await secrets.read('NPM_TOKEN')
  const config = gitConfig(options.gitIdentity, storedGithub !== undefined)
  const credentials: Credential[] = []

  if (storedGithub !== undefined) credentials.push(githubCredential(storedGithub, config))
  else if (config !== '') credentials.push({ id: 'git-identity', env: {}, files: [{ path: '~/.gitconfig', mode: '0600', content: config }] })
  if (npmToken !== undefined) {
    credentials.push({
      id: 'npm',
      env: {},
      files: [{
        path: '~/.npmrc',
        mode: '0600',
        content: `prefix=/home/dev/.local\n//registry.npmjs.org/:_authToken=${npmToken}\n`,
      }],
    })
  }

  return {
    tooling: {
      schemaVersion: 1,
      tools: [
        ...toolFloor,
        ...(options.tooling ?? []).map((tool) => ({
          id: `${tool.kind}:${tool.name}`,
          kind: tool.kind,
          name: tool.name,
          version: tool.version,
        })),
      ],
    },
    credentials: { schemaVersion: 1, credentials },
  }
}
