import { resolve } from 'node:path'
import { acquireDeployLock, DEPLOY_LOCK_OWNER_PID_ENV } from './deployLock'
import { assertCleanDeployWorktree, runDeployCommand } from './deployProcess'
import { validateStandaloneRuntime } from './deployPm2'
import { adoptLegacyDeploySlot, getDeploySlotPaths } from './deploySlots'

const projectRoot = resolve(import.meta.dirname, '..')
const pinned = process.argv.slice(2)
if (pinned.length > 1 || (pinned.length === 1 && pinned[0] !== '--pinned')) {
  throw new Error(`Unknown deploy pull launcher arguments: ${pinned.join(' ')}`)
}

const slots = getDeploySlotPaths(projectRoot)
const releaseLock = acquireDeployLock(slots.deployRoot)
try {
  assertCleanDeployWorktree(projectRoot)
  validateStandaloneRuntime(adoptLegacyDeploySlot(slots))
  if (pinned.length === 0) {
    runDeployCommand('git', ['pull', '--ff-only'], { cwd: projectRoot })
  }
  runDeployCommand(
    'pnpm',
    ['exec', 'esno', 'scripts/deployPull.ts', ...pinned, '--lock-held'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        [DEPLOY_LOCK_OWNER_PID_ENV]: String(process.pid)
      }
    }
  )
} finally {
  releaseLock()
}
