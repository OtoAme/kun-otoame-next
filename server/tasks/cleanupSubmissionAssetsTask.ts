import cron from 'node-cron'
import {
  createSubmissionAssetCleanupDependencies,
  printSubmissionAssetCleanupSummary,
  runSubmissionAssetCleanup
} from '~/scripts/cleanupSubmissionAssets'
import { withTaskLock } from './withTaskLock'

const LOCK_KEY = 'cron:submission-assets-audit:lock'
const LOCK_TTL_SECONDS = 8 * 60 * 60
const TIMEZONE = 'Asia/Shanghai'

export const inspectSubmissionAssets = async () => {
  const dependencies = await createSubmissionAssetCleanupDependencies()
  const options = { apply: false, graceHours: 24 } as const

  // This is a long-lived server process. dependencies.close() disconnects the
  // shared Prisma client and belongs only to the CLI entrypoint.
  const result = await runSubmissionAssetCleanup(options, dependencies)
  printSubmissionAssetCleanupSummary(options, result)
  return result
}

export const cleanupSubmissionAssetsTask = cron.createTask(
  '0 4 * * *',
  async () => {
    await withTaskLock(
      {
        key: LOCK_KEY,
        ttlSeconds: LOCK_TTL_SECONDS,
        taskName: 'cleanupSubmissionAssetsTask'
      },
      inspectSubmissionAssets
    ).catch((error) => {
      console.error('Error auditing patch submission assets:', error)
    })
  },
  { timezone: TIMEZONE, noOverlap: true }
)
