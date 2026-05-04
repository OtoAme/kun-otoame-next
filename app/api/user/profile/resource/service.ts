import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { getUserInfoSchema } from '~/validations/user'
import type { UserResource } from '~/types/api/user'

export const getUserPatchResource = async (
  input: z.infer<typeof getUserInfoSchema>,
  nsfwEnable: Prisma.patchWhereInput
) => {
  const { uid, page, limit } = input
  const offset = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.patch_resource.findMany({
      where: { user_id: uid, patch: nsfwEnable, status: 0 },
      include: {
        patch: {
          select: {
            id: true,
            unique_id: true,
            name: true,
            banner: true
          }
        }
      },
      orderBy: { created: 'desc' },
      skip: offset,
      take: limit
    }),
    prisma.patch_resource.count({
      where: { user_id: uid, patch: nsfwEnable, status: 0 }
    })
  ])

  const resources: UserResource[] = data.map((res) => ({
    id: res.id,
    patchUniqueId: res.patch.unique_id,
    patchId: res.patch.id,
    patchName: res.patch.name,
    patchBanner: res.patch.banner,
    section: res.section,
    size: res.size,
    type: res.type,
    language: res.language,
    platform: res.platform,
    created: String(res.created)
  }))

  return { resources, total }
}
