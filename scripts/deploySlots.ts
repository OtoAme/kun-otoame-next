import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { resolvePrismaClientRuntimePaths } from './prismaClientRuntimePaths'

export type DeploySlotPaths = {
  deployRoot: string
  releasesRoot: string
  current: string
  previous: string
  journal: string
  standaloneLink: string
  legacyStandalone: string
  legacyStandaloneBackup: string
  rootPrisma: string
  rootNodeModules: string
}

export type ActivationJournal = {
  version: 1 | 2
  oldCurrent: string
  candidate: string
  failure?: { message: string; stopConfirmed: boolean }
}

const pathEntryExists = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export const getDeploySlotPaths = (projectRoot: string): DeploySlotPaths => {
  const resolvedProjectRoot = realpathSync(resolve(projectRoot))
  const nextRoot = resolve(resolvedProjectRoot, '.next')
  const deployRoot = join(resolvedProjectRoot, '.deploy')
  return {
    deployRoot,
    releasesRoot: join(deployRoot, 'releases'),
    current: join(deployRoot, 'current'),
    previous: join(deployRoot, 'previous'),
    journal: join(deployRoot, 'activation-journal.json'),
    standaloneLink: join(nextRoot, 'standalone'),
    legacyStandalone: join(nextRoot, 'standalone'),
    legacyStandaloneBackup: join(deployRoot, 'legacy-standalone-backup'),
    rootPrisma: resolve(resolvedProjectRoot, 'prisma'),
    rootNodeModules: resolve(resolvedProjectRoot, 'node_modules')
  }
}

const assertDirectory = (path: string, label: string) => {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`${label} is missing or is not a directory: ${path}`)
  }
}

const isWithin = (parent: string, child: string) => {
  const nested = relative(parent, child)
  return nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..')
}

export const assertReleasePath = (
  paths: DeploySlotPaths,
  releasePath: string
) => {
  for (const root of [paths.deployRoot, paths.releasesRoot]) {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) {
      throw new Error(`Deployment root must be a real directory: ${root}`)
    }
  }
  assertDirectory(releasePath, 'Deployment release')
  const releasesRoot = realpathSync(paths.releasesRoot)
  const resolved = realpathSync(releasePath)
  if (
    !isWithin(releasesRoot, resolved) ||
    dirname(resolved) !== releasesRoot ||
    resolved !== resolve(releasePath) ||
    (basename(resolved) !== 'legacy-initial' &&
      !isImmutableDeployReleaseId(basename(resolved)))
  ) {
    throw new Error(
      `Deployment pointer escapes the immutable release root: ${releasePath}`
    )
  }
  return resolved
}

const atomicSymlink = (linkPath: string, targetPath: string) => {
  const temporary = `${linkPath}.next-${process.pid}`
  rmSync(temporary, { force: true })
  symlinkSync(relative(dirname(linkPath), targetPath), temporary, 'dir')
  renameSync(temporary, linkPath)
}

const ensureStandaloneCompatibilityLink = (paths: DeploySlotPaths) => {
  const expectedTarget = paths.current
  mkdirSync(dirname(paths.standaloneLink), { recursive: true })
  if (pathEntryExists(paths.standaloneLink)) {
    const stat = lstatSync(paths.standaloneLink)
    if (stat.isSymbolicLink()) {
      atomicSymlink(paths.standaloneLink, expectedTarget)
      return
    }
    if (!stat.isDirectory()) {
      throw new Error('Legacy standalone path is not a directory or symlink.')
    }
    if (pathEntryExists(paths.legacyStandaloneBackup)) {
      throw new Error(
        'Legacy standalone backup already exists; inspect it manually.'
      )
    }
    renameSync(paths.standaloneLink, paths.legacyStandaloneBackup)
  }

  try {
    atomicSymlink(paths.standaloneLink, expectedTarget)
  } catch (error) {
    if (
      !pathEntryExists(paths.standaloneLink) &&
      pathEntryExists(paths.legacyStandaloneBackup)
    ) {
      renameSync(paths.legacyStandaloneBackup, paths.standaloneLink)
    }
    throw error
  }
}

const readReleasePointer = (paths: DeploySlotPaths, linkPath: string) => {
  if (!pathEntryExists(linkPath) || !lstatSync(linkPath).isSymbolicLink()) {
    throw new Error(
      `Deployment pointer is missing or is not a symlink: ${linkPath}`
    )
  }
  const target = resolve(dirname(linkPath), readlinkSync(linkPath))
  return assertReleasePath(paths, target)
}

