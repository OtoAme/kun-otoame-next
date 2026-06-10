import { prisma } from '~/prisma/index'
import { invalidateTagCaches } from '~/app/api/patch/cache'
import { normalizeStringArray } from '~/utils/normalizeStringArray'
import {
  buildTagLookupWhere,
  getCanonicalTagIds,
  hasAnyTagName,
  hasTagName,
  mapTagNamesToIds
} from './tagEnsureHelper'

export const handleBatchPatchTags = async (
  patchId: number,
  tagArray: string[],
  uid: number
) => {
  const validTags = normalizeStringArray(tagArray)

  const existingRelations = await prisma.patch_tag_relation.findMany({
    where: { patch_id: patchId },
    include: { tag: true }
  })

  const existingTags =
    validTags.length > 0
      ? await prisma.patch_tag.findMany({
          where: buildTagLookupWhere(validTags),
          orderBy: { id: 'asc' }
        })
      : []

  const tagNameToId = mapTagNamesToIds([
    ...existingRelations.map((rel) => rel.tag),
    ...existingTags
  ])
  const tagsToCreate = validTags.filter(
    (tag) => !tagNameToId.has(tag) && !hasAnyTagName(existingTags, tag)
  )

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

      const allTagIds = getCanonicalTagIds(validTags, tagNameToId)
      const allTagIdSet = new Set(allTagIds)
      const existingRelationIds = new Set(
        existingRelations.map((relation) => relation.tag_id)
      )
      const tagsToAdd = allTagIds.filter(
        (tagId) => !existingRelationIds.has(tagId)
      )
      const tagsToRemove = existingRelations
        .filter((rel) => {
          if (allTagIdSet.has(rel.tag_id)) {
            return false
          }

          const matchedSubmittedNames = validTags.filter((tagName) =>
            hasTagName(rel.tag, new Set([tagName]))
          )
          if (!matchedSubmittedNames.length) {
            return true
          }

          return matchedSubmittedNames.some((tagName) => {
            const canonicalTagId = tagNameToId.get(tagName)
            return (
              typeof canonicalTagId === 'number' &&
              canonicalTagId !== rel.tag_id
            )
          })
        })
        .map((rel) => rel.tag_id)

      if (tagsToAdd.length > 0) {
        await tx.patch_tag_relation.createMany({
          data: tagsToAdd.map((tagId) => ({
            patch_id: patchId,
            tag_id: tagId
          })),
          skipDuplicates: true
        })

        await tx.patch_tag.updateMany({
          where: { id: { in: tagsToAdd } },
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
