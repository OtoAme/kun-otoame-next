import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { createNotificationBatch, notificationTransaction } from './message'

export const notifyFollowedPublication = (
  patchId: number,
  resourceId?: number,
  database: Prisma.TransactionClient | PrismaClient = prisma
) =>
  notificationTransaction(database, async (tx) => {
    const patch = await tx.patch.findFirst({
      where: { id: patchId, status: 0 },
      select: {
        user_id: true,
        name: true,
        unique_id: true,
        content_limit: true
      }
    })
    if (!patch) return

    const resource =
      resourceId === undefined
        ? null
        : await tx.patch_resource.findFirst({
            where: { id: resourceId, patch_id: patchId, status: 0 },
            select: { id: true, user_id: true, name: true }
          })
    if (resourceId !== undefined && !resource) return
    const author = resource?.user_id ?? patch.user_id
    const followers = await tx.$queryRaw<{ id: number }[]>`
      SELECT reader.id FROM user_follow_relation f
      JOIN public."user" reader ON reader.id = f.follower_id
      WHERE f.following_id = ${author} AND reader.id <> ${author} AND reader.status = 0
        AND (reader.nsfw_mode = 'all' OR COALESCE(reader.nsfw_mode, 'sfw') = ${patch.content_limit})
        AND NOT EXISTS (SELECT 1 FROM patch_tag_relation tag
          WHERE tag.patch_id = ${patchId} AND tag.tag_id = ANY(reader.blocked_tag_ids))
      ORDER BY reader.id
      FOR KEY SHARE OF reader, f
    `
    const content = resource
      ? `在《${patch.name}》发布了新资源${resource.name ? `「${resource.name}」` : ''}。`
      : `发布了新游戏条目《${patch.name}》。`
    const link = resource
      ? `/${patch.unique_id}?tab=resources#resource-${resource.id}`
      : `/${patch.unique_id}`
    for (let index = 0; index < followers.length; index += 250) {
      await createNotificationBatch(
        followers.slice(index, index + 250).map(({ id }) => ({
          event_type: 'follow-publication',
          type: 'follow',
          sender_id: author,
          recipient_id: id,
          content,
          link
        })),
        tx,
        true
      )
    }
  })
