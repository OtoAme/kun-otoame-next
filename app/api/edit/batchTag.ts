import { prisma } from '~/prisma/index'
import { invalidateTagCaches } from '~/app/api/patch/cache'
import { normalizeStringArray } from '~/utils/normalizeStringArray'

const mapTagNamesToIds = <T extends { id: number; name: string; alias: string[] }>(
  tags: T[]
) => {
  const tagNameToId = new Map<string, number>()

  for (const tag of tags) {
    tagNameToId.set(tag.name, tag.id)
    for (const alias of tag.alias) {
      tagNameToId.set(alias, tag.id)
    }
  }

  return tagNameToId
}

const hasTagName = (tag: { name: string; alias: string[] }, tagNames: Set<string>) =>
  tagNames.has(tag.name) || tag.alias.some((alias) => tagNames.has(alias))

export const handleBatchPatchTags = async (
  patchId: number,
  tagArray: string[],
  uid: number
) => {
  const validTags = normalizeStringArray(tagArray)
  const validTagSet = new Set(validTags)

  const existingRelations = await prisma.patch_tag_relation.findMany({
    where: { patch_id: patchId },
    include: { tag: true }
  })

  const existingRelationTagNameToId = mapTagNamesToIds(
    existingRelations.map((rel) => rel.tag)
  )
  const tagsToAdd = validTags.filter(
    (tag) => !existingRelationTagNameToId.has(tag)
  )
  const tagsToRemove = existingRelations
    .filter((rel) => !hasTagName(rel.tag, validTagSet))
    .map((rel) => rel.tag_id)

  const existingTags =
    tagsToAdd.length > 0
      ? await prisma.patch_tag.findMany({
          where: {
            OR: tagsToAdd.map((tag) => ({
              OR: [{ name: tag }, { alias: { has: tag } }]
            }))
          }
        })
      : []

  const tagNameToId = mapTagNamesToIds(existingTags)
  const tagsToCreate = tagsToAdd.filter((tag) => !tagNameToId.has(tag))

  await prisma.$transaction(
    async (tx) => {
      if (tagsToCreate.length > 0) {
        await tx.patch_tag.createMany({
          data: tagsToCreate.map((name) => ({
            user_id: uid,
            name,
            source: 'self'
          })),
          skipDuplicates: true
        })
      }

      const newTags =
        tagsToCreate.length > 0
          ? await tx.patch_tag.findMany({
              where: { name: { in: tagsToCreate } },
              select: { id: true, name: true, alias: true }
            })
          : []

      for (const tag of newTags) {
        tagNameToId.set(tag.name, tag.id)
        for (const alias of tag.alias) {
          tagNameToId.set(alias, tag.id)
        }
      }

      const allTagIds = [
        ...new Set(
          tagsToAdd
            .map((tag) => tagNameToId.get(tag))
            .filter((tagId): tagId is number => typeof tagId === 'number')
        )
      ]

      if (allTagIds.length > 0) {
        await tx.patch_tag_relation.createMany({
          data: allTagIds.map((tagId) => ({
            patch_id: patchId,
            tag_id: tagId
          })),
          skipDuplicates: true
        })

        await tx.patch_tag.updateMany({
          where: { id: { in: allTagIds } },
          data: { count: { increment: 1 } }
        })
      }

      if (tagsToRemove.length > 0) {
        await tx.patch_tag_relation.deleteMany({
          where: { patch_id: patchId, tag_id: { in: tagsToRemove } }
        })

        await tx.patch_tag.updateMany({
          where: { id: { in: tagsToRemove } },
          data: { count: { decrement: 1 } }
        })
      }
    },
    { timeout: 60000 }
  )

  await invalidateTagCaches()

  return { success: true }
}
