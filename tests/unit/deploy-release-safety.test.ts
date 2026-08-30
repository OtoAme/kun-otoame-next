import { describe, expect, it } from 'vitest'
import {
  getPinnedCommitRef,
  getPinnedFetchArgs,
  parseReleaseManifest,
  verifyReleaseIdentity
} from '~/scripts/deployReleaseSafety'

const sha = '0123456789abcdef0123456789abcdef01234567'

describe('deployment release identity', () => {
  it('accepts an exact tag, source HEAD, fetched tag, and manifest match', () => {
    const manifest = parseReleaseManifest({
      version: 1,
      tag: 'v2026.08.31.1200',
      commitSha: sha
    })
    expect(
      verifyReleaseIdentity({
        expectedTag: manifest.tag,
        releaseTag: manifest.tag,
        headCommit: sha,
        tagCommit: sha,
        manifest
      })
    ).toEqual({ tag: manifest.tag, commitSha: sha })
  })

  it.each([
    { version: 2, tag: 'v1', commitSha: sha },
    { version: 1, tag: 'v1', commitSha: 'short' },
    { version: 1, tag: 'v1', commitSha: sha, extra: true }
  ])('rejects an incompatible manifest: %o', (manifest) => {
    expect(() => parseReleaseManifest(manifest)).toThrow()
  })

  it('rejects tag and commit mismatches', () => {
    const manifest = parseReleaseManifest({
      version: 1,
      tag: 'v1',
      commitSha: sha
    })
    expect(() =>
      verifyReleaseIdentity({
        expectedTag: 'v2',
        releaseTag: 'v1',
        headCommit: sha,
        tagCommit: sha,
        manifest
      })
    ).toThrow('Release tag mismatch')
    expect(() =>
      verifyReleaseIdentity({
        expectedTag: 'v1',
        releaseTag: 'v1',
        headCommit: sha,
        tagCommit: '1123456789abcdef0123456789abcdef01234567',
        manifest
      })
    ).toThrow('Release commit mismatch')
  })

  it('fetches only the exact validated tag into a deployment-only ref', () => {
    expect(getPinnedFetchArgs('v2026.08.31.1200')).toEqual([
      'fetch',
      '--no-tags',
      'origin',
      '+refs/tags/v2026.08.31.1200:refs/kun-deploy/v2026.08.31.1200'
    ])
    expect(getPinnedCommitRef('v2026.08.31.1200')).toBe(
      'refs/kun-deploy/v2026.08.31.1200^{commit}'
    )
    expect(() => getPinnedFetchArgs('../main')).toThrow('Invalid release tag')
  })
})
