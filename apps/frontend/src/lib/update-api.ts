import { request } from './http.ts'

/** The update check: the release this install runs, and whether a newer one exists. */

export type ReleaseChannel = 'production' | 'staging'

export interface UpdateStatus {
  readonly channel: ReleaseChannel
  readonly current: string | null
  readonly latest: string | null
  /** The release page, when there is one to open. */
  readonly url: string | null
  /** `null` when the answer is not knowable: a checkout, or a staging install tracking a moving tag. */
  readonly available: boolean | null
  readonly checkedAt: string | null
  /** Why the last check failed; the version numbers above are then the previous answer. */
  readonly error: string | null
}

/** The last answer, without asking GitHub. */
export const getUpdateStatus = (): Promise<UpdateStatus> => request<UpdateStatus>('/updates')
