/**
 * How to reach a workspace's container over SSH, and which of its listening ports can be forwarded over that connection.
 */

import { request } from './http.ts'

export interface SshAccess {
  /** `ssh://…` with the user, host and port filled in. */
  readonly command: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly running: boolean
}

export interface SshPort {
  readonly port: number
  readonly command: string
}

export const getSshAccess = async (environmentId: string): Promise<SshAccess | null> =>
  await request<SshAccess | null>(`/environments/${environmentId}/ssh`)

export const listSshPorts = async (environmentId: string): Promise<SshPort[]> =>
  (await request<{ ports: SshPort[] }>(`/environments/${environmentId}/ports`)).ports
