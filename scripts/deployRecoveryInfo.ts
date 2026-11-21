import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
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
  let tag = '未知（历史运行目录；需人工核对来源）'
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
            tag: '无法读取',
            commitSha: 'unknown',
            error: error instanceof Error ? error.message : 'Invalid runtime'
          }
        ]
      }
    })
}

const readRecoveryRoles = (paths: DeploySlotPaths) => {
  const roles: {
    candidate?: string
    candidateFailed?: boolean
    successful?: string
    previous?: string
  } = {}
  try {
    const journal = readActivationJournal(paths)
    if (journal) {
      roles.candidate = assertReleasePath(
        paths,
        resolve(paths.deployRoot, journal.candidate)
      )
      roles.successful = assertReleasePath(
        paths,
        resolve(paths.deployRoot, journal.oldCurrent)
      )
      roles.candidateFailed = journal.failure !== undefined
    } else {
      roles.successful = getCurrentDeployRelease(paths)
    }
  } catch {
    // Invalid deployment state remains visible; activation validates it again.
  }
  try {
    roles.previous = getPreviousDeployRelease(paths)
  } catch {
    // A missing pointer must not hide otherwise inspectable release entries.
  }
  return roles
}

const describeRecoveryRole = (
  roles: ReturnType<typeof readRecoveryRoles>,
  releasePath: string
) => {
  const labels: string[] = []
  if (releasePath === roles.candidate)
    labels.push(
      roles.candidateFailed
        ? '本次失败版本（可重试）'
        : '本次未决版本（可重试）'
    )
  if (releasePath === roles.successful)
    labels.push('最近成功版本（指针不等于在线）')
  return {
    status: labels.length
      ? labels.join('；')
      : releasePath === roles.previous
        ? '更早版本'
        : '其他保留版本',
    rank:
      releasePath === roles.candidate
        ? 0
        : releasePath === roles.successful
          ? 1
          : releasePath === roles.previous
            ? 2
            : 3
  }
}

export const getRecoveryReleaseStatus = (
  paths: DeploySlotPaths,
  releasePath: string
) => describeRecoveryRole(readRecoveryRoles(paths), releasePath).status

export const listRecoveryChoices = (paths: DeploySlotPaths) => {
  const roles = readRecoveryRoles(paths)
  return listRecoveryReleases(paths)
    .map((release) => ({
      ...release,
      ...describeRecoveryRole(roles, release.releasePath)
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank || left.releaseId.localeCompare(right.releaseId)
    )
}

export const formatRecoveryIdentity = ({
  tag,
  commitSha
}: {
  tag: string
  commitSha: string
}) =>
  `标签：${tag} | 提交：${commitSha === 'unknown' ? '未知' : commitSha.slice(0, 8)}`

export const formatRecoveryNextSteps = () =>
  [
    '下一步：',
    '  查看版本：pnpm deploy:rollback --list',
    '  交互恢复：pnpm deploy:rollback',
    '  详细预览：pnpm deploy:rollback --preview <编号或发布ID>',
    '  非交互恢复：pnpm deploy:rollback --release <发布ID> --confirm <同一发布ID>'
  ].join('\n')

export const formatRecoveryState = (
  paths: DeploySlotPaths,
  { includeCommands = true } = {}
) => {
  const lines = ['部署恢复状态（版本指针不等于在线）：']
  for (const [label, read] of [
    ['当前指针', getCurrentDeployRelease],
    ['上一版指针', getPreviousDeployRelease]
  ] as const) {
    try {
      const releasePath = read(paths)
      const release = readRecoveryReleaseIdentity(paths, basename(releasePath))
      lines.push(`${label}：${formatRecoveryIdentity(release)}`)
    } catch {
      lines.push(`${label}：无法核对，请先检查部署布局`)
    }
  }
  try {
    const journal = readActivationJournal(paths)
    if (journal) {
      lines.push(
        `本次激活：${journal.failure ? '失败' : '中断或未决'}`,
        `候选进程：${journal.failure?.stopConfirmed === true ? '已确认停止' : '未能确认停止'}`
      )
      try {
        const release = readRecoveryReleaseIdentity(
          paths,
          basename(journal.candidate)
        )
        lines.push(`本次候选：${formatRecoveryIdentity(release)}`)
      } catch {
        lines.push('本次候选：无法核对，请先检查发布目录')
      }
      lines.push('激活与失败记录：.deploy/activation-journal.json')
    } else {
      lines.push('本次激活：没有未决记录')
    }
  } catch {
    lines.push(
      '本次激活：记录无法读取或已损坏；请保留 .deploy/activation-journal.json 并人工检查'
    )
  }
  lines.push(
    '恢复只启动所选应用版本，数据库不会恢复；确认前须核对所选版本与数据库的兼容性。'
  )
  if (includeCommands) lines.push('', formatRecoveryNextSteps())
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
