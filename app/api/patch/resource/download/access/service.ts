import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { accessPatchResourceLinkSchema } from '~/validations/patch'
import type { Prisma } from '@prisma/client'
import type { PatchResourceAccessResponse } from '~/types/api/patch'

export const accessPatchResourceLink = async (
  input: z.infer<typeof accessPatchResourceLinkSchema>,
  visibilityWhere: Prisma.patchWhereInput
): Promise<PatchResourceAccessResponse | string> => {
  const link = await prisma.patch_resource_link.findFirst({
    where: {
      id: input.linkId,
      resource_id: input.resourceId,
      resource: {
        id: input.resourceId,
        patch_id: input.patchId,
        status: 0,
        patch: {
          id: input.patchId,
          status: 0,
          ...visibilityWhere
        }
      }
    },
    select: {
      id: true,
      storage: true,
      size: true,
      content: true,
      code: true,
      password: true,
      hash: true
    }
  })

  if (!link) {
    return '未找到对应资源链接'
  }

  return { link }
}
