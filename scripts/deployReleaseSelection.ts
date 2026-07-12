export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

export interface GitHubRelease {
  tag_name: string
  assets: GitHubReleaseAsset[]
}

export const getReleaseApiPath = (repo: string, releaseTag?: string) =>
  releaseTag
    ? `/repos/${repo}/releases/tags/${encodeURIComponent(releaseTag)}`
    : `/repos/${repo}/releases/latest`

export const selectReleaseAsset = (
  release: GitHubRelease,
  expectedTag?: string
) => {
  if (expectedTag && release.tag_name !== expectedTag) {
    throw new Error(
      `GitHub release tag mismatch: expected ${expectedTag}, received ${release.tag_name}`
    )
  }

  const asset = release.assets.find(({ name }) => name === 'release.tar.gz')
  if (!asset) {
    throw new Error(`No release.tar.gz found in release ${release.tag_name}`)
  }

  return asset.browser_download_url
}
