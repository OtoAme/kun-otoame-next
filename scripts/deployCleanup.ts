import { basename, resolve } from 'node:path'
import { acquireDeployLock } from './deployLock'
import {
  cleanupDeployReleases,
  planDeployReleaseCleanup
} from './deployReleaseCleanup'
import { getDeploySlotPaths } from './deploySlots'

const main = () => {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    throw new Error(`Unknown release cleanup arguments: ${args.join(' ')}`)
  }
  const apply = args[0] === '--apply'
  const projectRoot = resolve(import.meta.dirname, '..')
  const paths = getDeploySlotPaths(projectRoot)
  const releaseLock = acquireDeployLock(paths.deployRoot)
  try {
    const plan = planDeployReleaseCleanup(paths)
    console.table([
      ...plan.retained.map((path) => ({
        release: basename(path),
        action: 'retain'
      })),
      ...plan.removable.map((path) => ({
        release: basename(path),
        action: 'remove'
      })),
      ...plan.skipped.map((path) => ({
        release: basename(path),
        action: 'skip'
      }))
    ])
    if (!apply) {
      console.log(
        `Preview: ${plan.removable.length} unused releases can be removed; no release files were deleted. Review before running pnpm deploy:cleanup:apply.`
      )
      return
    }
    const removed = cleanupDeployReleases(paths)
    console.log(`Removed ${removed.length} unused deployment releases.`)
  } finally {
    releaseLock()
  }
}

try {
  main()
} catch (error) {
  console.error('Deployment release cleanup failed:', error)
  process.exitCode = 1
}
