import {
  lockPreferenceTags,
  maintainBlockedTagPreferences
} from '~/lib/accountPreferences/service'
import { prisma } from '~/prisma/index'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches,
  invalidateTagCaches
} from '~/app/api/patch/cache'

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
    await lockPreferenceTags(prisma, [tagId])
    await maintainBlockedTagPreferences(prisma, [tagId])
    await prisma.patch_tag_relation.deleteMany({
      where: { tag_id: tagId }
    })

    await prisma.patch_tag.delete({
      where: { id: tagId }
    })
  })

  const affectedUniqueIds = [
    ...new Set(tag.patch_relation.map((relation) => relation.patch.unique_id))
  ]

  await Promise.all([
    invalidateTagCaches(tagId),
    invalidatePatchListCaches(),
    ...affectedUniqueIds.map((uniqueId) =>
      invalidatePatchContentCache(uniqueId)
    )
  ])

  return {}
}
