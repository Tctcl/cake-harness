/**
 * The keys the user owns. A credential is written once and listed without its secret: the page shows what a key is for,
 * never what it contains.
 */

import { request } from './http.ts'

/** What a credential is for. The two kinds carry different fields, and the form asks for whichever applies. */
export type CredentialKind = 'opencode-go' | 'mcp' | 'github-token'

export interface Credential {
  readonly id: string
  readonly kind: CredentialKind
  readonly name: string
  /** ISO 8601, or `null` for a key that does not expire. */
  readonly expiresAt: string | null
  /** The account an `opencode-go` key belongs to. */
  readonly email: string | null
  /** Free text about an `mcp` key, such as where it came from. */
  readonly note: string | null
  /** The MCP server an `mcp` key answers for: what the MCP editor filters the dropdown by. */
  readonly mcpId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CredentialInput {
  readonly kind: CredentialKind
  readonly name: string
  readonly value: string
  readonly expiresAt?: string | null
  readonly email?: string | null
  readonly note?: string | null
  readonly mcpId?: string | null
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const listCredentials = async (): Promise<Credential[]> =>
  (await request<{ credentials: Credential[] }>('/credentials')).credentials

export const createCredential = async (input: CredentialInput): Promise<Credential> =>
  await request<Credential>('/credentials', json('POST', input))

export const deleteCredential = async (id: string): Promise<void> =>
  await request<void>(`/credentials/${id}`, { method: 'DELETE' })
