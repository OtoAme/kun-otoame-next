import cron from 'node-cron'
import { prisma } from '~/prisma/index'
import { LINK_HEALTH_POLICY as P } from '~/constants/linkHealth'
import { withTaskLock } from './withTaskLock'
import { getKv, setKv } from '~/lib/redis'
import { runDueLinkHealth } from '~/app/api/patch/resource/link/service'
import type { LinkHealth } from '~/types/api/linkHealth'
export const LINK_HEALTH_CRON_EXPRESSION = '27 * * * *'
const CURSOR_KEY = 'link-health:task-cursor'
let fallbackCursor = 0
export const runLinkHealthTask = async (now = new Date()) => {
  let changed = 0
  let cursor = fallbackCursor
  try {
    const stored = await getKv(CURSOR_KEY)
    if (
      typeof stored === 'string' &&
      /^\d{1,10}$/.test(stored) &&
      Number(stored) <= 2147483647
    )
      cursor = Number(stored)
  } catch {
    console.error('[LinkHealth] Task cursor read unavailable')
  }
  for (let round = 0; round < 10; round++) {
    const rows = await prisma.patch_resource_link.findMany({
      where: {
        id: { gt: cursor },
        OR: [
          {
            health: 'suspect',
            health_changed_at: {
              lte: new Date(now.getTime() - P.suspectTimeoutMs)
            }
          },
          {
            health: 'disputed',
            health_changed_at: {
              lte: new Date(now.getTime() - P.disputeConvergenceMs)
            }
          }
        ]
      },
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true,
        version: true,
        evidence_round: true,
        health: true,
        health_changed_at: true,
        resource_id: true,
        resource: { select: { patch_id: true } }
      }
    })
    if (!rows.length) {
      cursor = 0
      break
    }
    for (const row of rows) {
      cursor = row.id
      try {
        const result = await runDueLinkHealth(
          {
            patchId: row.resource.patch_id,
            resourceId: row.resource_id,
            linkId: row.id,
            linkVersion: row.version,
            health: row.health as LinkHealth,
            evidenceRound: row.evidence_round,
            healthChangedAt: row.health_changed_at?.toISOString() ?? null
          },
          now
        )
        if (result.changed) changed++
      } catch {
        console.error('[LinkHealth] Due transition unavailable')
      }
    }
    if (rows.length < 200) break
  }
  fallbackCursor = cursor
  try {
    await setKv(CURSOR_KEY, String(cursor), 7 * 86400)
  } catch {
    console.error('[LinkHealth] Task cursor write unavailable')
  }
  return { changed }
}
export const linkHealthTask = cron.createTask(
  LINK_HEALTH_CRON_EXPRESSION,
  () =>
    withTaskLock(
      {
        key: 'task:link-health',
        ttlSeconds: 55 * 60,
        taskName: 'linkHealthTask',
        releaseOnComplete: true
      },
      () => runLinkHealthTask()
    ),
  { timezone: 'Asia/Shanghai', noOverlap: true }
)
