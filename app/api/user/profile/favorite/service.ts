import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { getUserInfoSchema } from '~/validations/user'

export const getUserFavorite = async (
  input: z.infer<typeof getUserInfoSchema>,
  nsfwEnable: Record<string, string | undefined>
) => {
  const { uid, page, limit } = input
  const offset = (page - 1) * limit

  // const [data, total] = await Promise.all([
  //   prisma.user_patch_favorite_relation.findMany({
  //     where: { user_id: uid, patch: nsfwEnable },
  //     include: {
  //       patch: {
  //         select: GalgameCardSelectField
  //       }
  //     },
  //     orderBy: { created: 'desc' },
  //     take: limit,
  //     skip: offset
  //   }),
  //   prisma.user_patch_favorite_relation.count({
  //     where: { user_id: uid, patch: nsfwEnable }
  //   })
  // ])

  // const favorites: GalgameCard[] = data.map((gal) => ({
  //   ...gal.patch,
  //   tags: gal.patch.tag.map((t) => t.tag.name).slice(0, 3),
  //   uniqueId: gal.patch.unique_id
  // }))

  return { favorites: [], total: 0 }
}
