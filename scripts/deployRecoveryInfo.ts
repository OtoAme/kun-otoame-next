import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { validateStandaloneRuntime } from './deployPm2'
import { readReleaseManifest } from './deployReleaseSafety'
import {
  assertReleasePath,
  getCurrentDeployRelease,
  getPreviousDeployRelease,
  isImmutableDeployReleaseId,
  readActivationJournal,
  type DeploySlotPaths
} from './deploySlots'

const readRecoveryReleaseIdentity = (
  paths: DeploySlotPaths,
  releaseId: string
) => {
  if (
    releaseId !== 'legacy-initial' &&
    !isImmutableDeployReleaseId(releaseId)
  ) {
    throw new Error(
      'Choose a concrete managed release ID, not a path or pointer.'
    )
  }
  const releasePath = assertReleasePath(
    paths,
    join(paths.releasesRoot, releaseId)
  )
  let tag = 'unknown (legacy source; operator verification required)'
  let commitSha = 'unknown'
  if (releaseId !== 'legacy-initial') {
    const manifest = readReleaseManifest(
      join(releasePath, 'release-manifest.json')
    )
    if (releaseId !== `${manifest.commitSha}-${manifest.tag}`) {
      throw new Error('Managed release ID does not match its manifest.')
    }
    tag = manifest.tag
    commitSha = manifest.commitSha
  }
  return { releaseId, releasePath, tag, commitSha }
}

export const inspectRecoveryRelease = (
  paths: DeploySlotPaths,
  releaseId: string
) => {
  const release = readRecoveryReleaseIdentity(paths, releaseId)
  validateStandaloneRuntime(release.releasePath)
  return release
}

export const listRecoveryReleases = (paths: DeploySlotPaths) => {
  if (
    !lstatSync(paths.releasesRoot).isDirectory() ||
    realpathSync(paths.releasesRoot) !== paths.releasesRoot
  )
    throw new Error('Managed releases root must be a real directory.')
  return readdirSync(paths.releasesRoot)
    .sort()
    .flatMap((releaseId) => {
      if (
        releaseId !== 'legacy-initial' &&
        !isImmutableDeployReleaseId(releaseId)
      )
        return []
      try {
        return [{ ...inspectRecoveryRelease(paths, releaseId), error: '' }]
      } catch (error) {
        return [
          {
            releaseId,
            releasePath: join(paths.releasesRoot, releaseId),
            tag: 'unavailable',
            commitSha: 'unknown',
            error: error instanceof Error ? error.message : 'Invalid runtime'
          }
        ]
      }
    })
}

export const formatRecoveryState = (paths: DeploySlotPaths) => {
  const lines = ['Deployment state (pointers alone do not prove readiness):']
  for (const [label, read] of [
    ['current', getCurrentDeployRelease],
    ['previous', getPreviousDeployRelease]
  ] as const) {
    try {
      const releasePath = read(paths)
      const release = readRecoveryReleaseIdentity(paths, basename(releasePath))
      lines.push(
        `${label}: ${release.releaseId}; tag=${release.tag}; commit=${release.commitSha}; path=${releasePath}`
      )
    } catch (error) {
      lines.push(
        `${label}: unavailable (${error instanceof Error ? error.message : 'invalid pointer'})`
      )
    }
  }
  try {
    const journal = readActivationJournal(paths)
    if (journal) {
      lines.push(
        `activation: ${journal.failure ? 'failed' : 'interrupted/unresolved'}; candidate=${journal.candidate}; original=${journal.oldCurrent}; stopped=${journal.failure?.stopConfirmed === true ? 'confirmed' : '未能确认停止'}`
      )
      try {
        const release = readRecoveryReleaseIdentity(
          paths,
          basename(journal.candidate)
        )
        lines.push(
          `candidate: ${release.releaseId}; tag=${release.tag}; commit=${release.commitSha}; path=${release.releasePath}; NOT verified active`
        )
      } catch (error) {
        lines.push(
          `candidate: unavailable (${error instanceof Error ? error.message : 'invalid release'})`
        )
      }
      if (journal.failure) lines.push(`failure: ${journal.failure.message}`)
    } else {
      lines.push('activation: no unresolved journal')
    }
  } catch {
    lines.push(
      'activation: unreadable/invalid journal; retain it and inspect manually before recovery'
    )
  }
  lines.push(
    'Database was not restored. The operator must verify schema and data compatibility for the selected release; age or presence does not establish compatibility.'
  )
  lines.push('Inspect: pnpm deploy:rollback --list')
  lines.push('Preview: pnpm deploy:rollback --preview <release-id>')
  lines.push('Choose and confirm: pnpm deploy:rollback')
  lines.push(
    'Explicit non-TTY recovery: pnpm deploy:rollback --release <release-id> --confirm <same-release-id>'
  )
  return lines.join('\n')
}

export const recoverySelectionSnapshot = (
  paths: DeploySlotPaths,
  releaseId: string
) => {
  const release = inspectRecoveryRelease(paths, releaseId)
  const hash = createHash('sha256')
  const pending = [release.releasePath]
  while (pending.length) {
    const target = pending.pop()!
    const stat = lstatSync(target, { bigint: true })
    hash.update(
      `${target}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}\n`
    )
    if (stat.isSymbolicLink()) hash.update(readlinkSync(target))
    else if (stat.isDirectory()) {
      pending.push(
        ...readdirSync(target)
          .sort()
          .map((entry) => join(target, entry))
      )
    }
  }
  for (const pointer of [paths.current, paths.previous, paths.journal]) {
    try {
      const stat = lstatSync(pointer)
      hash.update(`${pointer}:${stat.ino}:${stat.ctimeMs}:`)
      hash.update(
        stat.isSymbolicLink() ? readlinkSync(pointer) : readFileSync(pointer)
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      hash.update(`${pointer}:absent`)
    }
  }
  return { release, fingerprint: hash.digest('hex') }
}
