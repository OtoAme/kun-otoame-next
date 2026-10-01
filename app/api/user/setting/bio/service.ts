import { prisma } from '~/prisma/index'

export const updateBio = async (bio: string, uid: number) => {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { bio: true }
  })
  if (!user) {
    return '用户未找到'
  }
  if (bio === user.bio.trim()) {
    return {}
  }

  await prisma.user.updateMany({
    where: { id: uid, bio: { not: bio } },
    data: { bio }
  })
  return {}
}
