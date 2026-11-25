/**
 * Public SSH keys stored for the signed-in account. The generated private half is returned only by the create call.
 */

import { request } from './http.ts'

export interface SshKey {
  readonly id: string
  readonly name: string
  readonly publicKey: string
  readonly fingerprint: string
  readonly createdAt: string
}

export interface GeneratedSshKey {
  readonly key: SshKey
  readonly privateKey: string
  readonly filename: 'cake_ed25519'
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const listSshKeys = async (): Promise<SshKey[]> =>
  (await request<{ keys: SshKey[] }>('/account/ssh-keys')).keys

export const uploadSshKey = async (name: string, publicKey: string): Promise<SshKey> =>
  await request<SshKey>('/account/ssh-keys', json('POST', { name, publicKey }))

export const generateSshKey = async (name: string): Promise<GeneratedSshKey> =>
  await request<GeneratedSshKey>('/account/ssh-keys/generate', json('POST', { name }))

export const deleteSshKey = async (id: string): Promise<void> =>
  await request<void>(`/account/ssh-keys/${id}`, { method: 'DELETE' })
