import { lstatSync, readFileSync } from 'node:fs'

export const RELEASE_MANIFEST_VERSION = 1 as const

export type ReleaseManifest = {
  version: typeof RELEASE_MANIFEST_VERSION
  tag: string
  commitSha: string
}

const RELEASE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/

export const assertValidReleaseTag = (tag: string) => {
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`)
  }
  return tag
}

export const parseReleaseManifest = (input: unknown): ReleaseManifest => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Release manifest must be an object.')
  }

  const keys = Object.keys(input).sort()
  if (keys.join(',') !== 'commitSha,tag,version') {
    throw new Error('Release manifest has unknown or missing fields.')
  }

  const value = input as Record<string, unknown>
  if (value.version !== RELEASE_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported release manifest version: ${String(value.version)}`
    )
  }
  if (typeof value.tag !== 'string') {
    throw new Error('Release manifest tag must be a string.')
  }
  if (typeof value.commitSha !== 'string') {
    throw new Error('Release manifest commitSha must be a string.')
  }

  return {
    version: RELEASE_MANIFEST_VERSION,
    tag: assertValidReleaseTag(value.tag),
    commitSha: normalizeCommitSha(value.commitSha)
  }
}

export const readReleaseManifest = (manifestPath: string) => {
  const stat = lstatSync(manifestPath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Release manifest must be a regular file, not a symlink.')
  }
  const source = readFileSync(manifestPath, 'utf8')
  return parseReleaseManifest(JSON.parse(source) as unknown)
}

export const normalizeCommitSha = (sha: string) => {
  const normalized = sha.trim().toLowerCase()
  if (!COMMIT_SHA_PATTERN.test(normalized)) {
    throw new Error(`Invalid release commit SHA: ${sha}`)
  }
  return normalized
}

export const verifyReleaseIdentity = ({
  expectedTag,
  releaseTag,
  headCommit,
  tagCommit,
  manifest
}: {
  expectedTag?: string
  releaseTag: string
  headCommit: string
  tagCommit?: string
  manifest: ReleaseManifest
}) => {
  const normalizedExpectedTag = expectedTag
    ? assertValidReleaseTag(expectedTag)
    : releaseTag
  const normalizedHead = normalizeCommitSha(headCommit)
  const normalizedTagCommit = tagCommit
    ? normalizeCommitSha(tagCommit)
    : normalizedHead

  if (releaseTag !== normalizedExpectedTag || manifest.tag !== releaseTag) {
    throw new Error(
      `Release tag mismatch: expected=${normalizedExpectedTag}, release=${releaseTag}, manifest=${manifest.tag}`
    )
  }
  if (
    normalizedHead !== normalizedTagCommit ||
    manifest.commitSha !== normalizedHead
  ) {
    throw new Error(
      `Release commit mismatch: HEAD=${normalizedHead}, tag=${normalizedTagCommit}, manifest=${manifest.commitSha}`
    )
  }

  return { tag: releaseTag, commitSha: normalizedHead }
}

export const getPinnedFetchArgs = (tag: string) => {
  const validTag = assertValidReleaseTag(tag)
  return [
    'fetch',
    '--no-tags',
    'origin',
    `+refs/tags/${validTag}:refs/kun-deploy/${validTag}`
  ]
}

export const getPinnedCommitRef = (tag: string) =>
  `refs/kun-deploy/${assertValidReleaseTag(tag)}^{commit}`
