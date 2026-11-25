/**
 * How to reach a workspace's container over SSH, and the tunnels that currently forward through it. A tunnel is the
 * container's, not the browser's: the agent process is what holds it open, so the list is read from there.
 */

import { request } from './http.ts'

export interface SshAccess {
  /** `ssh://…` with the user, host and port filled in. */
  readonly command: string
  readonly host: string
  readonly port: number
  readonly user: string
}

export interface SshTunnel {
  readonly id: string
  /** The command that establishes it again, e.g. `ssh -L 5432:localhost:5432 …`. */
  readonly command: string
  readonly localPort: number
  readonly remotePort: number
}

export const getSshAccess = async (environmentId: string): Promise<SshAccess | null> =>
  await request<SshAccess | null>(`/environments/${environmentId}/ssh`)

export const listSshTunnels = async (environmentId: string): Promise<SshTunnel[]> =>
  (await request<{ tunnels: SshTunnel[] }>(`/environments/${environmentId}/ssh/tunnels`)).tunnels
