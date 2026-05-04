import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'

export const getRandomUniqueId = async (nsfwEnable: Prisma.patchWhereInput) => {
  const totalArticles = await prisma.patch.findMany({
    where: nsfwEnable,
    select: { unique_id: true }
  })
  if (totalArticles.length === 0) {
    return '未查询到文章'
  }
  const uniqueIds = totalArticles.map((a) => a.unique_id)
  const randomIndex = Math.floor(Math.random() * uniqueIds.length)

  return { uniqueId: uniqueIds[randomIndex] }
}
