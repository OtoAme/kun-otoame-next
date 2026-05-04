import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResourceStatsSchema } from '~/validations/patch'

export const downloadStats = async (
  input: z.infer<typeof updatePatchResourceStatsSchema>
) => {
  return await prisma.$transaction(async (prisma) => {
    await prisma.patch.update({
      where: { id: input.patchId },
      data: { download: { increment: 1 } }
    })

    await prisma.patch_resource.update({
      where: { id: input.resourceId },
      data: { download: { increment: 1 } }
    })
    return {}
  })
}
