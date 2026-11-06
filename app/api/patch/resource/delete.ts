import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { closeLinkCases } from '~/app/api/case/linkHealth'
import { transferPublisherCasesOnHandover } from '~/app/api/case/service'
import {
  getCurrentBalance,
  reverseMoemoepoint
} from '~/app/api/moemoepoint/service'
import { MOEMOEPOINT_REASON } from '~/constants/moemoepoint'
import { deleteFileFromS3 } from '~/lib/s3'
import {
  PrismaResourceFileCleanupClient,
  ResourceFileCleanupError,
  processResourceFileCleanup,
  queueResourceFileCleanup
} from '~/lib/resourceFileCleanup'
import { prisma } from '~/prisma/index'
import { safeRevalidatePath } from '~/app/api/patch/revalidate'
import {
  deletePatchResourceCache,
  deletePatchResourceLink,
  updatePatchAttributes
} from './_helper'
import { lockLinkMaintenance } from './maintenance/service'
import {
  HANDOVER_MESSAGES,
  ResourceMutationError,
  lockResourceForMutation,
  markPublisherLeft,
  readLinkChangeFacts,
  readPublisherLeftAt,
  resourcePostCommit,
  runResourceMutation
} from './mutation'
import type { LinkChangeFact } from './mutation'
import type { Prisma } from '@prisma/client'

const iso = (value: Date | null) => value?.toISOString() ?? '无'

const handoverLog = (
  resourceId: number,
  removedCount: number,
  facts: readonly LinkChangeFact[]
) => {
  const backupAt = facts
    .filter((fact) => fact.storage === 'touchgal')
    .reduce<Date | null>(
      (latest, fact) =>
        fact.changedAt && (!latest || fact.changedAt > latest)
          ? fact.changedAt
          : latest,
      null
    )
  const stale = facts.filter(
    (fact) =>
      fact.storage === 'user' &&
      fact.changedAt !== null &&
      backupAt !== null &&
      fact.changedAt.getTime() > backupAt.getTime()
  )
  return [
    `资源 ${resourceId} 已交由站方维护`,
    `移除链接 ${removedCount} 条`,
    `晚于备份时间的外部链接 ${stale.length} 条`,
    `备份时间 ${iso(backupAt)}`,
    ...stale.map((fact) => `链接 ${fact.id} 变动时间 ${iso(fact.changedAt)}`)
  ].join('\n')
}

const deleteQueuedObject = async (
  objectKey: string
): Promise<'deleted' | 'absent'> => {
  try {
    await deleteFileFromS3(objectKey)
    return 'deleted'
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const code =
      typeof error === 'object' && error !== null && 'Code' in error
        ? String((error as { Code?: unknown }).Code ?? '')
        : ''
    if (
      name === 'NoSuchKey' ||
      name === 'NotFound' ||
      code === 'NoSuchKey' ||
      code === 'NotFound'
    ) {
      return 'absent'
    }
    throw error
  }
}

const queueRemovedLinks = async (
  tx: Prisma.TransactionClient,
  resourceId: number,
  links: readonly { storage: string; content: string }[]
) => {
  try {
    return await queueResourceFileCleanup(
      tx as PrismaResourceFileCleanupClient,
      { resourceId, links }
    )
  } catch (error) {
    if (error instanceof ResourceFileCleanupError) {
      throw new ResourceMutationError(
        error.code === 'invalid_locator'
          ? HANDOVER_MESSAGES.invalidLocator
          : HANDOVER_MESSAGES.cleanupUnavailable,
        error.code === 'invalid_locator' ? 409 : 503
      )
    }
    throw error
  }
}

