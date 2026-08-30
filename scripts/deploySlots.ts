import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
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

type ActivationJournal = {
  version: 1
  oldCurrent: string
  candidate: string
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

const assertReleasePath = (paths: DeploySlotPaths, releasePath: string) => {
  assertDirectory(releasePath, 'Deployment release')
  const releasesRoot = realpathSync(paths.releasesRoot)
  const resolved = realpathSync(releasePath)
  if (!isWithin(releasesRoot, resolved) || resolved === releasesRoot) {
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

const readJournal = (paths: DeploySlotPaths): ActivationJournal | null => {
  if (!existsSync(paths.journal)) return null
  if (!lstatSync(paths.journal).isFile()) {
    throw new Error('Deployment activation journal is not a regular file.')
  }
  const value = JSON.parse(readFileSync(paths.journal, 'utf8')) as unknown
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).sort().join(',') !== 'candidate,oldCurrent,version' ||
    (value as ActivationJournal).version !== 1 ||
    typeof (value as ActivationJournal).oldCurrent !== 'string' ||
    typeof (value as ActivationJournal).candidate !== 'string'
  ) {
    throw new Error('Deployment activation journal is invalid.')
  }
  return value as ActivationJournal
}

const journalReleasePath = (paths: DeploySlotPaths, relativePath: string) =>
  assertReleasePath(paths, resolve(paths.deployRoot, relativePath))

export const adoptLegacyDeploySlot = (paths: DeploySlotPaths) => {
  mkdirSync(paths.releasesRoot, { recursive: true })
  if (pathEntryExists(paths.current)) {
    const current = readReleasePointer(paths, paths.current)
    if (!pathEntryExists(paths.previous)) atomicSymlink(paths.previous, current)
    readReleasePointer(paths, paths.previous)
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
      dereference: false
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

export const installCandidateRelease = (
  paths: DeploySlotPaths,
  candidatePath: string,
  releaseId: string
) => {
  if (!/^[0-9a-f]{40}-[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(releaseId)) {
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
  candidateRelease: string
) => {
  const oldCurrent = adoptLegacyDeploySlot(paths)
  const candidate = assertReleasePath(paths, candidateRelease)
  if (readJournal(paths)) {
    throw new Error(
      'An interrupted deployment must be recovered before activation.'
    )
  }

  writeJournal(paths, {
    version: 1,
    oldCurrent: relative(paths.deployRoot, oldCurrent),
    candidate: relative(paths.deployRoot, candidate)
  })
  try {
    atomicSymlink(paths.previous, oldCurrent)
    atomicSymlink(paths.current, candidate)
  } catch (error) {
    recoverInterruptedActivation(paths)
    throw error
  }

  return { oldCurrent, candidate }
}

export const completeCandidateActivation = (paths: DeploySlotPaths) => {
  if (!readJournal(paths)) {
    throw new Error('Cannot complete deployment without an activation journal.')
  }
  rmSync(paths.journal)
}

export const pinPreviousToCurrent = (paths: DeploySlotPaths) => {
  const current = readReleasePointer(paths, paths.current)
  atomicSymlink(paths.previous, current)
  return current
}

export const recoverInterruptedActivation = (paths: DeploySlotPaths) => {
  const journal = readJournal(paths)
  if (!journal) return null
  const oldCurrent = journalReleasePath(paths, journal.oldCurrent)
  journalReleasePath(paths, journal.candidate)

  atomicSymlink(paths.current, oldCurrent)
  atomicSymlink(paths.previous, oldCurrent)
  rmSync(paths.journal)
  return oldCurrent
}

export const rollbackDeploySlots = (paths: DeploySlotPaths) => {
  const recovered = recoverInterruptedActivation(paths)
  if (recovered) return recovered

  adoptLegacyDeploySlot(paths)
  const previous = readReleasePointer(paths, paths.previous)
  atomicSymlink(paths.current, previous)
  atomicSymlink(paths.previous, previous)
  return previous
}

export const getCurrentDeployRelease = (paths: DeploySlotPaths) =>
  readReleasePointer(paths, paths.current)

export const getPreviousDeployRelease = (paths: DeploySlotPaths) =>
  readReleasePointer(paths, paths.previous)
