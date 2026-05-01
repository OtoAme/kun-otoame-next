import { prisma } from '~/prisma/index'
import type { OverviewData } from '~/types/api/admin'

export const getOverviewData = async (days: number): Promise<OverviewData> => {
  const time = new Date()
  time.setDate(time.getDate() - days)

  const [newUser, newActiveUser, newGalgame, newGalgameResource, newComment] =
    await Promise.all([
      prisma.user.count({
        where: {
          created: {
            gte: time
          }
        }
      }),
      prisma.user.count({
        where: {
          last_login_time: {
            gte: time.getTime().toString()
          }
        }
      }),
      prisma.patch.count({
        where: {
          created: {
            gte: time
          }
        }
      }),
      prisma.patch_resource.count({
        where: {
          created: {
            gte: time
          }
        }
      }),
      prisma.patch_comment.count({
        where: {
          created: {
            gte: time
          }
        }
      })
    ])

  return { newUser, newActiveUser, newGalgame, newGalgameResource, newComment }
}
