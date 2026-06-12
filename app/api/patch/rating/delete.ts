import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { recomputePatchRatingStat } from './stat'
import {
  invalidatePatchContentCache,
  invalidatePatchListCaches
} from '~/app/api/patch/cache'

const ratingIdSchema = z.object({
  ratingId: z.coerce.number({ message: 'ID 不正确' }).min(1).max(9999999)
})

export const deletePatchRating = async (
  input: z.infer<typeof ratingIdSchema>,
  uid: number,
  userRole: number
) => {
  const rating = await prisma.patch_rating.findUnique({
    where: { id: input.ratingId },
    include: {
      patch: {
        select: {
          unique_id: true
        }
      }
    }
  })
  if (!rating) {
    return '评价不存在'
  }

  if (rating.user_id !== uid && userRole < 3) {
    return '您没有权限删除该评价'
  }

  await prisma.patch_rating.delete({ where: { id: input.ratingId } })

  await recomputePatchRatingStat(rating.patch_id)
  await Promise.all([
    invalidatePatchContentCache(rating.patch.unique_id),
    invalidatePatchListCaches()
  ]).catch((error) => {
    console.error('Failed to invalidate patch rating cache:', error)
  })

  return {}
}
