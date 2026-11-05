import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'
import { setRealtimePatchDownloadStats } from '~/app/api/patch/views/buffer'
import type { GrantDownloadAccounting } from './access/grant'

const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'unknown'

/** Refresh public counters after the grant transaction commits. */
export const refreshGrantedDownloadCaches = async (
  target: GrantDownloadAccounting
) => {
  const steps = [
    [
      'download-count:realtime-stats',
      () => setRealtimePatchDownloadStats(target.uniqueId, target.download)
    ],
    [
      'download-count:content-cache',
      () => invalidatePatchContentCache(target.uniqueId)
    ],
    ['download-count:list-cache', () => invalidatePatchListCaches()]
  ] as const

  await Promise.all(
    steps.map(async ([operation, work]) => {
      try {
        await work()
      } catch (error) {
        console.error('[Resource] Postcommit operation failed', {
          operation,
          uniqueId: target.uniqueId,
          resourceId: target.resourceId,
          linkId: target.linkId,
          kind: target.kind,
          download: target.download,
          message: failureMessage(error)
        })
      }
    })
  )
}
