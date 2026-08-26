import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { getUserInfoSchema } from '~/validations/user'
import {
  GalgameCardSelectField,
  toGalgameCardCount
} from '~/constants/api/select'

/**
 * A user's published game entries, for the public profile tab. For an ordinary
 * submitter these are exactly their approved submissions (approval sets the new
 * patch's user_id to the submitter); an admin's directly created entries appear
 * here too. NSFW visibility is applied by the caller.
 */
export const getUserPatch = async (
  input: z.infer<typeof getUserInfoSchema>,
  nsfwEnable: Prisma.patchWhereInput
) => {
  const { uid, page, limit } = input
  const offset = (page - 1) * limit
  const where: Prisma.patchWhereInput = { user_id: uid, ...nsfwEnable }

  const [data, total] = await Promise.all([
    prisma.patch.findMany({
      where,
      select: GalgameCardSelectField,
      // `created` alone is not a total order, and offset pagination over a tied
      // sort key may repeat or skip rows between pages. The id breaks the tie.
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit
    }),
    prisma.patch.count({ where })
  ])

  const galgames: GalgameCard[] = data.map((gal) => ({
    id: gal.id,
    uniqueId: gal.unique_id,
    name: gal.name,
    banner: gal.banner,
    view: gal.view,
    download: gal.download,
    type: gal.type,
    language: gal.language,
    platform: gal.platform,
    tags: gal.tag.map((t) => t.tag.name).slice(0, 3),
    created: gal.created,
    _count: toGalgameCardCount(gal),
    averageRating: gal.rating_stat?.avg_overall
      ? Math.round(gal.rating_stat.avg_overall * 10) / 10
      : 0
  }))

  return { galgames, total }
}
