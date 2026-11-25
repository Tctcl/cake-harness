import { z } from 'zod'

/** A published release: the version tag and where a human can read about it. */
export interface Release {
  readonly tag: string
  readonly url: string
}

/** Where "the newest release" comes from. An interface so a test answers without the network. */
export interface ReleaseSource {
  latest(): Promise<Release>
}

const REPOSITORY = 'Tctcl/tlabs-platform'

// The API answers a lot; only these two are promised to the caller, so an unexpected shape is a failed check rather
// than a half-read release.
const releaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.url(),
})

/** Ten seconds: a slow answer must not hold the interval, and the next check is the retry. */
const TIMEOUT_MS = 10_000

/**
 * The newest release of this repository, as GitHub reports it. Unauthenticated: sixty requests an hour is far more
 * than a fifteen-minute interval needs, and a token would be another secret to install.
 */
export const createGithubReleases = (fetchImpl: typeof fetch = fetch): ReleaseSource => ({
  async latest() {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for the latest release`)
    }

    const release = releaseSchema.parse(await response.json())

    return { tag: release.tag_name, url: release.html_url }
  },
})
