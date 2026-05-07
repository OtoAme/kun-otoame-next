import { prisma } from '~/prisma/index'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches,
  invalidateTagCaches
} from '~/app/api/patch/cache'

const removeBlockedTagIds = async (tagIds: number[]) => {
  if (!tagIds.length) {
    return
  }

  const tagIdSet = new Set(tagIds)
  const users = await prisma.user.findMany({
    where: {
      OR: tagIds.map((tagId) => ({
        blocked_tag_ids: { has: tagId }
      }))
    },
    select: {
      id: true,
      blocked_tag_ids: true
    }
  })
  if (!users.length) {
    return
  }

  await prisma.$transaction(
    users.map((user) =>
      prisma.user.update({
        where: { id: user.id },
        data: {
          blocked_tag_ids: user.blocked_tag_ids.filter(
            (tagId) => !tagIdSet.has(tagId)
          )
        }
      })
    )
  )
}

export const deleteTag = async (tagId: number) => {
  const tag = await prisma.patch_tag.findUnique({
    where: { id: tagId },
    select: {
      id: true,
      patch_relation: {
        select: {
          patch: {
            select: {
              unique_id: true
            }
          }
        }
      }
    }
  })
  if (!tag) {
    return '未找到对应的标签'
  }

  await prisma.$transaction(async (prisma) => {
    await prisma.patch_tag_relation.deleteMany({
      where: { tag_id: tagId }
    })

    await prisma.patch_tag.delete({
      where: { id: tagId }
    })
  })

  await removeBlockedTagIds([tagId])

  const affectedUniqueIds = [
    ...new Set(tag.patch_relation.map((relation) => relation.patch.unique_id))
  ]

  await Promise.all([
    invalidateTagCaches(),
    invalidatePatchListCaches(),
    ...affectedUniqueIds.map((uniqueId) =>
      invalidatePatchContentCache(uniqueId)
    )
  ])

  return {}
}
