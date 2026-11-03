import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  assertInheritedDeployLock,
  DEPLOY_LOCK_OWNER_PID_ENV
} from './deployLock'
import {
  getCurrentDeployRelease,
  getPreviousDeployRelease,
  isImmutableDeployReleaseId,
  type DeploySlotPaths
} from './deploySlots'

export type DeployReleaseCleanupPlan = {
  retained: string[]
  removable: string[]
  skipped: string[]
}

const assertCleanupRoot = (path: string) => {
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) {
    throw new Error(`Release cleanup requires a real directory: ${path}`)
  }
}

const assertNoActivationJournal = (paths: DeploySlotPaths) => {
  try {
    lstatSync(paths.journal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  // Even an unreadable or broken journal may describe a required recovery.
  throw new Error('Recover the interrupted deployment before release cleanup.')
}

const isManagedReleaseId = (name: string) =>
  name === 'legacy-initial' || isImmutableDeployReleaseId(name)

// Callers hold the deployment operation lock while previewing or deleting.
export const planDeployReleaseCleanup = (
  paths: DeploySlotPaths
): DeployReleaseCleanupPlan => {
  assertCleanupRoot(paths.deployRoot)
  assertCleanupRoot(paths.releasesRoot)
  assertNoActivationJournal(paths)

  const retained = [
    ...new Set([
      getCurrentDeployRelease(paths),
      getPreviousDeployRelease(paths)
    ])
  ]
  for (const release of retained) {
    if (
      dirname(release) !== paths.releasesRoot ||
      !isManagedReleaseId(basename(release))
    ) {
      throw new Error(
        `Release cleanup cannot trust the retained pointer: ${release}`
      )
    }
  }

  const plan: DeployReleaseCleanupPlan = {
    retained,
    removable: [],
    skipped: []
  }
  for (const entry of readdirSync(paths.releasesRoot, {
    withFileTypes: true
  }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(paths.releasesRoot, entry.name)
    if (retained.includes(path)) continue
    if (!entry.isDirectory() || !isManagedReleaseId(entry.name)) {
      plan.skipped.push(path)
      continue
    }
    plan.removable.push(path)
  }
  return plan
}

export const cleanupDeployReleases = (paths: DeploySlotPaths): string[] => {
  assertCleanupRoot(paths.deployRoot)
  assertInheritedDeployLock(
    paths.deployRoot,
    process.env[DEPLOY_LOCK_OWNER_PID_ENV] || String(process.pid)
  )
  const plan = planDeployReleaseCleanup(paths)
  for (const release of plan.removable) {
    // The shared operation lock prevents deployment and rollback from changing
    // pointers while this plan is applied. rm does not traverse symlink targets.
    rmSync(release, { recursive: true })
    console.log(`Removed unused deployment release: ${basename(release)}`)
  }
  return plan.removable
}
