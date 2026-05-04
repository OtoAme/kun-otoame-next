import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { patchTagChangeSchema } from '~/validations/patch'

export const handleAddPatchTag = async (
  input: z.infer<typeof patchTagChangeSchema>
) => {
  const { patchId, tagId } = input

  return await prisma.$transaction(async (prisma) => {
    const relationData = tagId.map((id) => ({
      patch_id: patchId,
      tag_id: id
    }))
    await prisma.patch_tag_relation.createMany({
      data: relationData
    })

    await prisma.patch_tag.updateMany({
      where: { id: { in: tagId } },
      data: { count: { increment: 1 } }
    })
    return {}
  })
}

export const handleRemovePatchTag = async (
  input: z.infer<typeof patchTagChangeSchema>
) => {
  const { patchId, tagId } = input

  return await prisma.$transaction(async (prisma) => {
    await prisma.patch_tag_relation.deleteMany({
      where: {
        patch_id: patchId,
        tag_id: { in: tagId }
      }
    })

    await prisma.patch_tag.updateMany({
      where: { id: { in: tagId } },
      data: { count: { increment: -1 } }
    })
    return {}
  })
}