const writeJournal = (paths: DeploySlotPaths, journal: ActivationJournal) => {
  const temporary = `${paths.journal}.next-${process.pid}`
  rmSync(temporary, { force: true })
  writeFileSync(temporary, `${JSON.stringify(journal)}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  renameSync(temporary, paths.journal)
}

export const readActivationJournal = (
  paths: DeploySlotPaths
): ActivationJournal | null => {
  if (!pathEntryExists(paths.journal)) return null
  if (!lstatSync(paths.journal).isFile()) {
    throw new Error(
      'Deployment activation journal is not a regular file; inspect it without deleting it.'
    )
  }
  const value = JSON.parse(
    readFileSync(paths.journal, 'utf8')
  ) as ActivationJournal
  if (
    !value ||
    typeof value !== 'object' ||
    ![1, 2].includes(value.version) ||
    typeof value.oldCurrent !== 'string' ||
    typeof value.candidate !== 'string' ||
    Object.keys(value).some(
      (key) => !['version', 'oldCurrent', 'candidate', 'failure'].includes(key)
    ) ||
    (value.version === 1 && value.failure !== undefined) ||
    (value.failure !== undefined &&
      (!value.failure ||
        typeof value.failure !== 'object' ||
        typeof value.failure.message !== 'string' ||
        typeof value.failure.stopConfirmed !== 'boolean' ||
        Object.keys(value.failure).sort().join(',') !==
          'message,stopConfirmed'))
  ) {
    throw new Error(
      'Deployment activation journal is invalid; inspect it without deleting it.'
    )
  }
  return value
}

export const assertNoPendingActivation = (paths: DeploySlotPaths) => {
  if (pathEntryExists(paths.journal)) {
    throw new Error(
      'Unresolved deployment activation. No automatic startup or recovery was attempted. Run pnpm deploy:rollback --list, then pnpm deploy:rollback to explicitly choose and confirm a managed release. Database was not restored; verify target compatibility before recovery.'
    )
  }
}

const journalReleasePath = (paths: DeploySlotPaths, relativePath: string) =>
  assertReleasePath(paths, resolve(paths.deployRoot, relativePath))

const relinkLegacyAbsoluteSymlinks = (
  paths: DeploySlotPaths,
  releasePath: string
) => {
  // Releases adopted before verbatim symlink copies carry pnpm links rewritten
  // to absolute paths under the mutable legacy standalone locations. Point them
  // back inside the immutable release so activating another release cannot
  // redirect or break them.
  const legacyPrefixes = [
    paths.legacyStandalone,
    paths.legacyStandaloneBackup
  ].map((prefix) => `${prefix}${sep}`)
  const pending = [releasePath]
  while (pending.length) {
    const directory = pending.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const linkPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(linkPath)
        continue
      }
      if (!entry.isSymbolicLink()) continue
      const target = readlinkSync(linkPath)
      const prefix = legacyPrefixes.find((candidate) =>
        target.startsWith(candidate)
      )
      if (!prefix) continue
      const inside = join(releasePath, target.slice(prefix.length))
      if (!pathEntryExists(inside)) {
        throw new Error(
          `Legacy release link target is missing inside the release: ${relative(releasePath, linkPath)}`
        )
      }
      atomicSymlink(linkPath, inside)
    }
  }
}

export const adoptLegacyDeploySlot = (paths: DeploySlotPaths) => {
  mkdirSync(paths.releasesRoot, { recursive: true })
  if (pathEntryExists(paths.current)) {
    const current = readReleasePointer(paths, paths.current)
    if (!pathEntryExists(paths.previous)) atomicSymlink(paths.previous, current)
    const previous = readReleasePointer(paths, paths.previous)
    relinkLegacyAbsoluteSymlinks(paths, current)
    if (previous !== current) relinkLegacyAbsoluteSymlinks(paths, previous)
    ensureStandaloneCompatibilityLink(paths)
    return current
  }

  const legacySource = pathEntryExists(paths.legacyStandalone)
    ? paths.legacyStandalone
    : paths.legacyStandaloneBackup
  assertDirectory(legacySource, 'Legacy standalone deployment')
  const staged = join(paths.deployRoot, `legacy-staging-${process.pid}`)
  const release = join(paths.releasesRoot, 'legacy-initial')
  rmSync(staged, { recursive: true, force: true })

  if (!existsSync(release)) {
    cpSync(legacySource, staged, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true
    })
    const stagedNodeModules = join(staged, 'node_modules')
    const { generatedPackage } =
      resolvePrismaClientRuntimePaths(stagedNodeModules)
    const flattenedGeneratedPackage = join(stagedNodeModules, '.prisma')
    if (realpathSync(generatedPackage) !== resolve(flattenedGeneratedPackage)) {
      rmSync(flattenedGeneratedPackage, { recursive: true, force: true })
      cpSync(generatedPackage, flattenedGeneratedPackage, {
        recursive: true,
        dereference: true
      })
    }
    if (!existsSync(join(staged, 'prisma'))) {
      cpSync(paths.rootPrisma, join(staged, 'prisma'), {
        recursive: true,
        dereference: true
      })
    }
    renameSync(staged, release)
  }

  const validRelease = assertReleasePath(paths, release)
  atomicSymlink(paths.current, validRelease)
  atomicSymlink(paths.previous, validRelease)
  ensureStandaloneCompatibilityLink(paths)
  return validRelease
}

export const isImmutableDeployReleaseId = (releaseId: string) =>
  /^[0-9a-f]{40}-[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(releaseId)

export const installCandidateRelease = (
  paths: DeploySlotPaths,
  candidatePath: string,
  releaseId: string
) => {
  if (!isImmutableDeployReleaseId(releaseId)) {
    throw new Error(`Invalid immutable release ID: ${releaseId}`)
  }
  assertDirectory(candidatePath, 'Candidate deployment release')
  const releasePath = join(paths.releasesRoot, releaseId)
  mkdirSync(paths.releasesRoot, { recursive: true })

  if (existsSync(releasePath)) {
    rmSync(candidatePath, { recursive: true, force: true })
    return assertReleasePath(paths, releasePath)
  }
  renameSync(candidatePath, releasePath)
  return assertReleasePath(paths, releasePath)
}

export const beginCandidateActivation = (
  paths: DeploySlotPaths,
  candidateRelease: string,
  explicitRecovery = false
) => {
  if (!explicitRecovery) assertNoPendingActivation(paths)
  const pending = readActivationJournal(paths)
  const oldCurrent = pending
    ? journalReleasePath(paths, pending.oldCurrent)
    : adoptLegacyDeploySlot(paths)
  const candidate = assertReleasePath(paths, candidateRelease)
  if (pending) {
    journalReleasePath(paths, pending.candidate)
    const history = join(paths.deployRoot, 'activation-history')
    mkdirSync(history, { recursive: true, mode: 0o700 })
    if (
      !lstatSync(history).isDirectory() ||
      realpathSync(history) !== history
    ) {
      throw new Error('Activation history must be a real directory.')
    }
    writeFileSync(
      join(history, `${Date.now()}-${process.pid}-${randomUUID()}.json`),
      `${JSON.stringify(pending)}\n`,
      { flag: 'wx', mode: 0o600 }
    )
  }
  writeJournal(paths, {
    version: 2,
    oldCurrent: relative(paths.deployRoot, oldCurrent),
    candidate: relative(paths.deployRoot, candidate)
  })
  ensureStandaloneCompatibilityLink(paths)
  return { oldCurrent, candidate }
}

const activationErrorMessages = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof AggregateError
    ? [message, ...error.errors.map(activationErrorMessages)].join('\n')
    : message
}

export const recordActivationFailure = (
  paths: DeploySlotPaths,
  error: unknown,
  stopConfirmed: boolean
) => {
  const journal = readActivationJournal(paths)
  if (!journal)
    throw new Error('Cannot record failure without an activation journal.')
  writeJournal(paths, {
    ...journal,
    version: 2,
    failure: {
      message: activationErrorMessages(error).slice(0, 16_384),
      stopConfirmed
    }
  })
}

export const completeCandidateActivation = (
  paths: DeploySlotPaths,
  expected?: { candidate: string; oldCurrent: string }
) => {
  const journal = readActivationJournal(paths)
  if (!journal)
    throw new Error('Cannot complete deployment without an activation journal.')
  const candidate = journalReleasePath(paths, journal.candidate)
  const oldCurrent = journalReleasePath(paths, journal.oldCurrent)
  if (
    expected &&
    (candidate !== expected.candidate || oldCurrent !== expected.oldCurrent)
  ) {
    throw new Error(
      'Activation journal changed before completion; refusing to commit a different release.'
    )
  }
  atomicSymlink(paths.previous, oldCurrent)
  atomicSymlink(paths.current, candidate)
  rmSync(paths.journal)
}

export const getCurrentDeployRelease = (paths: DeploySlotPaths) =>
  readReleasePointer(paths, paths.current)

export const getPreviousDeployRelease = (paths: DeploySlotPaths) =>
  readReleasePointer(paths, paths.previous)
