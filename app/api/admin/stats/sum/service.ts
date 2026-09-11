import { prisma } from '~/prisma/index'
import type { DashboardStatsSumData } from '~/types/api/admin'

export const getSumData = async (): Promise<DashboardStatsSumData> => {
  const [
    userCount,
    galgameCount,
    galgameResourceCount,
    galgamePatchResourceCount,
    galgameCommentCount,
    ratingCount,
    submissionCount,
    creatorCount,
    pendingCreatorApplyCount
  ] = await Promise.all([
    prisma.user.count(),
    prisma.patch.count(),
    prisma.patch_resource.count({
      where: { section: 'galgame' }
    }),
    prisma.patch_resource.count({
      where: { section: 'patch' }
    }),
    prisma.patch_comment.count(),
    prisma.patch_rating.count(),
    prisma.patch_submission.count(),
    prisma.user.count({ where: { role: 2 } }),
    prisma.user_message.count({
      where: {
        type: 'apply',
        sender_id: { not: null },
        recipient_id: null,
        status: { in: [0, 1] }
      }
    })
  ])

  return {
    userCount,
    galgameCount,
    galgameResourceCount,
    galgamePatchResourceCount,
    galgameCommentCount,
    ratingCount,
    submissionCount,
    creatorCount,
    pendingCreatorApplyCount
  }
}