export const deleteResource = async (
  input: { resourceId: number; action?: 'handover' | 'delete' },
  uid: number,
  userRole: number,
  options: { expectedOwnerId?: number } = {}
) => {
  try {
    const result = await runResourceMutation(async (tx) => {
      const patchResource = await lockResourceForMutation(tx, input.resourceId)
      if (!patchResource)
        throw new ResourceMutationError('未找到对应的资源', 404)
      if (
        options.expectedOwnerId !== undefined &&
        patchResource.user_id !== options.expectedOwnerId
      )
        throw new ResourceMutationError('您没有权限操作该资源', 403)
      const leftAt = await readPublisherLeftAt(tx, patchResource.id)
      const hasTouchgal = patchResource.links.some(
        (link) => link.storage === 'touchgal'
      )
      const isAuthor = patchResource.user_id === uid
      if (input.action === 'handover') {
        if (!isAuthor || userRole >= 3)
          throw new ResourceMutationError(HANDOVER_MESSAGES.forbidden, 403)
        if (leftAt) {
          return {
            action: 'handed_over' as const,
            idempotent: true,
            uniqueId: patchResource.patch.unique_id,
            balanceUserId: patchResource.user_id,
            moemoepointBalance: await getCurrentBalance(
              tx,
              patchResource.user_id
            ),
            cleanupJobIds: [] as number[]
          }
        }
        if (!hasTouchgal)
          throw new ResourceMutationError(HANDOVER_MESSAGES.backupMissing, 409)
        const now = new Date()
        const removed = patchResource.links.filter(
          (link) => link.storage !== 'touchgal'
        )
        const facts = await readLinkChangeFacts(tx, [patchResource.id])
        const queued = removed.length
          ? await queueRemovedLinks(tx, patchResource.id, removed)
          : { jobIds: [] as number[] }
        if (removed.length) {
          await lockLinkMaintenance(
            tx,
            removed.map((link) => link.id)
          )
          for (const link of removed) {
            await tx.patch_resource_link_history.create({
              data: {
                resource_id: patchResource.id,
                link_id: link.id,
                from_version: link.version,
                old_content: link.content,
                old_storage: link.storage,
                old_size: link.size,
                reason: 'remove',
                operator_user_id: uid,
                created: now
              }
            })
          }
          await tx.patch_resource_access.updateMany({
            where: { link_id: { in: removed.map((link) => link.id) } },
            data: { link_id: null }
          })
          await closeLinkCases(tx, {
            linkIds: removed.map((link) => link.id),
            resolution: 'link_removed',
            actorType: 'publisher',
            actorId: uid,
            excludeRecipientIds: [uid],
            suppressPublisher: true,
            now
          })
          const deleted = await tx.patch_resource_link.deleteMany({
            where: {
              resource_id: patchResource.id,
              id: { in: removed.map((link) => link.id) }
            }
          })
          if (deleted.count !== removed.length)
            throw new ResourceMutationError(HANDOVER_MESSAGES.caseConflict, 409)
        }
        if (!(await markPublisherLeft(tx, patchResource.id, now)))
          throw new ResourceMutationError(HANDOVER_MESSAGES.caseConflict, 409)
        await transferPublisherCasesOnHandover(tx, patchResource.id, now)
        await tx.admin_log.create({
          data: {
            type: 'resource_handover',
            user_id: uid,
            content: handoverLog(patchResource.id, removed.length, facts)
          }
        })
        return {
          action: 'handed_over' as const,
          idempotent: false,
          uniqueId: patchResource.patch.unique_id,
          balanceUserId: patchResource.user_id,
          moemoepointBalance: await getCurrentBalance(
            tx,
            patchResource.user_id
          ),
          cleanupJobIds: queued.jobIds
        }
      }
      if (!isAuthor && userRole < 3)
        throw new ResourceMutationError('您没有权限删除该资源', 403)
      if (userRole < 3 && leftAt)
        throw new ResourceMutationError(HANDOVER_MESSAGES.deleteClosed, 403)
      if (userRole < 3 && hasTouchgal) {
        throw new ResourceMutationError(
          input.action === 'delete'
            ? HANDOVER_MESSAGES.backupChanged
            : LINK_HEALTH_ERRORS.forbidden.message,
          input.action === 'delete' ? 409 : 403
        )
      }
      const now = new Date()
      await closeLinkCases(tx, {
        resourceIds: [patchResource.id],
        resolution: 'link_removed',
        actorType: userRole >= 3 ? 'staff' : 'publisher',
        actorId: uid,
        now
      })
      const moemoepointBalance = leftAt
        ? await getCurrentBalance(tx, patchResource.user_id)
        : (
            await reverseMoemoepoint(tx, {
              userId: patchResource.user_id,
              amount: 3,
              reasonCode: MOEMOEPOINT_REASON.resourceDeleted.code,
              reason: `${MOEMOEPOINT_REASON.resourceDeleted.text}：${patchResource.name}`,
              referenceType: 'patch_resource',
              referenceId: patchResource.id,
              idempotencyKey: `resource:${patchResource.id}:delete-reversal`
            })
          ).balance
      if (userRole >= 3 && leftAt) {
        await tx.admin_log.create({
          data: {
            type: 'delete',
            user_id: uid,
            content: `管理员删除已交接资源 #${patchResource.id}\n\n已交接，保留原发布奖励`
          }
        })
      }
      await tx.patch_resource.delete({ where: { id: patchResource.id } })
      return {
        action: 'deleted' as const,
        idempotent: false,
        uniqueId: await updatePatchAttributes(patchResource.patch_id, tx),
        balanceUserId: patchResource.user_id,
        moemoepointBalance,
        s3Contents: [
          ...new Set(
            patchResource.links
              .filter((link) => link.storage === 's3')
              .map((link) => link.content)
          )
        ],
        cleanupJobIds: [] as number[]
      }
    })
    if (!result.idempotent) {
      await resourcePostCommit('resource-delete-cache', () =>
        deletePatchResourceCache(result.uniqueId)
      )
      await resourcePostCommit('resource-author-page', async () => {
        safeRevalidatePath(`/user/${result.balanceUserId}/resource`, 'page')
      })
    }
    if (result.action === 'deleted') {
      for (const content of result.s3Contents)
        await resourcePostCommit('resource-delete-object', () =>
          deletePatchResourceLink(content)
        )
    } else if (result.cleanupJobIds.length) {
      const jobIds = result.cleanupJobIds
      await resourcePostCommit('resource-handover-cleanup', () =>
        processResourceFileCleanup(prisma as PrismaResourceFileCleanupClient, {
          ids: jobIds,
          deleteObject: deleteQueuedObject
        })
      )
    }
    return {
      action: result.action,
      balanceUserId: result.balanceUserId,
      moemoepointBalance: result.moemoepointBalance
    }
  } catch (error) {
    if (error instanceof ResourceMutationError) return error.message
    throw error
  }
}
